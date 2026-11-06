// The subset of the Stremio addon protocol this project serves.
// https://github.com/Stremio/stremio-addon-sdk/tree/master/docs/api

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
