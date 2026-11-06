// Match our shows to TMDB (and through it IMDb), so a show opened from another catalog (e.g. Cinemeta)
// also gets our streams, and a search in English finds it. Only exact matches are accepted: an Israeli show
// whose Hebrew or original title normalizes to ours. Numbered and year seasons are answered (see render);
// named seasons do not line up with TMDB's season numbers.

import { setTimeout as sleep } from 'node:timers/promises';
import { DAY_MS, normalizeForSearch } from '@israel-tv/core';
import type { Store } from '@israel-tv/store';

const API = 'https://api.themoviedb.org/3';
/** seriesId → other names of a matched show (English, original, alternative titles): search aliases only. */
export const ALIASES_KEY = 'tmdb:aliases';
type Aliases = Record<string, string[]>;
/** Shows matched before aliases were kept get theirs a few at a time. */
const ALIAS_BACKFILL_PER_RUN = 60;

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
      // One TMDB/IMDb id must lead to one of our series; a second match is left unassigned and reported.
      const taken = hit ? store.seriesWithExternalIds(hit.id, imdbId).filter((x) => x !== row.seriesId) : [];
      if (taken.length > 0) {
        store.addWarnings(runId, row.seriesId, [
          {
            code: 'tmdb-duplicate',
            message: `${row.title}: TMDB ${hit?.id} already matched to ${taken.join(', ')}; not assigned`,
          },
        ]);
        store.setExternalIds(row.seriesId, { tmdbId: null, imdbId: null });
        delete aliases[row.seriesId];
      } else {
        store.setExternalIds(row.seriesId, { tmdbId: hit?.id ?? null, imdbId });
        if (hit) aliases[row.seriesId] = await aliasesOf(get, apiKey, hit.id, row.title);
        else delete aliases[row.seriesId];
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
    store.setState(ALIASES_KEY, aliases);
    store.finishRun(runId, { status: 'ok', showsOk: matched, requests: checked });
  } catch (err) {
    store.setState(ALIASES_KEY, aliases);
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
