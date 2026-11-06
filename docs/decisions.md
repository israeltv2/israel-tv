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
- **Season numbers:** `עונה N` → N; year titles (`עונה 2025`, `2025`) → numbered by position, oldest = 1,
  after the show's real season numbers, ordered by the year in the title (a page URL can disagree: `uvda-2024`
  is titled `עונה 2025`) — until 2026-11-06 they took the year itself (see below); anything else ("VIP 5", "נבחרת החלומות") →
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
and exactly one such result. On 510 Mako shows: 128 matched, 62 with an IMDb id. Numbered and year seasons
(1, 2, … by position) are answered for `tt…`/`tmdb:…` ids; named seasons (101+) never line up with TMDB's.
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

### Intuitiveness review, round 3 (2026-11-06)

Same three personas on a fresh export. Verdicts: **no real friction** for all three setup paths (in Israel
at home; outside Israel with a proxy — including a mocked wrong login, unknown host and wrong scheme, all
explained in words and shown on `/status`; public Cloudflare — failure reason shown, token never printed).
What remained were nits, now done: a Docker note on which address to install, `serve --port` in the
README, the proxy example uses `http://`, a cleaner unknown-option message, the next full-run time in the
`--no-initial-run` message, "1 show".

One real data problem surfaced in round 3 and is fixed: Reshet's older page template gives some shows'
episodes the show's own start date (every episode of a daily show dated 2017-03-28) and counts its episode
numbers newest = 1. Dates now come from the title first, and when all episodes share one start date, from
their upload date. Generally, printed episode numbers that run against the air dates are ignored and the
season is numbered by date (warning `numbers-reversed`). As with Mako earlier the same day, Reshet's episode
numbers were reset once before anyone used the addon.

### Code review, round 3 (2026-11-06)

A full-codebase review after the round 2 and simplify changes found 11 defects; all fixed:

- A Reshet layout change would have read as "no VOD" and cleared the shows' errors — a known show that
  suddenly reads as having no seasons is now a failed read (last good data kept, shown on `/status`).
- `serve` (preview) wrote into the Cloudflare build folder, so a following `publish` saw nothing to deploy —
  with Cloudflare it now renders into a separate `preview` folder.
- Kan: a failed first read of a show page later made its whole backlog look "new"; a refresh requested
  during a running slice was lost — first-read failures are tracked apart, and refreshes are kept in memory
  and read first by the next slice.
- Warnings repeated on every run (and `numbers-reversed` per run per season) — identical warnings for a
  show are recorded once; warnings and runs older than 60 days are pruned.
- The relay reported success to `/status` when the upstream refused (403) — it now reports the HTTP status.
- `/status` said "never succeeded" after one failed night — the 36-hour check uses the last good run ever.
- Kan with `browser.type: none` kept health at warn forever — Kan is listed only when it can run.
- Admin was reachable through DNS rebinding — the Host header must be an IP, `localhost`, a dotless name or
  a `.local`/`.lan`/`.home.arpa`/`.internal` name.
- Proxy fail-over blamed every proxy after a timeout, probed the wrong port for http targets, and kept 407
  connections open — fixed.
- **Reshet season keys used the season title**, so a renamed season would have moved its new episodes to
  season 101+ — keys now use Reshet's own season id (map key / position). Reshet's season and episode numbers
  were reset once more (before any viewer used them) so all keys follow the new scheme.

### Code review, round 4, and security review, round 2 (2026-11-06)

Security: no qualifying vulnerabilities; the one near miss (the Mako master fetch followed redirects
without re-checking the host, reachable only if Mako itself were compromised) is closed — redirects are
followed by hand on Mako's CDNs. Code review round 4 found 8 defects, all fixed: pruning old runs broke a
foreign key and could stop startup (warnings are now pruned first, and pruning never blocks startup or
publishing); a season read with exactly two dated episodes counted newest = 1 was numbered backwards (the
check now works from two episodes; numbers were reset once more before anyone used the addon); scraped data
is cleaned (junk image paths, zero durations) and validated before it is stored, so one bad show cannot
make the catalog unreadable; a Kan refresh no longer hides new episodes or pauses a show for a week, is kept
across a back-off, and a Kan show page that suddenly lists no episodes is a failed read (slices with
unreadable pages are "partial"); after a container restart, runs of the previous process (same pid 1) are
closed; a publish requested while one is running is no longer dropped.

### Code review, round 5 (2026-11-06)

4 findings, all fixed: a Kan refresh during a back-off re-started the crawl in a tight promise loop and froze
the daemon (reproduced; now the next scheduled slice takes it); a known show whose every season read empty
in a full read was saved as a success (now a failed read, as for "no seasons"); a Kan show's "page lists no
episodes" error never cleared (a later good read clears it); a single-show refresh dropped the show's
poster (now kept).

### Code review, round 6 (2026-11-06)

During this round a reviewer's scratch test called the publish step without the project's Cloudflare token.
wrangler then fell back to a login stored on the development machine and created a worker in a different
Cloudflare account. That worker was deleted minutes later (it had not existed before). The publish step now
refuses to deploy unless the configured token and account id are set, and runs wrangler with a home folder
of its own, so a login stored on the machine can never be used.

Findings, all fixed: a browser that cannot load pages at all (proxy refusing the tunnel, browser missing)
was treated as broken pages instead of a block — it now makes the slice back off; Mako shows matched to
IMDb/TMDB got no streams when opened from other catalogs — the resolver now answers `tt…`/`tmdb:…` ids for
matched shows (numbered seasons only); publish render/write failures (disk full, permissions) did not show
on `/status` — they are recorded as failed publishes for both publishers; status timestamps alone caused a
deploy after every quiet airing check — files are compared without timestamps.

### Code review, round 7 (2026-11-06)

4 findings, all fixed: a Kan refresh was dropped when its slice was blocked before reaching the show (it is
now kept until its show page is actually read); two series matched to the same TMDB/IMDb id were answered
differently by the Worker and the resolver (a second match is not assigned, and an id held by two series is
answered by neither); a Kan lobby that loads but lists no shows was accepted silently (warning, slice
partial, retried); the "Israel only" label depended on where ingest ran — Reshet episodes on the access
profile measured as Israel-only (3387861) are labelled wherever ingest runs, and Kan VOD, geo-blocked per
title nearly always, is labelled Israel-only without a per-episode probe.

### Code review, round 8 (2026-11-06)

4 findings, all fixed before they touched stored data: refreshing a Kan show whose page fails (e.g. a
removed show) re-ran slices back to back (a refresh now counts as done once its page was tried without a
block); a video embedded in a Kan show page was keyed by a per-render container id, which would have added a
duplicate episode on every re-read (now keyed by Kan's video id from the stream path; no such episode had
been stored yet); a restart during the first full run left later sources empty until the night (startup now
runs the full read when any source has had no good run in a day); a failed TMDB matching run (e.g. a revoked
key) did not show on `/status` (now a `tmdb` note and health warn).

### Code review, round 9 (2026-11-06)

3 findings in the Kan crawler, all fixed: kankids episode links whose season segment is Hebrew (`עונה-3/`)
were dropped (any single segment is now accepted); a show page's embedded player could be saved as a
duplicate episode (a page video is saved only for a show with nothing stored yet, and a known show whose
page lists no episodes is a failed read whether or not it embeds a player); a page budget of 1 never got past
the first lobby (the budget is at least 2). Kan's stored data (20 episodes, collected in the first hours)
was cleared once and crawled again, so the missing kids seasons are numbered in Kan's page order.

### Code review, round 10 (2026-11-06)

One finding, a regression from round 9, fixed: a genuine single-video Kan show (its page embeds the video
and lists no episode pages) would have been marked failed on every re-read; the "lists no episodes" check now
skips a show whose one stored episode is the page's own video. Everything else the reviewer checked —
numbering, store, runner, all three readers, the daemon, publishing, rendering, the addon, the Worker, the
resolver and the network layer — was reported sound.

### Code review, round 11 (2026-11-06)

2 findings in the Kan crawler, both fixed before any affected data existed: a premiere or upcoming show whose
page embeds a player before listing its episode pages would have had that video stored as S1E1 and every real
episode shifted by one (a page video is now taken as a single-video show only after two reads at least a day
apart, and an episode page carrying a video already stored from the show page is not stored again); a known
Kan show whose page disappeared stayed healthy on `/status` (it is now marked failing, its data kept).

### Code review, round 12, and a simplification (2026-11-06)

