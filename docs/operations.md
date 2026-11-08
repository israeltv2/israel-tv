# Operations

## Commands

`pnpm israel-tv <command>` (or `node apps/ingest/src/cli.ts <command>`; `pnpm israel-tv help` prints this):

| Command                                                                       |                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start [--no-initial-run]`                                                    | The service: schedules, admin, local addon server (local publisher), resolver. Same as `pnpm start`. On start it checks the live channels, publishes, and reads everything if there was no full run in 24 hours; `--no-initial-run` skips only that read. Ctrl-C stops it. |
| `full [--source mako] [--limit N]`                                            | Read every show now. `--limit` is for trying things out: a limited run is recorded apart and does not count as the full run (`/status` says "only a limited test run so far").                                                                                             |
| `airing [--source …]`                                                         | Re-check shows with a recent episode.                                                                                                                                                                                                                                      |
| `show <series-id \| source:key>`                                              | Re-read one Mako or Reshet show, e.g. `show iltv_mako_12`. (Kan shows: `POST /refresh/<id>` on the running service.)                                                                                                                                                       |
| `kan [--limit N]`                                                             | One Kan crawl slice (N pages).                                                                                                                                                                                                                                             |
| `publish`                                                                     | Render and publish now.                                                                                                                                                                                                                                                    |
| `serve [--port N]`                                                            | Render the current data and serve it locally; with the Cloudflare publisher, a preview of what is uploaded (port 7700 by default).                                                                                                                                         |
| `resolver`                                                                    | Only the resolver.                                                                                                                                                                                                                                                         |
| `check-proxy`                                                                 | Checks each configured geo proxy answers and exits in Israel, and says why when not.                                                                                                                                                                                       |
| `match`                                                                       | TMDB/IMDb lookup.                                                                                                                                                                                                                                                          |
| `status`                                                                      | Recent runs and warnings.                                                                                                                                                                                                                                                  |
| `idle [--wait SECONDS]`                                                       | Exit 0 when no run is in progress, 3 when one is; `--wait 300` waits up to 300 seconds for one to end. For deploy scripts (see "Restarting safely").                                                                                                                       |
| `events [--play P] [--kind K] [--errors] [--since 2h] [--show S] [--limit N]` | Usage and diagnostics events as JSON lines, oldest first (`pnpm logs …` is the same).                                                                                                                                                                                      |
| `usage`                                                                       | The usage dashboard's figures as JSON (`pnpm usage`; "playing now" is only on the running service's `/usage.json`).                                                                                                                                                        |
| `admin-url`                                                                   | The admin page's link with its token.                                                                                                                                                                                                                                      |
| `remote-url`                                                                  | The away-from-home (Mako) resolver's manifest link, with its token.                                                                                                                                                                                                        |
| `restore <registry.json file or URL>`                                         | Rebuild ids and numbering into an empty database (see below).                                                                                                                                                                                                              |

Errors are printed as one line; set `ISRAEL_TV_DEBUG=1` for stack traces.

**Every admin request needs the admin token** (`ISRAEL_TV_ADMIN_TOKEN` from `.env`, or — when you did not set
one — the `token=` part of what `pnpm israel-tv admin-url` prints); without it the answer is a plain 404, which
looks like a wrong address. In the examples below, `$T` is that token (`T=…` in your shell first).

While `start` runs, prefer the admin endpoints (they queue work behind the running job, so only one process
writes the database): `curl -X POST -H "Authorization: Bearer $T" http://<host>:7702/refresh/iltv_mako_12`.
In these examples `<addon>` is the addon's base URL: its manifest URL without `/manifest.json` (e.g.
`https://israel-tv.<subdomain>.workers.dev`, or `http://<host>:7700`). To find a show's series id: search its row,
`curl -s '<addon>/catalog/series/<row>/search=<word>.json'` (one word of the title, or spaces as `%20`) →
`metas[].id` (rows `iltv_keshet12`, `iltv_reshet13`, `iltv_kan11`, `iltv_kankids`), or `failingShows` in `/status`. Admin endpoints answer only
private network addresses and refuse requests sent by web pages (cross-site), so use curl or a script. A Kan
show's refresh makes it due for the next crawl slice and starts one.

A **resolver-only** instance (role `resolver-only`) runs only the resolver, with its own entry point:
`pnpm resolver start`, `check-catalog`, `check-proxy`, `remote-url` and `events` (same options as `pnpm logs`).
It has no admin page, `/status` or usage dashboard: its events and logs are local, and a proxy failure shows
only there (`pnpm resolver events --errors`). At start it logs `catalog check: …` about the catalog it plays from.

## Status

`http://<host>:7702/status` (local network, JSON, includes the job queue and the next scheduled runs) and
`/status` on the addon (public copy, HTML; `/status.json` for JSON). Health per source:

- **ok** — last full run fine and less than 36 hours old.
- **warn** — partial run (some shows failed; their last good data is still served), Kan crawl backing off,
  or no full run yet. For live channels, `shows` is the number of channels whose stream answered (Mako's
  four channels are checked at play time, so 12 of the 16 are counted).
