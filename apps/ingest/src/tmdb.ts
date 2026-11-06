// Match our shows to TMDB (and through it IMDb), so a show opened from another catalog (e.g. Cinemeta)
// also gets our streams. Only exact matches are accepted: an Israeli show whose Hebrew or original title
// normalizes to ours. Numbered seasons only are answered (see render), because named or year seasons
// do not line up with TMDB's season numbers.

import { setTimeout as sleep } from 'node:timers/promises';
import { DAY_MS, normalizeForSearch } from '@israel-tv/core';
import type { Store } from '@israel-tv/store';

const API = 'https://api.themoviedb.org/3';

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
      store.setExternalIds(row.seriesId, { tmdbId: hit?.id ?? null, imdbId });
      checked++;
      await sleep(opts.delayMs ?? 250);
    }
    store.finishRun(runId, { status: 'ok', showsOk: matched, requests: checked });
  } catch (err) {
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
