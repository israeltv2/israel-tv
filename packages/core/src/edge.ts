// What the Cloudflare Workers and the addon app use from core, without the config and contract schemas (zod): the
// Workers stay small (the full core would add ~760 KB of zod to the API Worker). Checked by `pnpm boundaries`.

export {
  type GuideFile,
  type GuideRow,
  guideLine,
  guideVideos,
  liveChannelOf,
} from './epg.ts';
export { CANARY_HEADER, clientHash, PROBE_HEADER } from './events.ts';
export {
  type Freshness,
  STALE_ID_PREFIX,
  staleItem,
  staleSince,
} from './freshness.ts';
export { expandSearchKey, normalizeForSearch, searchMatches } from './hebrew.ts';
export { parseSeriesId, parseVideoId } from './ids.ts';
export {
  CATALOG_PAGE_SIZE,
  type ExtIds,
  ORIGIN_TOKEN,
  type SearchRow,
  type SeasonStreams,
  sitePaths,
  withOrigin,
} from './site.ts';
export type { Stream } from './stremio.ts';
