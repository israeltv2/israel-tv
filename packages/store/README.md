# @israel-tv/store — the home catalog database: id registry, numbering and last good data

`store` is the SQLite database (`node:sqlite` with Drizzle) behind a full instance. It allocates series ids
once and never reuses them, keeps every season and episode number ever given out, and holds the last good
data of each show, the run history and warnings. It is the only memory of which number means which episode,
so it lives in its own package with its own migrations and a backup and restore path.

## Responsibility

- Series ids per source key (`seriesIdFor`), counters that only go up, and stored numbering (`assignments`).
- Saving a good read atomically (`saveShow`): new numbers are added, stored ones never change.
- Show state: listed / delisted, last checked, last failure, airing shows, external (TMDB/IMDb) ids.
- Runs (`startRun`, `finishRun`, `lastGoodRun`, `closeStaleRuns`) and numbering warnings, pruned after 60 days.
- The id registry for `registry.json` (`registry`) and rebuilding it into an empty database (`restoreRegistry`).
- Consistent copies for the nightly backup (`backupTo`).

## Must not

- Have more than one writer: the ingest daemon is the single writer.
- Be opened by the resolver (`resolver-not-ingest-or-catalog-db`): the resolver plays from published files.
- Be used by the Workers (`workers-only-worker-safe-packages`): it needs `node:sqlite`.
- Hold usage events (they belong to `@israel-tv/events`), secrets, or anything about viewers.
- Import an app.

## Inputs and outputs

- `Store.open(path)` — open or create, applying migrations from `drizzle/`.
- Registry and numbering: `findSeriesId`, `seriesIdFor`, `assignments`, `episodeKey`, `registry`,
  `restoreRegistry`.
- Shows: `saveShow`, `getShow`, `listShows`, `countShows`, `airingShows`, `syncListed`, `markShowChecked`,
  `markShowFailed`, `showStamp`.
- External ids: `setExternalIds`, `showsToMatch`, `seriesWithExternalIds`, `externalSeries`.
- Runs and warnings: `startRun`, `finishRun`, `recentRuns`, `lastRun`, `firstRun`, `lastGoodRun`,
  `closeStaleRuns`, `addWarnings`, `recentWarnings`, `prune`; `onRunFinished` callback.
- Other: `getState`, `setState`, `backupTo`, `close`; types `ShowRow`, `RunRow`, `RunKind`, `RunStatus`, `WarningRow`.

## Run and test it alone

```bash
pnpm --filter @israel-tv/store test
pnpm --filter @israel-tv/store typecheck
pnpm --filter @israel-tv/store db:generate   # after changing src/schema.ts: writes a new migration
```
Restoring ids into an empty database: `pnpm israel-tv restore <registry.json file or URL>` (see
[../../docs/operations.md](../../docs/operations.md)).

## Related

- [../../docs/architecture.md](../../docs/architecture.md)
- [../../docs/contract.md](../../docs/contract.md)
- [../../docs/configuration.md](../../docs/configuration.md)
- [../../docs/operations.md](../../docs/operations.md)
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md)
