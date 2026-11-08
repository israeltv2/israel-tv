// Reshet 13 (13tv.co.il) pages are Next.js pages with their data in __NEXT_DATA__. Two templates exist:
// - "VodPlaylist" (newer shows): all seasons and episodes in `episodesSeasonsMap`;
// - "program" (older shows, Kaltura OTT): a season list plus the current season's episodes; other seasons
//   live on /allshows/series/<id>/season/<position>/.
// Video is on Kaltura (partner 2748741); episodes are keyed by the Kaltura entry id, which is the same in
// both templates.
import {
  cleanDescription,
  cleanGenres,
  kalturaImage,
  parseDottedDate,
  parseEpisodeHint,
  type ScrapedEpisode,
  type ScrapedSeason,
  type ScrapedShow,
  tidyText,
} from '@israel-tv/core';
import { z } from 'zod';

/** At most this many list pages are read per show (the longest show had 26 on 2026-11-07). */
export const SITE_LIST_PAGES = 40;

export const RESHET_ORIGIN = 'https://13tv.co.il';
export const KALTURA_PARTNER = 2748741;

export function playManifestUrl(entryId: string): string {
  return `https://cdnapisec.kaltura.com/p/${KALTURA_PARTNER}/sp/${KALTURA_PARTNER}00/playManifest/entryId/${entryId}/format/applehttp/protocol/https/a.m3u8`;
}

export function nextData(html: string): unknown {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m?.[1]) throw new Error('page has no __NEXT_DATA__ (layout changed or block page)');
  return JSON.parse(m[1]);
}

const ShowRef = z.looseObject({
  id: z.coerce.string(),
  url: z.string(),
  title: z.string(),
  poster: z.string().nullish(),
});
const AllShowsPage = z.looseObject({
  props: z.looseObject({
    pageProps: z.looseObject({
      page: z.looseObject({
        Content: z.looseObject({ PageGrid: z.array(z.looseObject({ shows: z.array(ShowRef).optional() })) }),
      }),
    }),
  }),
});

export interface ReshetIndexEntry {
  key: string;
  title: string;
  poster?: string;
}

export function parseAllShows(html: string): ReshetIndexEntry[] {
  const d = AllShowsPage.parse(nextData(html));
  const grid = d.props.pageProps.page.Content.PageGrid.find((g) => g.shows && g.shows.length > 0);
  if (!grid?.shows) throw new Error('all-shows page has no show list');
  const seen = new Set<string>();
  const out: ReshetIndexEntry[] = [];
  for (const s of grid.shows) {
    // Some entries have no link yet (announced shows) or link elsewhere; keep 13tv.co.il pages only.
    if (!s.url.trim()) continue;
    const u = new URL(s.url, RESHET_ORIGIN);
    if (u.hostname !== new URL(RESHET_ORIGIN).hostname) continue;
    const key = u.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, title: s.title.trim(), ...(s.poster ? { poster: s.poster } : {}) });
  }
  return out;
}

// ---- show pages ---------------------------------------------------------------------------------------

const ImageObj = z.looseObject({ d: z.string().nullish(), m: z.string().nullish() }).nullish();
const NewEpisode = z.looseObject({
  id: z.coerce.string(),
  link: z.string().nullish(),
  title: z.string().default(''),
  secondaryTitle: z.string().nullish(),
  isBlank: z.boolean().nullish(),
  imageObj: ImageObj,
  air_date: z.string().nullish(),
  video: z.looseObject({ kalturaId: z.string().nullish(), duration: z.number().nullish() }).nullish(),
});
const VodPlaylistGrid = z.looseObject({
  grid_type: z.literal('VodPlaylist'),
  vodShowName: z.string().nullish(),
  episodesSeasonsMap: z.record(
    z.string(),
    z.looseObject({ name: z.string().nullish(), episodes: z.array(NewEpisode).nullish() }),
  ),
});