- **error** — last full run failed, nothing succeeded in 36 hours, or a source has no shows. The affected
  catalog row gets a "⚠" first item with the reason.

A run marked **stopped** ("stopped for restart") was cut short because the service was stopped or restarted. It is
not a failure: health, the notes, the day-by-day history and the dashboard's failure lists ignore it, and judge the
source on the last run that ended by itself. A run marked **failed** with "interrupted: the process ended without a
clean stop" was left open by a crash, a forced kill or a power cut.

`failingShows` lists shows whose last read failed (still served from last good data); `warnings` lists
numbering conflicts, renumberings at the source, thin results and dead season links.

### The public status page

`/status` (in Hebrew: `/he/status`, right to left, each linking to the other) is for viewers first: one line on top says whether everything is working and what that means for
watching; then a card per row (shows, episodes, last and next refresh, a 30-day bar), the live channels as last
checked, and, folded away, the details for contributors (shows that failed, notes, the catalog check with the count of
shows per source still without genres, a description or a year line, recent
warnings). It is rendered at publish time from the same data as `/status.json`; a few lines of script only turn
times into "3 hours ago" in the reader's time zone (without it they read "7 Nov, 03:30 Israel time"). Its times are
`<time>` elements, which the publisher leaves out when it compares status files, so a quiet run uploads nothing.

