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
To find a show's series id: `https://<addon>/registry.json`, or `failingShows` in `/status`. Admin endpoints answer only
private network addresses and refuse requests sent by web pages (cross-site), so use curl or a script. A Kan
show's refresh makes it due for the next crawl slice and starts one.

## Status

`http://<host>:7702/status` (local network, JSON, includes the job queue and the next scheduled runs) and
`/status` on the addon (public copy, HTML; `/status.json` for JSON). Health per source:

- **ok** — last full run fine and less than 36 hours old.
- **warn** — partial run (some shows failed; their last good data is still served), Kan crawl backing off,
  or no full run yet. For live channels, `shows` is the number of channels whose stream answered (Mako's
  four channels are checked at play time, so 12 of the 16 are counted).
- **error** — last full run failed, nothing succeeded in 36 hours, or a source has no shows. The affected
  catalog row gets a "⚠" first item with the reason.

`failingShows` lists shows whose last read failed (still served from last good data); `warnings` lists
numbering conflicts, renumberings at the source, thin results and dead season links.

## Usage dashboard and events

The admin page `http://<host>:7702/usage` is for the owner only: it answers on the local network only, and also
needs the admin token (`ISRAEL_TV_ADMIN_TOKEN` in `.env`; without it, one is generated on first start).
`pnpm israel-tv admin-url` prints the link with the token; open it once in a browser and the token moves into a
cookie. Anyone without it gets a plain 404. Scripts send `Authorization: Bearer <token>`.

The page has two clearly separate views:

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

| `kind`           | Recorded by          | When                                                                               |
| ---------------- | -------------------- | ---------------------------------------------------------------------------------- |
| `stream_request` | resolver             | It answered a stream request: what it offered and why (`detail.offered`, `notes`). |
| `play_start`     | mako-auth            | A Mako play got its master playlist (latency = time to it; `detail.upstream`).     |
| `ticket_fetch`   | mako-auth            | A Mako entitlement (ticket) fetch.                                                 |
| `relay_session`  | geo-relay            | One relayed play, written when it ends: duration, bytes, segments, errors.         |
| `failure`        | mako-auth, geo-relay | A play that failed: `detail.stage` (`play`, `relay`), upstream statuses, reason.   |
| `run`            | ingest               | A finished run: full, airing, show, Kan crawl slice, publish, match.               |
| `canary`         | canary               | The daily playback check of one title (see below).                                 |

**`daily_usage`** — per day, origin (`home` or `public`), source and show (`''` = all), the number of plays,
unique clients, failures and minutes watched (known only for relayed plays). Kept a year. Home rows are rolled
up nightly from the events; public rows come from Cloudflare (Workers Analytics Engine when the API token may
read it, otherwise the same counts from Workers Logs).

Every night (`schedule.daily`) the daemon also: backs up the catalog database (below), rolls up yesterday,
deletes events older than 30 days and rollups older than a year, VACUUMs once a week, and checks the size cap
(`events.maxMB`, default 200): above it, raw events are cut to the last week and `/status` warns.

### Logs

JSON lines (pino), one per thing, with `component` and the ids of what it is about (`playId`, `showId`,
`episodeId`, `source`). With `log.file` set they go to rotated files next to it (a new file daily or at
`log.maxMB`, keeping `log.keep`; `current.log` points at the newest); otherwise to the terminal (under systemd:
`journalctl -u israel-tv -f`; under Docker: `docker compose -f deploy/docker-compose.yml logs -f`). Secrets never
reach a line: the value of every secret the config names (proxy login, Cloudflare, TMDB, admin and remote
tokens) and of anything in `.env` named like a token, password, key or secret is replaced with `[redacted]`
wherever it appears.

### Playback canary

Once a day (`schedule.daily`) the daemon plays one title per source end to end, the way a viewer at home would:
the newest episode of the most recently aired, healthy Mako, Reshet and Kan show, and one live channel. It asks
the home resolver for the stream (Mako through mako-auth; Reshet and Kan direct or through geo-relay, as the
title needs), then fetches the master playlist, a variant playlist and the first bytes of the first segment —
200, 200, 206 is a pass. Each result is a `canary` event; `/status` (`canary`) and the dashboard show the latest
per source, with the failing step (`pick`: no recent playable title; `stream`: nothing offered; `master`,
`variant`, `segment`) and the statuses. Run it now with
`curl -X POST -H "Authorization: Bearer $T" http://<host>:7702/run/canary`.

### A catalog row says it is old

The public addon adds "⚠ הקטלוג לא עודכן מאז …" (catalog not updated since …) at the top of a row by itself,
without the home machine: when nothing has been published for more than 36 hours (every row), or when the row's
source has had no good full read (Kan: crawl slice) for more than 48 hours. Both times are rounded down to 6
hours. Look at `https://<addon>/freshness.json` (what the addon compares), the admin `/status` (`publish`,
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
   grep "<playId>" <folder of log.file>/current.log   # the log lines around it (with log.file set)
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

5. **Reproduce.** Fetch the stream list, then the play URL, a variant playlist and a segment with one
   User-Agent; a working play gives 200, 200, 206:

   ```bash
   curl -s http://<host>:7701/stream/series/<video-id>.json | jq -r '.streams[].url'
   ```

## Backups and moving

Every night the daemon copies the catalog database (`data/israel-tv.sqlite`, the one that holds every id and
episode number) to `data/backups/israel-tv-YYYY-MM-DD.sqlite` and keeps the last 7 days (`backup.keepDays`,
`backup.dir`); older copies it made are removed, nothing else is. To go back to a copy: stop the service,
replace `data/israel-tv.sqlite` with it (and delete `israel-tv.sqlite-wal` / `-shm`), start again.

Back up `data/israel-tv.sqlite` (the ids and numbers live there). The addon also serves `/registry.json`
(the id registry) as an off-machine copy. Rendered files are disposable: `publish` recreates them.

A failed upload to Cloudflare shows as `publish` on `/status` (overall health `error`, with Cloudflare's
reason) and is retried after the next run. With a geo proxy, the admin `/status` also has `geo`: the
proxies, and when relaying through them last worked or failed (and why).

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

## Updating

Pull, `pnpm install --prod`, restart the service. Database migrations run on start. (`--prod` leaves out
the development tools, so `pnpm check` needs a full `pnpm install`.) Deploy tooling may write the deployed
git revision to a `.revision` file in the repo root; `/status` shows it (`dev` otherwise).
