# @israel-tv/net — polite HTTP client for the source sites, and the geo adapter

`net` is how Israel TV talks to the broadcasters: a fetcher that is slow and polite on purpose and fails loudly
when a site answers with a block page, and the geo adapter that sends requests which must look Israeli through
the configured HTTP or SOCKS5 proxies. The scrapers and the resolver share it, so it is a package.

## Responsibility

- One request at a time per host, a pause between requests (`scraping.delayMs`), retries with backoff, timeouts.
- Recognising block pages (Radware, captcha, Cloudflare challenge, "Access Denied") and raising `BlockedError`
  instead of returning them as data.
- Resolving the configured proxies with credentials from the environment, falling back to the next proxy when
  one fails.
- Turning network and proxy failures into plain-language messages.

## Must not

- Be used by the Workers (`workers-only-worker-safe-packages`): it uses Node modules and `undici`.
- Log or print a proxy URL with credentials (`proxyUrlWithAuth` output is never logged; `ProxyEndpoint.server`
  is the safe form).
- Know about any particular source; import an app.

## Inputs and outputs

- `createFetcher(options)` → `Fetcher` — `text(url, headers?)`, `json(url, headers?)`, `requests` count.
- `FetcherOptions` — delay, retries, timeout, proxies, `onRequest` callback.
- `BlockedError`, `HttpError` — a block page, and any other non-success status.
- `proxyEndpoints(geoConfig, env?)` → `ProxyEndpoint[]` — the configured proxies (empty for `geo.type: none`).
- `proxyUrlWithAuth(endpoint)` — a proxy URL with credentials, for clients that take one string.
- `explainNetError(err)` — a failure in plain words, with what to check.
- `createGeoFetch(proxies)` → `GeoFetch` — `fetch` through the proxies (plain `fetch` when there are none).

## Run and test it alone

```bash
pnpm --filter @israel-tv/net test
pnpm --filter @israel-tv/net typecheck
pnpm israel-tv check-proxy     # real check that each configured proxy exits in Israel (contacts the network)
```

## Related

- [../../docs/architecture.md](../../docs/architecture.md)
- [../../docs/contract.md](../../docs/contract.md)
- [../../docs/configuration.md](../../docs/configuration.md)
- [../../docs/operations.md](../../docs/operations.md)
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md)
