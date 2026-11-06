# Configuration

One file, `israel-tv.config.json`, in your config folder (`pnpm israel-tv paths` shows it). It is optional: without
it every default below applies, which is a working setup inside Israel. Secrets go in `.env` next to the config file;
the config only names the variables.

Where the config is looked for, in order: the file in `ISRAEL_TV_CONFIG`; `israel-tv.config.json` in the folder in
`ISRAEL_TV_HOME`; an `israel-tv.config.json` in the current folder; the platform's usual folder (`%LOCALAPPDATA%\israel-tv`
on Windows, `~/Library/Application Support/israel-tv` on macOS, `$XDG_CONFIG_HOME/israel-tv` or `~/.config/israel-tv`
on Linux).

**From the environment** (for ready-made containers; a config file always wins): `ISRAEL_TV_CATALOG_URL` (no config
file: a resolver-only instance playing from that catalog), `ISRAEL_TV_PROXY` (a proxy URL with an Israeli exit, used
when the config has no `geo`; the login can be in it or in `ISRAEL_TV_PROXY_USER` / `ISRAEL_TV_PROXY_PASSWORD`), and
`ISRAEL_TV_BROWSER=none` (no browser: Kan episodes off).

The file is checked at startup. A wrong or unknown option stops the program with the option's name and what
is wrong, e.g. `geo.urls: Too small: expected array to have >=1 items`.

Relative paths are relative to the config file's folder.

## `store`

| Option | Default                   |                                                                                                                                                 |
| ------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `path` | `./data/israel-tv.sqlite` | The database: permanent ids, numbering, last good data, run log. Back it up; `/registry.json` on the addon is a public copy of the id registry. |

## `role`

`host`, `local-only` or `resolver-only` — see [Choose your setup](setup/README.md). When not set, it follows
the publisher (Cloudflare: `host`; local: `local-only`). The start refuses settings the role cannot use, and says
what to change. `resolver-only` needs
`resolver.catalogUrl` (the public catalog's manifest URL) and runs only the resolver (and `resolver.remote` when
enabled): no reading of sites, no publishing, no catalog database; usage events and logs are still kept.

## `branding`

`dir` (default `./branding`): your own addon images, used instead of the bundled ones when present —
`logo.png` (the addon's logo, square, about 256 px), `resolver-logo.png` (the resolver's) and `background.jpg`
or `background.png` (1920×1080). Missing ones fall back to the bundled images in `assets/branding/`.

## `sources`

`mako`, `reshet`, `kan`, `live`: each `true` (default) or `false`.

## `hide` — taking something off without a code change

```json
"hide": { "shows": ["iltv_mako_12"], "sources": ["kan"] }
```

Hidden series ids and sources leave every catalog row, search, show page, stream and play file at the next publish
(restart the service after editing the config; it publishes on start). They are still read, so their ids and episode
numbers stay as they are if they come back. A series id is in the show's address in the app, or on `/status`. Turning
a source off in `sources` instead stops reading it too. See [removal requests](takedown.md).

## `geo` — reaching Israel-only content

Only needed **outside Israel**.

| `type`           | Meaning                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `none` (default) | Everything goes out directly. Right inside Israel.                                                                                       |
| `http-proxy`     | An `http://` or `https://` proxy with an Israeli exit.                                                                                   |
| `socks5`         | A SOCKS5 proxy with an Israeli exit. (Chrome cannot log in to SOCKS proxies, so for Kan pages use an HTTP proxy or one without a login.) |

| Option                       |          |                                                                                            |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `urls`                       | required | One or more proxy URLs, tried in order.                                                    |
| `usernameEnv`, `passwordEnv` | optional | Names of the `.env` variables with the proxy login. Leave out for a proxy without a login. |

What goes through it: the resolver's "דרך ישראל" streams, offered only when the direct stream is refused from your network (checked about every 6 hours per show). `pnpm israel-tv check-proxy` (resolver-only: `pnpm resolver check-proxy`) tests it.

