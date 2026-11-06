# @israel-tv/admin-contract — the admin API's answers

Zod schemas for every answer of the owner's admin API (`/api/v1/*` on the admin port), version 1. The daemon's answers
are checked against them in tests (`apps/ingest/test/admin-api.test.ts`); the dashboard uses the route table and the
types.

## Responsibility

- One schema per endpoint (`SessionSchema`, `HealthSchema`, `OverviewSchema`, `SourcesSchema`, `PlaysSchema`,
  `FailuresSchema`, `TraceSchema`, `LiveSchema`, `DeploysSchema`, `SystemSchema`, `ActionSchema`), their types, and
  `Responses` (route name → answer type).
- `@israel-tv/admin-contract/routes` (no zod, what the browser bundles): the route table (`routes`, `routePath`),
  `ADMIN_API` (`/api/v1`) and `CSRF_HEADER` (`x-israel-tv-csrf`).

## Must not

- Import anything but zod (and `routes.ts` not even that): both the daemon and the browser page depend on it.
- Change an answer an older dashboard could misread within v1: such a change is a new path prefix.

## Run and test it alone

`pnpm --filter @israel-tv/admin-contract test`

## Related

[apps/dashboard](../../apps/dashboard) · [apps/ingest](../../apps/ingest)
