// Match our shows to TMDB (and through it IMDb), so a show opened from another catalog (e.g. Cinemeta)
// also gets our streams, and a search in English finds it. Only exact matches are accepted: an Israeli show
// whose Hebrew or original title normalizes to ours. Numbered and year seasons are answered (see render);
// named seasons do not line up with TMDB's season numbers.

import { setTimeout as sleep } from 'node:timers/promises';
import { DAY_MS, normalizeForSearch, type ScrapedShow, type TmdbDetails } from '@israel-tv/core';
import type { Store } from '@israel-tv/store';

const API = 'https://api.themoviedb.org/3';
/** seriesId → other names of a matched show (English, original, alternative titles): search aliases only. */
export const ALIASES_KEY = 'tmdb:aliases';
type Aliases = Record<string, string[]>;
/** Shows matched before aliases were kept get theirs a few at a time. */
const ALIAS_BACKFILL_PER_RUN = 60;
/**
 * seriesId → what TMDB says about a matched show in Hebrew (genres, overview, first and last air year): used only where
 * the source says nothing (render.ts), never instead of it.
 */
export const DETAILS_KEY = 'tmdb:details';
type DetailsState = Record<string, TmdbDetails & { tmdbId: number; at: string }>;
/** A matched show's details are read again after this long (TMDB adds overviews and seasons over time). */
const DETAILS_EVERY_MS = 30 * DAY_MS;
/** At most this many details requests per run (all ~300 matched shows fit in one run). */
const DETAILS_PER_RUN = 400;

/** A show's details as TMDB gives them in Hebrew: genre names, overview (when TMDB has a Hebrew one), years. */
export function parseDetails(d: {
  genres?: { name?: string | null }[] | null;
  overview?: string | null;
  first_air_date?: string | null;
  last_air_date?: string | null;
}): TmdbDetails {
  const year = (s: string | null | undefined) => /^(\d{4})-\d{2}-\d{2}$/.exec(s ?? '')?.[1];
  const genres = (d.genres ?? []).map((g) => g.name?.trim() ?? '').filter(Boolean);
  const overview = d.overview?.trim() ?? '';
  const first = year(d.first_air_date);
  const last = year(d.last_air_date) ?? first;
  return {
    ...(genres.length ? { genres } : {}),
    // TMDB answers with an empty overview when it has none in the language asked for.
    ...(/[\u0590-\u05FF]/.test(overview) && overview.length >= 10 ? { overview } : {}),
    ...(first ? { firstYear: first } : {}),
    ...(first && last ? { lastYear: last } : {}),
  };
}

async function detailsOf(get: Get, apiKey: string, id: number): Promise<TmdbDetails> {
  const q = new URLSearchParams({ api_key: apiKey, language: 'he-IL' });
  return parseDetails((await get(`${API}/tv/${id}?${q}`)) as Parameters<typeof parseDetails>[0]);
}

