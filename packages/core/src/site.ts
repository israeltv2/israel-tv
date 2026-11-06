// The rendered addon site: plain JSON files that any static host can serve, plus the few lookups the
// addon app does on top of them (search, paging extras, per-season stream files, external ids).
import type { Stream } from './stremio.ts';

export const CATALOG_PAGE_SIZE = 100;

export const sitePaths = {
  manifest: 'manifest.json',
  catalog: (type: string, id: string, skip = 0) =>
    // Later pages are stored as skip-N (not skip=N: some static hosts redirect '=' to '%3D'); the addon
    // app maps Stremio's `/skip=N.json` URL onto them.
    skip === 0 ? `catalog/${type}/${id}.json` : `catalog/${type}/${id}/skip-${skip}.json`,
  meta: (type: string, id: string) => `meta/${type}/${id}.json`,
  seasonStreams: (seriesId: string, season: number) => `streams/${seriesId}/${season}.json`,
  /** What a resolver needs to play a season's episodes, so it can run from the public catalog alone. */
  seasonPlay: (seriesId: string, season: number) => `play/${seriesId}/${season}.json`,
  /** The catalog ↔ resolver contract version (see contract.ts). */
  contract: 'resolver-contract.json',
  liveStreams: (id: string) => `streams/${id}.json`,
  search: 'search.json',
  extIds: 'ext-ids.json',
  status: 'status.json',
  statusPage: 'status.html',
  registry: 'registry.json',
  freshness: 'freshness.json',
  logo: 'logo.png',
  background: 'background.jpg',
  channelLogo: (id: string) => `logos/${id}.png`,
  /** Our copy of a show's artwork (sources whose images are refused outside Israel). */
  artwork: (seriesId: string) => `art/${seriesId}.jpg`,
  /** A show's portrait poster made by us (its own image was not portrait). */
  poster: (seriesId: string) => `art/${seriesId}-poster.jpg`,
  /** The poster for a show whose image cannot be published yet. */
  posterPlaceholder: 'art/placeholder-poster.jpg',
} as const;

/**
 * Stands for the addon's own address in rendered files (image URLs must be absolute, and the address is only
 * known when a request comes in): the server replaces it with the request's origin when serving JSON.
 */
export const ORIGIN_TOKEN = '{{israel-tv-origin}}';

/** Replace the origin token in a served JSON body. */
export function withOrigin(body: string, origin: string): string {
  return body.includes(ORIGIN_TOKEN) ? body.replaceAll(ORIGIN_TOKEN, origin) : body;
}

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
  /** Set when the last publish failed (the public copy may be out of date). */
  publish?: string;
  /** Set when the last TMDB matching run failed (e.g. a revoked API key). */
  tmdb?: string;
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
