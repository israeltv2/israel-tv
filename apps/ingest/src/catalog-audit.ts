// The publisher's own audit of what it is about to publish (after every render), so the catalog stays clean:
// poster shapes and reachability, numbering, leftover site text, year lines, and catalog items that disagree with
// their show pages. Results are on /status ("Catalog audit"); nothing is fetched (remote posters' shapes come
// from their measurements).
import { ORIGIN_TOKEN, type StatusFile } from '@israel-tv/core';
import type { SiteFiles } from '@israel-tv/render';
import type { Store } from '@israel-tv/store';
import { imageSize, isPortrait, reachableAbroad, remotePosterShape } from './posters.ts';

type Meta = {
  id: string;
  name?: string;
  poster?: string;
  posterShape?: string;
  description?: string;
  releaseInfo?: string;
  background?: string;
  videos?: { id: string; title?: string; season?: number; episode?: number; thumbnail?: string }[];
};

/** Text that should never reach a viewer: entities, tags, template placeholders, SEO phrases, stray separators. */
const JUNK =
  /&(?:amp|nbsp|quot|lt|gt|#\d+);|<\/?[a-z][^>]*>|%%[a-z_]+%%|לצפייה ישירה|^\s*[|\-–·]|[|\-–·]\s*$/i;

export function auditSite(
  files: SiteFiles,
  store: Store,
  now = Date.now(),
): NonNullable<StatusFile['audit']> {
  const found = new Map<string, string[]>();
  const flag = (check: string, id: string) => {
    const list = found.get(check) ?? [];
    list.push(id);
    found.set(check, list);
  };
  const text = (p: string) => {
    const v = files.get(p);
    return typeof v === 'string' ? v : undefined;
  };
  const ours = (u: string) =>
    u.startsWith(`${ORIGIN_TOKEN}/`) ? u.slice(ORIGIN_TOKEN.length + 1) : undefined;
  const items = new Map<string, Meta>();
  for (const [path, body] of files) {
    if (!/^catalog\/series\/[^/]+\.json$/.test(path) || typeof body !== 'string') continue;
    for (const m of (JSON.parse(body) as { metas: Meta[] }).metas)
      if (m.id.startsWith('iltv_') && !m.id.startsWith('iltv_status_') && !m.id.startsWith('iltv_stale_'))
        items.set(m.id, m);
  }
  let metas = 0;
  for (const [path, body] of files) {
    const m = /^meta\/series\/([^/]+)\.json$/.exec(path);
    if (!m || typeof body !== 'string') continue;
    metas++;
    const meta = (JSON.parse(body) as { meta: Meta }).meta;
    const id = meta.id;
    // Posters: shaped "poster", portrait, reachable from abroad.
    if (meta.posterShape !== 'poster') flag('series shown with a non-poster shape', id);
    if (!meta.poster) flag('no poster', id);
    else if (!reachableAbroad(meta.poster)) flag('poster refused outside Israel', id);
    else {
      const local = ours(meta.poster);
      const img = local ? files.get(local) : undefined;
      if (local && !(img instanceof Uint8Array)) flag('poster file missing from the site', id);
      else if (img instanceof Uint8Array) {
        const size = imageSize(img);
        if (!size || !isPortrait(size)) flag('poster not portrait', id);
      } else if (remotePosterShape(store, meta.poster) === 'not portrait') flag('poster not portrait', id);
    }
    for (const u of [meta.background, ...(meta.videos ?? []).map((v) => v.thumbnail)])
      if (u && !reachableAbroad(u)) {
        flag('artwork refused outside Israel', id);
        break;
      }
    // Numbering: no season from the old 101+ range, no two episodes with one number, ids match numbers.
    const seen = new Set<string>();
    for (const v of meta.videos ?? []) {
      const se = `${v.season}:${v.episode}`;
      if ((v.season ?? 0) >= 101) flag('season numbered 101 or more', `${id}:${se}`);
      if (seen.has(se)) flag('two episodes with one number', `${id}:${se}`);
      seen.add(se);
      if (v.id !== `${id}:${se}`) flag('episode id does not match its numbers', v.id);
      if (v.title && JUNK.test(v.title)) flag('site text in an episode title', v.id);
    }
    // Text and year line.
    if (!meta.name?.trim() || JUNK.test(meta.name)) flag('empty name or site text in a name', id);
    if (meta.description && JUNK.test(meta.description)) flag('site text in a description', id);
    if (meta.releaseInfo && !/^\d{4}(?:–(?:\d{4}|present))?$/.test(meta.releaseInfo))
      flag('year line not "2024", "2021–2024" or "2024–present"', id);
    // The row's item says the same as the show page.
    const item = items.get(id);
    if (
      item &&
      (item.name !== meta.name || item.poster !== meta.poster || item.releaseInfo !== meta.releaseInfo)
    )
      flag('row item differs from its show page', id);
  }
  if (text('manifest.json') === undefined) flag('no manifest', 'manifest.json');
  const problems = [...found]
    .map(([check, ids]) => ({ check, count: ids.length, examples: ids.slice(0, 3) }))
    .sort((a, b) => b.count - a.count);
  return { at: new Date(now).toISOString(), metas, problems };
}
