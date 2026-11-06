// Network side of the Mako reader: index, one show (all seasons), playlist.
import type { ScrapedEpisode, ScrapedShow } from '@israel-tv/core';
import type { Fetcher } from '@israel-tv/net';
import {
  episodesFromPage,
  MAKO_ORIGIN,
  type MakoIndexEntry,
  parseIndex,
  parseShowPage,
  seasonRefs,
  seasonsFrom,
  showArtwork,
} from './parse.ts';
import { PlaylistResponse } from './schema.ts';

export const MAKO_CATALOG = 'iltv_keshet12';
const q = '?platform=responsive';

export async function fetchIndex(f: Fetcher): Promise<MakoIndexEntry[]> {
  return parseIndex(await f.json(`${MAKO_ORIGIN}/mako-vod-index${q}`));
}

export interface FetchShowOptions {
  /** Only fetch the current season (airing checks). Older seasons come back empty. */
  currentSeasonOnly?: boolean;
}

export async function fetchShow(
  f: Fetcher,
  entry: MakoIndexEntry,
  opts: FetchShowOptions = {},
): Promise<ScrapedShow> {
  const page = parseShowPage(await f.json(`${MAKO_ORIGIN}${entry.key}${q}`));
  const refs = seasonRefs(page);
  const byKey = new Map<string, ScrapedEpisode[]>();
  const current = refs.find((r) => r.current);
  if (current) byKey.set(current.key, episodesFromPage(page));
  for (const r of refs) {
    if (byKey.has(r.key) || opts.currentSeasonOnly) continue;
    byKey.set(r.key, episodesFromPage(parseShowPage(await f.json(`${MAKO_ORIGIN}${r.key}${q}`))));
  }
  const art = showArtwork(page);
  return {
    source: 'mako',
    key: entry.key,
    title: entry.title,
    catalog: MAKO_CATALOG,
    ...(art.description ? { description: art.description } : {}),
    ...(entry.poster ? { poster: entry.poster } : {}),
    ...(art.background ? { background: art.background } : {}),
    seasons: seasonsFrom(refs, byKey),
    pageUrl: `${MAKO_ORIGIN}${entry.key}`,
  };
}

export interface MakoPlay {
  vcmid: string;
  channelId: string;
  galleryChannelId?: string;
}

/** HLS URLs for one episode (unsigned; playback needs a ticket, see resolver). */
export async function fetchPlaylist(f: Fetcher, p: MakoPlay): Promise<{ url: string; cdn?: string }[]> {
  const u = new URL(`${MAKO_ORIGIN}/AjaxPage`);
  u.search = new URLSearchParams({
    jspName: 'playlist.jsp',
    vcmid: p.vcmid,
    videoChannelId: p.channelId,
    galleryChannelId: p.galleryChannelId ?? p.vcmid,
    isGallery: 'false',
    consumer: 'web_html5',
    encryption: 'no',
  }).toString();
  const r = PlaylistResponse.parse(await f.json(u.toString()));
  return r.media.map((m) => ({ url: m.url, ...(m.cdn ? { cdn: m.cdn } : {}) }));
}
