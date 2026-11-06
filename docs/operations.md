# Operations

## Commands

`pnpm israel-tv <command>` (or `node apps/ingest/src/cli.ts <command>`):

| Command                            |                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `start`                            | The service: schedules, admin, local addon server (local publisher), resolver. Same as `pnpm start`. |
| `full [--source mako] [--limit N]` | Read every show now.                                                                                 |
| `airing [--source …]`              | Re-check shows with a recent episode.                                                                |
| `show <series-id \| source:key>`   | Re-read one show, e.g. `show iltv_mako_12`.                                                          |
| `kan [--limit N]`                  | One Kan crawl slice.                                                                                 |
| `match`                            | TMDB/IMDb lookup.                                                                                    |
| `publish`                          | Render and publish now.                                                                              |
| `serve`                            | Only serve the rendered files (local publisher).                                                     |
| `resolver`                         | Only the resolver.                                                                                   |
| `status`                           | Recent runs and warnings.                                                                            |

While `start` runs, prefer the admin endpoints (they queue work behind the running job, so only one process
writes the database): `curl -X POST http://<host>:7002/refresh/iltv_mako_12`.

## Status

`http://<host>:7002/status` (local network) and `/status` on the addon (public copy, HTML; `/status.json`
for JSON). Health per source:

- **ok** — last full run fine and less than 36 hours old.
- **warn** — partial run (some shows failed; their last good data is still served), Kan crawl backing off,
  or no run yet.
- **error** — last full run failed, nothing succeeded in 36 hours, or a source has no shows. The affected
  catalog row gets a "⚠" first item with the reason.

`failingShows` lists shows whose last read failed (still served from last good data); `warnings` lists
numbering conflicts, renumberings at the source, thin results and dead season links.

## Backups and moving

Back up `data/israel-tv.sqlite` (the ids and numbers live there). The addon also serves `/registry.json`
(the id registry) as an off-machine copy. Rendered files are disposable: `publish` recreates them.

## Updating

Pull, `pnpm install --prod`, restart the service. Database migrations run on start.
