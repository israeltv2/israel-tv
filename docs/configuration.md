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

| Option         | Default                 |                                                                                |
| -------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `workerName`   | `israel-tv`             | Served at `https://<workerName>.<your-subdomain>.workers.dev`.                 |
| `accountIdEnv` | `CLOUDFLARE_ACCOUNT_ID` | `.env` variable with the account id.                                           |
| `apiTokenEnv`  | `CLOUDFLARE_API_TOKEN`  | `.env` variable with an API token allowed to edit Workers scripts.             |
| `dir`          | `./data/site`           | Build folder uploaded on each publish.                                         |
| `publicUrl`    | —                       | Optional, for your own reference.                                              |
| `requestLogs`  | `true`                  | Log each catalog, meta and stream request for the usage dashboard (see below). |

With `requestLogs` on, the Worker answers every request itself (instead of Cloudflare serving the static files
directly) and logs one line per request: route, id, status, time, and a salted daily hash of the client's
address — never the address. Those requests then count toward the free plan's 100,000 Worker requests a day
(plenty for a household and friends; past it, Cloudflare answers errors until midnight UTC). The daemon pulls
the lines from Workers Logs every 10 minutes with the same API token. Set it to `false` to keep catalogs and
metadata as plain static files with no request log.

## `resolver`

| Option         | Default           |                                                                                                                |
| -------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `enabled`      | `true`            | The second addon that plays Mako and relays geo-blocked video. Run it on the network of the device that plays. |
| `host`, `port` | `0.0.0.0`, `7701` |                                                                                                                |

## `admin`

`host`, `port` (default `0.0.0.0`, `7702`). Serves `/status` (JSON), `/usage` (the usage dashboard; JSON at
`/usage.json`), `/events.json` (event queries, see [operations](operations.md#investigating-a-failed-play)),
`POST /refresh/<series-id>` (re-read one show now), `POST /run/full`, `POST /run/airing`. Answers only requests
from private network addresses.

## `schedule`

| Option             | Default                               |                                                |
| ------------------ | ------------------------------------- | ---------------------------------------------- |
| `timezone`         | `Asia/Jerusalem`                      | For all patterns below (cron syntax).          |
| `fullRun`          | `30 3 * * *`                          | Every show of every source, all seasons.       |
| `airingChecks`     | `["5 * * * *", "*/15 19-23,0 * * *"]` | Current season of shows with a recent episode. |
| `kanCrawl`         | `*/10 * * * *`                        | One Kan crawl slice.                           |
| `airingWindowDays` | `14`                                  | "Recent" for the two lines above.              |

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

`{ "file": "./israel-tv.log", "maxMB": 20 }`: write the service log to a file (trimmed to its newest half
when it passes `maxMB`). Without `file`, the log goes to standard output.