Round 12 found two more defects, both in the logic that stored a video embedded in a Kan _show_ page as a
"single-video show" (an endless re-read of a page whose video was already stored, and a premiere whose
episodes are season 2 shifting that season's numbers). Each fix of that path had produced a new edge case
(rounds 10–12), and the evidence for such shows was thin (the one recorded "single" page also links an episode
page). Decision: **Kan episodes come only from episode pages**, keyed by their stable page id; a video
embedded in a show page is never stored. A known show whose page lists no episode pages is a failed read.
Possible gap: a Kan special published with no episode page of its own would not appear. No such episode had
been stored (checked on the deployment database).

### Code review, round 13 (2026-11-06)

One finding, fixed: Kan episodes have no air dates or printed numbers and are numbered in reading order, so
an episode page that failed once (a transient 5xx) and was read a week later would have been numbered after
all newer episodes. The crawler now never reads past a gap: a failed episode page stays first in its show's
queue, the show pauses, and the page is retried at least two hours apart; only after three tries is it given
up (with a warning) and reading continues. (On the deployment no Kan episode page had failed yet, so nothing
stored was out of order.)

### Code review, round 14 (2026-11-06)

One finding, fixed: pages given up on after the round 13 retries were put back at the head of the queue on
every show re-read with a fresh retry count, so a few dead episode pages could hold back new episodes for days.
Given-up pages now stay given up (persisted, never re-queued).

### Code review, round 15 (2026-11-06)

One finding, fixed: a few hours of Kan server errors (5xx, rate limiting) counted as tries against the
episode page at the head of each show's queue, so after three tries it was given up and, since round 14,
never read again — dropping a real episode. Server-side errors now make the slice back off like a challenge,
without charging any page a try; only failures about the page itself (404, no player on the page) count, and
those are retried 12 hours apart, so giving up takes at least a day.

### Code review, round 16 (2026-11-06)

One finding, a regression from round 15, fixed: a single Kan episode page answering 5xx on every try (while
the rest of the site works) made every slice back off and nothing behind it was ever read. Server errors on an
episode page now back off for at most two slices in a row; from the third, they count as that page's own
problem and take the round-13 path (show paused 12 h per try, given up after three), so the crawl moves on.

### Code review, round 17, and one rule for Kan errors (2026-11-06)

Rounds 13–17 each found an edge case in how the Kan crawler tells a broken page from an outage. Round 17's two
(a show page always answering 5xx still stopped all of Kan; an outage of only episode pages for about a day still
used up a page's tries) led to one rule replacing the per-case ones: **a page is charged a failure only when
another page loads normally in the same slice.** A server error on one page makes it a suspect; if the next page
loads, the suspect is charged (a show page: skipped for a week and shown as failing; an episode page: its show
pauses 12 h, given up after three tries); if the next page also answers a server error, the site is down and
the slice backs off without charging anyone. A page that can never be compared (nothing else to read) is
charged after three days of failing alone. Challenges, proxy refusals and a browser that cannot load pages
still back off immediately. 404s and pages without a player count as that page's own problem at once.

### Code review, round 18 (2026-11-06)

Two findings on the round 17 rule, fixed: (1) a page answering a server error as the last page of a slice had
nothing after it to be compared with, so it waited days for the "failing alone" fallback while `/status` stayed
green; (2) a page of kan.org.il loading was taken as proof that kankids.org.il was up. The comparison is now per
site, and a suspect still open at the end of a slice is settled by loading its site's lobby (loads → the page is
charged; fails → the site is down, back off). That replaced the three-day fallback. Every try is now a warning,
and a Kan run is `partial` while any show waits to retry an episode page.

### Code review, round 19 (2026-11-06)

Two findings, fixed: (1) the round 18 lobby probe compared a failing _episode_ page with the lobby, which can load
while every episode page fails, so an episode-only outage could still use up a new episode's tries. Suspects are
now compared like with like: show pages with show pages or the lobby, episode pages with episode pages (at the end
of a slice, the last episode page of that site that loaded). With nothing comparable, the page stays uncharged
and the run is `partial` saying so. (2) A failing lobby stopped every slice, on both sites; a lobby that fails is
now a warning, skipped, and read again next slice, while known shows carry on.

### Code review, round 20 (2026-11-06)

Two findings, fixed: (1) any error thrown while loading a page (a 60 s timeout, a redirect loop, an empty
response) counted as a dead browser, so one such page stopped Kan for good. Now only a browser that does not
start, or a proxy, network or browser-closed error, backs off at once; other load errors go through the suspect
rule like a server error. (2) A show first seen in a lobby after the first lobby read (a premiere) was re-read only
weekly, so its next episodes came up to a week late; such shows are now airing from the start (6-hour re-reads).

### Code review, round 21 (2026-11-06)

**No real findings.** One item noted below the bar and accepted: when a known Kan show's page fails while that
show still has episode pages waiting, saving the next episode clears the show's "failing" mark; the warning and
that slice's partial run remain, and the page is read again a week later (mostly relevant during the first fill).

### Single-show refresh, verified on the live deployment (2026-11-06)

No new Mako episode was due (Friday), so the refresh path was exercised on live data instead. On the deployment,
the newest episode of one Mako show (a daily news show, S2026E212, aired 5 Nov) and one Reshet show (S1E94,
aired 6 Nov) were removed from the store (both the show data and the stored number, as before they arrived; the
database was backed up first) and the site was published; both were then gone from the public meta. Then
`POST /refresh/<id>` on the LAN admin port:

| Show   | Back in public meta (from the POST) | Number      | Play-check (master/variant/segment)                   |
| ------ | ----------------------------------- | ----------- | ----------------------------------------------------- |
| Mako   | 63 s                                | S2026E212 ✓ | 200/200/206 via the resolver                          |
| Reshet | 31 s                                | S1E94 ✓     | 200/200/206 via the public addon and via the resolver |

Both came back with their original numbers. The time is almost all the Cloudflare upload. During the test
Cloudflare's API answered "no healthy upstream" for about 8 minutes; publishing failed visibly (`/status`:
health error with Cloudflare's reason) and succeeded on retry. The hint printed with that failure blamed the
token and account id; it now says when the problem is on Cloudflare's side.

The natural test (a newly published episode appearing through the hourly airing run) is still pending: it needs
a broadcaster to publish one. It shows on `/status` as the latest airing run's new episodes, and in the app as
the show moving to the top of its row.

### Supervisor review after the final report (2026-11-06)

- **Kan Kids/Teens row.** The row (`iltv_kankids`, "כאן חינוכית: ילדים ונוער") existed but was left out of the
  manifest while it had no shows: the Kan crawl reads Kan 11's shows first, and on the first day all 50
  Kids/Teens shows were still unread. An empty row of a running source is now always in the manifest, with a
  first item "⏳ עדיין בטעינה" (still loading) until its first show arrives, instead of being left out. A row of a
  source that is off (or Kan without a browser) stays out.
- **Reshet shows without episodes.** Reshet's index lists 270 shows (the 267 of an earlier export); 225 have
  episodes and are in the catalog. The other 45 pages have no episode list: checked by hand on two of them
  (empty `Base` and `PaginationArray` grids, no posts at all) — mostly foreign formats Reshet airs without VOD
  rights. 16 of them were already noted; the other 29 were skipped with only a count in the log. Now every such
  show gets a `source-note` warning, and each complete full read saves the list, which `/status` names per
  source ("N shows listed by the site have no episodes on their page, so they are not in the catalog: …").
  Health stays ok: it is the site's content, not a failure. The same applies to Mako.
- **Cloudflare deploy path.** The only deploy path is `publish.ts` `deployCloudflare`: it refuses to run unless
  the configured token and account id variables are set, and runs wrangler with an environment built from
  scratch (PATH, the token, the account id) and a HOME of its own under the data folder, so no stored wrangler
  login on the machine can be seen or used. No other script, package script or CI step calls wrangler. On the
  deployment, that HOME holds no OAuth login. The stray Worker created on a personal account by an earlier
  review test is deleted: its workers.dev URL answers 404.
- **`/simplify` on the Kan crawler** (after rounds 13–20; four read-only reviewers: reuse, simplification,
  efficiency, altitude). Applied, behaviour unchanged (all tests unchanged and green): `load()` now throws a
  typed error saying what a failure means (`outage` / `suspect` / `page`) instead of a hidden `blocked` counter
  every catch had to check first, and one `triage` helper handles show and episode pages; one `warn` helper for
  the six warning sites; the episode key built with `kanEpisodeKey`; shared time constants; the series lookup
  moved after the "is this show due" check (one query per known show per slice saved) and done once per show in
  the episode loop; an explicit `stopped` flag instead of matching the note's wording; one batch item type;
  stale comments fixed; tests typed against `PageLoader` (21 casts gone) with a shared episode helper.
  Skipped: a shared `failing()` loader helper and one crawl-state type for the tests (readability only).

## Round 2 (2026-11-06)

### Reshet start-up time, direct vs relayed (measured)

The owner's first TV test: Reshet (חדשות היום) took long to start. Measured from the home network, time from
the stream URL to the first segment's first bytes (master, variant, first segment; 3 runs each):

| Path                                                | Time        |
| --------------------------------------------------- | ----------- |
| Direct (public addon: Kaltura `playManifest`)       | 1.39–2.15 s |
| Relayed (resolver, "via Israel", through the proxy) | 1.39–2.27 s |

Both are the same because only Kaltura's manifest goes through the proxy; the segments come straight from
Kaltura's CDN (`cfvod.kaltura.com`, not a relayed host). The news episode's master has four variants up to
720p, 2-second segments; its first segment (178 KB) downloads in 0.42 s. So nothing on the network path explains
a slow start; the TV's own play events (round 2, item A) now record the time to the first playlist for every
play, so the next slow start can be looked up instead of guessed.

What changed anyway: the resolver offered the relayed stream for every Reshet and Kan episode, even at home
where nothing is blocked, so the app listed two streams and might pick the one with an extra hop. Now the
resolver (which runs on the viewer's network) tries the direct stream first and offers the relay only when it is
refused (401/403/451, or no answer within 4 s), cached per show (or live channel stream) for 6 hours. At home
in Israel, Reshet and Kan play straight from the CDN and the "via Israel" stream no longer appears. Kan is
treated the same way (its blocks are per title, so the probe is per show).

### Addon branding

The owner's logo, resolver logo and background are the project's branding (`assets/branding/`). The logos had
truly transparent corners (alpha 0); their artwork was not centred on the 1024 canvas (near-invisible alpha
pixels reached the left edge), so they were trimmed to their visible pixels (alpha > 24), centred on a square
with a 4% margin, and saved as a 1024 px master and a 256 px manifest logo (41 KB). The background (1920×1080
PNG) is served as a JPEG of about 120 KB. The owner replaced the first background (which showed the Dome of the
Rock) with one showing the coast and Jerusalem's walls at night; the current one is used. Anyone running their own instance can drop their own `logo.png`, `resolver-logo.png` and
`background.jpg`/`.png` into `branding.dir` (default `./branding` next to the config).

Image URLs in a Stremio manifest must be absolute, and the address an addon is served from is only known when a
request comes in. Rendered files carry a placeholder origin that the Worker and the local server replace with the
request's origin when serving JSON; without request logs the Worker still runs first for the three kinds of
files that carry images (manifest, the live row, live channel pages).

### Live channel logos

Square 512 px tiles in `assets/logos/`, served as our own static files (`/logos/<channel id>.png`), so the app
never depends on the broadcasters' servers (some refuse requests from outside Israel). Each logo is centred on a
white rounded tile (most are dark ink on transparent), except logos that are their own coloured square, which
fill the tile, and the Knesset Channel's white logo on navy. Sources and licences, checked on each file page:

| Channel(s)               | Source                                                                                         | Licence / status                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| כאן 11                   | Wikimedia Commons, `File:Kan11Logo.svg`                                                        | Public domain (PD-textlogo); trademark                                |
| כאן חינוכית              | Wikimedia Commons, `File:KanHinuchit.svg`                                                      | PD-textlogo, also tagged CC BY-SA 4.0 (uploader "רונאלדיניו המלך")    |
| מכאן 33                  | Wikimedia Commons, `File:شعار_قناة_مكان.png` (the "مكان" wordmark, without "33")               | Public domain                                                         |
| קשת 12                   | Wikimedia Commons, `File:Keshet12_2018.svg`                                                    | Public domain (PD-textlogo)                                           |
| רשת 13                   | Wikimedia Commons, `File:Channel_13_(Israel)_logo.svg` (2022 design; the 2025 one is not free) | Public domain (PD-textlogo); trademark                                |
| עכשיו 14                 | Wikimedia Commons, `File:Noamperetz-now14logo.png`                                             | CC BY-SA 4.0, "Israeli Channel 14" (uploader's claim, no VRTS ticket) |
| ערוץ 24                  | Wikimedia Commons, `File:Arutz_24_logo.png`                                                    | Public domain (PD-textlogo)                                           |
| ערוץ הכנסת               | The channel's own site, knesset.tv (its share image)                                           | Trademark of the channel, used only to identify it                    |
| ynet                     | Wikimedia Commons, `File:Ynet_website_logo.svg`                                                | Public domain (PD-textlogo); trademark                                |
| i24 (4 languages)        | Wikimedia Commons, `File:LOGO_i24NEWS.png`                                                     | CC BY-SA 4.0, "i24NEWS"                                               |
| ערוץ סברי מרנן           | Wikimedia Commons, `File:סברי_מרנן.jpg`                                                        | Public domain (PD-textlogo)                                           |
| כלכלה 10, ערוץ ארץ נהדרת | No free logo exists (only fair-use files on Wikipedia; the channel site is behind a bot wall)  | Our own text tiles                                                    |

The CC BY-SA files are credited here, which is the attribution they ask for; the tiles made from them are shared
under the same licence.

### Observability (owner's stack, as decided)

- **Logs:** pino JSON lines with child loggers per component (`ingest`, `resolver`, `mako-auth`, `geo-relay`)
  and the ids of what a line is about (`playId`, `showId`, `episodeId`, `source`); pino-roll rotates them daily
  and by size, keeping a fixed number. Redaction is by key (`token`, `password`, `authorization`, …) and, since a
  token can hide inside a URL or an error message, by value too: a pino hook replaces the value of every
  token/password/key/secret from `.env` in every string of every line. A test writes a secret through the real
  file transport and checks it never appears.
- **Events:** `data/events.sqlite`, its own Drizzle schema and migrations, WAL, batched inserts (one transaction
  per ~2 s or 200 events), never written per video segment. Kinds and schema in docs/operations.md. Nightly:
  rollup into `daily_usage`, prune raw events after 30 days and rollups after a year, VACUUM weekly, size cap
  (default 200 MB) with a /status warning. The catalog database lost its `events` table (round 2's first version
  put events there; nothing in it was needed).
- **Public Worker:** Workers Logs (one JSON line per request it answers, `head_sampling_rate` 1, Cloudflare's
  invocation logs off because they keep request metadata) and Workers Analytics Engine (one data point per
  stream request). Catalog browsing is static files and is not counted (accepted by the owner). This also ends
  round 2's first approach (the Worker answering every request so browsing could be logged).
- **One measured deviation:** reading Analytics Engine back needs an API token with "Account Analytics: Read".
  The publishing token does not have it (the SQL API answers "Authorization error"; checked 2026-11-06), and a
  new credential is the owner's call. Until the token gets that permission, the daily public counts come from
  the same Worker's Workers Logs through the observability query API (one aggregate query per level per day:
  count and unique clients by source and show — Cloudflare still does the counting). The daily job tries
  Analytics Engine first and the dashboard says which one answered and why.

### Separation of concerns: ingest, catalog, resolver (mako-auth, geo-relay)

The README has the diagram and table. The resolver's two jobs are now separate modules (`mako-auth.ts`,
`geo-relay.ts`) with their own config switch (`resolver.makoAuth`, `resolver.geoRelay`), their own log component
and their own event component; `app.ts` only answers the manifest and stream requests by asking each module.
The resolver serves no catalogs. **geo-relay stays in the same process as mako-auth** (the default the owner
suggested): it needs no different privileges, both read the same catalog database read-only, a second process
would add a second addon URL to install and a second port to keep reachable, and the separation the owner wants
(scope, config, logs, metrics) is there without it. If the relay ever needs isolating (e.g. a lot of video
traffic), the module can be served on its own port without code changes beyond the wiring.

### Admin page: owner only

LAN-only as before, and a token on top (`ISRAEL_TV_ADMIN_TOKEN`; generated and kept in the catalog database
when not set, printed by `israel-tv admin-url`). Anything without it, including the dashboard, gets a plain
404 — guests on the home Wi-Fi see nothing. A browser opens the link once; the token moves into an HttpOnly,
SameSite=Strict cookie and is removed from the address bar. The admin port is never routed through a tunnel.

### Nightly catalog backup

One rotating copy: every night `VACUUM INTO data/backups/israel-tv-YYYY-MM-DD.sqlite`, keeping 7 days; only
files with that name pattern in that folder are ever removed. (The one-off `before-*` copies made during round 1
were deleted on the deployment with the owner's approval.)

### Artwork that is refused outside Israel is served from our own copy (Kan)

Measured from a non-Israeli exit (a Netherlands proxy, 2026-11-06), three posters per catalog: Mako
(`img.mako.co.il`) and Reshet (`media.reshet.tv`, `media3.reshet.tv`) answer 200; every Kan show image and
episode thumbnail (`www.kan.org.il/media/…`) answers 403 HTML, so Kan tiles were blank abroad. Kan's artwork is
also refused to plain HTTP clients from Israel (the same bot check as its pages), so it is fetched by the Kan
crawler's browser, in the same session as the show page, scaled on a canvas in the page to at most 960 px wide
as a JPEG (no native image library needed), and saved under `data/artwork/`. The publish serves it as
`/art/<series id>.jpg`, and the show's poster, background and episode thumbnails all point at that copy (Kan's
episode thumbnails are refused too; the share image fits the landscape tiles the rows use). Shows read before
this get their copy on a re-read (at most once a day per show until it succeeds). Mako and Reshet keep their own
URLs; a source whose artwork starts being refused abroad would be added the same way.

File budget: the site is about 1,240 files; Kan artwork adds one per show (about 90 for Kan 11 and Kids/Teens),
far below Cloudflare's 20,000 files per Worker.

### Staleness is shown by the catalog itself

Every publish includes `freshness.json`: when the catalog was rendered and each source's last good read, both
rounded down to 6 hours (so the file does not change, and force an upload, on every run, while a quiet catalog
is still re-uploaded at least every 6 hours). The public addon compares them with the time of each request:
when the catalog has not been published for more than 36 hours, or a row's source has had no good read for more
than twice its daily cadence, that row's first page starts with "⚠ הקטלוג לא עודכן מאז …" (catalog not
updated since …), and the item's own page explains it. Because the Worker computes this, it works when the home
machine is down and cannot publish. At home, `/status` also flags a catalog not published for 36 hours (on top
of the existing per-source 36-hour check and its "⚠" item). Cost: catalog row requests now run the Worker (they
count toward the free plan's 100,000 a day; a household browses a few hundred); metadata stays static files.

### Abuse protection on the public addon

Search and stream requests are limited per client: 120 stream requests and 60 searches a minute. That is enough
for a family whose devices all share one home address (opening an episode is one stream request) and stops a
runaway client or a scraper. The key is the salted daily client hash, so no address goes into the limiter
either. Two counters, and a request over either is refused: Cloudflare's Workers rate-limiting binding (available on the
free plan; it counts across locations but is deliberately permissive while it syncs — measured: of about 430
stream requests in a minute from one address, only the last few got 429) and an in-memory one-minute window in
each Worker instance, which stops a burst at once. Over the limit:
HTTP 429 with `retry-after: 60` and a plain message. Catalog browsing and metadata are not limited (static files).

