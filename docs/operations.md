# Operations

## Commands

`pnpm israel-tv <command>` (or `node apps/ingest/src/cli.ts <command>`; `pnpm israel-tv help` prints this):

| Command                                                                         |                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start [--no-initial-run]`                                                      | The service: schedules, admin, local addon server (local publisher), resolver. Same as `pnpm start`. On start it checks the live channels, publishes, and reads everything if there was no full run in 24 hours; `--no-initial-run` skips only that read. Ctrl-C stops it. |
| `full [--source mako] [--limit N]`                                              | Read every show now. `--limit` is for trying things out: a limited run is recorded apart and does not count as the full run (`/status` says "only a limited test run so far").                                                                                             |
| `airing [--source …]`                                                           | Re-check shows with a recent episode.                                                                                                                                                                                                                                      |
| `show <series-id \| source:key>`                                                | Re-read one Mako or Reshet show, e.g. `show iltv_mako_12`. (Kan shows: `POST /refresh/<id>` on the running service.)                                                                                                                                                       |
| `kan [--limit N]`                                                               | One Kan crawl slice (N pages).                                                                                                                                                                                                                                             |
| `publish`                                                                       | Render and publish now.                                                                                                                                                                                                                                                    |
| `serve [--port N]`                                                              | Render the current data and serve it locally; with the Cloudflare publisher, a preview of what is uploaded (port 7700 by default).                                                                                                                                         |
| `resolver`                                                                      | Only the resolver.                                                                                                                                                                                                                                                         |
| `check-proxy`                                                                   | Checks each configured geo proxy answers and exits in Israel, and says why when not.                                                                                                                                                                                       |
| `match`                                                                         | TMDB/IMDb lookup.                                                                                                                                                                                                                                                          |
| `status`                                                                        | Recent runs and warnings.                                                                                                                                                                                                                                                  |
| `events [--corr C] [--kind K] [--errors] [--since 2h] [--series S] [--limit N]` | Usage and diagnostics events as JSON lines, oldest first (see below).                                                                                                                                                                                                      |

Errors are printed as one line; set `ISRAEL_TV_DEBUG=1` for stack traces.

While `start` runs, prefer the admin endpoints (they queue work behind the running job, so only one process
writes the database): `curl -X POST http://<host>:7702/refresh/iltv_mako_12`. Admin endpoints answer only
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

`http://<host>:7702/usage` (local network) shows unique clients today and per day for the last week (public
addon and home resolver apart), what is playing now, stream requests, plays and failures by source and by
show, the public addon's requests by route, and the latest failures with their reasons.

Behind it is one event per thing that happened, kept 30 days in the database and also written to the log as
`event {json}`:

| `kind`    | Recorded by   | What                                                                                                      |
| --------- | ------------- | --------------------------------------------------------------------------------------------------------- |
| `request` | public Worker | A catalog, meta, stream, search or status request: route, id, status, time.                               |
| `stream`  | resolver      | A stream request: the video id and how many streams were offered.                                         |
| `play`    | resolver      | A play start (Mako): outcome, status, upstream statuses in order, time to the playlist.                   |
| `ticket`  | resolver      | A Mako entitlement (ticket) fetch: outcome, status, time.                                                 |
| `relay`   | resolver      | A relay session through the geo proxy, when it ends: segments, bytes, errors, time to the first playlist. |
| `ingest`  | ingest        | A finished run (full, airing, show, Kan crawl slice, publish, match): status, time, error.                |

The stream request hands out play and relay URLs carrying a correlation id (`?c=…`), so the `stream`, `ticket`,
`play` and `relay` events of one play share their `corr`. Worker requests carry Cloudflare's ray id instead.
No address is stored anywhere: `client` is an HMAC of the address keyed with a secret salt (kept in the
database, and uploaded to the Worker as a secret) and the UTC day, so it counts a viewer once a day and cannot
be turned back into an address or followed across days.

## Investigating a failed play

1. **Find it.** The latest failures, newest first:

   ```bash
   curl -s 'http://<host>:7702/events.json?outcome=error&since=2h' | jq -c '.[] | {at, kind, source, video, status, upstream, reason, corr}'
   # on the machine itself, without the service: pnpm israel-tv events --errors --since 2h
   ```

   For one show: add `&series=iltv_mako_12`; for one kind: `&kind=play`.

2. **Follow the play.** Everything that happened under its correlation id, in order:

   ```bash
   pnpm israel-tv events --corr <corr>
   ```

   A healthy Mako play is `stream` (1+ streams) → `ticket` (ok) → `play` (ok, upstream
   `playlist 200, ticket 200, master 200`). A relayed Reshet or Kan play is `stream` → `relay` (segments > 0).

3. **Read the upstream statuses.**
   - `play` failing with `master 403`: Akamai refused the session token. The master must be fetched with the
     player's User-Agent (the resolver forwards it); a player that changes its User-Agent between the master and
     the segments gets 403 on the segments, which the resolver never sees.
   - `ticket` failing (`Mako entitlement HTTP …` or no ticket): Mako's entitlement service; try the same
     episode in a browser on mako.co.il.
   - `playlist 404`, or `unknown episode`: the episode is gone at Mako, or the database is older than the app's
     catalog — re-read the show: `curl -X POST http://<host>:7702/refresh/<series-id>`.
   - `stream` with `no stream for this id here`: the resolver has no stream for this id (e.g. a Reshet episode
     with no geo proxy configured — the public addon offers its direct stream).
   - `relay` with errors and `segments: 0`: the geo proxy. `pnpm israel-tv check-proxy`, and `geo` in `/status`.
     `upstream HTTP 403` through the proxy usually means its exit is not in Israel.

4. **Public addon side.** `kind=request` events show what the app asked the public addon and what it got:
   `curl -s 'http://<host>:7702/events.json?kind=request&series=<series-id>&since=1h'`. They arrive up to 10
   minutes late (pulled from Workers Logs).

5. **Reproduce.** Fetch the stream list, then the play URL, a variant playlist and a segment with one
   User-Agent; a working play gives 200, 200, 206:

   ```bash
   curl -s http://<host>:7701/stream/series/<video-id>.json | jq -r '.streams[].url'
   ```

## Backups and moving

Back up `data/israel-tv.sqlite` (the ids and numbers live there). The addon also serves `/registry.json`
(the id registry) as an off-machine copy. Rendered files are disposable: `publish` recreates them.

A failed upload to Cloudflare shows as `publish` on `/status` (overall health `error`, with Cloudflare's
reason) and is retried after the next run. With a geo proxy, the admin `/status` also has `geo`: the
proxies, and when relaying through them last worked or failed (and why).

## Updating

Pull, `pnpm install --prod`, restart the service. Database migrations run on start. (`--prod` leaves out
the development tools, so `pnpm check` needs a full `pnpm install`.) Deploy tooling may write the deployed
git revision to a `.revision` file in the repo root; `/status` shows it (`dev` otherwise).
