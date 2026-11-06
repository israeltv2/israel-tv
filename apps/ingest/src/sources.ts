// Source adapters: each source lists its shows and reads one show into the common model.
import type { Config, ScrapedShow, Source } from '@israel-tv/core';
import * as mako from '@israel-tv/mako';
import { createFetcher, type Fetcher } from '@israel-tv/net';
import * as reshet from '@israel-tv/reshet';

export interface ShowEntry {
  key: string;
  title: string;
  poster?: string;
}

export interface SourceAdapter {
  readonly source: Source;
  listShows(): Promise<ShowEntry[]>;
  fetchShow(entry: ShowEntry, opts: { currentSeasonOnly: boolean }): Promise<ScrapedShow>;
  readonly requests: number;
}

export function makoAdapter(f: Fetcher): SourceAdapter {
  return {
    source: 'mako',
    listShows: () => mako.fetchIndex(f),
    fetchShow: (entry, opts) => mako.fetchShow(f, entry, opts),
    get requests() {
      return f.requests;
    },
  };
}

export function reshetAdapter(f: Fetcher): SourceAdapter {
  const profiles = new Map<number, boolean>();
  return {
    source: 'reshet',
    listShows: () => reshet.fetchIndex(f),
    fetchShow: (entry, opts) => reshet.fetchShow(f, entry, { ...opts, profiles }),
    get requests() {
      return f.requests;
    },
  };
}

export function createAdapters(config: Config): Partial<Record<Source, () => SourceAdapter>> {
  const fetcher = () => createFetcher({ delayMs: config.scraping.delayMs });
  const out: Partial<Record<Source, () => SourceAdapter>> = {};
  if (config.sources.mako) out.mako = () => makoAdapter(fetcher());
  if (config.sources.reshet) out.reshet = () => reshetAdapter(fetcher());
  return out;
}