## `browser` — for Kan pages

| `type`             |                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chrome` (default) | Uses installed Google Chrome; set `executablePath` for another Chrome/Chromium. `headed` (default `true`) opens an off-screen window, which passes the site's checks far more often than headless. |
| `none`             | Kan VOD off.                                                                                                                                                                                       |

## `publisher` — where the addon is served

`type` may be left out of any section (`publisher`, `browser`, `geo`): it then takes the default kind, so
`{ "publisher": { "port": 8000 } }` is the local publisher on port 8000.

`local` (default):

| Option | Default       |                       |
| ------ | ------------- | --------------------- |
| `host` | `0.0.0.0`     | Address to listen on. |
| `port` | `7700`        |                       |
| `dir`  | `./data/site` | Rendered files.       |

`cloudflare`:

| Option               | Default                 |                                                                    |
| -------------------- | ----------------------- | ------------------------------------------------------------------ |
| `workerName`         | `israel-tv`             | Served at `https://<workerName>.<your-subdomain>.workers.dev`.     |
| `accountIdEnv`       | `CLOUDFLARE_ACCOUNT_ID` | `.env` variable with the account id.                               |
| `apiTokenEnv`        | `CLOUDFLARE_API_TOKEN`  | `.env` variable with an API token allowed to edit Workers scripts. |
| `dir`                | `./data/site`           | Build folder uploaded on each publish.                             |
| `publicUrl`          | —                       | Optional, for your own reference.                                  |
| `apiWorkerName`      | `<workerName>-api`      | The private API Worker (no public address).                        |
| `minIntervalMinutes` | `30`                    | Routine changes are published at most this often, in one deploy.   |

Two Workers on your account:

- **`<workerName>` (public, the data Worker):** the catalog as static assets — manifest, rows' files, show pages,
  images — served by Cloudflare without running any code (free and not counted). A tiny router runs only for the
  dynamic paths (`/catalog/*` rows and search, `/stream/*`, `/status*`) and hands them to the API Worker through a
  service binding. Every publish is a new version of this Worker: its versions are the catalog's history.
- **`<workerName>-api` (private, the code):** rows (with the warning on a row not updated for too long), search,
  streams, `/status`, the per-client limits, one Workers Logs line per request (no addresses) and one Analytics
  Engine data point per stream request. It has no public address. It is deployed by `pnpm israel-tv deploy-api`
  (after each update), never by a publish, so code and catalog roll back separately (see operations.md).

Router requests count toward the free plan's 100,000 a day (one per row, search, stream or status request; the
call into the API Worker adds no request fee). Image URLs are written absolute at publish time (the address is
`publicUrl`, or else the one the first deploy reported; on that very first publish only, the manifest and show
pages also go through the API to get the address filled in). The home daemon reads the daily counts back with
the same API token from Analytics Engine (the token needs "Account Analytics: Read", and Analytics Engine
must be enabled on the account; without them the public addon is not counted and `/status` says why).

Publishing is batched: airing checks and Kan slices gather their changes into one deploy at most every
`minIntervalMinutes`; the end of a full run and a show refresh you ask for publish at once.

## `resolver`

