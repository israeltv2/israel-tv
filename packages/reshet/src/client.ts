import type { ScrapedEpisode, ScrapedSeason, ScrapedShow } from '@israel-tv/core';
import type { Fetcher } from '@israel-tv/net';
import { blockedEntries, type EntryState, kalturaPost } from './kaltura.ts';
import {
  dropCollidingHints,
  type ParsedSeason,
  parseAllShows,
  parseSeasonPage,
  parseShowPage,
  parseShowSitePage,
  RESHET_ORIGIN,
  type ReshetIndexEntry,
  type ShowSitePage,
  SITE_LIST_PAGES,
  type SiteEpisode,
  siteSeasons,
  untitledSeasonsByYear,
} from './parse.ts';

export const RESHET_CATALOG = 'iltv_reshet13';

export async function fetchIndex(f: Fetcher): Promise<ReshetIndexEntry[]> {
  const r = await f.text(`${RESHET_ORIGIN}/all-shows/all-shows-list/`);
  if (r.status !== 200) throw new Error(`all-shows page HTTP ${r.status}`);
  return parseAllShows(r.body);
}

class PageMissing extends Error {
  readonly status = 404;
}

async function page(f: Fetcher, path: string): Promise<string> {
  // Paths come from Reshet's own pages: only ever this site (a path like "@other.host/…" must not leave it).
  const url = new URL(path, RESHET_ORIGIN);
  if (url.origin !== RESHET_ORIGIN || !path.startsWith('/')) throw new Error(`${path}: not a Reshet page`);
  const r = await f.text(url.toString());
  if (r.status === 404) throw new PageMissing(`${path}: HTTP 404`);
  if (r.status !== 200) throw new Error(`${path}: HTTP ${r.status}`);
  return r.body;
}

export interface ReshetOptions {
  currentSeasonOnly?: boolean;
  /** Shared across a run: Kaltura access-control profile → blocked here. */
  profiles?: Map<number, boolean>;
  kaltura?: (body: unknown) => Promise<unknown>;
}

/** Most pages read from one show's site lists (a daily show's list runs to 26, 2026-11-07). */
export const SITE_PAGE_LIMIT = SITE_LIST_PAGES;

/**
 * A show's episodes from its own site page and the full-episode lists it links to, with their further pages. Always
 * all of them, airing check or not: a season read replaces the stored one, so a partial list would drop episodes.
 */
async function readSitePages(
  f: Fetcher,
  show: string,
  opts: { first?: string; seriesId?: string | undefined },
): Promise<{ seasons: ParsedSeason[]; notes: string[]; nothing?: string }> {
  const notes: string[] = [];
  const found: SiteEpisode[] = [];
  let seriesId = opts.seriesId;
  let reads = 0;
  const visit = async (path: string, html?: string) => {
    reads++;
    const p = parseShowSitePage(html ?? (await page(f, path)), { show, page: path, seriesId });
    seriesId ??= p.seriesId;
    found.push(...p.episodes);
    return p;
  };
  /** A list page that is gone is noted; the rest is still read. */
  const tryVisit = async (path: string) => {
    try {
      return await visit(path);
    } catch (err) {
      if (!(err instanceof PageMissing)) throw err;
      notes.push(`${path} is linked but gone (404)`);
      return undefined;
    }
  };
  let first: ShowSitePage;
  try {
    first = await visit(show, opts.first);
  } catch (err) {
    if (!(err instanceof PageMissing)) throw err;
    return { seasons: [], notes, nothing: `its show page ${show} is gone (404)` };
  }
  if (first.front)
    return {
      seasons: [],
      notes,
      nothing: "listed with a link to the site's front page, not a page of its own",
    };
  if (first.mixed) notes.push(`${show} links to several shows' videos; none were taken`);
  const more = [...first.morePages];
  for (const list of first.lists) {
    if (list === show) continue;
    if (reads >= SITE_PAGE_LIMIT) break;
    const p = await tryVisit(list);
    if (p) more.push(...p.morePages);
  }
  for (const [i, path] of more.entries()) {
    if (reads >= SITE_PAGE_LIMIT) {
      notes.push(`read the first ${reads} of its ${reads + more.length - i} list pages (the limit per show)`);
      break;
    }
    await tryVisit(path);
  }
  const seen = new Set<string>();
  const unique = found.filter((e) => !seen.has(e.episode.key) && seen.add(e.episode.key));
  return { seasons: siteSeasons(unique), notes };
}

