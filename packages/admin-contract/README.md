# @israel-tv/admin-contract — the admin API's answers

Zod schemas for every answer of the owner's admin API (`/api/v1/*` on the admin port), version 1. The daemon's answers
are checked against them in tests (`apps/ingest/test/admin-api.test.ts`); the dashboard uses the types.

## Responsibility

- One schema per endpoint (`SessionSchema`, `OverviewSchema`, `SourcesSchema`, `PlaysSchema`, `FailuresSchema`,
  `TraceSchema`, `LiveSchema`, `DeploysSchema`, `SystemSchema`, `ActionSchema`) and their types.
- `ADMIN_API` (`/api/v1`) and `CSRF_HEADER` (`x-israel-tv-csrf`).

## Must not

- Import anything but zod: both the daemon and the browser page depend on it.
- Change an answer an older dashboard could misread within v1: such a change is a new path prefix.

## Run and test it alone

`pnpm --filter @israel-tv/admin-contract test`

## Related

[apps/dashboard](../../apps/dashboard) · [apps/ingest](../../apps/ingest)
