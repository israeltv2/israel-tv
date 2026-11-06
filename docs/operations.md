# Operations

## Commands

`pnpm israel-tv <command>` (or `node apps/ingest/src/cli.ts <command>`; `pnpm israel-tv help` prints this):

| Command                            |                                                                                                                                                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start [--no-initial-run]`         | The service: schedules, admin, local addon server (local publisher), resolver. Same as `pnpm start`. On start it checks the live channels, publishes, and reads everything if there was no full run in 24 hours; `--no-initial-run` skips only that read. Ctrl-C stops it. |
| `full [--source mako] [--limit N]` | Read every show now. `--limit` is for trying things out: a limited run is recorded apart and does not count as the full run (`/status` says "only a limited test run so far").                                                                                             |
| `airing [--source …]`              | Re-check shows with a recent episode.                                                                                                                                                                                                                                      |
| `show <series-id \| source:key>`   | Re-read one Mako or Reshet show, e.g. `show iltv_mako_12`. (Kan shows: `POST /refresh/<id>` on the running service.)                                                                                                                                                       |
| `kan [--limit N]`                  | One Kan crawl slice (N pages).                                                                                                                                                                                                                                             |
| `publish`                          | Render and publish now.                                                                                                                                                                                                                                                    |
| `serve [--port N]`                 | Render the current data and serve it locally; with the Cloudflare publisher, a preview of what is uploaded (port 7700 by default).                                                                                                                                         |
| `resolver`                         | Only the resolver.                                                                                                                                                                                                                                                         |
| `check-proxy`                      | Checks each configured geo proxy answers and exits in Israel, and says why when not.                                                                                                                                                                                       |
| `match`                            | TMDB/IMDb lookup.                                                                                                                                                                                                                                                          |
| `status`                           | Recent runs and warnings.                                                                                                                                                                                                                                                  |

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
