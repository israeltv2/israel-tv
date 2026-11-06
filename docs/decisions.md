# Decisions and measurements

What was measured, what it showed, and what it decided. Dates are when measured. Measurements were taken
from a home connection outside Israel unless stated; "through Israel" means through an HTTPS proxy with an
Israeli exit (a commercial VPN's proxy service, datacenter address in Tel Aviv).

## Toolchain (2026-11-06)

- **Drizzle:** the stable release (`drizzle-orm` 0.45.4) has no `node:sqlite` driver; `1.0.0-rc.5` ships
  `drizzle-orm/node-sqlite`, and `drizzle-kit` 1.0.0-rc.5 generates SQLite migrations correctly. Both pinned at
  `1.0.0-rc.5`. Migrations are applied at startup by Drizzle's migrator.
- **Tests:** Vitest 5 everywhere. The Worker is a thin wrapper around the same Hono app the local server
  runs, and that app is tested in Node (`app.request()`), so `@cloudflare/vitest-pool-workers` (which still
  requires Vitest 4) is not needed. The Worker entry itself is typechecked against the Workers types.
- **pnpm 12** needs `allowBuilds` for `esbuild` and `workerd`, or a frozen install fails in CI.
- **Source boundaries:** responses are parsed with zod `looseObject` (unknown fields are ignored, because the
  sites send hundreds), while every field we use is validated strictly. A change at a site fails with the
  path of the field that changed.

## Spike 1a: Kan pages in a real browser through Israel (2026-11-06)

Installed Google Chrome driven by `playwright-core`, headed, window off-screen, locale `he-IL`.

- `/lobby/kan11/`, `/lobby/kan-box/` and kankids lobbies load (200, real content) **on the first navigation
  of a fresh browser context**.
- In the same context, later `kan.org.il` pages get a Cloudflare challenge ("רק רגע...", 403) that does not
  clear by waiting (45 s). A persistent profile (keeping cookies) does not help. We do not script the
  challenge's checkbox: that would be defeating the bot wall rather than browsing normally.
- With a commercial VPN proxy, about 10 browser sessions within a few minutes made the provider answer
  **407 on every server for the same credentials for 30+ minutes** (a temporary lockout, confirmed by the
  provider-side check). Blocking images, fonts and media cuts proxy connections per page.
- Decision: **Kan is read by a budgeted crawler** — one fresh browser context per page, a pause between
  pages (75 s), a few pages per slice (5) every 10 minutes, and a 45-minute back-off on a challenge or a
  proxy refusal. See "Kan VOD" below.

## Spike 1b: stored Kan stream URLs (2026-11-06)

12 Redge URLs (`r.il.cdn-redge.media/.../Manifest.ism/playlist.m3u8?fmp4`) taken from episode pages
published days earlier:

- Directly from outside Israel: **403** for all 12.
- Through Israel: **200/200/206** (master/variant/segment) for all 12.
- The URLs carry no token or expiry. Decision: store them; they play directly inside Israel, and outside
  Israel the private resolver relays them through the geo proxy (playlists and segments).

## Spike 1c: deploy time on workers.dev (2026-11-06)

`wrangler deploy` of a Hono Worker with static assets, using an API token.

| Case             | Assets                            | Time                                     |
| ---------------- | --------------------------------- | ---------------------------------------- |
| First deploy     | 1                                 | 14 s                                     |
| Bulk upload      | 5,000 (meta + per-season streams) | 29 s (assets 14 s)                       |
| One file changed | 5,000 (4,999 already uploaded)    | 15 s (assets 1.4 s; Worker upload ~11 s) |

The changed file was served immediately. Decision: **publish with `wrangler deploy` after each run**;
only changed files upload. Files are written only when their content changes, so a run that changes
nothing does not deploy at all.

## Spike 1d: search CPU on the free plan (2026-11-06)

1,500 Hebrew titles, normalized (niqqud, geresh/gershayim, final letters, punctuation), substring scan.

- Local: building the index 3.2 ms; a query 0.3–0.9 ms.
- Cloudflare (`wrangler tail` `cpuTime`): **0–2 ms per search request**, cold isolates included.
- Decision: the search index is a static asset (`search.json`, pre-normalized at publish), read by the
  Worker once per isolate and scanned linearly. No database.

## Mako (2026-11-06)

- **Full run, polite:** 663 shows in the index, **1,044 requests in 24 minutes** at one request per second
  per host. Result: 510 shows with episodes, 884 seasons, 23,861 episodes. Playback URLs are not
  fetched during ingest (the resolver gets them at play time), which is why a full run is ~1,000 requests,
  not the 25–50k a per-episode playlist fetch would cost.
- **One show** = 1 request plus 1 per older season. **Airing check** = 1 request per show (the show page
  carries the current season's episodes).
- **Season numbers:** `עונה N` → N; year titles (`עונה 2025`, `2025`) → the year, read from the title (a
  page URL can disagree: `uvda-2024` is titled `עונה 2025`); anything else ("VIP 5", "נבחרת החלומות") →
  stable numbers from 101 in the order first seen. Measured on the full run: 610 numbered, 83 year,
  24 named, 167 single-season.
- **Episode numbers:** the printed `פרק N`; otherwise the next number after the season's highest, in air-date
  order (daily shows list newest first). Ad slots are dropped before numbering. 50 duplicate printed
  numbers were found at the source; the later one gets the next free number and a warning.
- Numbers are stored and never change (viewer apps key watch progress by id + season + episode). A source
  renumbering is reported on `/status`, not applied.
- **Playback:** the entitlement ticket (`entitlementsServicesV2.jsp?et=gt&lp=<url>&rv=<cdn>`) lasts about
  15 minutes, and Akamai binds the variant token to the User-Agent that fetched the master (same UA → 200,
  any other → 403). The resolver hands out its own URL and, on each open, gets a fresh ticket and fetches
  the master with the player's User-Agent. Verified: master/variant/segment 200/200/206 from outside Israel.
- 4 shows list a season whose page is gone (404); such a season is skipped with a warning instead of
  failing the show.

## Reshet 13 (2026-11-06)

- Show list: `__NEXT_DATA__` of `/all-shows/all-shows-list/` (271 entries; one has no link and is skipped).
- Two page templates: newer `VodPlaylist` pages carry every season; older pages carry a season list plus the
  current season, with the others at `/allshows/series/<id>/season/<n>/`.
- Video: Kaltura partner 2748741. **Every sampled entry (40/40) has access-control profile 3387861, which
  blocks playback outside Israel** — but only the master playlist (`playManifest`) is gated: its variant and
  segment URLs are signed CloudFront links (about 24 h) that played directly from outside Israel (200/206).
  Decision: publish the `playManifest` URL (plays inside Israel); outside Israel the resolver fetches just
  the master through the geo proxy, and video flows directly.
- The block check costs one Kaltura call per show (`baseEntry.list` with `idIn`), plus one playback-context
  call per access profile per run.
- The site answers intermittent 403s; the fetcher retries 403 with backoff.

## Live channels (2026-11-06)

16 channels. Direct ones answered master/variant/segment 200/200/206 from outside Israel at the time
(Kan 11, Kan Educational and Makan included, though Kan's live streams are known to be geo-blocked at
times — the resolver adds a relayed stream for them when a geo proxy is configured). Channel 14's primary
host did not answer; its Redge stream is listed first. Keshet 12, 24 and the Mako 24/7 channels need a Mako
ticket and are played through the resolver.

## TMDB / IMDb (2026-11-06)

Exact matches only: an Israeli show (origin IL or Hebrew) whose Hebrew or original title normalizes to ours,
and exactly one such result. On 510 Mako shows: 128 matched, 62 with an IMDb id. Only numbered seasons are
answered for `tt…`/`tmdb:…` ids, because year and named seasons do not line up with TMDB's numbering.
Misses are retried after 30 days.

## Kan VOD (2026-11-06)

- Lobbies list show pages; show pages list episode pages; **only an episode page carries its video**
  (a `data-redge-config` JSON with the Redge HLS URL, title, season number and series name). So every
  episode costs one browser page, i.e. one fresh browser session.
- With the pacing above (5 pages per 10 minutes, ~720 pages a day at most), the first fill of Kan 11 and
  Kan Educational (a few thousand episode pages) takes days; after that, new episodes cost a few pages a
  day (show pages of airing shows are re-read every 6 hours, others weekly). Progress is kept in the
  store, so restarts lose nothing, and `/status` shows how many episode pages are still waiting.
- Kan has no air dates on these pages; episodes are numbered in Kan's page-id order (publication order).

## Storage and publishing

- Home SQLite is the source of truth: id registry (never reused), numbering, last good data, runs, warnings,
  crawl state. The registry is also published (`/registry.json`) as an off-machine backup.
- Rendered files: one meta file per show, catalog pages of 100, one stream file per season (to stay far
  below the free plan's 20,000 files per version), `search.json`, `ext-ids.json`, `status.json`.
- A failed or thin read never replaces last good data: a show with half its episodes gone is rejected, an
  index with less than 80% of the previous shows is rejected, and a season that reads empty keeps its
  episodes. Failures show on `/status` and as a labelled first item in the affected catalog row.
- D1 stays the documented fallback behind the same publish step; it was not needed (search CPU 0–2 ms).

## Reviews

### Code and security review, round 1 (2026-11-06)

Code review (high) found 10 issues in the Kan crawler and status (episodes lost on a block, a browser
launch failure leaving a run open, "airing" never expiring, a lobby budget bug, failures not shown) — all
fixed. Security review: no finding at the exploitability bar; hardened anyway: the relay re-checks the host on
every redirect, Mako media/ticket URLs must be https on Mako's CDNs, the local server's path check includes
the separator.

### Live data, first deploy (2026-11-06)

The first full run on the deployment machine failed 41 Reshet shows: 21 list the same Kaltura entry twice
(now de-duplicated before numbering) and 15 have a show page with an empty article grid (no VOD; now read as
a show without episodes, not a layout change). Cloudflare's static assets redirect a literal `=` in a file
name, so later catalog pages are stored as `skip-N` and served by the Worker.

### Intuitiveness review, round 1 (2026-11-06)

Three fresh agents, each with only an export of the repository: (1) in Israel, home only, no Cloudflare;
(2) outside Israel with a generic authenticated proxy (mocked); (3) a public Cloudflare instance (mocked
credentials). Each followed the README from zero and ran what could run.

Real friction found, and what changed:

- `.env.example` was missing (the `.env.*` ignore rule caught it) — committed.
- `corepack` is absent on some Node installs — README gives the `npm i -g pnpm@12.15.0` fallback and the
  exact Node minimum.
- Writing `"publisher": { "port": … }` failed for lack of `type` — every section's `type` now defaults.
- The default port 7000 is taken by macOS AirPlay — defaults moved to 7700/7701/7702.
- `start` printed `0.0.0.0` URLs, crashed on a busy port after it had begun publishing, and `--help` threw —
  ports are opened first with a message naming the option, the log prints LAN addresses, `--help` works.
- A `--limit` test run suppressed the real first fill; live channels showed "warn" until the night —
  limited runs are recorded apart; live channels are checked on start; `start --no-initial-run` exists.
- Proxy setup: what it is for, that the resolver must be installed, and how a failure looks were unclear;
  invalid proxy URLs were accepted — README section rewritten, `check-proxy` command, per-type URL
  validation, missing-secret errors name the option and the `.env` path, a proxy failure gives a 502 and
  one log line. The relay is now offered for every Reshet/Kan episode when a proxy is configured (whether an
  episode is blocked depends on the viewer's location, not on where ingest ran).
- What friends of a public instance can play was not said — "Sharing with friends" section; manifest
  description lists only enabled sources.
- Cloudflare steps were thin; a failed deploy printed colour codes and a stack and never showed on
  `/status` — exact token template and where the account id/subdomain are, plain error with a hint, failed
  publishes recorded, retried and shown; `serve --port` previews a Cloudflare build.
- systemd/Docker examples were not usable as is — setup commands in the unit's header, Docker runs as
  `node`, compose paths explicit, admin port bound to the host only (behind Docker's port mapping every
  client looks local), a Cloudflare variant of the Docker config.
- `CLAUDE.md`, `.paradev/` and `spikes/` looked like personal leftovers — kept (contributor tooling and the
  measurement scripts behind this file), now labelled as such in the README and `CLAUDE.md`; excluded
  from the Docker image.

Not changed: live channel logos (none published by a stable source), English search (titles are Hebrew).

### Code review, round 2 (2026-11-06)

10 more findings, all fixed: the early stop for blocked runs now counts consecutive blocks for every
source; a show's first save and the Kan backlog no longer count as "new" for newest-first ordering; admin
refuses cross-site requests (a web page could trigger runs) and refresh is POST only; startup publish goes
through the queue; `writeSite` never cleans a folder it did not create, and the config refuses a publish
folder that holds the database or log; no backoff sleep after the last retry; a Kaltura API failure no
longer fails Reshet shows; Kan shows can be refreshed one at a time; Kan numbering warnings are recorded;
status timestamps alone no longer trigger a deploy.

### Simplify pass (2026-11-06)

Four cleanup reviews (reuse, simplification, efficiency, altitude) over the whole codebase. Applied: shared
helpers instead of copies (Mako playlist URL, enabled sources, Kan options, run status, relay host check),
dead code removed (including change tracking that serialised every show twice per run and was never read),
`buildStatus` driven by a per-source table instead of scattered special cases, publish reads shows and
numbering once instead of two queries per show, `count(*)` instead of parsing shows to count them, bulk
warning inserts, linear episode numbering, a resolver cache of parsed episodes per show. Skipped: a shared
HTTP helper between the addon and the resolver (would couple the two packages), a generic run wrapper,
incremental rendering of only changed shows (a design change, not a cleanup).

### Intuitiveness review, round 2 (2026-11-06)

Same three personas, fresh export after the round 1 fixes. Verdicts: inside Israel and outside Israel —
"a stranger could succeed from the README alone"; public Cloudflare — "about 80% of the way".

Fixed from round 2:

- CLI: option typos and other user errors are one line (stack traces only with `ISRAEL_TV_DEBUG`); an
  unknown `--source` is an error instead of a silent no-op; Ctrl-C logs "stopped" and exits cleanly;
  `status` and `serve` do not need every service's secrets; `serve` renders the current data first.
- Proxy: a wrong login is reported as such (undici hides a refused CONNECT as "Request was cancelled", so a
  failed relay asks the proxy directly what it answered); host-not-found, refused, timeout, TLS and
  "use http:// for this proxy" are explained in words; credentials written into a proxy URL are moved out of
  it and never printed; relay failures show under `geo` on the admin `/status`; startup logs the proxies;
  the relayed stream is labelled "דרך ישראל · via Israel".
- Cloudflare: the publish failure on `/status` carries Cloudflare's reason (wrangler's colour codes
  stripped); the Docker image is writable for wrangler as the `node` user; startup prints where the
  public addon will be; README: choosing the workers.dev subdomain, free-plan limits, a public / home /
  admin table, and the complete list of what friends cannot play.
- The manifest claims IMDb/TMDB ids only when some show is matched (otherwise apps would query the addon
  for every title).
- Docs: `--no-initial-run` in the quick start, the pnpm "awaiting approval" notice, proxy URL scheme, the
  operations command table matches `help`, clearer service-file placeholders.

### A numbering bug caught on live data (2026-11-06)

Within the first hour of the deployment, a check of the daily shows found the 2026 season of the morning
news numbered backwards ("פותחים את שנת 2026", 01.01.26, was episode 212). On daily-show seasons Mako's
`extraInfo` is a bare date (`05.11.26`), not `פרק N@date`, and the reader only took the date after `@`;
without dates the season was numbered in list order, which is newest first. Fixed (with the real page as a
fixture). Because no viewer had used the addon yet, Mako's episode numbers were reset once and assigned
again from correctly dated data; series ids were kept. From here on numbers are permanent as designed.
