# @israel-tv/events — the usage and diagnostics database (events.sqlite)

`events` stores usage and diagnostics events (plays, stream requests, failures, runs, canary results) in their
own SQLite file, apart from the catalog database, and keeps daily rollups. Both a full instance and a
resolver-only install write it, so it is a package of its own rather than part of either app.

## Responsibility

- Append-only events, buffered and written in batches (within about 2 s, or at 200 queued).
- Nightly maintenance (`maintain`): roll up finished days, prune raw events (30 days) and rollups (365 days),
  VACUUM weekly, enforce the size cap (over it, raw events are cut to the last week).
- The secret salt for client hashes (created once, kept only here).
- Queries for the dashboard, `/events.json` and the `events` command.

## Must not

- Store an IP address: clients are salted daily hashes made by `clientHash` in `@israel-tv/core`.
- Share a file or tables with the catalog database (`@israel-tv/store`).
- Be used by the Workers (`workers-only-worker-safe-packages`): it needs `node:sqlite`.
- Import an app.

## Inputs and outputs

- `EventStore` — `open(path)` / `openReadOnly(path)`; `record`, `flush`, `events`, `daily`, `homeDay`,
  `failuresByReason`, `perDay`, `putDaily`, `maintain`, `sizeBytes`, `overCap`, `clientSalt`, `getMeta`,
  `setMeta`, `close`.
- `queryEvents(store, query)` — events by filter; `since` takes an ISO time or a span such as `2h`, `7d`.
- `EventFilter`, `EventRow`, `DailyRow` — types; `eventsSchema` — the Drizzle tables; `PLAY_KINDS`.
- Migrations: `drizzle/` (applied by `EventStore.open`).

## Run and test it alone

```bash
pnpm --filter @israel-tv/events test
pnpm --filter @israel-tv/events typecheck
pnpm --filter @israel-tv/events db:generate   # after changing src/schema.ts: writes a new migration
```

## Related

- [../../docs/architecture.md](../../docs/architecture.md)
- [../../docs/contract.md](../../docs/contract.md)
- [../../docs/configuration.md](../../docs/configuration.md)
- [../../docs/operations.md](../../docs/operations.md)
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md)
