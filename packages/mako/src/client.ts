// Network side of the Mako reader: index, one show (all seasons), playlist.
import type { ScrapedEpisode, ScrapedShow } from '@israel-tv/core';
import { type Fetcher, HttpError } from '@israel-tv/net';
import {
  episodesFromPage,
  featuredEpisode,
  featuredOnly,
  MAKO_ORIGIN,
  type MakoIndexEntry,
  parseIndex,
  parseShowPage,
  seasonRefs,
  seasonsFrom,
  showArtwork,
} from './parse.ts';
import { PlaylistResponse, type ShowPage } from './schema.ts';

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
  const notes: string[] = [];
  /** A page's episodes; a page with no list but one featured video (films, specials) gives that video. */
  const episodesOf = async (p: ShowPage): Promise<ScrapedEpisode[]> => {
    const listed = episodesFromPage(p);
    const vod = listed.length === 0 ? featuredOnly(p) : undefined;
    if (!vod) return listed;
    let raw: unknown;
    if (vod.pageUrl?.startsWith('/'))
      try {
        raw = await f.json(`${MAKO_ORIGIN}${vod.pageUrl}${q}`);
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        notes.push(`the featured video's page answered HTTP ${err.status}; titled after the show`);
      }
    return [featuredEpisode(p, vod, entry.title, raw)];
  };
  const current = refs.find((r) => r.current);
  if (current) byKey.set(current.key, await episodesOf(page));
  for (const r of refs) {
    if (byKey.has(r.key) || opts.currentSeasonOnly) continue;
    try {
      byKey.set(r.key, await episodesOf(parseShowPage(await f.json(`${MAKO_ORIGIN}${r.key}${q}`))));
    } catch (err) {
      // Mako sometimes lists a season whose page is gone; skip it rather than lose the whole show.
      if (!(err instanceof HttpError && err.status === 404)) throw err;
      notes.push(`season "${r.title}" (${r.key}) is listed but its page is gone (404)`);
    }
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
    ...(art.genres ? { genres: art.genres } : {}),
    seasons: seasonsFrom(refs, byKey),
    pageUrl: `${MAKO_ORIGIN}${entry.key}`,
    ...(notes.length ? { notes } : {}),
  };
}

export interface MakoPlay {
  vcmid: string;
  channelId: string;
  galleryChannelId?: string;
}

/** The playlist.jsp URL that lists one episode's HLS media (unsigned; playback needs a ticket). */
export function makoPlaylistUrl(p: MakoPlay): string {
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
  return u.toString();
}

/** Media of one episode's playlist response. */
export function parsePlaylist(raw: unknown): { url: string; cdn?: string }[] {
  return PlaylistResponse.parse(raw).media.map((m) => ({ url: m.url, ...(m.cdn ? { cdn: m.cdn } : {}) }));
}

/** HLS URLs for one episode (unsigned; playback needs a ticket, see resolver). */
export async function fetchPlaylist(f: Fetcher, p: MakoPlay): Promise<{ url: string; cdn?: string }[]> {
  return parsePlaylist(await f.json(makoPlaylistUrl(p)));
}