Nothing private is published: every string in the status goes through `publicText` (packages/render). Kept: web
addresses on the broadcasters' hosts and a few well-known public ones (`PUBLIC_HOSTS`: not workers.dev or
cloudflare.com), as origin and path only (no user, password, query or fragment), and the public addon's own origin
(`publisher.publicUrl` or the deployed address). Replaced with `[private address]` / `[path]`: every other web
address, host names without a scheme (`proxy.example.net:3128`, as Node's connection errors print them), LAN names
with a port (`mac-mini:7703`), `localhost`, IP addresses and file paths (`/Users/…`, `/Library/…`, `~/…`, `C:\…`,
`C:/…`). The live check's stream addresses and the home helper's address are never copied into it.

`/status.json` keeps every field above and adds (all optional, for older readers):

| Field                     | What it holds                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalogs[]`              | The rows as published: `id`, `name` (Hebrew, as apps show it), `source`, `shows`, `episodes`; `filling: {inCatalog, known, pagesToRead}` while a Kan row has its first fill.                                                                                                                                                                                     |
| `history`                 | `days` (YYYY-MM-DD in `schedule.timezone`, oldest first, 30 of them) and `sources.<source>`: one `ok` / `warn` / `error` / `null` (no run) per day, from the runs table (full, airing and show runs; Kan's crawl slices; the live check). A day is `error` when nothing succeeded (Kan: `warn`), `warn` when something failed (Kan: more failed than succeeded). |
| `live`                    | The last live check: `at`, `abroad`, `channels[]` with `id`, `name`, `state` (`up`, `down`, or `unchecked` when a Keshet channel had no home helper to play it through), `helper` (plays only through the home helper), `israelOnly`.                                                                                                                            |
| `sources[].skipped`       | Episodes a site lists that are not in the catalog: `noLongerOffered` (Kan: rights ended; Reshet: past its availability window, number kept), `notVideo` (articles, promos).                                                                                                                                                                                      |
| `sources[].botCheck`      | The site's bot check today: `challenged` page loads of `pages`.                                                                                                                                                                                                                                                                                                  |
| `sources[].noteCodes`     | The same notes as `notes`, one for one and in the same order, as `{code, params}` (`first-fill`, `kan-no-longer-offered`, `blocked-retrying`, …): the status page words them in English or Hebrew from these, never from the English text. A code a page does not know is shown as its English note.                                                             |
| `publishNote`, `tmdbNote` | `publish` and `tmdb` as `{code, params}` (`publish-failed` with `at`, `inRow`, `error`; `publish-stale` with `since`; `tmdb-failed`).                                                                                                                                                                                                                            |
| `warnings[].params`       | The warning's values by name (stored with it since v0.11): episode keys and numbers for the numbering warnings, the titles of a bot-check delay, Kan's page address and its own message. Older warnings have none and show their English message, marked as English, on the Hebrew page.                                                                         |
| `schedule`                | `timezone`, `fullRunTime` ("03:30" for a plain daily `schedule.fullRun`), `nextFullRun`, `airingChecksPerDay`, `nextAiringCheck`.                                                                                                                                                                                                                                |

The landing page (`/`, and `/he/` in Hebrew) is rendered at the same time, with the rows, counts and live channels
written in. Both pages have their canonical address, share cards (`og.jpg`) and icons; `robots.txt` and
`sitemap.xml` list the four pages (the home and status pages in both languages, with `hreflang` alternates), and the addon's JSON is kept out of search results (`X-Robots-Tag: noindex`
and `Disallow` in robots.txt). Absolute addresses use `publisher.publicUrl`, else the address the last Cloudflare
deploy reported; otherwise (the local publisher, or the very first deploy) the server fills in the address the page
was asked on. To look at the pages without a database: `pnpm shots:site` (screenshots at phone and desktop width,
light and dark, into `site-screens/`) or `pnpm shots:site --serve` (http://127.0.0.1:7790/).

**IndexNow.** After a publish that went through (Cloudflare publisher, `indexNow.enabled`), the pages it added,
changed or removed are sent to `api.indexnow.org` in one request (up to 10,000 addresses each): the very first time,
or after a new address or key, every page of the sitemap; `/status` at most once a day (it changes with nearly every
publish); search, the 404 page and the JSON files never. A publish that changed no page sends nothing. The key file
`/<key>.txt` is published with the site. The log has `indexnow: api.indexnow.org answered 202 for N URLs`; a failure
is only an `indexnow warning:` line and a note on the admin `/status` (the publish stays good), and its addresses go
with the next submission.

### The library on the website

The website also has the catalog itself, in Hebrew, rendered with everything else at publish time
(`packages/render/src/library-html.ts`):

| Address              | What it shows                                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/library/`          | Every row as a strip of posters, the live channels with what is on now, and a search box.                                                                                  |
| `/library/<row>/`    | A row's shows (`keshet12`, `reshet13`, `kan11`, `kankids`, `kanarchive`), newest first, with a genre filter.                                                               |
| `/show/<series id>/` | One show: poster, picture, description, genres, years, its seasons and episodes (60 per season, the newest of a long one), "Watch in Stremio", the broadcaster's own page. |
| `/live/`             | Every live channel with now and next from the programme guide, "Watch in Stremio" and the channel's own live page where known.                                             |
| `/search/`           | Search over `search.json`, in the browser.                                                                                                                                 |

The pages are plain static files (about 1,100 next to the catalog's ~3,700; the free plan allows 20,000). Show and row
pages change only when their show does, and the live guide is written in whole (its first 36 hours) rather than cut
at the moment of publishing, so a quiet run uploads none of them; the page's script hides what has ended and shows
what is on. Images stay where the broadcasters host them, asked for at the size shown where their image service
can resize (Reshet, Kan). A portrait poster over 100 KB on a host that cannot resize (Keshet 12's are often 200+ KB) is
published as our own lighter copy (`art/<id>-poster.jpg`, at most 400 px wide, used by the apps too); channel logos
on the pages are 128 px WebP copies of the 512 px PNGs the apps get (`assets/logos/site`, made by
`pnpm images:site --logos`). Browsers keep the fonts a year, logos a week and artwork a day (`_headers`). `sitemap.xml` lists every row, show and the live page. Nothing plays on the website
(see decisions.md, "Round 9"). An address that does not exist gets `404.html` (Hebrew and English, with search and the
ways back in); on Cloudflare through `not_found_handling: "404-page"`, in the local server for browsers (apps get JSON).

To see a design change on real data: copy a published site folder (the publisher's `publisher.dir`) and run
`pnpm preview:site <that folder>`: it renders the landing, library and status pages from its JSON files into a
copy next to it and serves it on http://localhost:8788/. Nothing is published.

## Usage dashboard and events

The dashboard `http://<this computer's address>:7702/dash/` is for the owner only: it answers on the local network
only, and also needs the admin token (`ISRAEL_TV_ADMIN_TOKEN` in `.env`; without it, one is generated on first start).
`pnpm israel-tv admin-url` prints the link with the token; open it once in a browser and the token moves into a
cookie (kept 30 days). Anyone without it gets a plain 404. It works on a phone (a tab bar at the bottom) and on a
desktop (a sidebar), follows the system's light or dark setting (or the switch in the top corner, remembered on that
device), shows every time in the configured time zone (`schedule.timezone`, Israel by default; the UTC time is in
each time's tooltip) and keeps Hebrew titles in their own direction.

At the top of every section, one line answers "is everything OK?": **All good**, **Needs a look** or **Something is
broken**, with each problem in a sentence that links to its section (`GET /api/v1/health`; the same problems put a
dot on the section in the menu). Problems come from: a source that is not green, a canary that does not play, a
catalog row the addon shows as stale, shows that fail to read, a failed publish or TMDB run, the service's own notes
(Analytics Engine, the remote helper, the free-plan quota, the events database size), plays that failed in the last
24 hours (not counting a single unavailable title), an old or failed backup, and a nearly full disk.

The sections:

- **Overview** — plays today and over 7 days with a 30-day sparkline, viewers (home, and the public addon per day),
  minutes relayed (only relayed plays can be timed), the failure rate with its counts (also since the running
  version was deployed), catalog freshness per source and the last publish, today's
  Cloudflare requests against the free plan; plays per day (home and public), the most watched shows with posters.
- **Sources** — a card per source: shows, episodes, last good read against its rhythm (with a bar to the point where
  the addon calls the row stale), the last airing check, the playback canary of the last runs as a strip (green: plays;
  amber: played after skipping an unavailable title; red: failed — hover for the step and statuses), the notes, the
  shows the site's bot protection refused and their retries, the shows the site lists with nothing to watch (a count
  that opens into the list) and the recent reads. Below: each geo proxy exit (what the relay saw through it) and the
  Kan reader's progress. A button runs the canary now.
- **Plays** — plays per day by source, the time to the first playlist (median and 95th percentile, per day), the most
  watched shows with posters, the most played episodes and the recent plays, each opening its trace.
- **Failures** — failed plays in 7 days, the rate, failures per day by source, the groups (source, stage, status,
  reason; "one title" when only that title failed) with a 7-day bar and a sentence in plain words, and the recent
  failures. The project's own checks (`x-israel-tv-probe`) are never counted, and neither are the home helper's
  `not-mine` answers. Failures recorded before their cause was fixed (`KNOWN_FIXES` in apps/ingest admin-api.ts: the
  fix's date and what was done) stay listed, dimmed and marked "fixed", but are not counted as open problems, here or
  in the health line.
- **Trace** (`#/trace/<playId>`, from any play or failure) — every event of one play on a timeline: offset from the
  start, which part (resolver, mako-auth, geo-relay), what happened, its status and how long it took, the upstream
  statuses in order (`playlist 200, cdn AKAMAI, ticket 200, master 403, …`) and the full detail.
- **Live now** — what plays through the home helper right now, pushed as it changes (Server-Sent Events; paused while
  the tab is hidden).
- **Catalog & deploys** — shows and episodes per source, the last publishes, the two Workers' versions with their
  rollback commands to copy (shown, never run from the page), the publisher's own catalog check, the shows failing to
  read, and a form that reads one show again now.
- **System** — uptime, version and revision, memory in use (the file cache counts as available) and disk with gauges, database sizes and growth, the last backup
  and its restore check, Cloudflare's free-plan use today (requests and Analytics Engine writes, per Worker), usage
  events per day.

The page is a static app built from `apps/dashboard` (`pnpm build`; releases and the Docker image include it). It
loads its own files only (a strict content security policy: no inline script, no other origins except show posters
over https), reads the API below and never holds the token itself (the browser's cookie does). A copy without the
build says so at `/dash/` and on `/status`.

The same numbers are a JSON API for scripts, `GET /api/v1/{session,health,overview,sources,plays,failures,trace/<playId>,
live,deploys,system}` with `Authorization: Bearer <token>` (schemas: `packages/admin-contract`); changes are
`POST /api/v1/actions/refresh/<series-id>` and `POST /api/v1/actions/canary` (a browser must also send the
`x-israel-tv-csrf` value from `/session`). The older one-page view stays at `/usage` (no JavaScript needed).

The usage numbers come in two clearly separate views:

- **This home (resolver):** what the resolver on this network saw — plays (Mako play starts and relayed plays),
  unique clients per day, top shows, failures by reason, and what is playing now. It cannot see other people's
  resolvers, catalog browsing, or plays that go straight from the public addon to a broadcaster.
- **Public addon (all users, anonymous):** stream requests to the public addon from everyone who installed it,
  counted by Cloudflare and read back once a day. It cannot see catalog browsing (static files) or what is
  actually watched.

Plus health: the daily playback canary, ingest per source, and the usage data itself (size, growth per day,
events per day, how long the page took to build). `/usage.json` has the same figures as JSON; `pnpm usage`
prints them too, without "playing now" (only the running service knows that). Plays through the away-from-home
link count under "This home". On a server without a browser: `ssh -L 7702:127.0.0.1:7702 <server>`, then open the
`admin-url` link with `127.0.0.1:7702` on your own machine.

### Where usage data lives

`data/events.sqlite` (`events.path`), apart from the catalog database so its writes never get in the way of
ingest. WAL mode; events are written in batches. Two tables:

**`events`** — one row per meaningful action, never per video segment. Indexes on `ts`, `(kind, ts)`, `show_id`,
`play_id`. Kept 30 days.

| Column       | What                                                                                   |
| ------------ | -------------------------------------------------------------------------------------- |
| `ts`         | ISO time                                                                               |
| `kind`       | see below                                                                              |
| `component`  | `resolver`, `mako-auth`, `geo-relay`, `ingest`, `canary`                               |
| `outcome`    | `ok` or `error`                                                                        |
| `play_id`    | ties the events of one play together (the resolver's play and relay URLs carry `?p=…`) |
| `source`     | `mako`, `reshet`, `kan`, `live`; for `run`, the run's scope                            |
| `show_id`    | series id (`iltv_…`) or live channel id                                                |
| `episode_id` | video id (`series:season:episode`)                                                     |
| `client`     | salted daily hash of the client's address (never the address)                          |
| `status`     | HTTP status answered, or for a failure the upstream status that caused it              |
| `latency_ms` | time taken (for a play: time to the first playlist)                                    |
| `detail`     | JSON: upstream statuses, reason, stage, bytes, segments, duration, run counts          |

| `kind`           | Recorded by          | When                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stream_request` | resolver             | It answered a stream request: what it offered and why (`detail.offered`, `notes`). Outcome `not-mine` when it has no job for that id (another addon's title, a channel or title the public addon plays): apps ask every addon for every id, so that is normal and never a failure. `error` when it had one and failed it (Mako, a relay, one of our own titles it does not know). |
| `play_start`     | mako-auth            | A Mako play got its master playlist (latency = time to it; `detail.upstream`).                                                                                                                                                                                                                                                                                                    |
| `ticket_fetch`   | mako-auth            | A Mako entitlement (ticket) fetch.                                                                                                                                                                                                                                                                                                                                                |
| `relay_session`  | geo-relay            | One relayed play, written when it ends: duration, bytes, segments, errors.                                                                                                                                                                                                                                                                                                        |
| `failure`        | mako-auth, geo-relay | A play that failed: `detail.stage` (`play`, `relay`), upstream statuses, reason.                                                                                                                                                                                                                                                                                                  |
| `run`            | ingest               | A finished run: full, airing, show, Kan crawl slice, publish, match.                                                                                                                                                                                                                                                                                                              |
| `canary`         | canary               | The daily playback check of one title (see below).                                                                                                                                                                                                                                                                                                                                |

**`daily_usage`** — per day, origin (`home` or `public`), source and show (`''` = all), the number of plays,
unique clients, failures and minutes watched (known only for relayed plays). Kept a year. Home rows are rolled
up nightly from the events; public rows come from Cloudflare's Workers Analytics Engine (a failed read shows on `/status` and the
dashboard; the API Worker's Workers Logs lines are for debugging only).

Every night (`schedule.daily`) the daemon also: backs up the catalog database (below), rolls up yesterday,
deletes events older than 30 days and rollups older than a year, VACUUMs once a week, and checks the size cap
(`events.maxMB`, default 200): above it, raw events are cut to the last week and `/status` warns.

### Logs

JSON lines (pino), one per thing, with `component` and the ids of what it is about (`playId`, `showId`,
`episodeId`, `source`). With `log.file` set they go to rotated files next to it (a new file daily or at
`log.maxMB`, keeping `log.keep`; `current.log` points at the newest: `tail -f data/logs/current.log` with the
example configs); otherwise to the terminal (under systemd: `journalctl -u israel-tv -f`, or `-u
israel-tv-resolver`; under Docker: `docker compose -f deploy/docker-compose.yml logs -f`, or
`docker-compose.resolver.yml`). Secrets never
reach a line: the value of every secret the config names (proxy login, Cloudflare, TMDB, admin and remote
tokens) and of anything in `.env` named like a token, password, key or secret is replaced with `[redacted]`
wherever it appears.

### Playback canary

Once a day (`schedule.daily`) the daemon plays one title per source end to end, the way a viewer at home would:
the newest episode of the most recently aired, healthy Mako, Reshet and Kan show, and one live channel. It asks
the home resolver for the stream (Mako through mako-auth; Reshet and Kan direct or through geo-relay, as the
title needs), then fetches the master playlist, a variant playlist and the first bytes of the first segment —
200, 200, 206 is a pass. One title that will not play does not make its source red: when a title fails on its own
(nothing offered, or a 4xx from the CDN) the canary tries the newest episode of the next recent show, up to three
titles; the source passes if one plays, and the ones that did not are listed as `unavailable` ("episode
unavailable", not "source broken"). A source is red only when none of its titles plays or a failure is not the
title's (5xx, network). Failed titles are skipped as first picks for a day. A relayed title (Kan, geo-blocked
Reshet) that fails is checked once more 20 seconds later: the relay itself already moves to the next proxy exit
when a CDN refuses one, since a refusal can be the exit's fault. Each result is a `canary` event; `/status`
(`canary`) and the dashboard show the latest per source, with the failing step (`pick`: no recent playable title;
`stream`: nothing offered; `master`, `variant`, `segment`), the statuses and any unavailable titles. Its requests
carry `x-israel-tv-probe: canary`, so its plays never count as usage or failures. Run it now with
`curl -X POST -H "Authorization: Bearer $T" http://<host>:7702/run/canary`.

### Stream probes and the live check

- **Live check** (with each full run): every stream of every live channel is played (playlist → variant → first
  segment): the public addon's own streams directly, and the Mako channels through this instance's home helper. A
  channel is red when none of its streams plays; a single dead stream (a backup) makes the live source amber and is
  named on `/status`. A stream that fails is played once more 30 seconds later before it counts (what a viewer
  pressing play again would see); a refusal from abroad is not (a programme's block lasts). From abroad (an instance with a geo proxy) a refusal (403/451) is a label,
  not a fault: each stream keeps its last 20 outcomes (`recent`: `o` played, `r` refused, `f` failed), and a stream
  refused in every one of them says "זמין לצפייה רק בישראל", one refused in some says "לפעמים זמין רק בישראל". Kan's
  channels (`geo` in packages/core live.ts) always say at least the latter: Kan blocks some programmes outside Israel
  (measured: Kan Educational refused for 22 minutes, then playing again), and the home helper relays them then.
  Results: kv `live:check`; the dashboard's Sources page lists every stream (a refusal from abroad is grey; hover for
  its history).
- **Stream probes** (after each full run, up to 1,500 reads, and each airing check, up to 300): Kan titles are asked
  from abroad, directly (newest episode, playlist → variant → segment), once a week per title; a title refused there
  is labelled "only in Israel", one that plays is not, and one that could not be told keeps the label. Reshet
  episodes get their real best quality from their master playlist (once each). Results: kv `probe:kan-abroad` and
  `probe:quality`; the next publish uses them. Inside Israel (no proxy) Kan is not probed.

### Programme guide

`epg.json` (published) holds each channel's programmes from 6 hours ago to 3 days ahead, from the broadcasters' own
schedule pages: Keshet 12 (mako.co.il) and Reshet 13 (13tv.co.il) through the scrapers, Channel 14 (c14.co.il
wp-json) and the Knesset (knesset.tv) directly, every 6 hours (Knesset 12) after an airing check; Kan 11, Kan
Educational and Makan 33 through the Kan browser, one guide page per crawl slice (each channel, today and tomorrow,
twice a day). A failed read keeps the last good guide and says why on the dashboard (kv `epg:guide`). The addon puts
"עכשיו … · אחר כך …" first in every live tile's description at request time and answers Stremio's guide pages
(`/catalog/tv/iltv_live/date=YYYY-MM-DD.json` → `metasDetailed`). Not covered: i24 (an undated weekly template its own
site no longer shows), Channel 10 (bot checkpoint), Channel 24, ynet and the 24/7 loop channels (no schedule).

### Kan's first fill

Kan is read a few pages per slice, so a new install fills over days. Until every show its lobbies list has at least
one episode, `/status` says how far each row is (`first fill of iltv_kan11 … in progress: N of M shows`) and the row
starts with a "⏳ עדיין בטעינה" item; the source is amber meanwhile (the archive row is read last and only noted).
Episode pages are read breadth-first: newly published episodes, then the shows with the fewest episodes.

### Shows the site refused (bot protection)

Mako and Reshet sometimes answer a show page with a bot-protection page (Mako's is Radware: a redirect to
`validate.perfdrive.com`). The check scores each request, so a reader of the site's JSON (Mako's) first asks again a little later, with fresh
browser headers and no cookies (after about 5, 15 and 30 seconds, with jitter); that usually gets the data. A show
still refused is delayed, not lost, and the run is not marked partial or failed for it: its last good data stays, a
labelled note says so ("Mako's bot check delayed N shows; retried at …"), and the daemon reads just those shows
again later, after 30 minutes, 1 hour and 2 hours. This holds for the nightly full read, the airing checks and a
single-show refresh. The source stays green while retries are pending or once they succeed; it turns amber only for
shows still refused after the third retry (named on `/status`, in `blocked` per source, and listed as failing shows),
or when the site refuses three shows in a row (the run stops there and is partial). `/status` also says how many of
the day's requests met the bot check, how many a quick retry read, and how many shows were delayed. Other failures
in the run are not retried and show as before.

### Images: checking what viewers see

`pnpm audit:images` checks every image the public catalog shows, the way a viewer's app loads it, from wherever
it runs (run it outside Israel, without a VPN: most viewers' case). It walks the manifest, every row's first page
(posters, live tiles, row notices), a sample of each row's metas (backdrops, channel logos, two episode stills
each), and reports per source and kind: **missing** (no image at all), **placeholder** (the generic poster, ours or
a broadcaster's own stand-in: the show has no image of its own yet), **broken** (not 200, not an image,
unreadable), **refused abroad** (403 from a broadcaster's own host, Kan's), **tiny** and **wrong shape** (posters
2:3, logos square, backdrops and stills landscape). It is polite: at most 4 requests at once and `--max` requests
in all (600 by default), and only the first bytes of each image.

```sh
pnpm audit:images                                  # the public addon
pnpm audit:images --base https://<your-addon> --max 300 --metas 6 --json audit.json
```

What it finds is fixed where the image is chosen (apps/ingest/src/publish.ts, posters.ts, packages/render), and
shows after the next publish. Kan shows whose image could not be copied yet (Kan refuses its images abroad, and
sometimes the copy too) carry the placeholder until a later crawl copies it; the dashboard draws a tile with the
show's first letter for them instead of the generic poster.

### A catalog row says it is old

The public addon adds "⚠ הקטלוג לא עודכן מאז …" (catalog not updated since …) at the top of a row by itself,
without the home machine: when nothing has been published for more than 36 hours (every row), or when the row's
source has had no good full read (Kan: crawl slice) for more than 48 hours. Both times are rounded down to 6
hours. Look at `<addon>/freshness.json` (what the addon compares), the admin `/status` (`publish`,
each source's `lastFullRun` and `notes`) and `pnpm israel-tv status`. A row without the ⚠ that still looks old in
the app is usually the app's own cache (see docs/tv-checklist.md).

## Investigating a failed play

1. **Find it.** The latest failures (the CLI prints oldest first, `/events.json` newest first):

   ```bash
   pnpm logs --errors --since 2h
   curl -s -H "Authorization: Bearer $T" 'http://<host>:7702/events.json?outcome=error&since=2h'
   ```

   For one show add `--show iltv_mako_12` (`&show=…`); for one kind `--kind failure` (`&kind=…`).

2. **Follow the play.** Everything that happened under its play id, in order:

   ```bash
   pnpm logs --play <playId>
   curl -s -H "Authorization: Bearer $T" 'http://<host>:7702/events.json?playId=<playId>'
   grep "<playId>" data/logs/current.log   # the log lines around it (the folder of log.file)
   ```

   A healthy Mako play is `stream_request` (offered 1 stream) → `ticket_fetch` (ok) → `play_start` (upstream
   `playlist 200, ticket 200, master 200`). A relayed Reshet or Kan play is `stream_request` (notes: `direct
   refused here … relayed`) → `relay_session` (segments > 0).

3. **Read the upstream statuses** in the `failure` event's `detail`:
   - `master 403`: Akamai refused the session token. The master must be fetched with the player's User-Agent
     (the resolver forwards it); a player that changes its User-Agent between the master and the segments gets
     403 on the segments, which the resolver never sees.
   - `ticket …` failing: Mako's entitlement service; try the episode on mako.co.il.
   - `playlist 404` or `unknown episode`: gone at Mako, or the catalog is older than the app's view — re-read
     the show: `curl -X POST -H "Authorization: Bearer …" http://<host>:7702/refresh/<series-id>`.
   - `stream_request` with `no stream for this id here`: the resolver has nothing for this id (the public addon
     may). `none needed` means the direct stream plays from here, so the resolver deliberately adds nothing — and
     records nothing more: that play goes from the TV straight to the broadcaster. Reproduce it from the TV's
     network (step 5); if the direct stream is refused there after all, the resolver's check (repeated every 6
     hours per show) was wrong for that title — a restart clears it.
   - `relay` failures, or `relay_session` with errors and no segments: the geo proxy — `pnpm israel-tv
     check-proxy`, and `geo` in `/status`. `upstream HTTP 403` through the proxy usually means its exit is not in
     Israel.

4. **Public addon side.** Its requests are in Cloudflare's Workers Logs for a few days (dashboard → Workers →
   the worker → Logs; one JSON line per request it answered, with `route`, `series`, `status`, `ms`). The
   daily counts are on the usage page.

5. **Reproduce.** The video id is in the show's page: `curl -s <addon>/meta/series/<series-id>.json |
   jq -r '.meta.videos[] | .id + "  " + .title'`. Then take the stream list — from the resolver for Mako or a
   relayed title, from the public addon for a direct one (Reshet and Kan in Israel) — and fetch the play URL, a
   variant playlist and a segment with one User-Agent; a working play gives 200, 200, 206:

   Mark your own checks with the `x-israel-tv-probe` header (any value, e.g. `test`; the canary sends `canary`):
   their plays get a `probe-…` id and stay out of usage, failures and "playing now", but you can still follow
   them by play id.

   ```bash
   P='x-israel-tv-probe: test'
   curl -s -H "$P" http://<host>:7701/stream/series/<video-id>.json | jq -r '.streams[].url'   # resolver
   curl -s -H "$P" <addon>/stream/series/<video-id>.json | jq -r '.streams[].url'      # public addon
   UA='Mozilla/5.0 (Linux; Android 12) ExoPlayer'
   curl -s -A "$UA" '<stream url>'            # master: note the first non-# line (a variant)
   curl -s -A "$UA" '<variant url>'           # variant: note the first segment
   curl -s -A "$UA" -r 0-1023 -o /dev/null -w '%{http_code}\n' '<segment url>'   # 206
   ```

## Backups and moving

Every night the daemon copies the catalog database (`data/israel-tv.sqlite`, the one that holds every id and
episode number) to `data/backups/israel-tv-YYYY-MM-DD.sqlite` and keeps the last 7 days (`backup.keepDays`,
`backup.dir`); older copies it made are removed, nothing else is. To go back to a copy: stop the service,
replace `data/israel-tv.sqlite` with it (and delete `israel-tv.sqlite-wal` / `-shm`), start again.

Back up `data/israel-tv.sqlite` (the ids and numbers live there). The addon also serves `/registry.json`
(the id registry) as an off-machine copy. Rendered files are disposable: `publish` recreates them.

A publish that meets Cloudflare's own trouble (a 5xx, "no healthy upstream", a malformed API answer, a timeout) is
tried again within the same publish, up to 4 tries with growing pauses (15 s, 60 s, 3 min, each 50–100% of that
at random). A try resumes the last one: wrangler uploads files by content hash and Cloudflare answers which it still
lacks. A setup problem (token, account, permissions) fails at once and says what to check; Cloudflare's own trouble
says it is on Cloudflare's side. On `/status`, `publish` (overall health `error`) appears at once for a setup
problem, and for Cloudflare's trouble only after 3 failed publishes in a row (each with its retries; runs stopped by
a restart are skipped); meanwhile the public copy is the last good one, and every failed publish is in the runs
(dashboard: Catalog & deploys). A failed publish is tried again after the next run either way. With a geo proxy, the admin `/status` also has `geo`: the
proxies, and when relaying through them last worked or failed (and why).

### Rolling back on Cloudflare

The public data Worker (the catalog and its router) and the private API Worker (the code) have their own versions
and roll back on their own:

```bash
pnpm israel-tv versions data          # every publish is a version of the data Worker
pnpm israel-tv rollback data          # the catalog as it was one publish ago (or: rollback data <version-id>)
pnpm israel-tv versions api
pnpm israel-tv rollback api           # the previous code (or: rollback api <version-id>)
```

Cloudflare keeps the last 100 versions of each. A data rollback holds only until the next publish (at most
`minIntervalMinutes` away while routine changes come in), so to keep an old catalog, stop the service first. The
router and the API check each other's contract version: if a rollback leaves them speaking different versions,
the public addon answers a clear error (and `/status` says so) until the matching one is deployed.

### Restoring from registry.json (when the database is lost)

The public addon serves `/registry.json`: every series id, season number and episode number ever given out.
It is enough to rebuild a lost database so every id and number comes back the same (watch progress in the
apps keys on them):

```bash
# a new, empty data folder (the config's store.path must not exist yet)
pnpm israel-tv restore https://<your addon>/registry.json      # or a saved copy of the file
pnpm israel-tv full                                            # read everything again (about half an hour)
```

`restore` refuses a database that already has series. It loads the series, seasons and episode numbers as
published and continues each source's id counter after its highest id, so a show that appears later never gets
an old id. The fresh read then finds every show and episode under its old id and number; only episodes published
since the copy get new numbers, after the existing ones. Kan's crawl fills in again over a few days (its numbers
come back too). Keep a copy of `registry.json` somewhere else from time to time if the addon is not public.

Drill (2026-11-06): the published registry (783 series, 1,665 seasons, 36,580 episode numbers) restored into an
empty folder, then a fresh read of 9 real shows (6 Mako, 4 Reshet, one without episodes): all 3,527 of their
episodes came back with exactly the published season and episode numbers, none differed.

## Restarting safely

Stopping the service (Ctrl-C, or the service manager's stop, which sends SIGTERM) does not cut work off in the
middle:

1. Nothing new starts: no queued job, no scheduled run, no new Kan crawl slice.
2. The work in progress stops at its next safe point: a full run or an airing check after the show it is reading,
   a Kan crawl slice before its next page (its progress is saved), a publish when its upload is done.
3. The run is recorded as **stopped** ("stopped for restart"), not failed, and the service exits.
4. It waits at most 60 seconds. Whatever is still open then is closed as stopped too. A second Ctrl-C or stop
   exits at once.

After the restart:

- A **full run** that was stopped is finished first, for the sources it had not read yet. (A full run cut short by
  a crash is not restarted on its own, so a crash cannot repeat in a loop; it waits for the nightly run, or for the
  "no full run in 24 hours" rule.)
- The **Kan crawl** goes on from where it was: its queue is saved after every page.
- An **airing check** is not repeated: the next scheduled one reads the same shows.
- The catalog is **published** first, so anything read before the stop goes out.

What a deploy should do:

- Give the service more than 60 seconds to stop. The files in `deploy/` do: launchd `ExitTimeOut` 90 (its default
  is 20 seconds, after which it kills the process), systemd `TimeoutStopSec=90`, Docker `stop_grace_period: 90s`
  (its default is 10 seconds). If you made your launchd plist or unit file before this, add that line to it.
- Then restart as usual (below). No other step is needed.
- Optional, to avoid cutting a long full run short: wait for a quiet moment first with
  `pnpm israel-tv idle --wait 600` (exits 0 when no run is in progress, 3 if one still is after 10 minutes).
  `/status` on the admin port shows the same thing live: `daemon.running`, `daemon.kanSlice`, and
  `daemon.stopping` while a stop is under way.
- Windows: the task cannot be asked to stop gently, so `install-task.ps1 -Restart` and `-Stop` first wait (up to 5
  minutes) with `idle`, then stop it.

## Updating

Pull, `pnpm install --prod`, restart the service: `launchctl kickstart -k gui/$(id -u)/org.israel-tv` (macOS),
`systemctl restart israel-tv` (Linux), or `docker compose -f deploy/docker-compose.yml up -d --build` (Docker).
Resolver-only: `pnpm install --prod --frozen-lockfile --filter "@israel-tv/resolver..."`, then
`launchctl kickstart -k gui/$(id -u)/org.israel-tv.resolver`, `systemctl restart israel-tv-resolver`, or
`docker compose -f deploy/docker-compose.resolver.yml up -d --build`.
With the Cloudflare publisher, also deploy the API Worker after each update: `pnpm israel-tv deploy-api` (or
`pnpm israel-tv deploy`, which also publishes). The same restart applies after changing the config or `.env`. Database migrations run on start. (`--prod` leaves out
the development tools, so `pnpm check` needs a full `pnpm install`.) Deploy tooling may write the deployed
git revision to a `.revision` file in the repo root; `/status` shows it (`dev` otherwise).
