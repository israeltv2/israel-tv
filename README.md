# Israel TV

Israeli TV for Stremio-compatible apps (Stremio, Nuvio, …): VOD from **Keshet 12 (Mako)**, **Reshet 13**
and **Kan** (Kan 11, Kan Educational), plus **16 live channels**. Catalog rows per channel in Hebrew, newest
episode first, Hebrew-aware search, and stable ids so your watch progress never moves.

You run it yourself. It reads the broadcasters' public websites from your machine, slowly, and serves the
result as a Stremio addon — on your home network, or publicly through Cloudflare's free plan.

## What do you need?

| You are…                                          | You need                                                        | You get                                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **In Israel, watching at home**                   | Node 24 and `pnpm start`                                        | Everything. Addon and resolver on your network.                                                           |
| **Outside Israel**                                | The above, plus an HTTP(S) or SOCKS5 proxy with an Israeli exit | Reshet and Kan play through the proxy (via the resolver). Mako and most live channels need nothing extra. |
| **Wanting it reachable from anywhere, or shared** | The above, plus a free Cloudflare account                       | The catalog on `https://<name>.<you>.workers.dev`. Mako playback still needs the resolver at home.        |
| **Wanting Kan VOD**                               | Google Chrome (or Chromium) on the machine that runs it         | Kan 11 and Kan Educational episodes. The first fill takes days (see below).                               |

What each optional piece costs you if you leave it out:

- **No proxy, outside Israel:** Reshet episodes and most Kan episodes do not play (they are geo-blocked
  outside Israel). Mako, i24, Knesset, ynet, 13/14 live and the rest still work. The proxy is only for
  people outside Israel.
- **No Cloudflare:** the addon is reachable only on your home network (or wherever you expose it).
- **No resolver:** Mako episodes and the Keshet 12 / 24 live channels do not play. The resolver must run on
  the viewer's network: Mako's playback token is bound to the player that first opens it.
- **No browser:** no Kan VOD (Kan live channels still work).

## Quick start (in Israel, home network)

```bash
git clone <this repo> israel-tv && cd israel-tv
corepack enable          # gives you the pnpm version this repo pins
pnpm install
pnpm start
```

The first start reads Mako and Reshet right away (about 30 minutes; one request per second, so the sites
are not hammered), then every night and, for shows that are airing, every hour (every 15 minutes in the
evening). While it runs:

- Addon: `http://<this machine's IP>:7000/manifest.json`
- Resolver: `http://<this machine's IP>:7001/manifest.json`
- Status: `http://<this machine's IP>:7002/status` (local network only)

Add **both** manifest URLs in your app (Stremio: Addons → paste URL; Nuvio: Settings → Addons → Add).
The first one gives catalogs, metadata and the streams that need no token; the second plays Mako and
relays geo-blocked video.

No config file is needed for this. To change anything, copy
[`israel-tv.config.example.json`](israel-tv.config.example.json) to `israel-tv.config.json` and edit it;
every option is described in [docs/configuration.md](docs/configuration.md).

## Outside Israel: add a proxy

```json
{
  "geo": {
    "type": "http-proxy",
    "urls": ["https://proxy.example.net:89"],
    "usernameEnv": "GEO_PROXY_USERNAME",
    "passwordEnv": "GEO_PROXY_PASSWORD"
  }
}
```

Put the credentials in `.env` (see [`.env.example`](.env.example)); never in the config file. Several URLs
can be listed; the next one is tried when one fails. Any proxy with an Israeli exit works. For example,
NordVPN's "service credentials" work with its HTTPS proxies (`https://ilNN.proxy.nordvpn.com:89`); keep to
one connection at a time with such services, they lock accounts that open many sessions quickly.

The proxy carries only geo-blocked playlists and video (relayed by the resolver) and, if Kan VOD is on,
Kan's web pages. Mako, Reshet and Kan catalog reading otherwise goes out directly.

## Reachable from anywhere: Cloudflare

1. Create a free Cloudflare account and open **Workers & Pages** once, so you get a `*.workers.dev`
   subdomain.
2. Create an API token with **Account → Workers Scripts → Edit**. Put it and your account id in `.env`
   as `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. In `israel-tv.config.json`: `"publisher": { "type": "cloudflare", "workerName": "israel-tv" }`.

After each run the changed files are uploaded (`wrangler deploy`; static files are free and unlimited, the
Worker only answers search, streams and `/status`). Install
`https://israel-tv.<your-subdomain>.workers.dev/manifest.json` in your app, plus the resolver from home.

## Kan VOD

Kan's site lets a browser see one page per session before it asks for a human check, and each episode's
video is only on that episode's own page. So Kan is read slowly on purpose: a few pages every ten minutes,
each in a fresh browser session, pausing for 45 minutes whenever the site pushes back. The first fill of
Kan 11 and Kan Educational takes a few days; after that, new episodes appear within hours. `/status` shows
how many pages are still waiting.

It needs Google Chrome (or set `browser.executablePath` to a Chromium). Without a browser, set
`"browser": { "type": "none" }` and Kan VOD stays off.

## Running it as a service

Example service files are in [`deploy/`](deploy): a launchd agent (macOS), a systemd unit (Linux) and a
Docker Compose file. Data (the SQLite database and the rendered files) lives in `./data` by default.

## How it works

```
sites ──(polite reads)──▶ ingest ──▶ SQLite (ids, numbering, last good data)
                                         │
                                         ▼
                                 render Stremio JSON ──▶ local server  or  Cloudflare Worker + static files
viewer's app ──▶ resolver (home) ──▶ Mako ticket / geo relay
```

- **Ids never change.** Every show gets a permanent id the first time it is seen, and every episode a
  permanent season/episode number. Apps key watch progress on these, so they are never reused or
  renumbered. If a site renumbers, the old numbers stay and `/status` says so.
- **Failures are visible.** A failed or suspiciously thin read never replaces good data. The problem shows
  on `/status` and as a "⚠" first item in the affected catalog row.
- **Shows opened from other catalogs** (e.g. Cinemeta) also get streams when the show was matched to TMDB/
  IMDb (optional, needs a free TMDB API key), for regular numbered seasons.

More: [docs/configuration.md](docs/configuration.md), [docs/operations.md](docs/operations.md),
[docs/decisions.md](docs/decisions.md) (measurements behind the design).

## Development

```bash
pnpm install
pnpm check            # typecheck, lint (Biome), tests (Vitest)
pnpm israel-tv help   # the command line
```

Tests run on recorded real responses (`packages/*/test/fixtures`); nothing in the test suite or CI talks to
the broadcasters.

## License

MIT. This project only reads public web pages and points your player at the broadcasters' own streams; it
does not host or re-broadcast any video. Respect the broadcasters' terms where you live.
