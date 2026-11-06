# Israel TV

Israeli TV for Stremio-compatible apps (Stremio, Nuvio, …): VOD from **Keshet 12 (Mako)**, **Reshet 13**
and **Kan** (Kan 11, Kan Educational), plus **16 live channels**. Catalog rows per channel in Hebrew, newest
episode first, Hebrew search, and stable ids so your watch progress never moves.

You run it yourself. It reads the broadcasters' public websites from your machine, slowly, and serves the
result as a Stremio addon — on your home network, or publicly through Cloudflare's free plan.

## What do you need?

| You are…                                          | You need                                                        | You get                                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **In Israel, watching at home**                   | Node 24.11+ and `pnpm start`                                    | Everything. Addon and resolver on your network.                                                           |
| **Outside Israel**                                | The above, plus an HTTP(S) or SOCKS5 proxy with an Israeli exit | Reshet and Kan play through the proxy (via the resolver). Mako and most live channels need nothing extra. |
| **Wanting it reachable from anywhere, or shared** | The above, plus a free Cloudflare account                       | The catalog on `https://<name>.<you>.workers.dev`. See [what friends can play](#sharing-with-friends).    |
| **Wanting Kan VOD**                               | Google Chrome (or Chromium) on the machine that runs it         | Kan 11 and Kan Educational episodes. The first fill takes days (see below).                               |

What each optional piece costs you if you leave it out:

- **No proxy, outside Israel:** Reshet VOD, Kan VOD and (at times) Kan live do not play — they are
  geo-blocked outside Israel. Mako, i24, Knesset, ynet, 13 and 14 live and the rest still work. The proxy is
  only for people outside Israel.
- **No Cloudflare:** the addon is reachable only on your home network (or wherever you expose it).
- **No resolver:** Mako episodes and the Keshet 12 / 24 live channels do not play, and nothing is relayed
  through the proxy. The resolver must run on the viewer's network: Mako's playback token is bound to the
  player that first opens it.
- **No browser:** no Kan VOD (Kan live channels still work).

## Quick start (in Israel, home network)

```bash
git clone https://github.com/israeltv2/israel-tv.git && cd israel-tv
corepack enable          # gives you the pnpm version this repo pins
pnpm install
pnpm start
```

No `corepack`? (Some Node installs, e.g. through Volta, leave it out.) Use `npm i -g pnpm@12.15.0`
instead. Node must be 24.11 or newer (`node -v`). If `pnpm install` mentions "awaiting approval", ignore it:
nothing needs approving.

`pnpm start` prints the addresses to use, for example:

```
addon — install this in your app: http://192.168.1.20:7700/manifest.json
resolver — install this too, at home: http://192.168.1.20:7701/manifest.json
admin (local network only): http://192.168.1.20:7702/status
```

Add **both** manifest URLs in your app (Stremio: Addons → paste URL; Nuvio: Settings → Addons → Add). The
first gives catalogs, metadata and the streams that need no token; the second plays Mako and relays
geo-blocked video. (If the log shows only `127.0.0.1`, find the machine's address with
`ipconfig getifaddr en0` on macOS or `hostname -I` on Linux.)

The first start reads Mako and Reshet right away (about 30 minutes; one request per second, so the sites
are not hammered), then every night, and for shows that are airing every hour (every 15 minutes in the
evening). It also starts the Kan crawl, which opens Chrome in an off-screen window every ten minutes; if you
don't want that, set `"browser": { "type": "none" }` (see [Kan VOD](#kan-vod)). To try it out without the
first half-hour read, use `pnpm start --no-initial-run`. Stop it with Ctrl-C.

No config file is needed for this. To change anything, copy
[`israel-tv.config.example.json`](israel-tv.config.example.json) to `israel-tv.config.json` and edit it;
every option is described in [docs/configuration.md](docs/configuration.md). Secrets go in `.env` next to
it (start from [`.env.example`](.env.example)).

## Outside Israel: add a proxy

`israel-tv.config.json`:

```json
{
  "geo": {
    "type": "http-proxy",
    "urls": ["http://proxy.example.net:3128"],
    "usernameEnv": "GEO_PROXY_USERNAME",
    "passwordEnv": "GEO_PROXY_PASSWORD"
  }
}
```

`.env` (next to the config; never put credentials in the config file):

```
GEO_PROXY_USERNAME=your-proxy-user
GEO_PROXY_PASSWORD=your-proxy-password
```

Use the scheme your provider gives: most proxies on ports 3128 or 8080 are `http://`; `https://` is for
proxies that speak TLS. Then `pnpm israel-tv check-proxy` should say `exits in IL ✓`; if not, it says why
(wrong login, unknown host, wrong scheme…). Several URLs can be listed; the next one is tried when one fails.

Any HTTP(S) or SOCKS5 proxy with an Israeli exit works: a proxy service, or the proxy endpoints some VPN
providers offer (NordVPN's take its "service credentials", for example). Some providers lock an account for
a while after many connections in a short time; Israel TV keeps its own use slow for that reason.

What the proxy is used for:

- **By the resolver:** when a Reshet or Kan episode (or Kan live) is refused from your network, the resolver
  adds a stream named "דרך ישראל · via Israel" that fetches it through the proxy. It checks the direct stream
  once per show every 6 hours; where the direct stream plays (in Israel), no relayed stream is offered and the
  video goes straight from the broadcaster's CDN. Keep the resolver enabled and installed in your app, or the
  proxy does nothing for playback.
- **By the Kan crawl:** Kan's web pages, if Kan VOD is on.

Everything else (reading Mako and Reshet, Mako playback, most live channels) goes out directly. If the proxy
fails, that stream answers 502, the log says why, and the admin `/status` shows it under `geo`.

## Reachable from anywhere: Cloudflare

1. Create a free Cloudflare account and open **Workers & Pages**. Choose your `<subdomain>.workers.dev`
   subdomain when asked (publishing fails until one exists; it can be changed later under _Account
   settings_). The **Account ID** is in the right-hand column of the same page. The free plan allows
   100,000 Worker requests a day; catalogs and metadata are static files and do not count.
2. Create an API token (_My Profile → API Tokens → Create Token_) from the **Edit Cloudflare Workers**
   template, limited to your account. Put the token and the account id in `.env` as
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. In `israel-tv.config.json`: `"publisher": { "type": "cloudflare", "workerName": "israel-tv" }`.

After each run the changed files are uploaded (`wrangler deploy`; static files are free and unlimited, the
Worker only answers search, streams, paging and `/status`). `pnpm israel-tv publish` does it by hand and
prints the URL to install: `https://israel-tv.<subdomain>.workers.dev/manifest.json` (a brand-new
workers.dev name can take a minute to resolve). To preview what it serves: `pnpm israel-tv serve` (or `serve --port N`; it renders the current data first; then open
`http://127.0.0.1:7700/manifest.json`).

A failed upload is retried after the next run and shows on `/status` with Cloudflare's reason.

| Public (anyone with the URL)                                                                      | Your home network only | This machine / LAN admin                 |
| ------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------- |
| The addon: catalogs, metadata, search, token-free streams, `/status`, `/registry.json` (show ids) | The resolver (`:7701`) | Admin (`:7702`: status details, refresh) |

### Sharing with friends

What friends who install your public addon get:

- Catalogs, metadata and search for everything.
- Live channels that need no token: Kan 11, Kan Educational, Makan 33, Reshet 13, 14, i24 (4 languages),
  Knesset, ynet, Calcala 10. Kan's channels can be geo-blocked outside Israel.
- Reshet and Kan episodes: only for friends inside Israel.
- **Not** Mako episodes, or the Keshet 12, 24, Eretz Nehederet and Savri Maranan live channels: those need
  a resolver, and the resolver needs the database of the instance that collected the data. Don't expose your
  resolver to the internet (it has no login and would relay through your proxy). Friends who want Mako run
  their own instance.

So a public instance with only Mako enabled gives friends the live channels and a Keshet 12 row they cannot
play; enable Reshet (and Kan) if you want them to have episodes to watch.

## Kan VOD

Kan's site lets a browser see one page per session before it asks for a human check, and each episode's
video is only on that episode's own page. So Kan is read slowly on purpose: a few pages every ten minutes,
each in a fresh browser session, pausing for 45 minutes whenever the site pushes back. The first fill of
Kan 11 and Kan Educational takes a few days; after that, new episodes appear within hours. `/status` shows
how many pages are still waiting.

It needs Google Chrome (or set `browser.executablePath` to a Chromium), and a desktop session: the window is
real but off-screen, because Kan's check passes far more often than headless. On a server without a
display, run it under `xvfb-run`, or set `"browser": { "type": "none" }` and Kan VOD stays off.

## Running it as a service

Example service files are in [`deploy/`](deploy): a launchd agent (macOS), a systemd unit (Linux, with the
setup commands in its header) and a Docker Compose file (Kan off; instructions at its top). Data (the
SQLite database and the rendered files) lives in `./data` by default.

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
- **Search** matches Hebrew titles as people type them (final letters, niqqud, quotes and geresh do not
  matter). Titles are as the broadcasters publish them, so English or transliterated searches mostly find
  nothing.
- **Shows opened from other catalogs** (e.g. Cinemeta) also get streams when the show was matched to TMDB/
  IMDb (optional, needs a free TMDB API key), for regular numbered seasons.

More: [docs/configuration.md](docs/configuration.md), [docs/operations.md](docs/operations.md),
[docs/decisions.md](docs/decisions.md) (measurements behind the design),
[docs/tv-checklist.md](docs/tv-checklist.md).

## Privacy

Israel TV keeps a record of how it is used so problems can be found and fixed: which shows and episodes were
asked for and played, what failed and why, and how many different devices used it each day. It never stores
an IP address: a device is counted by a salted hash of its address that changes every day, so it cannot be
turned back into an address or followed from one day to the next. Records are kept 30 days, in your own
database (the public addon's request records pass through your Cloudflare account's Workers Logs, kept there a
few days). You can see it all on the admin page at `/usage`, and turn the public addon's request records off
with `"requestLogs": false` (see [configuration](docs/configuration.md#publisher--where-the-addon-is-served)).
If you share your addon with friends, tell them this.

## Development

```bash
pnpm install
pnpm check            # typecheck, lint (Biome), tests (Vitest)
pnpm israel-tv help   # the command line
```

Tests run on recorded real responses (`packages/*/test/fixtures`); nothing in the test suite or CI talks to
the broadcasters. `spikes/` holds the measurement scripts behind [docs/decisions.md](docs/decisions.md);
`.paradev/` and `CLAUDE.md` are optional setup for contributors who use those tools. None of them are
needed to run Israel TV.

## License

MIT. This project only reads public web pages and points your player at the broadcasters' own streams; it
does not host or re-broadcast any video. Respect the broadcasters' terms where you live.