const OldEpisode = z.looseObject({
  id: z.coerce.string(),
  name: z.string().default(''),
  description: z.string().nullish(),
  entryId: z.string().nullish(),
  startDate: z.number().nullish(),
  createDate: z.number().nullish(),
  mediaFiles: z.array(z.looseObject({ duration: z.number().nullish() })).nullish(),
  images: z.array(z.looseObject({ url: z.string() })).nullish(),
  metas: z.looseObject({ EpisodeNumber: z.number().nullish(), SeasonNumber: z.number().nullish() }).nullish(),
  tags: z
    .looseObject({
      Genre: z
        .looseObject({ objects: z.array(z.looseObject({ value: z.string().nullish() })).nullish() })
        .nullish(),
    })
    .nullish(),
});
const Program = z.looseObject({
  seriesId: z.coerce.string(),
  seriesName: z.string().nullish(),
  /** The show's own page on the site ("/vod/hostages/"), which lists its videos as posts. */
  seriesHp: z.string().nullish(),
  season: z.looseObject({ position: z.number(), name: z.string().nullish() }).nullish(),
  seasonsList: z.array(z.looseObject({ position: z.number(), name: z.string().nullish() })).nullish(),
  episodes: z.array(OldEpisode).nullish(),
  /** The show's own record on Kaltura: its blurb and its pictures (16x9, 2x3, 9x16). */
  programData: z
    .looseObject({
      description: z.string().nullish(),
      images: z
        .array(z.looseObject({ imageTypeName: z.string().nullish(), url: z.string().nullish() }))
        .nullish(),
    })
    .nullish(),
});

const ShowPageData = z.looseObject({
  props: z.looseObject({
    pageProps: z.looseObject({
      page: z
        .looseObject({
          Content: z.looseObject({
            PageGrid: z.array(
              z.looseObject({ grid_type: z.string().nullish(), post_count: z.number().nullish() }),
            ),
          }),
        })
        .optional(),
      program: Program.optional(),
      assetMeta: z.unknown().optional(),
    }),
  }),
});

export interface ParsedSeason {
  /** Reshet's own season id (map key or position); stable when the title changes. */
  id: string;
  title: string;
  /** Older template: the season's position, to fetch its page. */
  position?: number;
  /** Episodes when the page carries them; undefined when the season page must be fetched. */
  episodes?: ScrapedEpisode[];
}

export interface ParsedShowPage {
  template: 'vod-playlist' | 'program' | 'no-vod';
  /** Why there are no episodes, for a warning. */
  note?: string;
  seriesId?: string;
  seasons: ParsedSeason[];
  /** The show's genres, from its episodes' Kaltura tags (older template only). */
  genres?: string[];
  /** The show's own blurb (the page's description meta, else its Kaltura record). */
  description?: string;
  /** A wide picture of the show (its Kaltura record's 16x9 image, 1280×720). */
  background?: string;
  /**
   * Older template whose Kaltura record has no seasons left: the show's own site page ("/vod/hostages/"), where its
   * episodes are still listed as posts (see parseShowSitePage).
   */
  sitePage?: string;
}

const img = (o: z.infer<typeof ImageObj>) => o?.d ?? o?.m ?? undefined;

/**
 * Kaltura's image service sends 120×90 when no size is asked for (1,630 of 1,767 Reshet episodes, 2026-11-07):
 * ask for 640×360, the size apps show episode stills at.
 */
export function episodeThumb(url: string | null | undefined): string | undefined {
  return url ? kalturaImage(url, 640, 360) : undefined;
}

/** The common episode shape for both page templates. */
function episode(
  entryId: string,
  rawTitle: string,
  f: {
    numberHint?: number | undefined;
    airDate?: string | undefined;
    description?: string | null | undefined;
    thumb?: string | null | undefined;
    dur?: number | null | undefined;
  },
): ScrapedEpisode {
  return {
    key: entryId,
    // "דה וויס, עונה 6, פרק 26: הגמר הגדול!" → "הגמר הגדול!"
    title: rawTitle.replace(/^.*?פרק\s*\d+\s*[:\-–]\s*/, '').trim() || rawTitle.trim(),
    ...(f.numberHint && f.numberHint > 0 ? { numberHint: f.numberHint } : {}),
    ...(f.airDate ? { airDate: f.airDate } : {}),
    ...(f.description ? { description: f.description.trim() } : {}),
    ...(episodeThumb(f.thumb) ? { thumbnail: episodeThumb(f.thumb) } : {}),
    ...(f.dur && f.dur > 0 ? { durationSec: Math.round(f.dur) } : {}),
    streams: [{ url: playManifestUrl(entryId), kind: 'direct' }],
    play: { entryId },
  };
}

