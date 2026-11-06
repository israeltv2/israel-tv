# How Israel TV works

Israeli TV needs three kinds of work, done in three places. Each part does exactly one, and the boundaries between
them are checked in CI (`pnpm boundaries`, [.dependency-cruiser.cjs](../.dependency-cruiser.cjs)).

```
                    ┌──────────────────────────── home ─────────────────────────────┐
broadcaster sites ──┼─▶ ingest ──▶ catalog DB ──▶ render ──▶ publish ──┐             │
                    │                                    (contract     │             │
                    │                                     files)       │             │
                    │   resolver ◀── play files ───────────────────────┤             │
                    │   ├ mako-auth                                    │             │
                    │   └ geo-relay ──▶ proxy (abroad) ───────────────────────────────┼─▶ Reshet / Kan video
                    └────────▲──────────────────────────────────────────┼────────────┘
                             │                                          ▼
viewer's app ── Mako plays, relays             catalog: data Worker (files + router) ─▶ API Worker
       └──────────── rows, show pages, search, plain streams ───────────┘   (Cloudflare, or the local server)
       └──────────── video ──▶ the broadcasters' own servers, directly
```

## The parts and why each exists

| Part                         | Code                                                                 | Runs                                         | Does                                                                                                                                                                                                                     | Never                                                                 |
| ---------------------------- | -------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| **Ingest**                   | [apps/ingest](../apps/ingest)                                        | at home                                      | Reads the broadcasters' public sites slowly, gives every show and episode a permanent id and number, keeps the last good data, renders and publishes the catalog.                                                        | serves viewers                                                        |
| **Catalog**                  | [apps/catalog](../apps/catalog), [packages/addon](../packages/addon) | Cloudflare (two Workers) or the local server | Rows, show pages, search and the streams that need nothing at play time. Public and stateless: the same files for everyone.                                                                                              | knows any household; plays Mako                                       |
| **Resolver** ("home helper") | [apps/resolver](../apps/resolver)                                    | at the viewer's home                         | Only what must happen on the viewer's own network: a fresh Mako pass per play (bound to the player that uses it) and, abroad, relaying Israel-only video through a proxy — only when the direct stream is refused there. | serves catalogs; reads a broadcaster site; opens the catalog database |

The roles are which parts you run: `host` = ingest + Cloudflare catalog + resolver; `local-only` = the same with the
catalog on your network; `resolver-only` = the resolver alone, pointed at any Israel TV catalog. See
[Choose your setup](setup/README.md).

## Contracts between the parts

- **Catalog → resolver:** versioned files the catalog publishes for resolvers (`resolver-contract.json`, per-season
  play files, `ext-ids.json`): [contract.md](contract.md). The resolver refuses a version it does not understand and
  says why. A full instance's resolver reads the same files from its own publish folder; no resolver ever opens the
  catalog database.
- **Data Worker → API Worker** (Cloudflare): the public Worker's static assets are the catalog; its tiny router runs
  only for `/catalog/*`, `/stream/*` and `/status*` and hands those to the private API Worker through a service
  binding, as a versioned envelope with the client's address and the files the API asks for
  ([router-contract.ts](../packages/core/src/router-contract.ts)). The API Worker has no public address. Data and code
  are deployed — and rolled back — separately ([operations](operations.md#rolling-back-on-cloudflare)).
- **Which addon answers what:** an integration test installs both addons in a simulated app and checks, for every
  kind of title at home and abroad, that no title gets competing streams
  ([apps/ingest/test/integration.test.ts](../apps/ingest/test/integration.test.ts)). The only deliberate pair is abroad:
  the catalog's direct stream (marked "ישראל בלבד", Israel only) next to the resolver's relay of it.

## Principles

- **Ids never change.** Every show gets a permanent id the first time it is seen and every episode a permanent
  season and episode number, taken from the source, never from a list position. Apps key watch progress on them. If a
  site renumbers, the old numbers stay and `/status` says so.
- **Failures are visible.** A failed or suspiciously thin read never replaces good data; the problem shows on
  `/status`, and a row not updated for too long starts with a "⚠" item.
- **Polite reading.** One request a second for Mako and Reshet; Kan a few pages every ten minutes. Never from CI: tests
  run on recorded real responses.
- **Video never passes through the catalog.** It goes from the broadcaster to the player; only relayed Israel-only
  episodes pass through the viewer's own resolver and proxy.
- **Search** matches Hebrew titles as people type them (final letters, niqqud, quotes and geresh do not matter).
- **Shows opened from other catalogs** (e.g. Cinemeta) get streams when the show was matched to TMDB/IMDb, for
  regular numbered seasons.

## Packages

Shared building blocks, each with its own README: [core](../packages/core) (config, ids, contracts),
[addon](../packages/addon) (the addon app the catalog serves), [render](../packages/render) (the site files),
[store](../packages/store) (the catalog database), [events](../packages/events) (usage and diagnostics events),
[net](../packages/net) (polite fetching, proxies), [runtime](../packages/runtime) (config loading, logging, serving),
[mako](../packages/mako), [reshet](../packages/reshet), [kan](../packages/kan) (one per source).

The measurements and decisions behind all of this: [decisions.md](decisions.md).
