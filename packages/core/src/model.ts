import { z } from 'zod';
import { SOURCES } from './ids.ts';
import { cleanDescription, isTrailer } from './tidy.ts';

/** One playable rendition as the source reports it. */
export const ScrapedStream = z.strictObject({
  url: z.url(),
  /** `direct`: playable as-is; `resolver`: needs the private resolver (tokens, relays). */
  kind: z.enum(['direct', 'resolver']),
  label: z.string().optional(),
});
export type ScrapedStream = z.infer<typeof ScrapedStream>;

export const ScrapedEpisode = z.strictObject({
  /** Stable source key (e.g. Mako itemVcmId, Kaltura entry id). */
  key: z.string().min(1),
  title: z.string(),
  /** Episode number printed by the source ("פרק 5"), when there is one. */
  numberHint: z.number().int().positive().optional(),
  airDate: z.iso.date().optional(),
  description: z.string().optional(),
  thumbnail: z.url().optional(),
  durationSec: z.number().int().positive().optional(),
  /** Where the source says the episode is watchable, if it says. */
  availableAbroad: z.boolean().optional(),
  streams: z.array(ScrapedStream).default([]),
  /** Source data the resolver needs at play time (e.g. Mako vcmid/channelId). */
  play: z.record(z.string(), z.string()).optional(),
});
export type ScrapedEpisode = z.infer<typeof ScrapedEpisode>;

export const ScrapedSeason = z.strictObject({
  key: z.string().min(1),
  /** Title as the source shows it, e.g. "עונה 12", "VIP 5", "עונה 2025". Empty for single-season shows. */
  title: z.string(),
  episodes: z.array(ScrapedEpisode),
});
export type ScrapedSeason = z.infer<typeof ScrapedSeason>;

export const ScrapedShow = z.strictObject({
  source: z.enum(SOURCES),
  key: z.string().min(1),
  title: z.string().min(1),
  /** Catalog row this show belongs to (see catalogs.ts). */
  catalog: z.string().min(1),
  description: z.string().optional(),
  poster: z.url().optional(),
  background: z.url().optional(),
  genres: z.array(z.string()).optional(),
  /** Seasons in the order the source lists them. */
  seasons: z.array(ScrapedSeason),
  pageUrl: z.url().optional(),
  /** Problems the reader worked around (e.g. a dead season link); recorded as warnings. */
  notes: z.array(z.string()).optional(),
});
export type ScrapedShow = z.infer<typeof ScrapedShow>;

const isHttpUrl = (u: unknown) => typeof u === 'string' && /^https?:\/\//.test(u) && URL.canParse(u);

/**
 * Drop optional fields a source filled with junk (relative image paths, zero durations), then validate.
 * A show that is still invalid fails with the field path, so only that show is affected.
 */
export function cleanShow(show: ScrapedShow): ScrapedShow {
  const optUrl = <T extends object, K extends keyof T>(o: T, k: K): T => {
    if (o[k] !== undefined && !isHttpUrl(o[k])) {
      const { [k]: _, ...rest } = o;
      return rest as T;
    }
    return o;
  };
  // Descriptions without what sites add for search engines (cleanDescription); none rather than junk.
  const { description: rawDescription, ...withoutDescription } = show;
  const description = cleanDescription(rawDescription);
  const cleaned: ScrapedShow = {
    ...optUrl(
      optUrl(
        optUrl({ ...withoutDescription, ...(description ? { description } : {}) }, 'poster'),
        'background',
      ),
      'pageUrl',
    ),
    // Trailers and promos are not episodes: left out before they are numbered (they would take an episode's place).
    seasons: show.seasons.map((s) => ({
      ...s,
      episodes: s.episodes
        .filter((e) => !isTrailer(e.title))
        .map((e) => {
          let ep = optUrl(e, 'thumbnail');
          if (ep.durationSec !== undefined && !(Number.isInteger(ep.durationSec) && ep.durationSec > 0)) {
            const { durationSec: _, ...rest } = ep;
            ep = rest;
          }
          return { ...ep, streams: ep.streams.filter((x) => isHttpUrl(x.url)) };
        }),
    })),
  };
  const r = ScrapedShow.safeParse(cleaned);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new Error(`source data failed validation at ${i?.path.join('.') ?? '?'}: ${i?.message ?? ''}`);
  }
  return r.data;
}

/** One name per genre across sources (Keshet and Reshet spell some differently). */
const GENRE_NAMES: Record<string, string> = {
  'לייף סטייל': 'לייפסטייל',
  שעשועון: 'שעשועונים',
  תעודה: 'דוקומנטרי',
  'דוקו ותחקירים': 'דוקומנטרי',
  תחקיר: 'תחקירים',
  אוכל: 'בישול',
};

/**
 * Genres as a source gives them, cleaned for a filter: one spelling ("תוכניות" → "תכניות", "לייף סטייל" →
 * "לייפסטייל"), no "תכניות" prefix ("תכניות אקטואליה" → "אקטואליה"), no site sections (anything with a channel
 * number, "חדשות 13"), no empties or repeats, at most 5.
 */
export function cleanGenres(list: readonly (string | null | undefined)[] | null | undefined): string[] {
  const one = (g: string) =>
    g
      .replace(/[\s\u00a0]+/g, ' ')
      .trim()
      .replace(/תוכני/g, 'תכני')
      .replace(/^תכני(?:ו)?ת\s+/, '')
      .replace(/^מצויירים$/, 'מצוירים');
  const named = (g: string) => GENRE_NAMES[g] ?? g;
  return [
    ...new Set(
      (list ?? [])
        .map((g) => named(one(g ?? '')))
        .filter((g) => g.length > 0 && g.length <= 40 && !/\d/.test(g)),
    ),
  ].slice(0, 5);
}
