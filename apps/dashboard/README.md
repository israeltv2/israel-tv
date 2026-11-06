# @israel-tv/dashboard — the owner's dashboard

The page the owner opens on the admin port (`/dash/`): plays and viewers, sources' health, failures with a trace of
any single play, what is playing now, the catalog and deploys, and the machine. It is its own app so the daemon only
serves a typed JSON API, and the page only reads it.

## Responsibility

- `web/`: the page — Preact components written with htm (no JSX, no build step), uPlot charts, plain CSS with light
  and dark themes and logical properties (Hebrew titles in `<bdi dir="auto">`).
- `src/server.ts`: what the daemon calls to serve it — the page with its import map, the stylesheet, the page's
  TypeScript with the types stripped by Node (`module.stripTypeScriptTypes`, cached), and the vendor modules straight
  from the installed packages. `IMPORT_MAP_HASH` goes into the content security policy.

## Must not

- Import the daemon or any server package: the page knows the admin API only through
  [packages/admin-contract](../../packages/admin-contract) (types only), checked by `pnpm boundaries`.
- Run anything destructive. The only actions are "refresh a show" and "run the canary" (POST with the CSRF value);
  rollbacks are shown as commands, never run from the page.
- Grow past its size budget (45 KB of JS, gzip; `test/budget.test.ts`).

## Inputs and outputs

- Reads `GET /api/v1/{session,overview,sources,plays,failures,trace/:playId,live,deploys,system}` and the live stream
  `GET /api/v1/live/stream` (Server-Sent Events, only while its section is open and the tab visible).
- Sends `POST /api/v1/actions/refresh/:id` and `POST /api/v1/actions/canary` with the `x-israel-tv-csrf` header.

## Run and test it alone

```bash
pnpm --filter @israel-tv/dashboard test        # size budget, safe paths
pnpm --filter @israel-tv/dashboard typecheck   # server and browser code (DOM types)
pnpm e2e:dashboard                             # a sandbox instance in Chrome: every section, phone/desktop, light/dark
```

On a running instance: `pnpm israel-tv admin-url` prints the link (open it once; the browser keeps the sign-in 30
days).

## Related

[docs/operations.md](../../docs/operations.md#usage-dashboard-and-events) · [packages/admin-contract](../../packages/admin-contract)
· [docs/decisions.md](../../docs/decisions.md)