function fromNew(e: z.infer<typeof NewEpisode>): ScrapedEpisode | undefined {
  const entryId = e.video?.kalturaId;
  if (e.isBlank || !entryId) return undefined;
  return episode(entryId, e.title, {
    numberHint: parseEpisodeHint(e.title),
    airDate: parseDottedDate(e.air_date),
    description: e.secondaryTitle,
    thumb: img(e.imageObj),
    dur: e.video?.duration,
  });
}

const epochDay = (sec: number | null | undefined) =>
  sec ? new Date(sec * 1000).toISOString().slice(0, 10) : undefined;

/**
 * Older-template episodes, with two repairs:
 * - some shows give every episode the show's own start date as `startDate`. When all episodes without a date in
 *   their title share one startDate, their upload date (`createDate`) is the better air date;
 * - some seasons give many episodes the same `EpisodeNumber` (a placeholder, mostly 1: 135 of the 138 episodes in
 *   one season of "המקור", 2026-11-07). A number shared within a season is not an episode number: those episodes
 *   take the number printed in their title, if any.
 */
function oldSeason(list: z.infer<typeof OldEpisode>[]): ScrapedEpisode[] {
  const untitled = list.filter((e) => !parseDottedDate(e.name) && e.startDate);
  const shared = untitled.length >= 2 && new Set(untitled.map((e) => e.startDate)).size === 1;
  const uses = new Map<number, number>();
  for (const e of list) {
    const n = e.metas?.EpisodeNumber;
    if (n) uses.set(n, (uses.get(n) ?? 0) + 1);
  }
  const placeholder = (e: z.infer<typeof OldEpisode>) => (uses.get(e.metas?.EpisodeNumber ?? 0) ?? 0) > 1;
  return list
    .map((e) => (shared && !parseDottedDate(e.name) && e.createDate ? { ...e, startDate: e.createDate } : e))
    .map((e) => (placeholder(e) ? { ...e, metas: { ...e.metas, EpisodeNumber: null } } : e))
    .map(fromOld)
    .filter((e): e is ScrapedEpisode => !!e);
}

export function fromOld(e: z.infer<typeof OldEpisode>): ScrapedEpisode | undefined {
  if (!e.entryId) return undefined;
  return episode(e.entryId, e.name, {
    // The number printed in the title is the broadcaster's own and what viewers read; Kaltura's EpisodeNumber field
    // is often a list position instead ("טלוויזיה מהעתיד" season 2: the special is 1, "פרק 1" is 2; 2026-11-07).
    numberHint: parseEpisodeHint(e.name) ?? e.metas?.EpisodeNumber ?? undefined,
    // A date in the title is the air date; otherwise startDate (see oldSeason for when that is the show's).
    airDate: parseDottedDate(e.name) ?? epochDay(e.startDate),
    description: e.description,
    thumb: e.images?.[0]?.url,
    dur: e.mediaFiles?.[0]?.duration,
  });
}

/** The page's description meta, decoded: the show's own blurb. */
function pageDescription(html: string): string | undefined {
  const m =
    /<meta[^>]+(?:property|name)="(?:og:)?description"[^>]+content="([^"]*)"/i.exec(html) ??
    /<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="(?:og:)?description"/i.exec(html);
  const t = m?.[1] ? tidyText(m[1]) : '';
  return t.length >= 10 ? t : undefined;
}

