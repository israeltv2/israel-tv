# @israel-tv/ingest — the full instance: reads the sources, keeps the catalog, publishes it

`ingest` is the `israel-tv` command line and the long-running daemon of a full instance (role `host` or
`local-only`). It reads Mako, Reshet, Kan and the live channels on a schedule, assigns stable ids and numbers in
the home database, renders the addon files and hands them to the configured publisher (local or Cloudflare).
It is its own app because it is the only part that scrapes, writes the catalog database and publishes.

## Responsibility

- Scheduled runs (full, airing, single show, Kan crawl slices, daily housekeeping), one job at a time: the
  single writer of the catalog database.
- A failed or thin read never replaces the last good data; it is recorded and shown on `/status`.
- Rendering the site from the store and publishing it (local folder, or `wrangler` deploys of the two Workers).
- The LAN admin endpoints and usage dashboard; usage events in `events.sqlite`; nightly backups; TMDB matching;
  the daily playback canary; reading the public addon's daily usage from Cloudflare.
- Starting the local addon server and the resolver it ships with (`start`).

## Must not

- Be imported by anything: packages never import apps, and `catalog`/`resolver` never import `ingest`.
- Reach into another workspace's files by path; use packages by name, through their exports.
- Print or write secrets (they are read from `.env` at run time; logs scrub them).
- Hide a failure: it is labelled on `/status` and in the catalog row, never silently filtered.

## Inputs and outputs

- Reads `israel-tv.config.json` and `.env` from the config folder (`israel-tv paths` shows it;
  `ISRAEL_TV_HOME` or `ISRAEL_TV_CONFIG` pick another), and `branding.dir`.
- Writes `store.path` (catalog database), `events.path` (`events.sqlite`), `publisher.dir` (rendered site, which
  includes the contract files of [../../docs/contract.md](../../docs/contract.md)), `backup.dir`, and `log.file`
  when set.
- Ports (defaults): local addon `publisher.port` 7700, resolver `resolver.port` 7701, admin `admin.port` 7702,
  remote resolver `resolver.remote.port` 7703 (only when enabled).
- Admin (local network + token): `GET /status`, `/usage`, `/usage.json`, `/events.json`; `POST /refresh/:id`,
  `/run/full`, `/run/airing`, `/run/daily`, `/run/canary`.
- Cloudflare publisher: deploys `apps/catalog` (router + API Workers, see
  [../../packages/core/src/router-contract.ts](../../packages/core/src/router-contract.ts)).

## Run and test it alone

```bash
pnpm --filter @israel-tv/ingest test        # unit and integration tests, no network
pnpm --filter @israel-tv/ingest typecheck
pnpm israel-tv help                          # = node apps/ingest/src/cli.ts help
pnpm start                                   # = israel-tv start (schedules, admin, addon server, resolver)
pnpm israel-tv full --source mako --limit 5  # a limited test run (contacts the sites)
pnpm israel-tv serve --port 7700             # serve the rendered files from the database
pnpm logs --errors --since 2h                # = israel-tv events
pnpm usage                                   # = israel-tv usage
```
Other commands: `airing`, `show`, `resolver`, `publish`, `deploy-api`, `deploy`, `versions`, `rollback`, `kan`,
`check-proxy`, `match`, `status`, `paths`, `urls`, `admin-url`, `restore`, `remote-url` (see `help`).

## Related

- [../../docs/architecture.md](../../docs/architecture.md)
- [../../docs/contract.md](../../docs/contract.md)
- [../../docs/configuration.md](../../docs/configuration.md)
- [../../docs/operations.md](../../docs/operations.md)
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md)
