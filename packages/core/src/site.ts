// The rendered addon site: plain JSON files that any static host can serve, plus the few lookups the
// addon app does on top of them (search, paging extras, per-season stream files, external ids).
import type { Stream } from './stremio.ts';

export const CATALOG_PAGE_SIZE = 100;

export const sitePaths = {
  manifest: 'manifest.json',
  /** A short page for people who open the addon's address in a browser. */
  landing: 'index.html',
  /** The same page in Hebrew (served at /he/). */
  landingHe: 'he/index.html',
  robots: 'robots.txt',
  sitemap: 'sitemap.xml',
  webManifest: 'site.webmanifest',
  /** The public pages' icons and share image (made by `pnpm images:site` into assets/site). */
  favicon: 'favicon.ico',
  faviconSvg: 'icon.svg',
  appleTouchIcon: 'apple-touch-icon.png',
  icon192: 'icon-192.png',
  icon512: 'icon-512.png',
  iconMaskable: 'icon-maskable-512.png',
  shareImage: 'og.jpg',
  heroImage: 'hero.jpg',
  /** The pages' own type (two families with Hebrew, SIL OFL; assets/site/fonts). */
  fonts: [
    'fonts/plex-he-400.woff2',
    'fonts/plex-latin-400.woff2',
    'fonts/plex-he-600.woff2',
    'fonts/plex-latin-600.woff2',
    'fonts/karantina-he-700.woff2',
    'fonts/karantina-latin-700.woff2',
  ],
  /** The library pages (Hebrew): every row, one page per row, one page per show, the live channels, search. */
  library: 'library/index.html',
  libraryRow: (slug: string) => `library/${slug}/index.html`,
  showPage: (seriesId: string) => `show/${seriesId}/index.html`,
  livePage: 'live/index.html',
  searchPage: 'search/index.html',
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
  /** The live programme guide (core epg.ts). */
  epg: 'epg.json',
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

/** search.json rows: [id, type, catalogId, display name, normalized name, poster, genres?] (in row order). */
export type SearchRow = [
  id: string,
  type: string,
  catalog: string,
  name: string,
  key: string,
  poster: string,
  genres?: string[],
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
    /** Titles the site lists with nothing to watch (from the last complete full read), kept out of the catalog. */
    emptyShows?: string[];
    /** Shows the last full run was refused (bot protection) and their retries later that night. */
    blocked?: { pending: string[]; recovered: string[]; attempts: number; nextAt?: string };
  }[];
  failingShows: { id: string; title: string; error: string; lastOkAt: string }[];
  warnings: { at: string; id?: string; code: string; message: string }[];
  /** The publisher's own check of what it just published (apps/ingest catalog-audit.ts). */
  audit?: { at: string; metas: number; problems: { check: string; count: number; examples: string[] }[] };
  /** The catalog's rows as published, in the apps' order (shows with something to watch). */
  catalogs?: StatusCatalog[];
  /** One health per day for each source, oldest day first (days in `schedule.timezone`). */
  history?: { days: string[]; sources: Record<string, (Health | null)[]> };
  /** The last check that played every live channel (no stream addresses). */
  live?: { at: string; abroad: boolean; channels: StatusLiveChannel[] };
  /** When things are refreshed, in the instance's time zone. */
  schedule?: StatusSchedule;
}

export interface StatusCatalog {
  id: string;
  /** The row's name as apps show it (Hebrew). */
  name: string;
  source: string;
  shows: number;
  episodes: number;
  /** A row still in its first fill (Kan): shows in the catalog of those the site lists. */
  filling?: { inCatalog: number; known: number };
}

export interface StatusLiveChannel {
  id: string;
  name: string;
  /** `unchecked`: the last check could not try it (a Keshet channel without a home helper to play it through). */
  state: 'up' | 'down' | 'unchecked';
  /** Plays only through the viewer's own home helper (Keshet's channels). */
  helper: boolean;
  /** Refused outside Israel when checked from abroad. */
  israelOnly?: boolean;
}

export interface StatusSchedule {
  timezone: string;
  /** The nightly full read, as "HH:MM" when it runs once a day at a fixed time. */
  fullRunTime?: string;
  nextFullRun?: string;
  /** Checks for new episodes of shows on the air, per day. */
  airingChecksPerDay?: number;
  nextAiringCheck?: string;
}