export async function fetchShow(
  f: Fetcher,
  entry: ReshetIndexEntry,
  opts: ReshetOptions = {},
): Promise<ScrapedShow> {
  const html = await page(f, entry.key);
  const parsed = parseShowPage(html);
  const seasons: { s: ParsedSeason; episodes: ScrapedEpisode[] }[] = [];
  const notes: string[] = [];
  // No VOD record (or none left): the show's own site page may still list its episodes.
  const sitePage = parsed.template === 'no-vod' ? entry.key : parsed.sitePage;
  if (sitePage) {
    const site = await readSitePages(f, sitePage, {
      ...(sitePage === entry.key ? { first: html } : {}),
      seriesId: parsed.seriesId,
    });
    if (site.seasons.length > 0) parsed.seasons = site.seasons;
    // Nothing found: the page's own reason ("lists no videos") unless the site read knows better.
    else notes.push(site.nothing ?? parsed.note ?? `its page ${sitePage} lists no full episodes`);
    notes.push(...site.notes);
  } else if (parsed.note) notes.push(parsed.note);
  for (const s of parsed.seasons) {
    let episodes = s.episodes;
    if (!episodes && !opts.currentSeasonOnly && parsed.seriesId && s.position !== undefined) {
      const path = `/allshows/series/${parsed.seriesId}/season/${s.position}/`;
      try {
        episodes = parseSeasonPage(await page(f, path));
      } catch (err) {
        if (!(err instanceof PageMissing)) throw err;
        notes.push(`season "${s.title}" (${path}) is listed but its page is gone (404)`);
      }
    }
    seasons.push({ s, episodes: episodes ?? [] });
  }
  const ids = seasons.flatMap((x) => x.episodes.map((e) => e.key));
  if (ids.length > 0) {
    // Only adds the "blocked outside Israel" label: if Kaltura's API fails, the show is still read.
    let states = new Map<string, EntryState>();
    try {
      states = await blockedEntries(ids, opts.profiles ?? new Map(), opts.kaltura ?? kalturaPost);
    } catch (err) {
      notes.push(`Kaltura lookup failed, episodes not labelled for geo-blocking: ${(err as Error).message}`);
    }
    // An entry Kaltura no longer has (missing from the answer, which lists every existing one) plays nowhere:
    // its episode stays (its number never moves) but offers no stream rather than one that fails. One past its
    // schedule window (Reshet took it down; 404 in Israel too) is marked unavailable: kept with its number, left
    // out of the catalog (counted on /status), and back with the same number when a later read finds it offered.
    const lookedUp = states.size > 0;
    let gone = 0;
    for (const x of seasons) {
      for (const e of x.episodes) {
        const st = states.get(e.key);
        if (st) {
          e.availableAbroad = !st.blocked;
          if (st.expired) e.unavailable = true;
        } else if (lookedUp) {
          e.streams = [];
          gone++;
        }
      }
    }
    if (gone > 0)
      notes.push(`${gone} episodes no longer exist on Reshet's video host: listed without a stream`);
  }
  const single = seasons.length === 1 && !/\d/.test(seasons[0]?.s.title ?? '');
  const out: ScrapedSeason[] = seasons.map((x) => ({
    key: `${entry.key}|s${x.s.id}`,
    title: single ? '' : x.s.title,
    episodes: dropCollidingHints(x.episodes),
  }));
  return untitledSeasonsByYear({
    source: 'reshet',
    key: entry.key,
    title: entry.title,
    catalog: RESHET_CATALOG,
    ...(entry.poster ? { poster: entry.poster } : {}),
    ...(parsed.genres ? { genres: parsed.genres } : {}),
    ...(parsed.description ? { description: parsed.description } : {}),
    ...(parsed.background ? { background: parsed.background } : {}),
    seasons: out,
    pageUrl: `${RESHET_ORIGIN}${entry.key}`,
    ...(notes.length ? { notes } : {}),
  });
}
