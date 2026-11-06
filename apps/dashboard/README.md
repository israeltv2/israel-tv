# @israel-tv/dashboard — the owner's dashboard

The page the owner opens on the admin port (`/dash/`): is everything OK, plays and viewers, each source's health and
playback canary, failures with a trace of any single play, what is playing now, the catalog and deploys, and the
machine. It is its own app: the daemon serves a typed JSON API and the built page, and the page only reads that API.

## Responsibility

- `src/`: the page — React 19, TanStack Router (sections in the address's hash, e.g. `#/trace/<playId>`) and
  TanStack Query, Tailwind CSS v4 with the design tokens in `src/styles.css` (light and dark), charts with Recharts
  (loaded with the sections that draw them), icons from lucide. Hebrew titles go through `Title` (`<bdi dir="auto">`).
  Imports inside the app use the package's subpath imports (`#lib/api.ts`).
- `server/serve.ts`: what the daemon calls to serve the build (`dist/`): the page with a fresh nonce, hashed assets
  cached for good, nothing outside `dist`, and the content security policy.
- `test/`: the size budget (on the build), the file server, and `fixtures.ts`: a typed week of answers for
  screenshots, checked against the contract's schemas.

## Must not

- Import the daemon or any server package: the page knows the admin API only through
  [packages/admin-contract](../../packages/admin-contract) — its route table at run time, its types for the answers
  (no schema code in the bundle). Checked by `pnpm boundaries`.
- Run anything destructive. The only actions are "refresh a show" and "run the canary" (POST with the CSRF value);
  rollbacks are shown as commands, never run from the page.
- Load anything from other origins except show posters, or use inline script (the CSP forbids both).
- Grow past its size budget (gzip: 140 KB of JavaScript for the first load, 300 KB in all, 12 KB of CSS;
  `test/budget.test.ts`).

## Inputs and outputs

- Reads `GET /api/v1/{session,health,overview,sources,plays,failures,trace/:playId,live,deploys,system}` and the live
  stream `GET /api/v1/live/stream` (Server-Sent Events, only while its section is open and the tab visible).
- Sends `POST /api/v1/actions/refresh/:id` and `POST /api/v1/actions/canary` with the `x-israel-tv-csrf` header.

## Run and test it alone

```bash
pnpm build                                      # dist/ (the daemon serves it; releases and the image include it)
pnpm --filter @israel-tv/dashboard dev          # hot reload; /api goes to a running daemon (DASHBOARD_API=…)
pnpm --filter @israel-tv/dashboard test         # budget, file server, fixtures against the contract
pnpm shots:dashboard                            # every section, phone and desktop, light and dark, from fixtures
pnpm e2e:dashboard                              # a real sandbox instance in Chrome
```

`shots:dashboard` writes `dashboard-screens/design/*.png` (CI keeps them): look at them when you change the page. On
a running instance: `pnpm israel-tv admin-url` prints the link (open it once; the browser keeps the sign-in 30 days).

To add a section: a route in `src/router.tsx`, a component in `src/routes/`, a menu entry in
`src/components/shell.tsx`; new data goes into the contract first (`packages/admin-contract`), then
`apps/ingest/src/admin-api.ts`, then `test/fixtures.ts`.

## Related

[docs/operations.md](../../docs/operations.md#usage-dashboard-and-events) · [packages/admin-contract](../../packages/admin-contract)
· [docs/decisions.md](../../docs/decisions.md)