### Daily playback canary

Once a day the daemon plays one title per source end to end through the same path a viewer at home uses
(resolver first, else the public addon's direct stream): master, variant, first segment. Titles are picked from
the catalog — the newest episode of the most recently aired show whose last read was good — so a show that
ends or a renumbering never breaks the canary. A segment answered 200 instead of 206 (a CDN that ignores
`Range`) passes. Results are events, shown per source on `/status` and the dashboard; `POST /run/canary` runs it
on demand.

### What the first canary found (2026-11-06)

- **Mako episodes that are airing right now** failed with `master 403`: Mako lists an episode before its
  broadcast ends, and its media is then the channel's live window (Akamai and CloudFront entries). Akamai
  refused the resolver's ticket for it; CloudFront served it. The resolver now tries Mako's media entries in
  order (Akamai first) and falls back to the next CDN when one refuses the master; each attempt is in the play's
  upstream statuses (`cdn AKAMAI, ticket 200, master 403, cdn AWS, ticket 200, master 200`).
- **Kan through geo-relay** played, but the canary reported its segment as failing: the relay named relayed URLs
  `.m3u8` whenever the original URL contained "playlist" or "manifest" anywhere (Kan's segment URLs do), and the
  canary believed the name. The relay now names a URL a playlist only when its path ends in `.m3u8` or is
  Kaltura's `playManifest`, and the canary decides from the answer itself (a playlist starts with `#EXTM3U`).

### Restore drill

`israel-tv restore <registry.json>` rebuilds the id registry into an empty database (it refuses a non-empty
one) and continues each source's id counter after its highest id. Tested both ways: a unit test (ingest, publish
the registry, restore into an empty store, ingest again in a different order: identical registry; a new show
gets the next id) and a live drill on 2026-11-06 (783 series, 1,665 seasons, 36,580 episode numbers restored;
a fresh read of 9 real shows put all 3,527 of their episodes under the published numbers, none differed).

### Mako away from home (remote resolver)

Measured first (2026-11-06): a Mako play started through the home resolver (ticket and master fetched from the
home address), then its variant playlist and a segment fetched from other addresses (an Israeli and a Dutch
proxy exit): 200 and 206 both times. Akamai binds the session to the User-Agent, not to the address, so a resolver
reachable from outside works.

Design: a separate listener (`resolver.remote`, on 127.0.0.1 for a tunnel connector on the same machine) in
front of a resolver with only mako-auth (geo-relay off). Every path must start with a secret token of 32+
characters (from `.env`, compared in constant time; rotating it revokes every install); only the manifest, Mako
and live stream requests and the Mako play playlists exist behind it; anything else, including any other method,
answers an empty 404. Per-client limits use the address the tunnel passes (`cf-connecting-ip`, only hashed).
The token is in `.env`, so it is scrubbed from every log line like the other secrets, and the startup log
names the address without it. No video can pass through the tunnel (no relay route), and the admin port is a
different listener that the tunnel is never pointed at.

### Security review, round 2

One finding, fixed: a failed Cloudflare deploy's error (wrangler's message names the account id in the API path)
was stored on the run and rendered into the public `/status` and `/status.json` by the next publish. That
happened once on the deployment (the Analytics Engine refusal at 11:47 on 2026-11-06) until a later publish
replaced the files. Errors are now cleaned of every secret value and of `/accounts/<id>` paths before they are
stored, and the whole status is cleaned again before anything is published; the stored copies on the deployment
were cleaned too. Everything else checked out (remote resolver token and allowlist, admin token, dashboard
escaping, image paths, Worker origin, rate limits, artwork, backup/restore, deploy secrets file, relay).