export function parseShowPage(html: string): ParsedShowPage {
  const description = pageDescription(html);
  const blurb = description ? { description } : {};
  const d = ShowPageData.parse(nextData(html));
  const pp = d.props.pageProps;
  const grid = pp.page?.Content.PageGrid.find((g) => g.grid_type === 'VodPlaylist');
  if (grid) {
    const g = VodPlaylistGrid.parse(grid);
    const seasons = Object.entries(g.episodesSeasonsMap)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, v]) => ({
        id: k,
        title: (v.name ?? `עונה ${k}`).trim(),
        episodes: (v.episodes ?? []).map(fromNew).filter((e): e is ScrapedEpisode => !!e),
      }));
    return { template: 'vod-playlist', seasons, ...blurb };
  }
  if (pp.program) {
    const p = pp.program;
    const current = p.season?.position;
    const list = p.seasonsList?.length ? p.seasonsList : p.season ? [p.season] : [];
    const seasons = [...list]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: String(s.position),
        title: (s.name ?? `עונה ${s.position}`).trim(),
        position: s.position,
        ...(s.position === current ? { episodes: oldSeason(p.episodes ?? []) } : {}),
      }));
    const genres = cleanGenres(
      (p.episodes ?? []).flatMap((e) => e.tags?.Genre?.objects?.map((o) => o.value) ?? []),
    );
    // Daily news shows leave the page's description empty; their Kaltura record still has a blurb.
    const own = tidyText(p.programData?.description ?? '');
    const wide = p.programData?.images?.find((i) => i.imageTypeName === '16x9')?.url;
    // A record with no seasons and no episodes (29 shows, 2026-11-07; their season pages answer HTTP 500): the
    // show's own site page still lists its videos.
    const empty = seasons.length === 0 && !p.episodes?.length;
    const home = p.seriesHp?.trim();
    return {
      template: 'program',
      seriesId: p.seriesId,
      seasons,
      ...(empty && home?.startsWith('/') ? { sitePage: home } : {}),
      ...(genres.length ? { genres } : {}),
      ...(description ? blurb : own.length >= 10 ? { description: own } : {}),
      ...(wide && /^https:\/\//.test(wide) ? { background: kalturaImage(wide, 1280, 720) } : {}),
    };
  }
  // Pages with only article/clip grids (no episode list) are shows without VOD. They are noted, not failed;
  // a page with no grids at all is still treated as a layout change.
  const grids = pp.page?.Content.PageGrid ?? [];
  if (grids.length > 0) {
    const kinds = [...new Set(grids.map((g) => g.grid_type ?? '?'))].join(', ');
    // A video list page whose list is empty (post_count 0): the show is listed with nothing on it.
    const count = grids.find((g) => g.grid_type === 'PaginationArray')?.post_count;
    return {
      template: 'no-vod',
      seasons: [],
      note: count === 0 ? 'its page lists no videos' : `no episode list on the show page (only ${kinds})`,
      ...blurb,
    };
  }
  throw new Error('show page has neither a VodPlaylist grid nor a program (layout changed?)');
}

/**
 * A printed number that two episodes of one season claim is no episode number (a title's "פרק 3" next to another
 * episode's Kaltura number 3, "חוזרים לפספוסים" 2026-11-07): neither keeps it, so the season is numbered by the rules
 * for unnumbered episodes instead of one taking the number and the other being reported as a clash on every read.
 */
export function dropCollidingHints(episodes: ScrapedEpisode[]): ScrapedEpisode[] {
  const uses = new Map<number, number>();
  for (const e of episodes) if (e.numberHint) uses.set(e.numberHint, (uses.get(e.numberHint) ?? 0) + 1);
  return episodes.map((e) => {
    if (!e.numberHint || (uses.get(e.numberHint) ?? 0) < 2) return e;
    const { numberHint: _, ...rest } = e;
    return rest;
  });
}

/** Episodes from an older-template season page. */
export function parseSeasonPage(html: string): ScrapedEpisode[] {
  const d = ShowPageData.parse(nextData(html));
  return oldSeason(d.props.pageProps.program?.episodes ?? []);
}