/** A matched show's other names, cleaned: no repeats, at most 8, none longer than 60 characters. */
export function cleanAliases(names: (string | null | undefined)[], title: string): string[] {
  const own = normalizeForSearch(title);
  const seen = new Set<string>([own]);
  const out: string[] = [];
  for (const n of names) {
    const t = (n ?? '').trim();
    const k = normalizeForSearch(t);
    if (!k || t.length > 60 || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.slice(0, 8);
}

async function aliasesOf(get: Get, apiKey: string, id: number, title: string): Promise<string[]> {
  const q = new URLSearchParams({
    api_key: apiKey,
    language: 'en-US',
    append_to_response: 'alternative_titles',
  });
  const d = (await get(`${API}/tv/${id}?${q}`)) as {
    name?: string;
    original_name?: string;
    alternative_titles?: { results?: { title?: string }[] };
  };
  return cleanAliases(
    [d.name, d.original_name, ...(d.alternative_titles?.results ?? []).map((r) => r.title)],
    title,
  );
}

export interface TmdbResult {
  id: number;
  name: string;
  original_name: string;
  origin_country?: string[];
  original_language?: string;
  first_air_date?: string;
}

/** The year a show's earliest dated episode aired, if any is dated. */
export function firstAirYear(show: ScrapedShow): number | undefined {
  let first: string | undefined;
  for (const s of show.seasons)
    for (const e of s.episodes) if (e.airDate && (!first || e.airDate < first)) first = e.airDate;
  return first ? Number(first.slice(0, 4)) : undefined;
}

/**
 * Two of our shows with one name and one TMDB match (לאהוב את אנה: Reshet's 2008 drama, Keshet's 2018 reality show;
 * TMDB 105361 first aired 2008-07-01): the one whose first episode year is nearer TMDB's first air year is that
 * show; "a" or "b", or undefined when the years do not tell (unknown, or as near as each other within a year).
 */
export function nearerShow(tmdbYear: number | undefined, a?: number, b?: number): 'a' | 'b' | undefined {
  if (tmdbYear === undefined || a === undefined || b === undefined) return undefined;
  const da = Math.abs(a - tmdbYear);
  const db = Math.abs(b - tmdbYear);
  if (Math.abs(da - db) <= 1) return undefined;
  return da < db ? 'a' : 'b';
}

/** The single result that is clearly the same show, or undefined. */
export function pickMatch(title: string, results: TmdbResult[]): TmdbResult | undefined {
  const want = normalizeForSearch(title);
  if (!want) return undefined;
  const israeli = results.filter((r) => r.origin_country?.includes('IL') || r.original_language === 'he');
  const exact = israeli.filter(
    (r) => normalizeForSearch(r.name) === want || normalizeForSearch(r.original_name) === want,
  );
  return exact.length === 1 ? exact[0] : undefined;
}

type Get = (url: string) => Promise<unknown>;

const defaultGet: Get = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (r.status === 429) {
    await sleep(5000);
    return defaultGet(url);
  }
  if (!r.ok) throw new Error(`TMDB HTTP ${r.status}`);
  return r.json();
};

export async function matchShows(
  store: Store,
  apiKey: string,
  opts: { log?: (l: string) => void; recheckDays?: number; get?: Get; delayMs?: number } = {},
): Promise<{ checked: number; matched: number }> {
  const get = opts.get ?? defaultGet;
  const before = new Date(Date.now() - (opts.recheckDays ?? 30) * DAY_MS).toISOString();
  const rows = store.showsToMatch(before);
  const runId = store.startRun('match', 'tmdb');
  let matched = 0;
  let checked = 0;
  const aliases: Aliases = { ...(store.getState<Aliases>(ALIASES_KEY) ?? {}) };
  const details: DetailsState = { ...(store.getState<DetailsState>(DETAILS_KEY) ?? {}) };
  const keep = () => {
    store.setState(ALIASES_KEY, aliases);
    store.setState(DETAILS_KEY, details);
  };
  try {
    for (const row of rows) {
      const q = new URLSearchParams({ api_key: apiKey, language: 'he-IL', query: row.title });
      const res = (await get(`${API}/search/tv?${q}`)) as { results?: TmdbResult[] };
      const hit = pickMatch(row.title, res.results ?? []);
      let imdbId: string | null = null;
      if (hit) {
        const ext = (await get(`${API}/tv/${hit.id}/external_ids?api_key=${apiKey}`)) as {
          imdb_id?: string | null;
        };
        imdbId = ext.imdb_id && /^tt\d+$/.test(ext.imdb_id) ? ext.imdb_id : null;
        matched++;
      }
      // One TMDB/IMDb id must lead to one of our series; a second match is left unassigned and reported, unless
      // the years say which show it is (nearerShow): then that one has it and the other is simply not matched.
      let taken = hit ? store.seriesWithExternalIds(hit.id, imdbId).filter((x) => x !== row.seriesId) : [];
      const tmdbYear = hit?.first_air_date ? Number(hit.first_air_date.slice(0, 4)) || undefined : undefined;
      const holder = taken.length === 1 ? store.getShow(taken[0] as string) : undefined;
      const which = holder
        ? nearerShow(tmdbYear, firstAirYear(row.show), firstAirYear(holder.show))
        : undefined;
      if (holder && which === 'b') {
        // The other show is the match: this one is not matched, and nothing is wrong.
        store.setExternalIds(row.seriesId, { tmdbId: null, imdbId: null });
        delete aliases[row.seriesId];
        delete details[row.seriesId];
        checked++;
        await sleep(opts.delayMs ?? 250);
        continue;
      }
      if (holder && which === 'a') {
        store.setExternalIds(holder.seriesId, { tmdbId: null, imdbId: null });
        delete aliases[holder.seriesId];
        delete details[holder.seriesId];
        store.clearWarnings(holder.seriesId, ['tmdb-duplicate']);
        opts.log?.(
          `tmdb: ${hit?.id} moved from ${holder.seriesId} to ${row.seriesId} (first aired ${tmdbYear})`,
        );
        taken = [];
      }
      if (taken.length > 0) {
        store.addWarnings(runId, row.seriesId, [
          {
            code: 'tmdb-duplicate',
            message: `${row.title}: TMDB ${hit?.id} already matched to ${taken.join(', ')}; not assigned`,
            params: { title: row.title, tmdbId: String(hit?.id ?? ''), taken },
          },
        ]);
        store.setExternalIds(row.seriesId, { tmdbId: null, imdbId: null });
        delete aliases[row.seriesId];
        delete details[row.seriesId];
      } else {
        store.clearWarnings(row.seriesId, ['tmdb-duplicate']);
        store.setExternalIds(row.seriesId, { tmdbId: hit?.id ?? null, imdbId });
        if (hit) aliases[row.seriesId] = await aliasesOf(get, apiKey, hit.id, row.title);
        else {
          delete aliases[row.seriesId];
          delete details[row.seriesId];
        }
      }
      checked++;
      await sleep(opts.delayMs ?? 250);
    }
    // Shows matched before their other names were kept.
    const missing = store
      .listShows()
      .filter((r) => r.tmdbId && !aliases[r.seriesId])
      .slice(0, ALIAS_BACKFILL_PER_RUN);
    for (const r of missing) {
      aliases[r.seriesId] = await aliasesOf(get, apiKey, r.tmdbId as number, r.title);
      await sleep(opts.delayMs ?? 250);
    }
    // Matched shows' details (new matches, matches made before details were kept, and month-old ones).
    const cutoff = Date.now() - DETAILS_EVERY_MS;
    const all = store.listShows();
    const due = all
      .filter((r) => {
        const d = details[r.seriesId];
        return r.tmdbId && (!d || d.tmdbId !== r.tmdbId || Date.parse(d.at) < cutoff);
      })
      .slice(0, DETAILS_PER_RUN);
    for (const r of due) {
      details[r.seriesId] = {
        ...(await detailsOf(get, apiKey, r.tmdbId as number)),
        tmdbId: r.tmdbId as number,
        at: new Date().toISOString(),
      };
      await sleep(opts.delayMs ?? 250);
    }
    // A show no longer matched keeps no details.
    const matchedIds = new Set(all.flatMap((r) => (r.tmdbId ? [r.seriesId] : [])));
    for (const id of Object.keys(details)) if (!matchedIds.has(id)) delete details[id];
    keep();
    store.finishRun(runId, { status: 'ok', showsOk: matched, requests: checked });
  } catch (err) {
    keep();
    store.finishRun(runId, {
      status: 'failed',
      showsOk: matched,
      requests: checked,
      error: (err as Error).message,
    });
    opts.log?.(`tmdb matching failed: ${(err as Error).message}`);
  }
  opts.log?.(`tmdb: ${checked} shows checked, ${matched} matched`);
  return { checked, matched };
}
