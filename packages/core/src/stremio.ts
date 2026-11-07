// The subset of the Stremio addon protocol this project serves.
// https://github.com/Stremio/stremio-addon-sdk/tree/master/docs/api

/**
 * The addons' ids. Apps and addon directories key installs on them, so they are unique to this project (reverse
 * domain of its GitHub account) and never change again (renamed from `community.israel-tv` on 2026-11-07).
 */
export const ADDON_ID = 'io.github.israeltv2.israel-tv';
export const RESOLVER_ADDON_ID = `${ADDON_ID}.resolver`;
export const REMOTE_RESOLVER_ADDON_ID = `${ADDON_ID}.resolver.remote`;
/** The project's contact address, shown by addon directories. */
export const CONTACT_EMAIL = 'israeltv2@proton.me';

export interface ManifestCatalog {
  type: string;
  id: string;
  name: string;
  extra?: { name: string; isRequired?: boolean; options?: string[] }[];
}

export interface Manifest {
  id: string;
  version: string;
  name: string;
  description: string;
  logo?: string;
  resources: (string | { name: string; types: string[]; idPrefixes?: string[] })[];
  types: string[];
  idPrefixes?: string[];
  catalogs: ManifestCatalog[];
  behaviorHints?: { configurable?: boolean; configurationRequired?: boolean };
  contactEmail?: string;
  /** stremio-addons.net's proof that this manifest belongs to the listed addon (issued after approval). */
  stremioAddonsConfig?: { issuer: string; signature: string };
}

export interface MetaPreview {
  id: string;
  type: string;
  name: string;
  poster?: string;
  posterShape?: 'poster' | 'square' | 'landscape';
  description?: string;
  releaseInfo?: string;
  genres?: string[];
  /** The show's IMDb id, when matched: lets Trakt and other addons recognise it. */
  imdb_id?: string;
}

export interface Video {
  id: string;
  title: string;
  season?: number;
  episode?: number;
  released?: string;
  thumbnail?: string;
  overview?: string;
}

export interface Meta extends MetaPreview {
  /** "Ended" or "Returning Series" (apps such as Nuvio show it, and use it with lastAirDate for the year line). */
  status?: 'Ended' | 'Returning Series';
  /** The latest episode's air date (yyyy-mm-dd). */
  lastAirDate?: string;
  background?: string;
  logo?: string;
  videos?: Video[];
  links?: { name: string; category: string; url: string }[];
  behaviorHints?: { defaultVideoId?: string };
}

export interface Stream {
  url: string;
  name?: string;
  title?: string;
  description?: string;
  behaviorHints?: {
    notWebReady?: boolean;
    bingeGroup?: string;
    proxyHeaders?: Record<string, Record<string, string>>;
  };
}
