// Reshet 13 (13tv.co.il) pages are Next.js pages with their data in __NEXT_DATA__. Two templates exist:
// - "VodPlaylist" (newer shows): all seasons and episodes in `episodesSeasonsMap`;
// - "program" (older shows, Kaltura OTT): a season list plus the current season's episodes; other seasons
//   live on /allshows/series/<id>/season/<position>/.
// Video is on Kaltura (partner 2748741); episodes are keyed by the Kaltura entry id, which is the same in
// both templates.
import {
  cleanGenres,
  parseDottedDate,
  parseEpisodeHint,
  type ScrapedEpisode,
  type ScrapedSeason,
  type ScrapedShow,
  tidyText,
} from '@israel-tv/core';
import { z } from 'zod';

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
  season: z.looseObject({ position: z.number(), name: z.string().nullish() }).nullish(),
  seasonsList: z.array(z.looseObject({ position: z.number(), name: z.string().nullish() })).nullish(),
  episodes: z.array(OldEpisode).nullish(),
});

const ShowPageData = z.looseObject({
  props: z.looseObject({
    pageProps: z.looseObject({
      page: z
        .looseObject({
          Content: z.looseObject({ PageGrid: z.array(z.looseObject({ grid_type: z.string().nullish() })) }),
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
  /** The show's own blurb (the page's description meta). */
  description?: string;
}

const img = (o: z.infer<typeof ImageObj>) => o?.d ?? o?.m ?? undefined;

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
    ...(f.thumb ? { thumbnail: f.thumb } : {}),
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
 * Older-template episodes, with one repair: some shows give every episode the show's own start date as
 * `startDate`. When all episodes without a date in their title share one startDate, their upload date
 * (`createDate`) is the better air date.
 */
function oldSeason(list: z.infer<typeof OldEpisode>[]): ScrapedEpisode[] {
  const untitled = list.filter((e) => !parseDottedDate(e.name) && e.startDate);
  const shared = untitled.length >= 2 && new Set(untitled.map((e) => e.startDate)).size === 1;
  return list
    .map((e) => (shared && !parseDottedDate(e.name) && e.createDate ? { ...e, startDate: e.createDate } : e))
    .map(fromOld)
    .filter((e): e is ScrapedEpisode => !!e);
}

export function fromOld(e: z.infer<typeof OldEpisode>): ScrapedEpisode | undefined {
  if (!e.entryId) return undefined;
  return episode(e.entryId, e.name, {
    numberHint: e.metas?.EpisodeNumber ?? parseEpisodeHint(e.name),
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
    return {
      template: 'program',
      seriesId: p.seriesId,
      seasons,
      ...(genres.length ? { genres } : {}),
      ...blurb,
    };
  }
  // Pages with only article/clip grids (no episode list) are shows without VOD. They are noted, not failed;
  // a page with no grids at all is still treated as a layout change.
  const grids = pp.page?.Content.PageGrid ?? [];
  if (grids.length > 0) {
    const kinds = [...new Set(grids.map((g) => g.grid_type ?? '?'))].join(', ');
    return {
      template: 'no-vod',
      seasons: [],
      note: `no episode list on the show page (only ${kinds})`,
      ...blurb,
    };
  }
  throw new Error('show page has neither a VodPlaylist grid nor a program (layout changed?)');
}

/** Episodes from an older-template season page. */
export function parseSeasonPage(html: string): ScrapedEpisode[] {
  const d = ShowPageData.parse(nextData(html));
  return oldSeason(d.props.pageProps.program?.episodes ?? []);
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