// ---- the show's own site page --------------------------------------------------------------------------
//
// Shows whose Kaltura record is empty (and some shows listed straight to such a page) are still on the site as a
// page of posts: a "Base" list with further pages ("/vod/hostages/page/2/"), or grids ("פרקים מלאים", clips,
// articles) that link to full lists ("/entertainment/the-x-factor-israel/season-04/episodes/"). A post is a full
// episode when it has a Kaltura video and links either to Reshet's VOD item for it
// ("/allshows/series/464/season/1/2147762/") or to an item under the show's own "episodes" section
// ("/item/kan-kids/shakshuka/season-01/episodes/…"). Clips, recipes and articles link elsewhere and are left out.

const SitePost = z.looseObject({
  link: z.string().nullish(),
  title: z.string().nullish(),
  secondaryTitle: z.string().nullish(),
  isBlank: z.boolean().nullish(),
  imageObj: ImageObj.catch(undefined),
  publishDate: z.string().nullish(),
  video: z
    .looseObject({
      kalturaId: z.string().nullish(),
      duration: z.number().nullish(),
      name: z.string().nullish(),
    })
    .nullish()
    .catch(undefined),
});
type SitePost = z.infer<typeof SitePost>;
const SiteGrid = z.looseObject({
  grid_type: z.string().nullish(),
  grid_title: z
    .looseObject({ text: z.string().nullish(), link: z.string().nullish() })
    .nullish()
    .catch(undefined),
  posts: z.array(z.unknown()).nullish().catch(undefined),
  matrix_elements: z
    .array(z.looseObject({ posts: z.array(z.unknown()).nullish() }).catch({ posts: [] }))
    .nullish()
    .catch(undefined),
  current_page: z.number().nullish(),
  max_page: z.number().nullish(),
  base: z.string().nullish(),
});
const SitePageData = z.looseObject({
  props: z.looseObject({
    pageProps: z.looseObject({
      page: z
        .looseObject({
          PageMeta: z.looseObject({ pageType: z.string().nullish() }).nullish().catch(undefined),
          Content: z.looseObject({ PageGrid: z.array(z.unknown()) }),
        })
        .nullish(),
    }),
  }),
});

export interface SiteEpisode {
  season: number;
  /** The post's publish time, to order a season oldest first. */
  at: string;
  episode: ScrapedEpisode;
}

export interface ShowSitePage {
  /** The site's front page (a show the list links there has no page of its own). */
  front: boolean;
  episodes: SiteEpisode[];
  /** Full-episode lists the page's grids link to. */
  lists: string[];
  /** This list's further pages, in order. */
  morePages: string[];
  /** The Reshet VOD series the episodes belong to (from their links), once known. */
  seriesId?: string;
  /** VOD links to several series and no way to tell the show's own: those were left out. */
  mixed?: boolean;
  /** The page's description meta (the show's blurb on its own site page), when it has one. */
  description?: string;
}

const VOD_ITEM = /^\/allshows\/series\/(\d+)\/season\/(\d+)\/\d+\/?$/;
const seasonIn = (s: string | null | undefined) => /עונה\s*(\d{1,3})(?!\d)/.exec(s ?? '')?.[1] ?? undefined;
const seasonPath = (s: string | null | undefined) =>
  /season-0*(\d{1,3})(?!\d)/.exec(s ?? '')?.[1] ?? undefined;
const dayOf = (s: string | null | undefined) => (/^\d{4}-\d{2}-\d{2}/.exec(s ?? '') ?? [])[0];

/**
 * Full episodes on one of a show's site pages. `show` is the show's own page ("/kan-kids/shakshuka/"), which its
 * episode items sit under; `seriesId` its VOD series when known (otherwise the one series the page's VOD links share);
 * `page` the address of this page, whose "season-04" names the season of a list that does not say it otherwise.
 */
