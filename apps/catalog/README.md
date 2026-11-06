# @israel-tv/catalog — the public addon on Cloudflare: a data Worker and a private API Worker

`catalog` holds the two Cloudflare Workers used by the Cloudflare publisher. The public data Worker serves the
rendered catalog as static assets and runs a tiny router only for dynamic paths (rows, search, streams, status);
the router hands those to a private API Worker through a service binding. It is its own app because it runs on
Cloudflare, not Node, and must stay small and stable.

## Responsibility

- `src/router.ts`: the data Worker script. Wraps each dynamic request in an envelope, forwards it to the API, and
  answers the API's "need these files" requests from the static assets (at most `MAX_ROUNDS` rounds).
- `src/api.ts`: the API Worker. Runs the shared addon app (`@israel-tv/addon`) over the files the router sends,
  keeps them for a minute, refuses a router of another contract version, writes one Workers Logs line per request
  and one Analytics Engine data point per stream request (salted daily client hash, never the address).
- `src/limit.ts`: per-client limits on streams (120/min) and search (60/min), with Cloudflare's rate-limiting
  binding or an in-memory fallback.
- `wrangler.jsonc` and `wrangler.api.jsonc`: base configs; `israel-tv publish` / `deploy-api` fill in the name,
  assets folder and bindings from `israel-tv.config.json`.

## Must not

- Use Node built-ins (`node:` modules) or Node-only packages: no `store`, `events`, `runtime`, `net`, `kan`,
  `mako`, `reshet` or `render` (`workers-no-node`, `workers-only-worker-safe-packages`).
- Import anything in `src/router.ts` except `packages/core/src/router-contract.ts`.
- Import another app (`ingest`, `resolver`); be imported by a package.
- Give the API Worker a public URL (`workers_dev: false`); deploy the API from a catalog publish (code releases
  only, via `deploy-api`).
- Keep or log a client's address.

## Inputs and outputs

- Public routes (served by the shared addon app): `/manifest.json`, `/catalog/...`, `/meta/...`,
  `/stream/...`, `/status`, `/status.json`, `/registry.json`, `/freshness.json`, `resolver-contract.json`,
  `ext-ids.json`, `/play/...`. Plain files are answered by the assets without running code.
- Router ↔ API: `POST /__israel-tv/router` with a `RouterEnvelope`; 409 + `x-israel-tv-need` asks for files.
  See [../../packages/core/src/router-contract.ts](../../packages/core/src/router-contract.ts).
- Catalog ↔ resolver files it serves: [../../docs/contract.md](../../docs/contract.md).
- API bindings: `CLIENT_SALT` (secret), `USAGE` (Analytics Engine), `RATE_STREAM`, `RATE_SEARCH`.

## Run and test it alone

```bash
pnpm --filter @israel-tv/catalog test        # router/API split and limits, no network
pnpm --filter @israel-tv/catalog typecheck
pnpm israel-tv serve                          # preview the rendered files locally (Node, same addon app)
pnpm israel-tv deploy-api                     # deploy the API Worker (after a code update)
pnpm israel-tv publish                        # render and deploy the data Worker
pnpm israel-tv versions data|api              # recent versions; `rollback data|api [id]` to roll back
```
Deploys need the Cloudflare account id and API token in `.env` (names in `publisher.accountIdEnv` /
`publisher.apiTokenEnv`); the owner runs them.

## Related

- [../../docs/architecture.md](../../docs/architecture.md)
- [../../docs/contract.md](../../docs/contract.md)
- [../../docs/configuration.md](../../docs/configuration.md)
- [../../docs/operations.md](../../docs/operations.md)
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md)
