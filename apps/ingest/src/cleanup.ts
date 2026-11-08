// stale-warnings-2026-11-08 (owner: "nothing left"): warnings on /status that no longer describe the catalog,
// removed once, each by a check that it is stale (counted in the report). From here on the readers keep their notes
// current themselves (Store.clearNotes: a complete read replaces a show's notes, a page's note goes once the page
// reads), and the rules no longer record the false ones.
// - season-number-taken (331, all from the first Reshet run, 2026-11-06): Reshet lists every season twice, once
//   empty; the empty copy "wanted" its number before seasons were numbered only with episodes. Removed where the
//   season it names is that empty copy, unnumbered, and its number is held by the season of the same title.
// - "Kan <url>: could not copy its image (…)": an older reader's message (copies are reported per slice now);
//   every one of those shows has its artwork copied (checked on the live catalog 2026-11-08).
// - Notes on shows "listed, but … no episodes" (no series) for shows we now have, with episodes, under their name
//   or their name before the clean-up of names ("| באדיבות כאן חינוכית"); of the rest, only each show's latest.
// - Kan page notes: only each page's latest (try 2 replaces try 1), none for a page whose episode we now have or
//   that the crawl has settled since (taken down, not a video, a trailer).
// - tmdb-duplicate: removed, and the show looked up again (the matching now tells two shows of one name apart
//   by their years).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cleanShowTitle } from '@israel-tv/core';
import type { Store } from '@israel-tv/store';
import { MIGRATIONS_KEY } from './renumber.ts';

export const STALE_WARNINGS = 'stale-warnings-2026-11-08';

export interface CleanupReport {
  id: string;
  backup?: string;
  removed: Record<string, number>;
  tmdbRecheck: string[];
}

const SHOW_NOTE =
  /^(.*): (listed, but its page has no episodes|listed, but its page is gone \(404\)|its page lists no videos|no episode list on the show page.*|listed with a link to the site's front page.*|only a trailer so far.*)$/;
const KAN_PAGE = /^Kan (?:episode )?(https:\/\/\S+?):/;

export function cleanStaleWarnings(
  store: Store,
  backupDir: string,
  opts: { dryRun?: boolean } = {},
): CleanupReport | undefined {
  const done = store.getState<string[]>(MIGRATIONS_KEY) ?? [];
  if (done.includes(STALE_WARNINGS)) return undefined;
  const report: CleanupReport = { id: STALE_WARNINGS, removed: {}, tmdbRecheck: [] };
  const drop: number[] = [];
  const count = (k: string, id: number) => {
    drop.push(id);
    report.removed[k] = (report.removed[k] ?? 0) + 1;
  };
  const shows = store.listShows();
  const byId = new Map(shows.map((r) => [r.seriesId, r]));
  const withEpisodes = new Set(
    shows
      .filter((r) => r.state === 'listed' && r.show.seasons.some((s) => s.episodes.length > 0))
      .map((r) => cleanShowTitle(r.title)),
  );
  const kanKeys = new Set(
    shows
      .filter((r) => r.show.source === 'kan')
      .flatMap((r) => r.show.seasons.flatMap((s) => s.episodes.map((e) => e.key))),
  );
  const all = store.warningsOf(['season-number-taken', 'source-note', 'tmdb-duplicate']);

  for (const w of all.filter((x) => x.code === 'season-number-taken')) {
    const m = /^season "(.*)" \((.*)\) wants (\d+), already used/.exec(w.message);
    const row = w.seriesId ? byId.get(w.seriesId) : undefined;
    if (!m || !row) continue;
    const [, title, key, n] = m;
    const season = row.show.seasons.find((s) => s.key === key);
    const a = store.assignments(row.seriesId);
    const holder = a.seasons.find((s) => s.number === Number(n));
    const holderTitle = row.show.seasons.find((s) => s.key === holder?.key)?.title;
    if (
      season &&
      season.episodes.length === 0 &&
      !a.seasons.some((s) => s.key === key) &&
      holderTitle === title
    )
      count('season-number-taken (an empty copy of a numbered season)', w.id);
  }

  const notes = all.filter((x) => x.code === 'source-note' && !drop.includes(x.id));
  const showNotes = new Map<string, typeof notes>();
  const pageNotes = new Map<string, typeof notes>();
  for (const w of notes) {
    if (/: could not copy its image \(/.test(w.message) && w.message.startsWith('Kan ')) {
      count("Kan image copy (an older reader's message)", w.id);
      continue;
    }
    const page = KAN_PAGE.exec(w.message)?.[1];
    if (page) {
      pageNotes.set(page, [...(pageNotes.get(page) ?? []), w]);
      continue;
    }
    const m = w.seriesId === null ? SHOW_NOTE.exec(w.message) : null;
    if (m) {
      const title = cleanShowTitle(m[1] as string);
      if (withEpisodes.has(title)) count('show without episodes that now has them', w.id);
      else showNotes.set(title, [...(showNotes.get(title) ?? []), w]);
    }
  }
  for (const list of showNotes.values()) {
    const latest = list.at(-1)?.createdAt;
    for (const w of list) if (w.createdAt !== latest) count('a show note a later read replaced', w.id);
  }
  // Pages the crawl has settled since (taken down by Kan, not a video, a trailer): no longer waited for.
  const crawl = store.getState<{ shows?: Record<string, Record<string, unknown>> }>('kan:crawl');
  const settledPages = new Set(
    Object.values(crawl?.shows ?? {}).flatMap((s) =>
      ['removed', 'notVideo', 'skipped'].flatMap((k) => (Array.isArray(s[k]) ? (s[k] as string[]) : [])),
    ),
  );
  for (const [url, list] of pageNotes) {
    const id = /\/(\d+)\/?$/.exec(url)?.[1];
    const stored = (id !== undefined && kanKeys.has(`kan:${id}`)) || settledPages.has(url);
    const latest = list.at(-1)?.id;
    for (const w of list)
      if (stored) count('Kan page note for a page since read or settled', w.id);
      else if (w.id !== latest) count('Kan page note a later try replaced', w.id);
  }
  for (const w of all.filter((x) => x.code === 'tmdb-duplicate')) {
    count('tmdb-duplicate (looked up again)', w.id);
    if (w.seriesId) report.tmdbRecheck.push(w.seriesId);
  }

  if (opts.dryRun) return report;
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  report.backup = join(backupDir, `before-${STALE_WARNINGS}.sqlite`);
  store.backupTo(report.backup);
  store.transaction(() => {
    store.deleteWarnings(drop);
    for (const id of report.tmdbRecheck) store.forgetTmdbCheck(id);
    store.setState(MIGRATIONS_KEY, [...(store.getState<string[]>(MIGRATIONS_KEY) ?? []), STALE_WARNINGS]);
    store.setState(`${MIGRATIONS_KEY}:${STALE_WARNINGS}`, { ...report, at: new Date().toISOString() });
  });
  return report;
}

export function cleanupLine(r: CleanupReport): string {
  const parts = Object.entries(r.removed).map(([k, n]) => `${n} ${k}`);
  return `one-time clean-up ${r.id}: removed ${parts.join(', ') || 'nothing'}${r.tmdbRecheck.length ? `; TMDB looked up again: ${r.tmdbRecheck.join(', ')}` : ''}; backup ${r.backup ?? 'none (dry run)'}`;
}
