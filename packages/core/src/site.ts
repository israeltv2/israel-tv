// The rendered addon site: plain JSON files that any static host can serve, plus the few lookups the
// addon app does on top of them (search, paging extras, per-season stream files, external ids).
import type { Stream } from './stremio.ts';

export const CATALOG_PAGE_SIZE = 100;

export const sitePaths = {
  manifest: 'manifest.json',
  catalog: (type: string, id: string, skip = 0) =>
    skip === 0 ? `catalog/${type}/${id}.json` : `catalog/${type}/${id}/skip=${skip}.json`,
  meta: (type: string, id: string) => `meta/${type}/${id}.json`,
  seasonStreams: (seriesId: string, season: number) => `streams/${seriesId}/${season}.json`,
  liveStreams: (id: string) => `streams/${id}.json`,
  search: 'search.json',
  extIds: 'ext-ids.json',
  status: 'status.json',
  statusPage: 'status.html',
  registry: 'registry.json',
} as const;

/** search.json rows: [id, type, catalogId, display name, normalized name, poster]. */
export type SearchRow = [
  id: string,
  type: string,
  catalog: string,
  name: string,
  key: string,
  poster: string,
];

/** streams/<series>/<season>.json: episode number → streams. */
export type SeasonStreams = Record<string, Stream[]>;

/** ext-ids.json: "tt123" or "tmdb:123" → our series and the seasons that share numbering with TMDB. */
export type ExtIds = Record<string, { id: string; seasons: number[] }>;

export type Health = 'ok' | 'warn' | 'error';

export interface StatusFile {
  generatedAt: string;
  health: Health;
  sources: {
    source: string;
    health: Health;
    shows: number;
    episodes: number;
    lastFullRun?: { at: string; status: string; error?: string };
    lastAiringRun?: { at: string; status: string };
    notes: string[];
  }[];
  failingShows: { id: string; title: string; error: string; lastOkAt: string }[];
  warnings: { at: string; id?: string; code: string; message: string }[];
}
