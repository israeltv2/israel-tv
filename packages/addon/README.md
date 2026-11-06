# @israel-tv/addon — the public Stremio addon as a Hono app over the rendered site files

`addon` answers the Stremio protocol requests (manifest, catalog rows with search and paging, meta, streams)
by reading the files `render` produced. The same app runs in the Cloudflare API Worker and in the local
publisher's Node server, so both publishers behave identically; it is a package because two apps share it.

## Responsibility

- Routes: `/manifest.json`, `/catalog/:type/*` (search via `search.json`, `skip=N` mapped to `skip-N` files),
  `/meta/:type/:file`, `/stream/:type/:file`, `/status`, `/status.json`, `/registry.json`, `/freshness.json`,
  `/resolver-contract.json`, `/ext-ids.json`, `/play/:series/:file`.
- Streams for our own ids, live channels, and `tt…` / `tmdb:…` ids through `ext-ids.json` (numbered seasons only).
- Staleness: a row shows a stale-catalog item when `freshness.json` says a source has not been read for too long.
- Replacing the origin placeholder in JSON with the request's origin; cache headers per kind of file.

## Must not

- Use Node built-ins or Node-only packages: it runs inside a Cloudflare Worker (`workers-no-node`); its only
  dependencies are `@israel-tv/core` and `hono`.
- Read files itself: it gets them only through the `SiteReader` it is given.
- Write anything, keep viewer data, or import an app.

## Inputs and outputs

- `createAddonApp(reader, opts?)` — the Hono app; `opts.cacheMs` sets how long lookups stay in memory (default
  60 s).
- `SiteReader` — `{ read(path): Promise<string | undefined> }`, a site path in, file text out.
- `AddonOptions` — the options type.

## Run and test it alone

```bash
pnpm --filter @israel-tv/addon test
pnpm --filter @israel-tv/addon typecheck
```
To see it serve real files, render them and run the local server: `pnpm israel-tv serve`.

## Related

- [../../docs/architecture.md](../../docs/architecture.md)
- [../../docs/contract.md](../../docs/contract.md)
- [../../docs/configuration.md](../../docs/configuration.md)
- [../../docs/operations.md](../../docs/operations.md)
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md)
