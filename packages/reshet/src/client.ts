import type { ScrapedEpisode, ScrapedSeason, ScrapedShow } from '@israel-tv/core';
import type { Fetcher } from '@israel-tv/net';
import { blockedEntries, kalturaPost } from './kaltura.ts';
import {
  type ParsedSeason,
  parseAllShows,
  parseSeasonPage,
  parseShowPage,
  RESHET_ORIGIN,
  type ReshetIndexEntry,
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
  const r = await f.text(`${RESHET_ORIGIN}${path}`);
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

export async function fetchShow(
  f: Fetcher,
  entry: ReshetIndexEntry,
  opts: ReshetOptions = {},
): Promise<ScrapedShow> {
  const parsed = parseShowPage(await page(f, entry.key));
  const seasons: { s: ParsedSeason; episodes: ScrapedEpisode[] }[] = [];
  const notes: string[] = parsed.note ? [parsed.note] : [];
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
    let blocked = new Map<string, boolean>();
    try {
      blocked = await blockedEntries(ids, opts.profiles ?? new Map(), opts.kaltura ?? kalturaPost);
    } catch (err) {
      notes.push(`Kaltura lookup failed, episodes not labelled for geo-blocking: ${(err as Error).message}`);
    }
    // An entry Kaltura no longer has (missing from the answer, which lists every existing one) plays nowhere:
    // its episode stays (its number never moves) but offers no stream rather than one that fails.
    const lookedUp = blocked.size > 0;
    let gone = 0;
    for (const x of seasons) {
      for (const e of x.episodes) {
        const b = blocked.get(e.key);
        if (b !== undefined) e.availableAbroad = !b;
        else if (lookedUp) {
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
    episodes: x.episodes,
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
