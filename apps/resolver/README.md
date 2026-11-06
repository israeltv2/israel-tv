# @israel-tv/resolver — the private stream resolver that does play-time work on the viewer's network

The resolver is a second Stremio addon that serves no catalogs: it answers stream requests that need work at
play time. Its `mako-auth` module gets a fresh Mako ticket and the ~1 KB master playlist per play; its
`geo-relay` module relays geo-blocked Reshet/Kan video through the geo proxy, only when the direct stream is
refused from here. It is its own app so it can run anywhere, from any published Israel TV catalog, without the
catalog's database.

## Responsibility

- The home resolver app (`createResolverApp`, wired by `resolverApp`) and the narrow remote one for Mako away from
  home (`createRemoteResolverApp`, behind a secret path token, per-client limits, no relay).
- Episode details from the catalog's contract files (`catalogLookup`): the published catalog for role
  `resolver-only`, or the instance's own publish folder on a full instance.
- Play and relay sessions in memory (`PlaySessions`); usage events through a callback.
- The `israel-tv-resolver` command line for resolver-only installs; commands shared with ingest
  (`checkProxy`, `printEvents`, `remoteUrl`).

## Must not

- Open the catalog database or import `ingest`, `store`, `render`, `kan` or `reshet`
  (`resolver-not-ingest-or-catalog-db`): it plays from the published contract files only.
- Import the `catalog` app; be imported by a package.
- Carry Mako video (only the master playlist), relay anything through the remote resolver, or fetch through the
  proxy any URL it did not sign or whose host is not allowed (every redirect hop is checked).
- Keep a client's address (only a salted daily hash) or print secrets.

## Inputs and outputs

- Home resolver on `resolver.port` (default 7701): `GET /manifest.json`, `/stream/:type/:file`,
  `/play/mako/:file`, `/play/mako-live/:channel/:file`, `/relay/:sig/:file`, `/logo.png`, `/background.jpg`.
- Remote resolver on `resolver.remote.port` (default 7703, `127.0.0.1`): the same Mako routes under
  `/<token>/...`; anything else is 404.
- Reads `resolver-contract.json`, `play/<series>/<season>.json` and `ext-ids.json` as defined in
  [../../docs/contract.md](../../docs/contract.md); refuses a contract version it does not understand.
- Resolver-only: reads `israel-tv.config.json` (`"role": "resolver-only"`, `resolver.catalogUrl`) and `.env`;
  writes `events.sqlite`.

## Run and test it alone

```bash
pnpm --filter @israel-tv/resolver test       # contract and resolver tests, no network
pnpm --filter @israel-tv/resolver typecheck
pnpm resolver help                            # = node apps/resolver/src/cli.ts help
pnpm resolver start                           # home resolver (+ remote when enabled), resolver-only role
pnpm resolver check-catalog                   # is resolver.catalogUrl a catalog this resolver understands?
pnpm resolver check-proxy                     # does the geo proxy exit in Israel?
pnpm resolver events --errors --since 2h
```
Also: `paths`, `urls`, `remote-url`. On a full instance, `pnpm start` (or `israel-tv resolver`) runs it instead.
Then install `http://<your-computer's-address>:7701/manifest.json` in the player.

## Related

- [../../docs/architecture.md](../../docs/architecture.md)
- [../../docs/contract.md](../../docs/contract.md)
- [../../docs/configuration.md](../../docs/configuration.md)
- [../../docs/operations.md](../../docs/operations.md)
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md)