export function parseShowSitePage(
  html: string,
  where: { show: string; page: string; seriesId?: string | undefined },
): ShowSitePage {
  const page = SitePageData.parse(nextData(html)).props.pageProps.page;
  const grids = (page?.Content.PageGrid ?? []).flatMap((g) => {
    const r = SiteGrid.safeParse(g);
    return r.success ? [r.data] : [];
  });
  const showPath = where.show.endsWith('/') ? where.show : `${where.show}/`;
  const candidates: { series?: string; season: number; at: string; episode: ScrapedEpisode }[] = [];
  const lists: string[] = [];
  const morePages: string[] = [];
  for (const g of grids) {
    const posts = [...(g.posts ?? []), ...(g.matrix_elements ?? []).flatMap((m) => m.posts ?? [])].flatMap(
      (p) => {
        const r = SitePost.safeParse(p);
        return r.success ? [r.data] : [];
      },
    );
    for (const p of posts) {
      const c = sitePost(p, showPath, g.grid_title, where.page);
      if (c) candidates.push(c);
    }
    const link = g.grid_title?.link?.trim();
    if (link?.startsWith(showPath) && /\/episodes\/?$/.test(link) && !lists.includes(link)) lists.push(link);
    // A site path only ("/…", never "//host" or "@host"), and never more pages than a show may read.
    if (
      g.grid_type === 'PaginationArray' &&
      /^\/[^/@]/.test(g.base ?? '') &&
      g.base?.includes('%#%') &&
      g.max_page
    ) {
      const current = g.current_page ?? 1;
      for (let n = current + 1; n <= Math.min(g.max_page, current + SITE_LIST_PAGES); n++)
        morePages.push(`${g.base.replace('%#%', String(n)).replace(/\/?$/, '/')}`);
    }
  }
  const series = [...new Set(candidates.flatMap((c) => (c.series ? [c.series] : [])))];
  const seriesId = where.seriesId ?? (series.length === 1 ? series[0] : undefined);
  const mixed = !where.seriesId && series.length > 1;
  const seen = new Set<string>();
  const episodes = candidates.filter((c) => {
    if (c.series && c.series !== seriesId) return false;
    if (seen.has(c.episode.key)) return false;
    seen.add(c.episode.key);
    return true;
  });
  const front = page?.PageMeta?.pageType === 'hp';
  const description = front ? undefined : cleanDescription(pageDescription(html));
  return {
    front,
    episodes: episodes.map(({ season, at, episode }) => ({ season, at, episode })),
    ...(description ? { description } : {}),
    lists,
    morePages,
    ...(seriesId ? { seriesId } : {}),
    ...(mixed ? { mixed } : {}),
  };
}

/** One post as a full episode of the show, or undefined (a clip, an article, another show's video). */
function sitePost(
  p: SitePost,
  showPath: string,
  grid: { text?: string | null | undefined; link?: string | null | undefined } | null | undefined,
  pagePath: string,
): { series?: string; season: number; at: string; episode: ScrapedEpisode } | undefined {
  const entryId = p.video?.kalturaId?.trim();
  const link = p.link?.trim() ?? '';
  if (!entryId || p.isBlank) return undefined;
  const vod = VOD_ITEM.exec(link);
  const own = link.startsWith(`/item${showPath}`) && /\/episodes\//.test(link);
  if (!vod && !own) return undefined;
  const title = p.title ?? '';
  // The season as the site names it: in the title, the item's address, the grid, the list's address, the video's
  // name; then the VOD item's season position; else 1.
  const season = Number(
    seasonIn(title) ??
      seasonPath(own ? link : undefined) ??
      seasonIn(grid?.text) ??
      seasonPath(grid?.link) ??
      seasonPath(pagePath) ??
      seasonPath(p.video?.name) ??
      vod?.[2] ??
      '1',
  );
  return {
    ...(vod?.[1] ? { series: vod[1] } : {}),
    season: season > 0 ? season : 1,
    at: p.publishDate ?? '',
    episode: episode(entryId, title, {
      numberHint: parseEpisodeHint(title),
      airDate: parseDottedDate(title) ?? dayOf(p.publishDate),
      description: p.secondaryTitle,
      thumb: img(p.imageObj),
      dur: p.video?.duration,
    }),
  };
}

