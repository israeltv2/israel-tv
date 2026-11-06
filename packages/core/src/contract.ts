// The catalog ↔ resolver contract: what a published catalog gives a resolver, so a resolver can run anywhere
// without the catalog's database. Versioned: a resolver refuses a catalog version it does not understand.
// Human description: docs/contract.md. Contract tests: packages/render and apps/resolver tests.
import { z } from 'zod';

/** Bump when a resolver could misread a catalog written by this code (and keep the docs in step). */
export const RESOLVER_CONTRACT_VERSION = 1;

/** One episode's play details (per season: `play/<series id>/<season>.json`, keyed by episode number). */
export const EpisodePlaySchema = z.object({
  /** Mako's ids for its playlist service: the resolver gets a fresh ticket and the master per play. */
  mako: z
    .object({
      vcmid: z.string().min(1),
      channelId: z.string().min(1),
      galleryChannelId: z.string().optional(),
    })
    .optional(),
  /** The direct stream (Reshet, Kan): the resolver relays it only when it is refused where the viewer is. */
  direct: z.url().optional(),
  /** Refused outside Israel, as far as the catalog's maker knows. */
  israelOnly: z.literal(true).optional(),
});
export type EpisodePlay = z.infer<typeof EpisodePlaySchema>;

export const SeasonPlaySchema = z.record(z.string().regex(/^\d+$/), EpisodePlaySchema);
export type SeasonPlay = z.infer<typeof SeasonPlaySchema>;

/** `ext-ids.json`: IMDb (`tt…`) / TMDB (`tmdb:…`) id → our series and the seasons that share their numbering. */
export const ExtIdsSchema = z.record(
  z.string(),
  z.object({ id: z.string(), seasons: z.array(z.number().int()) }),
);

/** `resolver-contract.json`, at the catalog's root. */
export const ContractSchema = z.looseObject({
  version: z.number().int().positive(),
  seasonPlay: z.string(),
  extIds: z.string(),
});
export type Contract = z.infer<typeof ContractSchema>;

/** What this code publishes. */
export const CONTRACT: Contract = {
  version: RESOLVER_CONTRACT_VERSION,
  seasonPlay: 'play/{series}/{season}.json',
  extIds: 'ext-ids.json',
};
