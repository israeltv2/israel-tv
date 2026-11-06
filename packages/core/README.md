# @israel-tv/core — shared model, ids, numbering, config schema and contracts

`core` holds what every part must agree on: the scraped-show model, public ids, the numbering rules, the one
config schema, the catalog ↔ resolver contract, the router ↔ API contract, the site file layout and the usage
event shape. It is pure TypeScript with `zod` as its only dependency, so it runs in Node and in Workers alike.

## Responsibility

- Public ids (`iltv_` prefix), allocated once and never reused; ids come from the source, never list position.
- Stateful numbering: a published season/episode number never changes; conflicts become warnings.
- The config schema with its defaults; secrets appear only as environment variable names.
- The versioned contracts both sides of a split import, so they cannot drift.

## Must not

- Import any other workspace package or any app.
- Use Node built-ins: the Workers import it (`@israel-tv/core/router-contract` must stay import-free, since the
  data Worker's router imports nothing else).
- Do I/O: no network, files or databases.

## Inputs and outputs

- `ScrapedShow`, `ScrapedSeason`, `ScrapedEpisode`, `ScrapedStream`, `cleanShow` — the common show model.
- `SOURCES`, `GEO_LIMITED`, `seriesId`, `parseSeriesId`, `videoId`, `parseVideoId` — ids.
- `assignNumbers`, `parseSeasonTitle`, `parseEpisodeHint`, `hintsRunBackwards`, `NAMED_SEASON_BASE` — numbering.
- `ConfigSchema`, `parseConfig`, `ConfigError`, `roleOf`, `enabledSources`, `secretOwners`, `checkSecrets`,
  `tmdbApiKey`, `apiWorkerName` — config.
- `ContractSchema`, `EpisodePlaySchema`, `SeasonPlaySchema`, `CONTRACT`, `RESOLVER_CONTRACT_VERSION` — the
  catalog ↔ resolver contract.
- `sitePaths`, `CATALOG_PAGE_SIZE`, `withOrigin`, `ORIGIN_TOKEN`, `StatusFile` and related types — site layout.
- `CATALOGS`, `catalogDef` — the catalog rows; `LIVE_CHANNELS` — live channels and their streams.
- `freshnessStamp`, `staleSince`, `staleItem`, `STALE_PUBLISH_HOURS` — staleness of a published catalog.
- `UsageEvent`, `clientHash`, `newPlayId`, retention constants — usage events.
- `normalizeForSearch` — Hebrew search normalization; `daysAgo`, `parseDottedDate` — dates.
- Stremio protocol types (`Manifest`, `Meta`, `Stream`, …), type-only.
- `@israel-tv/core/router-contract`: `RouterEnvelope`, `ENVELOPE_PATH`, `NEED_HEADER`, `MAX_ROUNDS`,
  `MAX_FILES`, `PASSED_HEADERS`, `safeSitePath`, `ROUTER_CONTRACT_VERSION`.

## Run and test it alone

```bash
pnpm --filter @israel-tv/core test
pnpm --filter @israel-tv/core typecheck
```
Changing a contract: bump its version constant and update [../../docs/contract.md](../../docs/contract.md).

## Related

- [../../docs/architecture.md](../../docs/architecture.md)
- [../../docs/contract.md](../../docs/contract.md)
- [../../docs/configuration.md](../../docs/configuration.md)
- [../../docs/operations.md](../../docs/operations.md)
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md)
