# Configuration

One file, `israel-tv.config.json`, in the folder you run from (or the path in `ISRAEL_TV_CONFIG`). It is
optional: without it every default below applies, which is a working setup inside Israel. Secrets go in
`.env` next to the config file; the config only names the variables.

The file is checked at startup. A wrong or unknown option stops the program with the option's name and what
is wrong, e.g. `geo.urls: Too small: expected array to have >=1 items`.

Relative paths are relative to the config file's folder.

## `store`

| Option | Default                   |                                                                                                                                                 |
| ------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `path` | `./data/israel-tv.sqlite` | The database: permanent ids, numbering, last good data, run log. Back it up; `/registry.json` on the addon is a public copy of the id registry. |

## `branding`

`dir` (default `./branding`): your own addon images, used instead of the bundled ones when present —
`logo.png` (the addon's logo, square, about 256 px), `resolver-logo.png` (the resolver's) and `background.jpg`
or `background.png` (1920×1080). Missing ones fall back to the bundled images in `assets/branding/`.

## `sources`

`mako`, `reshet`, `kan`, `live`: each `true` (default) or `false`.

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

What goes through it: the resolver's "דרך ישראל" streams, offered for every Reshet and Kan episode and for
Kan's live channels (Reshet: only the master playlist; Kan: playlists and video), and Kan's web pages when
Kan VOD is on. `pnpm israel-tv check-proxy` tests it.

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

| Option         | Default                 |                                                                    |
| -------------- | ----------------------- | ------------------------------------------------------------------ |
| `workerName`   | `israel-tv`             | Served at `https://<workerName>.<your-subdomain>.workers.dev`.     |
| `accountIdEnv` | `CLOUDFLARE_ACCOUNT_ID` | `.env` variable with the account id.                               |
| `apiTokenEnv`  | `CLOUDFLARE_API_TOKEN`  | `.env` variable with an API token allowed to edit Workers scripts. |
| `dir`          | `./data/site`           | Build folder uploaded on each publish.                             |
| `publicUrl`    | —                       | Optional, for your own reference.                                  |

The Worker runs only for search, streams, paging past the end, `/status`, and the three kinds of files that carry
image URLs (the manifest, the live row and live channel pages); catalogs and metadata are free static files
(not counted). For each request it answers it writes one JSON line to Workers Logs (no addresses), and for each
stream request one Workers Analytics Engine data point; the home daemon reads the daily counts back with the
same API token (Analytics Engine needs the token to also have "Account Analytics: Read"; without it the counts
come from Workers Logs).

## `resolver`

| Option             | Default           |                                                                                                                              |
| ------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `enabled`          | `true`            | The second addon that plays Mako and relays geo-blocked video. Run it on the network of the device that plays.               |
| `host`, `port`     | `0.0.0.0`, `7701` |                                                                                                                              |
| `makoAuth.enabled` | `true`            | Mako playback (a fresh ticket and the ~1 KB playlist per play; video comes from Mako's CDN).                                 |
| `geoRelay.enabled` | `true`            | Geo-blocked Reshet/Kan video through the `geo` proxy, only when refused from this network. The only part that carries video. |

## `admin`

`host`, `port` (default `0.0.0.0`, `7702`), `tokenEnv` (default `ISRAEL_TV_ADMIN_TOKEN`). Serves `/status`
(JSON), `/usage` (the usage dashboard; JSON at `/usage.json`), `/events.json` (event queries, see
[operations](operations.md#investigating-a-failed-play)), `POST /refresh/<series-id>` (re-read one show now),
`POST /run/full`, `POST /run/airing`. Answers only requests from private network addresses that carry the admin
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

`{ "file": "./data/israel-tv.log", "maxMB": 20, "keep": 10, "level": "info" }`: JSON log lines (pino) in rotated
files next to `file` (a new file each day or at `maxMB`, keeping `keep` files; `current.log` points at the
newest). Without `file`, the log goes to standard output (readable lines on a terminal, JSON otherwise). Secret
values from `.env` never appear in it.