### Code review, round 2 (first pass)

Five findings, fixed:

1. Kan show pages on the public addon kept the placeholder in their image URLs (series metadata was served as
   plain static files, never through the Worker that fills in the address): the Worker now runs first for all
   `/meta/*` too. Metadata requests now count toward the free plan's daily Worker requests (one per show opened).
2. The daily rollup's overall total could be displaced by events with no source or show (e.g. an IMDb id the
   resolver does not know), making daily totals near zero: each rollup level now only takes events that
   belong to it.
3. The canary's own plays counted as household usage: the canary marks its stream request, the resolver gives
   that play a `canary-` play id, and rollups and "playing now" leave such plays out.
4. After a VACUUM, the size check counted the database twice (the WAL file held a full copy), halving the cap:
   the WAL is checkpointed after VACUUM and the size is measured from the database's pages.
5. Requests refused by the rate limit were logged as stream requests, so the Workers Logs fallback counted
   them as plays: they are logged as `route: limited`.

### Image URLs are made absolute at publish time

Revisiting fix 1 above: sending `/meta/*` through the Worker put every show-page open on the free plan's 100,000
Worker requests a day. Instead, the publish writes absolute image URLs into every file whenever it knows the
public address — `publisher.publicUrl`, or else the address the last successful deploy reported (remembered in
the database). Then only catalog rows run the Worker (for the stale-row warning); the manifest and all metadata
are plain static files again. Only the very first publish of a brand-new install, before any address is known,
still sends the manifest and metadata through the Worker to fill the address in; its next publish switches over
by itself. The local server keeps filling in its address per request (it is reached under different LAN names).

### Code review, round 2 (second pass)

