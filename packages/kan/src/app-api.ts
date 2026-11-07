// Kan's app API (mobapi.kan.org.il): the JSON Kan's own mobile app reads. One request lists every episode of a show
// (`program?id=<show page id>`) and one lists a category's shows (`subClass?id=<category>`). It sits behind the same
// Cloudflare check as the site, so it is read in the same cleared browser session (docs/decisions.md "Kan's app API").
// Behaviour learned from public responses; no code from other projects.
import { z } from 'zod';
import type { KanEpisode } from './parse.ts';

export const KAN_APP_API = 'https://mobapi.kan.org.il/api/mobile';

/** A show's episode list in the app API (`from` is 1-based; a page holds up to 200 entries). */
export const appProgramUrl = (programId: string, from = 1) =>
  `${KAN_APP_API}/program?id=${encodeURIComponent(programId)}${from > 1 ? `&from=${from}` : ''}`;

/** A category's shows in the app API (kids & teens 4453, preschool 4462). */
export const appCategoryUrl = (categoryId: string, from = 1) =>
  `${KAN_APP_API}/subClass?id=${encodeURIComponent(categoryId)}${from > 1 ? `&from=${from}` : ''}`;

/** The app API's page size: a full page means there may be more. */
export const APP_PAGE_SIZE = 200;

/** Categories whose shows have no numeric id in their page address (kankids slugs): their ids come from here. */
export const KAN_APP_CATEGORIES = ['4453', '4462'];

const Entry = z.looseObject({
  id: z.coerce.string(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  published: z.string().nullish(),
  link: z.looseObject({ href: z.string().nullish() }).nullish(),
  content: z.looseObject({ type: z.string().nullish(), src: z.string().nullish() }).nullish(),
  extensions: z
    .looseObject({
      share_url: z.string().nullish(),
      analyticsCustomProperties: z
        .looseObject({ season: z.coerce.number().nullish(), show_name: z.string().nullish() })
        .nullish(),
    })
    .nullish(),
  media_group: z
    .array(
      z.looseObject({
        media_item: z
          .array(z.looseObject({ src: z.string().nullish(), key: z.string().nullish() }))
          .nullish(),
      }),
    )
    .nullish(),
});
const Feed = z.looseObject({ title: z.string().nullish(), entry: z.array(z.unknown()).nullish() });

export interface AppItem {
  /** Kan's page id of the episode: the same id as its web page (our episode key is `kan:<id>`). */
  id: string;
  /**
   * What the app plays: a Redge stream we can name; no stream named (an empty entry); or something else (a YouTube
   * id, a new kind). Only `redge` is used: anything else is read from the episode's web page, as before.
   */
  stream: { kind: 'redge'; url: string } | { kind: 'none' } | { kind: 'other' };
  title: string;
  seasonNumber?: number;
  description?: string;
  /** Israel's date of publication (YYYY-MM-DD), as the web page's datePublished gives it. */
  published?: string;
  image?: string;
  /** The episode's web page. */
  pageUrl?: string;
}

/**
 * The Redge HLS address the web player plays for a Kaltura entry. Measured 2026-11-07 on every stored Kan episode
 * whose web stream has a Kaltura entry id: the web page's Redge URL is exactly this, with the same entry id.
 */
export const redgeUrl = (entryId: string) =>
  `https://r.il.cdn-redge.media/webcache/gorigin/hls/oil/kancdn/vod/${entryId}/LIBCODER_SMOOTH_1080_KAN/Manifest.ism/playlist.m3u8?fmp4`;

function streamOf(content: z.infer<typeof Entry>['content']): AppItem['stream'] {
  const src = content?.src?.trim() ?? '';
  const kaltura = /\/playManifest\/entryId\/([^/]*)\//.exec(src);
  if (kaltura)
    return kaltura[1] && /^\d_[a-z0-9]+$/.test(kaltura[1])
      ? { kind: 'redge', url: redgeUrl(kaltura[1]) }
      : { kind: 'none' };
  if (!src) return { kind: 'none' };
  // A YouTube id, a numeric Redge asset or anything new: the web page knows which stream to play.
  return { kind: 'other' };
}

/** A show's episodes from `program?id=…` (one page of it). */
export function parseAppProgram(json: unknown): { title?: string; items: AppItem[]; full: boolean } {
  const feed = Feed.parse(json);
  const items: AppItem[] = [];
  for (const raw of feed.entry ?? []) {
    const r = Entry.safeParse(raw);
    if (!r.success) continue;
    const e = r.data;
    const season = e.extensions?.analyticsCustomProperties?.season;
    const image = e.media_group?.flatMap((g) => g.media_item ?? []).find((m) => m.key === 'image_base')?.src;
    const published = /^(\d{4}-\d{2}-\d{2})/.exec(e.published ?? '')?.[1];
    const pageUrl = (e.extensions?.share_url ?? e.link?.href ?? '').replace(/\?app=true$/, '') || undefined;
    // Kan's "rights ended" note (the web page shows it where the player was): the page decides, never the app.
    const withdrawn = /כבר לא זמין לצפייה/.test(`${e.description ?? ''} ${e.title ?? ''}`);
    items.push({
      id: e.id,
      stream: withdrawn ? { kind: 'other' } : streamOf(e.content),
      title: (e.title ?? '').trim(),
      ...(season ? { seasonNumber: season } : {}),
      ...(e.description?.trim() ? { description: e.description.trim() } : {}),
      ...(published ? { published } : {}),
      ...(image ? { image: image.replace('//mobapi.kan.org.il/', '//www.kan.org.il/') } : {}),
      ...(pageUrl ? { pageUrl } : {}),
    });
  }
  return {
    ...(feed.title ? { title: feed.title } : {}),
    items,
    full: (feed.entry?.length ?? 0) >= APP_PAGE_SIZE,
  };
}

/** A category's shows from `subClass?id=…`: each show's app id by its web page address (without `?app=true`). */
export function parseAppCategory(json: unknown): { shows: Map<string, string>; full: boolean } {
  const feed = Feed.parse(json);
  const shows = new Map<string, string>();
  for (const raw of feed.entry ?? []) {
    const r = Entry.safeParse(raw);
    const href = r.success ? r.data.link?.href?.replace(/\?app=true$/, '') : undefined;
    if (r.success && href) shows.set(href.endsWith('/') ? href : `${href}/`, r.data.id);
  }
  return { shows, full: (feed.entry?.length ?? 0) >= APP_PAGE_SIZE };
}

/** An episode as the web page's player would give it, from an app item whose stream we can name. */
export function appEpisode(item: AppItem & { stream: { kind: 'redge' } }): KanEpisode {
  return {
    id: item.id,
    title: item.title,
    hls: item.stream.url,
    ...(item.seasonNumber ? { seasonNumber: item.seasonNumber } : {}),
    ...(item.image ? { poster: item.image } : {}),
    ...(item.description ? { description: item.description } : {}),
    ...(item.published ? { published: item.published } : {}),
  };
}
