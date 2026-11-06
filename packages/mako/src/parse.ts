// Pure parsing: Mako responses → the common show model. No network here (tested on recorded fixtures).
import {
  cleanGenres,
  parseDottedDate,
  parseEpisodeHint,
  type ScrapedEpisode,
  type ScrapedSeason,
} from '@israel-tv/core';
import { z } from 'zod';
import { IndexResponse, ShowPage, VodPage, VodSlot } from './schema.ts';

export const MAKO_ORIGIN = 'https://www.mako.co.il';

export interface MakoIndexEntry {
  key: string;
  title: string;
  poster?: string;
}

export function parseIndex(raw: unknown): MakoIndexEntry[] {
  const { items } = IndexResponse.parse(raw);
  const seen = new Set<string>();
  const out: MakoIndexEntry[] = [];
  for (const it of items) {
    const key = it.pageUrl.replace(/\/+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, title: it.title.trim(), ...(it.pic ? { poster: it.pic } : {}) });
  }
  return out;
}

export function parseShowPage(raw: unknown): ShowPage {
  return ShowPage.parse(raw);
}

/** Episodes from a page's first menu tab ("פרקים"); ad slots are dropped, never counted. */
export function episodesFromPage(page: ShowPage): ScrapedEpisode[] {
  const vods = z.array(VodSlot).parse(page.menu?.[0]?.vods ?? []);
  const out: ScrapedEpisode[] = [];
  for (const v of vods) {
    if (v.componentLayout !== 'vod') continue;
    const [hintPart, datePart] = (v.extraInfo ?? '').split('@');
    // extraInfo is "פרק 5@05.11.26" on most seasons, but just "05.11.26" on daily shows.
    const airDate = parseDottedDate(datePart ?? hintPart) ?? parseDottedDate(v.title);
    const numberHint = parseEpisodeHint(hintPart) ?? parseEpisodeHint(v.title);
    const thumb = v.pics?.[0]?.picUrl;
    out.push({
      key: v.itemVcmId,
      title: v.title.trim(),
      ...(numberHint ? { numberHint } : {}),
      ...(airDate ? { airDate } : {}),
      ...(thumb ? { thumbnail: thumb } : {}),
      ...(v.aINT !== undefined ? { availableAbroad: v.aINT } : {}),
      streams: [],
      play: {
        vcmid: v.itemVcmId,
        channelId: v.channelId ?? page.channelId,
        galleryChannelId: v.galleryChannelId ?? v.itemVcmId,
      },
    });
  }
  return out;
}

/**
 * The video a page features when it has no episode list at all (Mako's films and one-off specials, and the
 * captioned news editions, which show only their latest broadcast). Undefined when the page lists episodes.
 */
export function featuredOnly(page: ShowPage): NonNullable<ShowPage['vod']> | undefined {
  const listed = (page.menu ?? []).some((m) => (m.vods ?? []).some((v) => v.componentLayout === 'vod'));
  return listed ? undefined : (page.vod ?? undefined);
}

/** A page's title without Mako's "watch now" boilerplate ("… לצפייה ישירה | 12+", "- הסרט המלא", "- המופע המלא"). */
export function cleanVodTitle(seoTitle: string | undefined): string {
  return (seoTitle ?? '')
    .replace(/\s*\|\s*12\+.*$/, '')
    .replace(/\s*לצפייה ישירה\s*$/, '')
    .replace(/\s*-?\s*(הסרט המלא|המופע המלא|פרקים מלאים|עמוד הסרט)\s*$/, '')
    .replace(/\s*-\s*$/, '')
    .trim();
}

/** The one episode of a page that only features a video, from the video's own page when it could be read. */
export function featuredEpisode(
  page: ShowPage,
  vod: NonNullable<ShowPage['vod']>,
  showTitle: string,
  rawVodPage?: unknown,
): ScrapedEpisode {
  const vp = rawVodPage === undefined ? undefined : VodPage.safeParse(rawVodPage).data;
  const title = cleanVodTitle(vp?.seo?.title) || showTitle;
  const airDate = parseDottedDate(title);
  const v = vp?.vod ?? vod;
  return {
    key: vod.itemVcmId,
    title,
    ...(airDate ? { airDate } : {}),
    ...(v.aINT !== undefined ? { availableAbroad: v.aINT } : {}),
    streams: [],
    play: {
      vcmid: vod.itemVcmId,
      channelId: v.channelId ?? vod.channelId ?? page.channelId,
      galleryChannelId: v.galleryChannelId ?? vod.galleryChannelId ?? vod.itemVcmId,
    },
  };
}

export interface SeasonRef {
  key: string;
  title: string;
  current: boolean;
}

/** Seasons listed on a show page, or one untitled season for single-list shows. */
export function seasonRefs(page: ShowPage): SeasonRef[] {
  const tabUrl = page.menu?.[0]?.pageUrl?.replace(/\/+$/, '');
  if (page.seasons && page.seasons.length > 0) {
    return page.seasons.map((s) => {
      const key = s.pageUrl.replace(/\/+$/, '');
      return { key, title: (s.seasonTitle ?? '').trim(), current: s.current === true || key === tabUrl };
    });
  }
  return [{ key: tabUrl ?? page.pageUrl.replace(/\/+$/, ''), title: '', current: true }];
}

export function showArtwork(page: ShowPage): {
  description?: string;
  background?: string;
  genres?: string[];
} {
  const description = page.hero?.description?.trim() || page.seo?.description?.trim();
  const background = page.hero?.pics?.[0]?.picUrl ?? page.seo?.image;
  const g = page.seo?.schema?.genre;
  const genres = cleanGenres(typeof g === 'string' ? [g] : g);
  return {
    ...(description ? { description } : {}),
    ...(background ? { background } : {}),
    ...(genres.length ? { genres } : {}),
  };
}

export function seasonsFrom(
  refs: SeasonRef[],
  episodesByKey: Map<string, ScrapedEpisode[]>,
): ScrapedSeason[] {
  return refs.map((r) => ({ key: r.key, title: r.title, episodes: episodesByKey.get(r.key) ?? [] }));
}