| Option             | Default           |                                                                                                                              |
| ------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `enabled`          | `true`            | The second addon that plays Mako and relays geo-blocked video. Run it on the network of the device that plays.               |
| `host`, `port`     | `0.0.0.0`, `7701` |                                                                                                                              |
| `makoAuth.enabled` | `true`            | Mako playback (a fresh ticket and the ~1 KB playlist per play; video comes from Mako's CDN).                                 |
| `geoRelay.enabled` | `true`            | Geo-blocked Reshet/Kan video through the `geo` proxy, only when refused from this network. The only part that carries video. |
| `catalogUrl`       | —                 | The public catalog to play from (role `resolver-only`).                                                                      |
| `remote.*`         | off               | Mako away from home through your own tunnel (see below).                                                                     |

`remote`: `enabled` (default `false`), `host`/`port` (default `127.0.0.1`, `7703`: for a tunnel connector on the
same machine), `publicUrl` (the tunnel's address), `tokenEnv` (default `ISRAEL_TV_REMOTE_TOKEN`: the secret
path token, 32 characters or more, in `.env`), `playsPerMinute` (30) and `requestsPerMinute` (240) per client.
Serves only Mako's routes under `/<token>/…` (no relay, nothing of the admin page); everything else answers an
empty 404. `pnpm israel-tv remote-url` (resolver-only: `pnpm resolver remote-url`) prints the manifest link.

## `admin`

`host`, `port` (default `0.0.0.0`, `7702`), `tokenEnv` (default `ISRAEL_TV_ADMIN_TOKEN`). Serves `/status`
(JSON), `/usage` (the usage dashboard; JSON at `/usage.json`), `/events.json` (event queries, see
[operations](operations.md#investigating-a-failed-play)), `POST /refresh/<series-id>` (re-read one show now),
`POST /run/full`, `POST /run/airing`, `POST /run/daily`, `POST /run/canary`. Answers only requests from private network addresses that carry the admin
token (the `.env` variable named by `tokenEnv`; when it is not set, a token is generated on first start and
`israel-tv admin-url` prints the link). Everything else gets 404. Never expose it outside your network.

## `events`

`path` (default `./data/events.sqlite`): usage and diagnostics events, kept apart from the catalog database.
`maxMB` (default 200): above it, raw events are cut to the last week and `/status` warns. See
[operations](operations.md#usage-dashboard-and-events).

## `backup`

`keepDays` (default 7, `0` = off) and `dir` (default `./data/backups`): a nightly copy of the catalog database.

## `schedule`

| Option             | Default                               |                                                                                                                |
| ------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `timezone`         | `Asia/Jerusalem`                      | For all patterns below (cron syntax).                                                                          |
| `fullRun`          | `30 3 * * *`                          | Every show of every source, all seasons.                                                                       |
| `airingChecks`     | `["5 * * * *", "*/15 19-23,0 * * *"]` | Current season of shows with a recent episode.                                                                 |
| `kanCrawl`         | `*/10 * * * *`                        | One Kan crawl slice.                                                                                           |
| `daily`            | `10 5 * * *`                          | Housekeeping: catalog backup, usage rollups and pruning, the public addon's daily counts, the playback canary. |
| `airingWindowDays` | `14`                                  | "Recent" for the two lines above.                                                                              |

On start, if there was no full run in the last 24 hours, one starts immediately.

## `scraping`

| Option                   | Default |                                                                                                                 |
| ------------------------ | ------- | --------------------------------------------------------------------------------------------------------------- |
| `delayMs`                | `1000`  | Pause between requests to the same site.                                                                        |
| `minShareOfPrevious`     | `0.8`   | A full run whose index lists fewer shows than this share of the previous run is rejected (last good data kept). |
| `browserPagesPerRun`     | `5`     | Kan pages per crawl slice.                                                                                      |
| `browserPageIntervalSec` | `75`    | Pause between Kan pages.                                                                                        |

## `tmdb` (optional)

`{ "apiKeyEnv": "TMDB_API_KEY" }` turns on matching shows to TMDB/IMDb after each full run, so a show opened
from another catalog (e.g. Cinemeta) also gets streams.

## `log`

Defaults: `{ "file": "./data/logs/israel-tv.log", "maxMB": 20, "keep": 10, "level": "info" }`. JSON log lines (pino)
in rotated files next to `file` (a new file each day or at `maxMB`, keeping `keep` files; `current.log` points at the
newest), also shown on the terminal when there is one (readable lines) and in a container's output (`docker logs`). A
service's own output (launchd, systemd, Task Scheduler) gets nothing, so nothing grows unrotated. `"file": ""` logs to
standard output only. The
values of the secrets the config names, and of anything in `.env` named like a token, password, key, secret, user, account or proxy,
never appear in it.