/** Site-page episodes as seasons ("עונה 2"), lowest first, each oldest first. */
export function siteSeasons(list: readonly SiteEpisode[]): (ParsedSeason & { episodes: ScrapedEpisode[] })[] {
  const by = new Map<number, SiteEpisode[]>();
  for (const e of list) by.set(e.season, [...(by.get(e.season) ?? []), e]);
  return [...by.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, eps]) => ({
      id: String(n),
      title: `עונה ${n}`,
      episodes: eps
        .map((e, i) => ({ e, i }))
        .sort((a, b) => a.e.at.localeCompare(b.e.at) || b.i - a.i)
        .map(({ e }) => e.episode),
    }));
}

/** Season keys a stored show already split by year (`<key>|2024`), so a later read splits them again. */
export function splitKeys(stored: ScrapedShow | undefined): Set<string> {
  const out = new Set<string>();
  for (const s of stored?.seasons ?? []) {
    const m = /^(.*)\|\d{4}$/.exec(s.key);
    if (m?.[1] && /^\d{4}$/.test(s.title)) out.add(m[1]);
  }
  return out;
}

/**
 * Reshet lists some daily shows as untitled seasons next to others (often an empty one), which would make them
 * "named" seasons. Each untitled season among several becomes one season per air year ("2024"), so it is
 * numbered like any year season (by position, oldest = 1), with its episodes in air-date order and no printed
 * numbers (a daily show's "פרק N" counts within a year at most). Empty untitled seasons are dropped. A show whose
 * only season is untitled stays a single season — unless it was split before (`alreadySplit`, from the stored
 * show): the decision never depends on how many seasons one read happened to see. Episodes join a year season of
 * the same key already in the show instead of duplicating it.
 */
export function untitledSeasonsByYear(
  show: ScrapedShow,
  alreadySplit: ReadonlySet<string> = new Set(),
): ScrapedShow {
  const untitled = (s: ScrapedSeason) => s.title.trim() === '';
  const eligible = (s: ScrapedSeason) => untitled(s) && (show.seasons.length > 1 || alreadySplit.has(s.key));
  if (!show.seasons.some(eligible)) return show;
  const byKey = new Map<string, ScrapedSeason>();
  const order: string[] = [];
  const put = (s: ScrapedSeason) => {
    const had = byKey.get(s.key);
    if (!had) {
      byKey.set(s.key, { ...s, episodes: [...s.episodes] });
      order.push(s.key);
      return;
    }
    const seen = new Set(had.episodes.map((e) => e.key));
    had.episodes.push(...s.episodes.filter((e) => !seen.has(e.key)));
  };
  for (const s of show.seasons) {
    if (!eligible(s)) {
      put(s);
      continue;
    }
    const years = [
      ...new Set(s.episodes.map((e) => e.airDate?.slice(0, 4)).filter((y): y is string => !!y)),
    ].sort();
    const last = years.at(-1);
    for (const e of s.episodes) {
      const y = e.airDate?.slice(0, 4) ?? last;
      if (!y) continue;
      const { numberHint: _, ...rest } = e;
      put({ key: `${s.key}|${y}`, title: y, episodes: [rest] });
    }
  }
  const seasons = order
    .map((k) => byKey.get(k) as ScrapedSeason)
    .map((s) =>
      /^\d{4}$/.test(s.title) && /\|\d{4}$/.test(s.key)
        ? {
            ...s,
            episodes: s.episodes
              .map((e, i) => ({ e, i }))
              .sort((a, b) => (a.e.airDate ?? '').localeCompare(b.e.airDate ?? '') || a.i - b.i)
              .map(({ e }) => e),
          }
        : s,
    )
    .sort((a, b) => {
      // Year seasons of one untitled season sit together, oldest first; everything else keeps the source order.
      const ya = /^(.*)\|(\d{4})$/.exec(a.key);
      const yb = /^(.*)\|(\d{4})$/.exec(b.key);
      if (ya && yb && ya[1] === yb[1]) return (ya[2] ?? '').localeCompare(yb[2] ?? '');
      return 0;
    });
  return { ...show, seasons };
}
