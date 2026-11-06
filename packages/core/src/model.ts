import { z } from 'zod';
import { SOURCES } from './ids.ts';

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
