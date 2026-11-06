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
admin and usage dashboard (local network, owner only): http://192.168.1.20:7702/usage — open it once with ?token=…
```

The admin page is yours only: `pnpm israel-tv admin-url` prints its link with your token (open it once; the
browser keeps it). Add **both** manifest URLs in your app (Stremio: Addons → paste URL; Nuvio: Settings → Addons → Add). The
first gives catalogs, metadata and the streams that need no token; the second plays Mako and relays
geo-blocked video. (If the log shows only `127.0.0.1`, find the machine's address with
`ipconfig getifaddr en0` on macOS or `hostname -I` on Linux.)

**On a Mac:** reserve the Mac's address in your router (or use `<computer-name>.local` in the addon links), so
the links in your app keep working; set it not to sleep (_System Settings → Energy → Prevent automatic sleeping_),
or playback and the night's reads stop; and choose _Allow_ when macOS asks whether `node` may accept incoming
connections.

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
   100,000 Worker requests a day; see below for what counts.
2. Create an API token (_My Profile → API Tokens → Create Token_) from the **Edit Cloudflare Workers**
   template, limited to your account. Put the token and the account id in `.env` as
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Optional, for the public addon's usage counts: add the
   permission **Account → Account Analytics → Read** to the token, and switch on **Workers Analytics Engine**
   once (dashboard → _Workers & Pages_ → _Analytics Engine_ → enable; free). Without them the counts come from
   Workers Logs, which the template's permissions already read, and `/status` says so.
3. In `israel-tv.config.json`: `"publisher": { "type": "cloudflare", "workerName": "israel-tv" }`.

After each run the changed files are uploaded (`wrangler deploy`). Metadata, images and the manifest are static
files (free and unlimited); the Worker answers catalog rows (one request per row an app loads), search, streams
and `/status` — those count toward the 100,000 a day, which is plenty for a household and friends. Past it,
Cloudflare answers errors until midnight UTC. Search and stream requests are also limited per client: 60
searches and 120 stream requests a minute (devices behind one home address share it); over it, the addon
answers HTTP 429 for a minute. `pnpm israel-tv publish` does it by hand and
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
- The per-client limits above (a friend's whole household shares them).
- **Not** Mako episodes, or the Keshet 12, 24, Eretz Nehederet and Savri Maranan live channels: those need
  a resolver, and the resolver needs the database of the instance that collected the data. Don't expose your
  resolver to the internet (it has no login and would relay through your proxy). Friends who want Mako run
  their own instance.

So a public instance with only Mako enabled gives friends the live channels and a Keshet 12 row they cannot
play; enable Reshet (and Kan) if you want them to have episodes to watch.

### Mako away from home

The home resolver answers only on your network, and Mako plays only through it. To watch Mako elsewhere (on a
phone, at a friend's), you can open a narrow second door to it through a **Cloudflare Tunnel** to the machine
(it needs a domain of yours on Cloudflare; a workers.dev name does not work for tunnels). Other tunnels work but
do not pass each viewer's address, so all viewers then share one rate limit.

1. Make a token: `openssl rand -hex 32`, and put it in `.env` as `ISRAEL_TV_REMOTE_TOKEN=…` (letters and digits
   only: it is part of a URL).
2. In `israel-tv.config.json`:
   `"resolver": { "remote": { "enabled": true, "publicUrl": "https://tv-remote.example.net" } }` — the tunnel's
   `https://` address, without the token.
3. Route that hostname to `http://127.0.0.1:7703` in the tunnel (and nothing else: never the admin port). With
   `cloudflared`: add `- hostname: tv-remote.example.net` / `service: http://127.0.0.1:7703` to the ingress
   list in `~/.cloudflared/config.yml` (before the catch-all), then `cloudflared tunnel route dns <tunnel>
   tv-remote.example.net` and restart cloudflared.
4. Restart Israel TV, then install the link `pnpm israel-tv remote-url` prints (it contains the token; keep it
   private).

Only Mako's routes are there — its manifest, stream requests and the small playlist per play; video comes from
Mako's CDN to the player, never through your home or the tunnel. Every other path, and any request without the
token, gets an empty 404, and each client is rate-limited. Change the token to revoke all installs. Plays through
this link are counted on your usage page under "This home", like plays at home.

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

Three parts, each with one job:

```
                    ┌────────────────────────── home ──────────────────────────┐
broadcaster sites ──┼─▶ ingest ──▶ catalog DB ──▶ render ──┐                    │
                    │      │                               │ publish            │
                    │      └──▶ events DB ◀── resolver     │                    │
                    │             (usage)     ├ mako-auth  │                    │
                    │                         └ geo-relay ─┼──▶ geo proxy ──────┼─▶ Reshet / Kan CDN
                    └──────────────────────────────▲───────┼────────────────────┘
                                                   │       ▼
viewer's app ──── streams that need home work ─────┘    catalog (public Worker or local server)
       └───────── catalogs, metadata, search, plain streams ──────────┘
       └───────── video ──▶ broadcasters' CDNs (Mako, Reshet, Kan, live) directly
```

| Part         | Runs                                    | Does                                                                                                                                                                                                                                                                                     | Never                                 |
| ------------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **ingest**   | at home (one process with the resolver) | Reads the broadcasters' sites slowly, owns the catalog database (ids, numbering, last good data), renders and publishes the catalog.                                                                                                                                                     | serves viewers                        |
| **catalog**  | Cloudflare Worker, or the local server  | Show rows, show pages, search, and the stream links that need nothing at play time.                                                                                                                                                                                                      | knows about any household or resolver |
| **resolver** | at home, its own addon                  | Play-time work only, in two modules: **mako-auth** (a fresh Mako ticket and the ~1 KB playlist per play; video still comes from Mako's CDN) and **geo-relay** (geo-blocked titles through the configured proxy, only when refused from this network — the only part that carries video). | serves catalogs                       |

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

Israel TV keeps a record of how it is used so problems can be found and fixed: what the home resolver was
asked for and played, what failed and why, and how many different devices used it each day. It never stores
an IP address: a device is counted by a salted hash of its address that changes every day, so it cannot be
turned back into an address or followed from one day to the next. These records stay in your own database
(`data/events.sqlite`): 30 days in detail, a year as daily totals. The public addon only counts stream requests
(with the same kind of hash), through your own Cloudflare account (Workers Logs keeps its lines a few days;
Analytics Engine keeps the counts); showing a show's page is not counted, and a catalog row only as a request
count. You can see it all on the admin page
at `/usage` (yours only: it needs the admin token). If you share your addon with friends, tell them this.

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
