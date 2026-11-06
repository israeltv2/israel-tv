# @israel-tv/render — renders the whole addon site from the home database contents

`render` turns shows, live channels, status and the id registry into the static files of the addon: the
manifest, catalog rows, meta, per-season stream files, search index, status page, and the contract files a
resolver reads. It is pure (data in, files out), so the same output serves the local publisher and Cloudflare,
and its output can be checked in tests without a server.

## Responsibility

- The manifest (`buildManifest`) and every site file under the paths in `sitePaths` (`@israel-tv/core`).
- Catalog rows newest first, paged; a failing source shown as a warning item at the top of its row, not hidden.
- The catalog ↔ resolver contract files: `resolver-contract.json`, `play/<series>/<season>.json`, `ext-ids.json`.
- `status.json` and its self-contained HTML page (no scripts); `freshness.json`; `registry.json`.

## Must not

- Do I/O: no files, network or database (the caller reads the store and writes the files).
- Be used by the Workers or the resolver (`workers-only-worker-safe-packages`,
  `resolver-not-ingest-or-catalog-db`): the resolver reads rendered files, never renders them.
- Change a published id or number: it renders what the store assigned.
- Import an app.

## Inputs and outputs

- `renderSite(input: RenderInput)` → `SiteFiles` — every file of the site (path → text or bytes).
- `buildManifest(input, catalogIds, externalIds?)` → `Manifest` — the addon manifest alone.
- `renderStatusHtml(status: StatusFile)` — the status page.
- `RenderInput`, `RenderShow`, `LiveChannelRender`, `SiteFiles` — types; `STATUS_ID_PREFIX`.

## Run and test it alone

```bash
pnpm --filter @israel-tv/render test         # includes the catalog side of the contract tests
pnpm --filter @israel-tv/render typecheck
```
To look at real output: `pnpm israel-tv serve` renders from the database and serves it.

## Related

- [../../docs/architecture.md](../../docs/architecture.md)
- [../../docs/contract.md](../../docs/contract.md)
- [../../docs/configuration.md](../../docs/configuration.md)
- [../../docs/operations.md](../../docs/operations.md)
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md)