Four findings, fixed: a relayed play the broadcaster refused with 403 left no event (an early return meant for
forged URLs also caught upstream 403s — only the relay's own refusals are skipped now); the public "failed"
totals were always 0 on the Workers Logs path (failures are now counted at every level); a relay session that
delivered nothing counted as a play (only successful sessions count); relay sessions open at a restart or at the
nightly rollup were lost or landed in an already rolled-up day (they are written on shutdown and before the
rollup).

### Kan artwork: loaded as an image, not fetched

Measured on the deployment: Kan answered 403 to the in-page `fetch()` of its share images even within the session
that passed its check. The browser now loads the image as an image (the loader lets exactly that URL through)
and draws it on a canvas (same site, so the canvas can be read back).

### Intuitiveness review, round 2 (three fresh readers: home user, self-hoster abroad, debugging agent)

All findings fixed in the docs (and two in code): the remote token must be URL-safe (`openssl rand -hex 32`;
a base64 token with `/` never matched — the resolver now refuses such a token with that advice); a full Cloudflare
Tunnel recipe with a config snippet, and that other tunnels share one rate limit; every admin `curl` shows the
token and where it comes from; the `events` flags in the commands table (`--play`, `--show`), the missing
commands (`admin-url`, `remote-url`, `restore`, `usage`) and the `pnpm logs` alias; what runs the Worker and the
per-client limits; the optional Analytics Engine permission and switch; a Mac note (fixed address, no sleep,
firewall prompt); headless and Docker access to the dashboard, Docker paths, ports and command forms, systemd
command forms and `journalctl`; a section for "a catalog row says it is old"; what "none needed" means for
debugging; that remote plays count under "This home"; and log scrubbing now covers every secret the config
names, whatever its variable is called (it only matched names containing TOKEN, PASS, … before).

### Code review, round 2 (third pass) and intuitiveness re-check

Code, fixed: Kids/Teens show pages are on kankids.org.il but their images on kan.org.il, and a cross-site image
taints the canvas it is drawn on — the image is now opened in its own tab of the same browser session (where it is
the document, so same-site) and resized there, for both sites; and the daily job's flush ended relay plays that
were still going, splitting each into two — it now ends only sessions started before the day began (shutdown
still ends all). Docs, fixed: `.env.example` still suggested a base64 remote token; `configuration.md` still
described the old Worker routing; series ids are found through a row's search (registry.json has no titles);
the local server now serves `freshness.json` too; reproducing a direct (non-resolver) play; that switching to the
Cloudflare publisher stops the `:7700` addon; restart commands for launchd, systemd and Docker; and how to create
a tunnel when there is none yet.

### Roles, and a resolver that needs no database

Three roles (`role` in the config): `host` (everything, published to Cloudflare), `local-only` (everything, on
this network), `resolver-only` (only the home resolver, playing from someone's public catalog). Each has a minimal
config and `.env.example` in `examples/`; the start refuses a config that mixes roles and says what to change, and
the secrets check only asks for what the config uses (a resolver-only instance needs none inside Israel).

The resolver read episode details from the home database, so it could not run without ingest. The catalog now
publishes, per season, what a resolver needs per episode (`play/<series>/<season>.json`: Mako's play ids, the
direct stream, whether it is Israel-only; about 1,600 more static files, well within the 20,000 limit), and a
resolver-only instance reads those (and `ext-ids.json`) over HTTP, cached for 10 minutes per season. A full host
keeps reading its own database, which is faster and always current.

### Roles: persona check

Fixed: the role example configs were never committed (the `.gitignore` entry for `israel-tv.config.json` also
matched `examples/*/israel-tv.config.json`) — they are now `israel-tv.config.example.json`; the host example asked
for a proxy and TMDB key it does not need (now Cloudflare only; the rest are opt-ins); "Sharing with friends"
still said Mako needs the host's database (friends now run the resolver-only role); a wrong or outdated
`catalogUrl` failed silently (a resolver-only instance now checks its catalog at start and logs what is wrong);
what a resolver-only instance has (no admin page or dashboard) is stated; the role check now also covers `host`
(it must publish to Cloudflare) and refuses `catalogUrl` outside resolver-only; and the role, when not set,
follows the publisher (Cloudflare: host; local: local-only), so the no-config Quick start is local-only.

### Code review, round 2 (fourth pass)

Two findings in the resolver-only path, fixed: a failed catalog fetch was cached like real data (10 minutes per
season file, an hour for `ext-ids.json`), and an episode published after a season file was cached stayed unseen
for up to 10 minutes — failures are no longer kept (they are logged, and the last good copy is used while the
catalog is unreachable), and a file older than a minute that lacks the episode asked for is fetched again; and a
resolver-only instance never pruned, rolled up or capped its usage events — it now runs the same daily
housekeeping (and once at start).

### Analytics Engine: why the SQL API says "Authorization error"

Checked 2026-11-06 after the owner added Account → Account Analytics → Read: the GraphQL Analytics API answers
with the token (the account's Worker requests), so the permission is in place and is the one Cloudflare's docs
name for the SQL API. The SQL API still answers "Authorization error", even to `SHOW TABLES`. The account has not
enabled Workers Analytics Engine: deploying a Worker with an Analytics Engine binding is refused with "You need to
enable Analytics Engine. Head to the Cloudflare Dashboard to enable", and no dataset can exist before that. This
is a one-time switch in the Cloudflare dashboard (free on the Workers free plan), for the owner. Nothing else is
needed: the next publish (it retries weekly) adds the binding, the Worker starts writing data points, and the daily
job reads them. Until then the public counts keep coming from Workers Logs (same numbers, counted by Cloudflare);
the GraphQL API is no substitute (it only has request totals per Worker, not per show).

### Architecture clean-up: one job per part, a versioned contract, per-role packaging

- **Contract.** What a catalog gives a resolver is now a versioned contract (`packages/core/src/contract.ts`,
  docs/contract.md): `resolver-contract.json` (version 1), per-season play files and `ext-ids.json`, each with a
  schema. The resolver checks the version (hourly) and the files, and refuses a version it does not understand
  with a clear message instead of guessing. Contract tests on both sides: what the renderer publishes fits the
  schemas; the resolver refuses a newer or missing version and files that do not fit.
- **Packaging per role.** What every process shares (config loading and role checks, logging, serving) moved to
  `packages/runtime`. The resolver has its own entry point (`apps/resolver/src/cli.ts`, `pnpm resolver …`), so a
  resolver-only install is `pnpm install --prod --filter "@israel-tv/resolver..."`: about 85 MB, with no
  browser, scrapers or Cloudflare tooling (checked from a clean clone, then played Mako from the live catalog).
  Per-role service files: `deploy/israel-tv-resolver.service`, `deploy/org.israel-tv.resolver.plist`,
  `deploy/docker-compose.resolver.yml` with `Dockerfile.resolver`. The full entry point still runs a
  resolver-only config (it hands over to the same code).
- **Which addon answers what** is an integration test: both addons in a simulated client, every kind of title,
  at home and abroad. At most one stream per addon per title; the only pair is deliberate (abroad: the catalog's
  direct stream labelled Israel-only, and the resolver's relay of it) — the catalog is public and stateless and
  cannot know where the viewer is.
- The README explains why each part exists.

### Review pass after the clean-up (code, security, three personas)

- **Contract tolerance.** The play-file and ext-id schemas accepted no added fields, yet the contract says fields
  may be added within a version: one new field would have made every older resolver drop every file. They now
  ignore unknown fields (test added); anything an older resolver cannot safely ignore is a new version.
- **The local server serves the contract** (`resolver-contract.json`, `play/…`, `ext-ids.json`), so a
  resolver-only instance can point at a local-only catalog. The integration test now reads the catalog through
  the catalog addon itself instead of the rendered files.
- **The resolver's own entry point has every command a resolver-only owner needs:** `check-catalog`,
  `check-proxy`, `remote-url`, `events` (shared code in `apps/resolver/src/commands.ts`; `queryEvents` moved to
  `packages/events`). Before, the filtered install could not run them. Its log lines say `component: resolver`.
- **Security hardening** (below the reporting bar, cheap): the resolver probes a catalog's direct stream only on a
  broadcaster's https host (the relay allowlist), so someone else's catalog cannot make it reach other hosts; a
  catalog file over 8 MB is refused unread.
- **Visible failures:** a failed nightly read of the public addon's usage is shown on `/status` and next to the
  public numbers (it was only logged). Analytics Engine refused earlier is tried again on the first publish after
  a restart (the owner may just have enabled it), not only weekly.
- **Docs and service files:** example configs log to rotated files and the launchd agents keep only a crash file
  (the old setup grew one log forever); plist Volta/Homebrew path explained correctly; LaunchAgent login note;
  `.local` names often fail on Android TV; Docker `chown` after copying `.env`; `<addon>` means the base URL
  everywhere and Hebrew searches use one word or `%20`; the admin cookie lasts 30 days; a first-time tunnel gets
  a complete `config.yml` in the right order; resolver-only update, restart and log commands.

### Kan artwork: copy the lobby poster, not the share image

Measured on the home machine in a real browser session (direct and through the proxy, same result): Kan answers
403 (a Cloudflare page) for its share images (`og:image`, with or without resize parameters), the show page's
hero and the video poster, whatever the request type (script fetch, page navigation, image element), while the
pictures its pages actually show load (64 of 67 on a show page, served as WebP). So the copy is now made from the
show's poster on its lobby card (portrait 300×450 on Kan 11; on the kids lobby the 239×360 poster, else the
character picture), loaded from the show page's session — confirmed 200, 300×450. The share image is only a
fallback for shows with no card. The catalog had been pointing at share images, so Kan posters were not showing
for anyone; the copies fix that too.

- **Copies come from the lobby read, not the show re-read.** Waiting for each show's page to be re-read left the
  copies behind the episode backlog (slices spend their pages on episodes). Each lobby shows all its posters, so a
  lobby read now also copies every poster that has no copy yet, from the lobby's own session; the lobbies are read
  whenever a show still lacks its copy (each show at most once a day, so a missing poster never makes every slice
  read them), and a slice that copied images publishes. Test: every card's poster is saved in the first slice,
  before any show page, and a failed copy does not bring the lobbies back next slice.
- **Kan 11 refuses image requests from a session that loads no images.** The first lobby copies worked on Kan
  Kids (49) but every Kan 11 poster answered 403, while a browser loading the lobby normally got 200 for all 41
  posters (direct and through the proxy). A page whose images are wanted now loads its images like any visitor
  (fonts and media stay off) and the poster's bytes are taken from the page's own response. Shows that failed
  under the old way are retried at once (a copy-method version in the crawl state), not a day later.
- **Shows without a lobby card** (older programs) have only the refused share image; their copy now comes from
  the first still or promo their own page shows (a 490×272 `?width=…&v=…` image the page loads). Copy method 3
  retries every show still without a copy at once.

### License: AGPL-3.0-only

Owner decision: the project is AGPL-3.0-only (© Israel TV contributors), so anyone who runs a modified copy as a
service must publish their changes. The license text is the unmodified official one. No funding, sponsor or
donation links of any kind will be added (they would identify the people behind the project), and Mako playback
stays self-hosted per household: there is no public resolver.

## Round 3: two Workers on workers.dev

Problem: the catalog's files and the Worker's code shipped as one Worker version, so every catalog refresh was a
code version, a code rollback also rolled back the catalog, and the version history was noise.

**Platform facts checked against Cloudflare's docs (2026-11-06) before building:**

- `assets.run_worker_first` takes an array of path patterns (`*` matches deeply, `!` excludes; wrangler ≥ 4.20,
  we use 4.158); everything else is served as a static asset — "Requests to static assets are free and
  unlimited." Once the daily free limit is reached, requests that run the Worker get a 429; assets keep working.
- Service bindings: "Service bindings don't increase costs"; on Standard pricing the call adds no request fee
  (CPU of both counts). The free plan's subrequest limit (50 per request) applies to the callee calls.
- A Worker with `workers_dev = false` and no routes is reachable only through a binding; `preview_urls = false` is
  set explicitly because an omitted setting leaves an existing preview URL as it is.
- A version includes code, static assets and bindings; `wrangler rollback` per Worker, last 100 versions; "Resources
  connected to your Worker will not be changed during a rollback", so the two Workers drift on purpose — hence the
  versioned contract.
- A Worker binding to a Worker that does not exist yet fails to deploy: the API Worker goes first.
- Rate limiting (`ratelimits`), Analytics Engine and Workers Logs need no public route.
- Whether `request.cf` / `CF-Connecting-IP` reach a callee is not documented: the router passes the client's address
  explicitly in the envelope (safe: the API has no other way in).
- Circular service bindings are not documented: avoided. The API reads catalog files by asking the router for them
  (a "need" answer; the router reads them from its assets and sends the envelope again), so the binding goes one
  way only. The API keeps files for a minute, so most requests take one round.
- Each Worker has its own wrangler config (`apps/catalog/wrangler.jsonc`, `wrangler.api.jsonc`).
- Token: "Workers Scripts: Edit" covers deploying both; under Cloudflare's newer roles, _creating_ a Worker may need
  the product-level Admin role — tried on the first deploy-api (see below).

**Built:** `apps/catalog/src/router.ts` (data Worker, a few dozen lines, imports only the contract),
`apps/catalog/src/api.ts` (everything else), `packages/core/src/router-contract.ts` (version 1, envelope, need
exchange, safe paths). The API refuses another contract version with a 500 that says which versions and what to
deploy (an HTML page on `/status`). Contract tests: rows and search through the router, a refused version, the
API answering nothing but envelopes, the router's 503 when the API is missing and its refusal to read unsafe
paths, and rate limits counted once per request whatever the rounds. `israel-tv deploy-api` (code releases;
Analytics Engine tried every time, fallback without it), `deploy` (both, in order: one command for a new
self-hoster), `versions` and `rollback` per Worker. The publisher deploys only the data Worker; a first publish
before deploy-api fails with what to run. The usage reader takes Workers Logs from the API Worker (falling back
to the old single Worker for days before the split).

**Publish batching:** airing checks and Kan slices request a publish; one is made at once if the last was at least
`publisher.minIntervalMinutes` (30) ago, else one timer publishes everything gathered when the interval is up.
The end of a full run, an owner's show refresh (Kan too) and start-up publish at once. Test with fake timers.

**Migration and live checks (2026-11-06).** Release script order: `deploy-api` first (the API Worker was
created with the existing "Workers Scripts: Edit" token — no new permission needed), then the service restart,
whose first publish replaced the single Worker with the router (16:00:49 UTC). The public URL never went down: the
old Worker served until the switch. Then, live:

- Every route 200 through the router (manifest, rows, search, show pages, streams, `/status`, `/status?x=1`,
  freshness, artwork, logos), also from a Netherlands exit; `israel-tv-api.<subdomain>.workers.dev` answers 404 (no
  public URL). Workers tail shows one request event per viewer request, with the client hash, in one round.
- The daily canary passes on all four sources through the home resolver.
- Rollbacks, both Workers: `rollback api` to the previous version and forward again, `rollback data` one publish
  back and forward again; the addon answered 200 throughout.
- Rate limits: over one connection, 42 of 80 searches were refused (the per-instance window, as before the split).
  Requests from many separate connections land on different Cloudflare servers, each with its own window, and
  Cloudflare's shared limiter is approximate by design, so a burst spread over many connections is not stopped
  quickly. Same as before the split; recorded as a known limit (the free daily cap still bounds the cost).

### Analytics Engine on; Workers Logs no longer used for counting

The owner enabled Analytics Engine on the account. `deploy-api` (which tries the binding every time) deployed the
API Worker with it; stream requests showed up as data points within a minute, and the daily pull, run for the
day on the home machine, read 3 rollup rows from it. The Workers Logs counting fallback is removed: a failed
Analytics Engine read is now an error shown on `/status` and the dashboard. The API Worker still writes one
Workers Logs line per request, for debugging.

### Code structure and tooling

- **The resolver never opens the catalog database**, on any role: a full instance's resolver reads the same
  contract files (play files, `ext-ids.json`, `resolver-contract.json`) from its own publish folder, written
  before each deploy, through the same lookup a resolver-only install uses over HTTP. `@israel-tv/store` is no
  longer a resolver dependency. (New episodes reach the resolver when they are published, as they reach the
  catalog.)
- **Boundaries in CI** (`pnpm boundaries`, dependency-cruiser): no cycles; packages never import apps; the
  resolver and catalog apps do not import other apps; the resolver imports neither ingest nor the catalog
  database, renderer or scrapers; the Workers import no Node built-ins and no Node-only packages; the router
  imports only the router contract; packages are used by name through their `exports`, never by path. TypeScript
  7 has no JavaScript compiler API yet, so dependency-cruiser parses with swc (checked: 87 modules cruised, and
  deliberate violations are caught).
- **Hygiene in CI** (`pnpm hygiene`): knip (unused files, exports and dependencies: it found four unused
  dependencies, removed; `wrangler`, `pino-roll` and `@swc/core` are used as a binary, a transport name and a
  parser and are listed as such), publint `--strict` on every package (each now lists its `files`). Shared
  dependency versions live in one pnpm catalog (`catalogMode: strict`).
- **Biome stays the only linter and formatter**, stricter: unused imports, variables and parameters, floating
  and misused promises, `import type`/`export type`, `node:` protocol, no non-null assertions, no `any`; CI runs
  `biome ci --error-on-warnings`. It found one unhandled promise chain (made explicit) and a leftover type.
- **Deprecations:** CI runs the tests with Node's pending deprecations on and a preload that fails the run on any
  deprecated API (`pnpm test:strict`, `tools/fail-on-deprecation.mjs`), except a named allowlist — today one entry,
  `process.binding()` inside `lodash.isequal`, which `got-scraping` pulls in through `ow`. Type-level deprecations
  (typescript-eslint `no-deprecated`) need TypeScript's JavaScript API, which TypeScript 7 does not have yet:
  measured gap, deferred until typescript-eslint supports TypeScript 7; no ESLint is added meanwhile.
- **Imports rule:** other workspace packages only by name (`@israel-tv/<pkg>`, or a declared subpath such as
  `@israel-tv/core/router-contract`); inside a package, relative imports (sources are one folder deep, so Node
  subpath imports `#…` add nothing yet; they are the rule if a package grows nested folders). No tsconfig `paths`.
- **`tsc --build` / project references:** not adopted. TypeScript 7 type-checks the whole workspace in seconds per
  package; references would add config to keep in sync for no measured gain.
- **CI:** the full suite on ubuntu-latest and windows-latest for every pull request (macOS runners were never
  assigned to this private repository — queued, then cancelled after 15 minutes, four runs in a row — so macOS runs
  as a non-blocking job on `main`, and is the platform every local run and the live deployment use; it rejoins the
  required matrix once the repository is public); lint, boundaries and hygiene once (on
  Linux); `pnpm audit --prod` on every pull request, reporting only (no bots, no automatic updates; updates are
  done on request with `pnpm up -i -r --latest`).

### Any operating system

- **One folder per instance** holds the config, `.env` and the data (easy to back up or move as one). Found in this
  order: `ISRAEL_TV_CONFIG` (a file; the home Mac's service sets it, unchanged), `ISRAEL_TV_HOME` (a folder), an
  `israel-tv.config.json` in the current folder (setups run from the repo keep working), else the platform's
  usual app folder: `%LOCALAPPDATA%\israel-tv` (Windows: local, not roaming, since it holds databases),
  `~/Library/Application Support/israel-tv` (macOS), `$XDG_CONFIG_HOME/israel-tv` or `~/.config/israel-tv`
  (Linux). `israel-tv paths` prints where everything is; `israel-tv urls` prints the links to install as other
  devices on the network see them (the start-up log prints them too), so no guide asks anyone to run an
  operating-system command to find an address or a folder. Both work in the resolver's own command line.
- **Secrets file:** on macOS and Linux a warning names `chmod 600` when `.env` is readable by other users; on
  Windows the folder is under the user's own AppData, private by default.
- **Kan's browser:** Google Chrome where it is normally installed (any OS), then Microsoft Edge (Chromium-based,
  on every Windows), then a distribution Chromium on Linux, NAS boxes and Raspberry Pi; `browser.executablePath`
  overrides. The error names all three.
- **Background service on Windows:** `deploy/windows/install-task.ps1` registers a Task Scheduler task at logon
  (restart on failure, no time limit; `-Resolver` for the resolver alone, `-Remove` to undo). No extra software;
  a cross-platform `service install` command was not added (four service systems to drive for little gain over
  the four ready files).
- **Checked on CI:** the whole suite and `pnpm smoke` on Linux and Windows: a local-only instance (every source off,
  so no site is contacted) and a resolver-only instance playing from it start, and both manifests answer.

### Releases and ready images

- **Versions:** release-please (lighter than changesets: no file per change; it reads the conventional commit
  messages already on main and keeps one release pull request open; merging it tags the version and writes
  `CHANGELOG.md`). Pull requests are squash-merged with their title as the commit message, so CI checks that
  titles follow Conventional Commits (a plain shell check, no third-party action). First version: 0.1.0 (beta).
- **Images:** a published release builds two images for linux/amd64 and linux/arm64 (PCs, NAS boxes, Raspberry
  Pi) to GHCR under the project account: `israel-tv-resolver` (the home helper; only the resolver's packages, no
  browser) and `israel-tv` (a full instance without a browser). The helper image needs no config: it plays from the
  public catalog (`ISRAEL_TV_CATALOG_URL`, overridable), and abroad takes a proxy as one variable
  (`ISRAEL_TV_PROXY`, treated as a secret everywhere). Inside a container the app prints "this computer's address"
  instead of the container's own address. A job then pulls the published helper image on a clean runner, runs it
  as a viewer would, fetches its manifest and checks the public catalog through it.
- **Owner's call:** GHCR packages of a private repository are private. The images contain the source, so making
  them public is part of publishing the project (with the repository); until then `docker run` works for the
  account only. Checked before publishing: the helper image runs, answers its manifest, and plays a Mako episode
  (master playlist 200) from the public catalog (local build, arm64).

### The public README and docs

The front page is for viewers (owner's final intent): install link first, what you get, Keshet 12 and abroad in a few
sentences, a short FAQ, then one paragraph each for how it works, running your own copy, contributing, privacy and the
license — everything else one link away (`docs/setup/*` per role and per system, `docs/architecture.md`, the app and
package READMEs, `CONTRIBUTING.md`, `llms.txt` + the assistants' guide).

Three independent drafts (a non-technical viewer abroad, an experienced Stremio user, a contributor) and well-regarded
READMEs (Immich, Jellyfin, Uptime Kuma, Home Assistant, AIOStreams, MediaFusion) agreed on what was adopted:

- **First screen:** one-line pitch, beta badge, a real screenshot (Stremio Web with the public link installed), the
  install link with a one-click Stremio link and the Nuvio steps.
- **The Keshet 12 caveat above the fold** (the main surprise for new users), in the "what you get" table: per channel,
  in Israel and abroad, and which need the home helper.
- **Plain words:** "install link", "home helper", "only plays from Israel"; no "manifest", "resolver", "Worker",
  "token", "pnpm" on viewer pages (they appear on the technical pages, explained).
- **Steps with what you should see** on the home-helper page, one action each, Docker first.
- **For experienced addon users:** works alongside other addons; streams for shows opened from Cinemeta where seasons
  match.
- **For contributors:** one path (README → CONTRIBUTING → the package's README), task recipes ("fix a broken source",
  "add a channel"), "no accounts or credentials needed", the project structure moved out of the README into
  CONTRIBUTING.md, issue forms (a "broken source" form linked from the FAQ) and a pull request template.
- Not adopted: a separate docs website (the repository's Markdown is enough for now).

`pnpm check:addresses` (CI) fails on private network addresses in tracked files; extra personal patterns can be given
through an environment variable so they are never written into the repository.

### Docs review, round 1 (seven fresh agents)

Four personas read the docs (a non-technical viewer abroad, an experienced Stremio user, a Windows user, a would-be
contributor) and three assistants followed `for-agents.md` in a sandbox (the helper via Docker in Israel; abroad with a
deliberately wrong proxy; an own copy at home with every source off). All three setups worked; the contributor ran
`pnpm check`, `test:strict` and `smoke` green from CONTRIBUTING.md alone; no secret reached any output. Fixed:

- **Viewers:** an honest "what the link alone gives you" in and outside Israel right under Install; Keshet 12 has no
  play option until the helper is added; install from a phone signed in to the same account (no typing on a TV); the
  Stremio button is an https link (GitHub drops `stremio://` links); which computer works (a laptop only while awake
  and home); Docker Desktop's WSL/restart; how to open a terminal; the address with a NAS/Linux path and no angle
  brackets; Windows network "Private" and sleep settings; "via Israel" vs "Israel only" sources; Keshet 12 away from
  home is not part of the easy way; one name everywhere — the addon is now called "Israel TV · home helper".
- **Abroad:** the proxy login goes in an env file (`ISRAEL_TV_PROXY_USER` / `_PASSWORD`, any characters, nothing on
  the command line or in shell history), `socks5://` is accepted, and updating keeps it. The proxy check names the
  real setting (`ISRAEL_TV_PROXY` or `geo.urls`); the helper now logs the proxy (address only) and checks its Israeli
  exit once at start, so a wrong proxy shows at once.
- **Stremio users:** the manifest's description no longer suggests the public link plays Mako; the README says which
  ids it answers (`iltv_`, and `tt`/`tmdb:` only for matched shows with regular seasons) and that it never touches
  movies; maintenance status.
- **Windows:** `Set-ExecutionPolicy` and `npm i -g pnpm` before installing; creating the config files with Notepad under
  the right name; the task now runs hidden (`conhost --headless`) in a loop that restarts the app 30 s after any stop
  (Task Scheduler's own restart covers only failures to launch), with logs in the config folder; a CI job installs the
  task on a Windows runner, fetches the manifest it serves, stops it and checks no process keeps the port.
- **Logs:** a log file is now the default (`data/logs` in the config folder), mirrored to a terminal or a container's
  output when there is one and never to a service's own output.
- **Addresses:** `urls`/`start` drop virtual adapters (WSL, Docker, VMs, VPNs, link-local) and list home-network
  ranges first.
- **Linux:** a per-user systemd unit that uses your own clone and config folder (plus linger), next to the separate
  system install; `xvfb-run` examples.
- **Contributors:** `pnpm format`; what CI runs besides `pnpm check`; how to record a raw page (not a browser's saved
  page) and compare the data the parser reads; how parser tests use fixtures.

## Round 4: the owner's dashboard

**Consulted first:** three independent design drafts — the strongest case for a lean single-page app, the strongest
case for server-rendered HTML with htmx, and a neutral critic scoring both against a framework-free page. Both the SPA
draft and the critic recommended a small SPA (Preact, not React; uPlot, not Recharts — Recharts alone is about twice
the whole budget; no TanStack Query for ~10 GET endpoints and one stream). The server-rendered option fails the brief's
"typed JSON API + a separate dashboard app" (htmx wants HTML fragments), and a framework-free page grows its own
framework by the fifth view.

**Chosen:** `packages/admin-contract` (zod schemas, the only thing the daemon and the page share) + `apps/dashboard`
(Preact 11 with htm, uPlot) + `/api/v1` in the daemon. One change from the drafts, measured against how Israel TV is
installed: the Mac, the Docker images and anyone installing with `--prod` have no development tools, so a Vite build
would have needed a committed or separately shipped bundle. Instead the page's TypeScript is served with the types
stripped by Node itself (`module.stripTypeScriptTypes`, cached), and the vendor modules come straight from the installed
packages through an import map (its hash is in the content security policy). No bundler, no build step, nothing
generated, no tooling exposed to TypeScript 7's missing JS API. uPlot's ES module build is not minified (41 KB gzip), so
its minified script build is loaded instead: the whole page is 36 KB of JS gzip (budget 45 KB, tested).

**Security, from the critic's rules:** one gate for the page, the API and the stream (local network, token, DNS
rebinding, cross-site origins — `Origin: null` is now refused instead of throwing); the token in the address only opens
a page, never the API; a cookie-authenticated change needs the CSRF value (an HMAC of the token, from `/session`);
bearer scripts are unchanged; `/events.json` validates its parameters; API answers are `no-store`; the page has a
strict CSP (`default-src 'self'`, no inline script but the hashed import map, `frame-ancestors 'none'`); the live
stream allows 4 at once, sends a snapshot only when something changed (checked every 3 s) and a comment every 25 s,
and the page closes it when the tab is hidden; the canary action runs one at a time; nothing destructive.

**New data:** the nightly backup is now opened and integrity-checked (a restore check, shown under System); the Worker
versions of each deploy are kept from wrangler's output (shown under Catalog & deploys).

**Tests:** every endpoint's answer parses with its schema (on a seeded events store); the gate (no token, token in the
address, missing/wrong CSRF, `Origin: null`, cross-site, bad `/events.json` and trace parameters); the page's security
headers, its modules, types stripped, no path escape; the stream's first frame; the size budget; and `pnpm
e2e:dashboard` in CI — a sandbox instance in Chrome, every section at phone and desktop size in light and dark, failing
on any page error, failed request or sideways scrolling, screenshots kept as CI artifacts.

### Tooling round 4

- **Worker size budget in CI** (`pnpm budget:workers`: wrangler's dry-run bundle, nothing uploaded): it found the API
  Worker at 146 KB gzip, 95% of it zod — the Worker imported two helpers from core's main entry, which also exports the
  config schemas. A schema-free entry, `@israel-tv/core/edge`, now serves the Workers and the addon app: the API Worker
  is 21 KB gzip (budget 40), the router 1.2 KB (budget 4). A boundary rule keeps the schemas out of the Worker side.
- **Git hooks** with lefthook (installed by `pnpm install`): staged files formatted before a commit; type and boundary
  checks before a push. Commit messages are not checked locally: the squash-merge title is the commit that counts, and
  CI checks it.
- **The dashboard's own budget** (45 KB JS gzip, measured 36) and its browser check run in CI (round 4 above).

## Series posters are portrait (2026-11-06)

Series rows were published as `landscape`, but the images are portrait (measured: 199 of 200 Mako and Reshet posters,
e.g. Mako 420x600, Reshet 1080x1920; our Kan copies 300x450), so apps like Nuvio drew them sideways. Now every series
row is `poster` (live stays `square`), and the publisher makes that true: it measures each poster once (the header
only; fetched before the first publish that needs it, failures retried after a day). A portrait image is used as it
is; any other (one Reshet show, landscape Kan images) gets a 2:3 version made here — the whole image on a blurred,
darkened fill of itself, 400x600 JPEG, pure JS (`jpeg-js`) so every platform can do it — served from our site. A
poster on a host that refuses viewers outside Israel (Kan's own site) is never published: our copy, or a placeholder
(`assets/branding/poster-placeholder.jpg`, replaceable in `branding.dir`) until the copy exists; backgrounds and
thumbnails on such hosts are dropped. A test fails if a series row is not `poster` or its poster is not portrait.

## Show metadata: year seasons, years, genres, IMDb ids, version (2026-11-06)

Measured on the live catalog against another addon's output for the same shows:

- **Year seasons were numbered with the year** (`iltv_mako_54` had seasons 2024 and 2026; 21 Mako shows, 83
  seasons), so apps showed "Season 2024" and TMDB matching could not line up. They are numbered by position now,
  oldest = 1, after any real season numbers (a show with seasons 1, 2 and 2020 gets 3; named ones stay 101+). New
  year seasons take the next number; stored numbers never move again. The one-time move of the stored ones (with
  their episodes) runs when the database opens and logs how many moved; it also applies to older data restored
  later. Done before going public, while there are almost no viewers: watch progress on those 21 shows restarts.
- **Episode titles** no longer start with the season's year ("2024 · …"); named seasons keep their label, since
  their numbers (101+) say nothing.
- **releaseInfo** is the first to last episode year (`2024–2026`), or one year when they are the same; it was the
  latest year for every show. An open range (`2024–`) for running shows was tried and dropped the same day: on the
  owner's iPhone it showed as a lone, broken-looking line, worst in right-to-left. Kan episodes now keep their page's publication day as
  the air date; those read earlier get it when a slice has pages to spare (no retries, no warnings).
- **Genres** where sources give them: Mako's show page schema, Reshet's Kaltura `Genre` tags (older template); Kan
  gives none. Cleaned (no repeats, at most 5). Each row offers its genres as a filter (`genre` extra; the Worker
  filters the search index, which now carries them).
- **imdb_id** on catalog items and metas when the match is known, for Trakt and other addons.
- **Version:** the manifests show the release (root `package.json`, which release-please bumps), not `1.0.0`. The
  description is one plain sentence about what is in it and what limits playing.

## Live sweep fixes (2026-11-06)

Measured on the live addon, then fixed:

- **One Cache-Control per answer.** Cloudflare applies every matching `_headers` rule and adds the values up, so
  `manifest.json` carried `public, max-age=600, public, max-age=3600`. Rules that set their own now detach the
  inherited one (`! Cache-Control`); a test checks every rule.
- **Kan show names** (17 of 68 carried site text): `cleanKanTitle` removes the site name, "פרקים מלאים לצפייה
  ישירה" / "הסרט המלא", "| סדרה … מבית …" and an Arabic name with its tagline; dashes that belong to a name stay.
  Stored names are cleaned in place on the next slice. Mako and Reshet names were clean.
- **Stream labels:** the name is the source and its best quality (`רשת 13 · 720p`, `כאן · 1080p`), the title the
  episode, and plainly `זמין לצפייה רק בישראל` when it plays only from Israel. Quality is per source, measured:
  Reshet's Kaltura masters top out at 720p (every sampled episode; Kaltura lists a 1080p file the master never
  offers), Kan names its ladder in the address. Live streams are named by channel; the home helper's say
  `דרך העוזר הביתי` / `דרך החיבור הישראלי שלך`.
- **Live channel pages** use the addon's background picture as the backdrop; the square logo stays the logo.
- **Large metas, not changed:** daily shows reach 421 KB (חדשות הבוקר, 1,832 episodes) but 52 KB on the wire. On
  Chrome throttled to a TV-class CPU (6×) and slow 4G: 0.43 s to fetch (0.17 s for a small show), 3 ms to parse,
  61 ms to lay out its largest season (253 episodes). Not slow, so no cap or split; ids stay as they are.
- **Subtitles:** Reshet — no caption assets on 60 sampled Kaltura entries, none in the HLS masters. Mako — no
  subtitle fields in its playlist data. Kan live — `כאן 11 · כתוביות` (already offered) has open captions in the
  picture, no subtitle track. Kan VOD — the player config has a `subtitles` field, `null` on the recorded page; the
  crawler now records the first non-empty one it meets (count and sample in its state, a log line) so a subtitles
  resource can be built on the real shape. Nothing to expose yet.
- **English search:** for shows matched to TMDB, the English and original names and alternative titles (one TMDB
  request per match; earlier matches filled 60 a run) are search aliases: found, never shown.
- **Kill switch:** config `hide` (series ids, whole sources) leaves them out of everything published, keeps their
  ids. Removal requests: [takedown.md](takedown.md).
- **Free-plan quota** on the dashboard (System): today's Worker requests per Worker and Analytics Engine writes
  against Cloudflare's free 100,000 a day each, read hourly; from 80% also on `/status`.

## Viewer-persona review of the live data (2026-11-06)

A fresh reviewer read the live addon as four viewers. Fixed:

- **Reshet show descriptions** (none of 225 had one): the show page's description meta.
- **Untitled seasons** no longer prefix episode titles with their number ("101 · …"). **Episode titles** lose the
  show's name, "עונה N" and "התכנית המלאה" around them; titles and texts are entity-decoded (Kan had a literal
  `&amp;nbsp;`) and spaces normalised (non-breaking ones in Mako names). Done when rendering, so stored data needs no
  change.
- **Kan names:** a trailing "|" or "-", and "- סדרת …" taglines, removed.
- **Live channel texts** in plain words ("צריך את העוזר הביתי" instead of "רזולבר").
- **Genre filters:** one spelling ("תוכניות" → "תכניות"), no "תכניות" prefix, no site sections ("חדשות 13"), and a
  genre is offered as a filter only when at least two shows of the row have it.
- **Search** matches whole words from their start ("kan" no longer finds the middle of another word); live channels
  have English names to search by.

Not changed, by design or waiting for the owner:

- **Kan rows look thin:** 1,914 episode pages were still queued across 168 shows (polite pace, 5 pages per 10
  minutes); they fill over the coming days.
- **Kan episode order** and **Reshet daily shows in season 101**: renumbered the same day with the owner's approval
  (next section).
- **Israel-only notes** appear only where Kaltura marks the episode geo-blocked; some Reshet episodes play abroad.

## Kan and Reshet renumbered once; numbering frozen (2026-11-06)

Owner-approved, before going public, while there were almost no viewers. One pass (`kan-titles+reshet-years-
2026-11-06`, apps/ingest/src/renumber.ts): a backup of the database first, then one transaction, logged at start-up
and recorded in the database so it never runs twice.

- **Kan:** episodes take the number in Kan's own title ("פרק 4 - …" → 4); episodes without one (trailers, specials)
  follow in air-date order (page order when undated), after the numbered ones; never two with the same number in a
  season — a clash is numbered after the others and listed as a warning on `/status`. New Kan episodes follow the
  same rule (the crawler passes the title's number).
- **Reshet:** an untitled season listed among others (Reshet's daily shows, which then sat in season 101) becomes
  one season per air year, numbered by position, oldest = 1 — the same rule as Mako's year seasons — with its
  episodes in air-date order within the year (printed numbers ignored there). A show whose only season is untitled
  stays one season. New episodes are read the same way (`untitledSeasonsByYear`).

**Frozen from here on.** Episode numbers only ever get added. Two guards hold that:

- `packages/core/test/numbering-frozen.test.ts` fixes the numbers a set of inputs covering every rule must get; a
  rule change that numbers them differently fails CI.
- The publisher's numbering guard (apps/ingest/src/numbering-guard.ts) keeps every published episode's number and
  refuses to publish when one would move or vanish, saying which on `/status`. Only a recorded migration (with a
  backup and the owner's approval) re-takes that history.

## Supervisor's full catalog audit: named seasons, descriptions, gone episodes, built-in audit (2026-11-06)

A read-only audit of every live meta, every poster from outside Israel and sampled streams found no HTTP errors,
junk names, duplicate ids or numbers, or unreachable posters. Fixed:

- **Named seasons below 101** (recorded migration `named-seasons-lowest-free-2026-11-06`, approved before going
  public): a named season takes the lowest number no other season of its show uses, in the show's list order (the
  original brief's rule); apps showed "Season 101". 33 named seasons had episodes (24 Mako, 9 Reshet); only their
  season numbers moved, episode numbers within each stayed. "עונת 2023"-style titles are year seasons now. A season
  gets a number only once it has episodes: Reshet lists empty duplicates of its seasons, 340 of which had taken
  numbers 101+ (no episodes, so nothing moved) and are unnumbered now. The frozen-rules test records the new rule.
  First reads are always full reads (the runner reads only the current season of shows it already has), so new
  shows get numbers in list order.
- **Descriptions** without what sites add for search engines (`cleanDescription`, at ingest and when rendering):
  WordPress placeholders (`%%excerpt%%`), a "חדשות 13 |" prefix, a trailing "| …, לצפייה ישירה" segment or
  "לצפייה ישירה" ending; Reshet's generic channel blurb is dropped. Ordinary sentences stay.
- **Reshet episodes whose video is gone** (a sampled "404 abroad" was "Entry not found" at Kaltura, 404 in Israel
  too; the Israel-only label was right on the other 59 of 60 samples): an entry missing from Kaltura's answer gets no
  stream (its number stays), with a note on `/status`.
- **Built-in catalog audit** after every render (apps/ingest/src/catalog-audit.ts), published on `/status`: poster
  shape, portrait and reachable from abroad; other artwork reachable; no season 101+, no two episodes with one
  number, ids matching numbers; no entities, tags, placeholders, SEO phrases or stray separators in names, titles and
  descriptions; year lines a year or a closed range; row items agreeing with their show pages. Nothing is fetched.
- **Incident during the deploy, repaired the same day:** an airing check read two Reshet daily shows' pages as a single
  untitled season, which the split then left whole (it only split untitled seasons among several), so in 11 shows'
  stored data the episodes moved back into the untitled season; their numbers did not move (published output was
  unchanged, so the numbering guard rightly stayed quiet), but the season took an empty number. Fix at the root: the
  Reshet adapter now gets the stored show, and a season split before is split again whatever one read sees
  (`splitKeys`); the split merges into existing year seasons. Recorded repair `reshet-split-repair-2026-11-06`
  re-split the data and dropped the empty numbers; no episode moved. A test replays the incident.

## Release pull requests and CI (2026-11-06)

- **Biome skips release-please's generated files** (`CHANGELOG.md`, `.release-please-manifest.json`): their format
  is release-please's, and the release commit failed `biome ci` on main. Everything else stays checked.
- **Checks on release pull requests.** release-please opens and updates its pull request with the workflow token;
  GitHub holds the pull_request workflows of such pull requests for approval (they ended "action required" and never
  ran; the two "failure" runs with no jobs were held runs left behind when the merged branch was deleted). The
  release workflow now starts `ci` and `pr-title` on the release branch itself (`workflow_dispatch`, allowed from the
  workflow token), so the required checks run on the pull request's head commit under their usual names, and removes
  the held runs so the pull request shows only real results. No extra token or secret.

## Right-to-left marks and filler endings (2026-11-07)

- **RLM for apps that lay lines out left to right** (owner's iPhone: Nuvio showed "פספורט TV" as "TV פספורט" and
  "רשת 13 · 720p" as "720 · 13 רשת"): a line whose first letter is Hebrew and that holds Latin letters or digits
  starts with U+200F (`rtl()`), in names, descriptions, episode titles and overviews, stream names and titles
  (catalog, live channels, the home helper), search results and the status rows. Never twice; Latin-first and
  pure-Hebrew lines unchanged; ids and search keys untouched.
- **Filler endings** in episode titles go: "המלא", "המלאה", "הפרק המלא", "התוכנית המלאה" ("פרק 1 המלא" → "פרק 1").

## Public repository: macOS required, release pull requests mergeable (2026-11-07)

- The repository is public, so GitHub's macOS runners are available: macOS is back in the `check` matrix and a
  required check (`check (macos-latest)`), replacing the separate non-blocking job on main.
- Dispatched runs (the checks on release-please's pull request, see "Release pull requests and CI") also post their
  results as commit statuses under the same names (`check (…)`, `windows-task`, `audit`, `title`): the branch
  ruleset counts statuses on a pull request's head commit, but not check runs from dispatched workflows (measured on
  release PR #105: six passing check runs, merge state "blocked").

## Nuvio: right-to-left embedding, status and lastAirDate (2026-11-07)

- The right-to-left mark did not help in Nuvio, which lays lines out left to right whatever they hold (the owner's
  iPhone still showed "TV פספורט" and "720 · 13 pרשת"): a mark only steers neutral characters in such a paragraph.
  Lines that need it are now wrapped in a right-to-left embedding (U+202B … U+202C), which is laid out right to left
  inside any paragraph; the earlier mark is replaced.
- Nuvio builds a series' year line from `releaseInfo`, `status` and `lastAirDate` (read in its source,
  `MetaDetailsReleaseLine.kt`): without an "ended" status it always writes "<first year> -". Metas now carry
  `lastAirDate` (the latest episode) and `status`: "Ended" after a year without episodes, else "Returning Series".
  Ended shows then read "2021 - 2024" (or one year); running ones "2024 -", Nuvio's own way of writing a running
  series. `status` is also shown as a "Status" row, so it says what is true.
