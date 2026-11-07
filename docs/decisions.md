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

## Year line: the usual form (2026-11-07)

`releaseInfo` follows the common convention (Cinemeta, IMDb and Wikipedia write ranges with an en dash and no
spaces): "2024–present" while a show runs (an episode within the last year), "2021–2024" or "2024" once it has ended
— the open "2024–" of IMDb and Cinemeta is left out, as it read as unfinished on the owner's phone. Nuvio shows any
`releaseInfo` that is not a bare year as it is; for a bare year on a running series it would write "2026 -" itself.
`status` and `lastAirDate` stay (Nuvio's "Status" row).

## New versions reach apps quickly (2026-11-07)

After the v0.2.2 deploy the owner's Nuvio still showed 0.2.1: the manifest was sent with `max-age=3600`, so
Cloudflare's edge and apps could keep the old one for up to an hour, and when a full read was due at start the first
publish waited behind it (about half an hour). Now the service publishes first thing at every start, before any
read, and the manifest is cached for 300 s (catalogs and show pages keep 600 s, streams 300 s).

## Round 6: what the dashboard showed (2026-11-07)

Measured from `events.sqlite` on the home machine and live requests, then fixed:

- **Mako's CloudFront fallback built an invalid URL.** Mako's entitlement service answers an Akamai ticket with an
  absolute `url` but a CloudFront ("AWS") ticket with a _path_ (`/hls/VOD/…/index.m3u8`); `new URL(path)` threw
  "Invalid URL" and the play failed with 502. The ticket URL is now resolved against the media URL. With that,
  the recorded episode plays through CloudFront 200/200/206 (test from the recorded playlist and tickets,
  `apps/resolver/test/fixtures`).
- **The episode whose Akamai master answered 403** (גלית ואילנית, S9E46) was not gone: it refused for about six
  minutes right after Mako published it (12:09–12:13 UTC on 2026-11-06) and played from 12:15 on, and plays now on
  both CDNs. A freshly published episode can reach the CDN a few minutes after the page lists it. The CloudFront
  fallback covers that window now; a failure where every CDN refuses a master despite valid tickets (or Mako lists
  no media) is recorded with `blame: "episode"`, apart from failures of Mako itself (`blame: "source"`). Nothing
  was unpublished: the episode is there and plays.
- **Canary**: tries up to three recent titles per source and reports "episode unavailable" titles separately;
  only a source where nothing plays (or a 5xx/network failure) is red; failed titles are skipped first for a day.
  Relayed titles are checked a second time, and the relay moves to the next proxy exit when a CDN refuses one
  (the one Kan segment 403 on 2026-11-06 passed on the next check four minutes later through the same relay).
- **Probe traffic**: the 404 "unknown episode" for id `x` was a security-audit request. Internal requests now
  carry `x-israel-tv-probe: <kind>` (the canary sends `canary`; the public Worker passes it on): their plays get
  `probe-`/`canary-` ids and are left out of rollups, failure groups, "playing now" and the public addon's
  Analytics Engine counts. A play URL whose id is not an episode id at all is refused without recording anything.
  Old failures for such ids were retagged once.
- **Bot-protection retries**: shows a full read was refused are read again 30 min, 1 h and 2 h later; amber only
  if still refused after the last retry, with their names (operations.md).
- **Mako "shows without episodes" (149)**: they were not empty. 146 of those pages have no episode list but feature
  one video: films and documentaries ("669", "הסוד של מיקי ברקוביץ'"), stand-up and concert specials, and the
  captioned news editions ("… מונגש ללקויי שמיעה"), which only ever show their latest broadcast. They are now read
  as one-episode shows (title and date from the video's own page; one extra request each). Two pages were gone
  (404), and one ("עד הקצה") lists eight episodes now: a new show whose page was still empty at the full read. Adding the captioned edition as a second stream on the matching
  news episode was considered and rejected: Mako keeps no archive of captioned editions, so it would only ever
  exist for the newest episode, and matching by date across two shows is fragile; as its own show it is plain.
- **Empty-show notes** are a count now; the titles are in `emptyShows` per source (an expandable list on `/status`
  and the dashboard). Reshet's 45 were checked by hand earlier and stay out.
- **Event times**: measured, every `events.ts` is an ISO 8601 UTC string (the log files' pino `time` is epoch
  milliseconds, a different thing). Readers compare text and take `substr(ts, 1, 10)` as the UTC day, which is right
  for that form; the writer now normalises whatever it is handed (Date, epoch seconds or milliseconds) to that
  form, so no reader can meet another.

## Round 6: the owner's dashboard, rebuilt (2026-11-07)

The round-4 dashboard (Preact + htm without a build, uPlot) worked but read as a plain page. Rebuilt as a polished app.
Three independent agents were consulted first (stack check with measured sizes; information architecture and visual
system; a devil's-advocate critique), drawing on Uptime Kuma (status strips, one-line verdict), Plausible/Umami (KPI
tiles with sparklines over one chart), Vercel/Cloudflare (deploy lists, copyable commands), Grafana (trace waterfall)
and shadcn/ui's dashboard blocks.

**Stack and why**

- **Vite 8 + React 19 + TypeScript**, **TanStack Query** (caching, refetch on focus, polling) and **TanStack Router**
  (code-based routes, hash history: one page for the daemon to serve, pasteable trace links, each section a lazily
  loaded chunk). React over Preact/Solid because the component ecosystem and the pool of contributors are React-first;
  on a LAN page for one owner, ~60 KB gzip more does not matter. The file-based router plugin was skipped (generated
  files for eight routes).
- **Tailwind CSS v4** with the design tokens as CSS variables, components written in shadcn/ui's style (cards,
  buttons, badges, meters) in the repo instead of a dependency: no Radix needed so far.
- **Recharts 3** for time series (measured +121 KB gzip vs ECharts' 188 KB; themed by the same CSS variables;
  keyboard-accessible), loaded only with the sections that draw charts; sparklines, gauges, the canary strip and the
  trace timeline are plain SVG/CSS. Tremor was rejected (React 18 only, unmaintained since early 2025).
- **Typed API without Hono's `hc`:** the admin routes are not a chained Hono app and the dashboard must not import the
  daemon (even its types pull in the store and drizzle). Instead the contract package has a zod-free route table
  (`@israel-tv/admin-contract/routes`) and a `Responses` type map; each daemon builder returns its contract type
  (drift fails typecheck), tests parse every answer with the zod schemas, and the page bundles only the route table.
- **Built where it is deployed from:** UI libraries are devDependencies; `pnpm build` makes `apps/dashboard/dist`.
  CI builds before testing; the Docker image builds it in a stage on the build machine's platform (the same files
  for every architecture); the home machine's deploy builds it on the laptop and adds it to the release (the machine
  installs production dependencies only). A copy without a build says so instead of failing silently.
- **Security unchanged in kind:** LAN + token (cookie), CSRF on the two actions, a stricter CSP than before
  (`script-src 'self'` with no hash or inline script; styles from the page plus a per-request nonce; images also from
  https for posters), no secrets in the bundle (it holds no token; the cookie does).
- **Budget:** 140 KB gzip of JavaScript for the first load (measured 119 KB), 300 KB in all, 12 KB of CSS (7 KB),
  enforced on the build in CI.

**Design:** zinc neutrals, one indigo accent, Inter with Noto Sans Hebrew for Hebrew (both served by the daemon),
tabular numbers. Health is always colour + icon + word; the four source colours avoid green, amber and red so a
source never reads as a state. One line at the top of every section gives the verdict and links each problem to its
section (`/health`, computed on the server so the banner and the menu dots agree). Desktop: sidebar; phone: a tab bar
with "More". Empty, loading and failed states are written out; a failed refresh keeps the last data on screen.

**New data for it** (contract additions, version 1 still: only new fields): `/health`; per source shows, episodes,
canary history, recent reads, empty-show lists and bot-block retries; per proxy exit what the relay saw; the Kan
reader's shows done; posters for top shows; time to first playlist per day; recent plays and failures leading to
traces; failure groups' days and blame; publish history, the catalog check and failing shows; machine totals,
version and start time; the session's time zone.

**Days follow `schedule.timezone`:** rollups, "today", per-day charts and the public addon's daily read now use the
configured time zone's calendar days (Israel by default), so a play at 01:00 is on the day the owner lived it.
Event times stay ISO UTC. No home rollup had been written yet on the deployed instance, so nothing mixes.

**Checked by:** `pnpm shots:dashboard` (the built page under the daemon's own file server and CSP, fixture answers,
frozen clock; every section at 390 px and 1440 px in light and dark; fails on page or console errors — CSP violations
included — failed requests and sideways scrolling) and `pnpm e2e:dashboard` (a real sandbox instance). The
screenshots were looked at and the design iterated (Hebrew titles kept next to their posters, uncounted public days
left blank instead of zero, axis labels, duplicate notes, loading placeholders).

**Reviews of round 6.** A security review of the branch found nothing at high confidence (the admin gate covers the
new routes, the file server and poster lookup cannot leave their folders, the Analytics Engine query takes only
internally built ISO times, proxy credentials never reach the exit table). A code review found ten real issues, all
fixed with tests where they behave: bot-block retries ran early when a job was queued twice (they now run only when
due) and miscounted non-block failures; the live view could leave a second event stream open after a quick tab
switch; the relay did not count a refusing exit against itself before moving on; a refused Akamai ticket skipped
the CloudFront fallback; the health line hid failures blamed on one title (they are counted now, and said so);
an empty older season page could borrow the show's featured video (only the show's own page uses it now); failures
without a play id linked to an empty trace; two quadratic or repeated computations; and the fixture proxy names
looked like a real provider's (now neutral placeholders).

**Supervisor's polish of the live dashboard (2026-11-07).** Memory is shown as in use = total − available (macOS:
free + inactive + speculative + purgeable pages from `vm_stat`; Linux: `MemAvailable`), amber at 85 %, red at 95 %:
counting the file cache as used read "96 %" on a healthy Mac. The page's hidden screen-reader tables (a table ignores
`sr-only`'s 1 px box) made pages taller than the layout, so the sidebar stopped short; they are wrapped now. "Minutes
watched" says that only relayed plays can be timed instead of showing 0. Kan shows its last slice and live channels
their last check instead of "last airing check: never". "One title only" became "Single title refused". The failure
rate also shows the count since the running version was deployed (`sinceRelease`, kept across restarts of the same
revision), so a fix shows at once instead of after a week. A Kan show with the placeholder poster had its image copy
refused (HTTP 403) once and waited a day; failed Kan image copies are now retried every 6 hours (31 shows lacked
their own copy), as slices rotate across proxy exits.

## Round 7: audit fixes, programme guide, more live channels, new addon ids (2026-11-07)

A black-box user-journey audit (from Cyprus, outside Israel) and a research pass over similar projects. Measured
2026-11-07 from outside Israel unless noted.

**Correctness**

- **"Israel only" from a real check, not a rule.** Every Kan stream said "זמין לצפייה רק בישראל", but whole Kan titles
  play abroad (iltv_kan_31, iltv_kan_68: playlist 200 from Cyprus) while others are refused at the playlist (HTTP 403:
  iltv_kan_101). Kan decides per title. The host is outside Israel exactly when it has a geo proxy into Israel, so it
  asks Kan directly (no proxy): the newest episode of each title, playlist → variant → first segment, once a week per
  title; 403/451 → labelled, a full pass → not labelled, anything else → no change (the label stays until it can be
  told). Inside Israel nothing is probed and Kan keeps the label. Live: a stream is labelled only when the daily live
  check from abroad was refused; all Kan live channels played from Cyprus, so none is labelled today. The resolver's
  relay was already decided by trying the direct stream from the viewer's network, so it needed no change.
- **Reshet plays abroad** (11 of 11 sampled episodes): docs said otherwise and now say "most play; a few are
  labelled". Reshet's label stays Kaltura's own access-control flag (profile 3387861).
- **Docs quoted labels the app never shows** ("ישראל בלבד", "דרך ישראל · via Israel"): every page now quotes the real
  strings, "זמין לצפייה רק בישראל" and "דרך החיבור הישראלי שלך".
- **Keshet 12 with no stream and no reason:** every Mako show page now ends with a line saying its episodes need the
  home helper (with where to get it). Not a placeholder "stream" pointing at the guide: Nuvio treats `externalUrl` as a
  video URL (its `Stream.getStreamUrl()` is `url ?: externalUrl`), so the guide link would open in the player and fail —
  on the very app most viewers use, and also for people who have the helper.
- **Kan "ok" while far from complete:** an unfinished first fill (shows its lobbies list with no episode yet) is amber on
  `/status` with "first fill of <row> in progress: N of M shows, P episode pages to read", and the row starts with a
  "⏳ עדיין בטעינה: N מתוך M התוכניות כבר כאן" item. On the live instance all 168 show pages were read but 1,857 episode
  pages waited, in an order (most recently read show first) that left Tehran with none after a day. Episode pages are
  now read breadth-first: newly published ones, then the shows with the fewest episodes, in lobby order.
- **More Kan:** the preschool lobby (kankids.org.il/lobby-kids/tiny/, 29 shows) joins the Kids row; Kan's archive
  lobby (kan.org.il/lobby/series/, 183 classic series such as זהו זה!) becomes a row of its own, **כאן ארכיון**, read
  only when no other Kan show has pages waiting (its show pages too), so it never delays current shows. Archive
  episode pages parse like the others (checked on p-671183). Their "published" date is the upload date, not the
  original broadcast — the year line of an archive show says when Kan put it online.
- **Paging at any offset:** an app may ask any `skip=` (the audit asked 50, 20, 99 and got nothing); stored pages are every
  100, so any other offset is cut from the two stored pages around it.
- **Hebrew prefix letters in search:** a word with a leading ה/ו/ב/ל/מ/ש/כ (or ו + one of them) also matches without it,
  on both sides ("שף" finds "משחקי השף", "לצהל" finds "צה״ל"). Words of two letters or fewer keep their letter.
  Because מ/ש/כ also begin many plain words ("אסטר" now matches "מאסטר"), matches found only that way are listed after
  the plain ones.
- **Reshet episode stills** were 120×90 (Kaltura's image service default when no size is asked, 1,630 of 1,767): asked
  for at 640×360. **Reshet quality** was assumed 720p; iltv_reshet_108:1:9 tops at 960×540. Each episode's master
  playlist is read once (its tallest RESOLUTION) by the stream probes; until then the name says only "רשת 13".
- **Entities:** every named and numeric entity is decoded (`&#x27;` was left in 21 Reshet descriptions).
- **Channel 14's backup** refused https (port 443 closed); the broadcaster's own API now names
  `https://ch14channel14-cdn.encoders.immergo.tv/2/streamPlaylist.m3u8` (720p), which is used.
- **Trailers** ("טריילר", "… | טריילר", promos, teasers) are not episodes: dropped at the source boundary, before
  numbering (a new one never takes an episode number), and from rendering of the two already stored (iltv_kan_6:1:3,
  iltv_kan_53:1:4 were the last numbers of their seasons, so nothing moved; their stored numbers are kept and never
  reused). Numbering stays frozen; no migration was needed.
- **"עונות קודמות" (iltv_reshet_78):** Reshet's own archive bucket of 138 episodes from 2010–2017 next to the year
  seasons. It is a real season on the site; renumbering it would move published episodes, so it stays season 1. Only
  its name, repeated on every episode title, is dropped (as for other generic bucket names).
- **Site prompts** ("… בעמוד כאן תסריטים >>") are dropped from descriptions.
- **Year line:** first and latest episode year, "2024–2026", one year when they are the same (owner's call; this
  replaces "2024–present"). Whether the show still runs is in `status` ("Returning Series"/"Ended"), which apps show
  next to it; Nuvio shows a single year of a running show as "2026 -".
- **Genres:** one name per genre across sources ("לייף סטייל" → "לייפסטייל", "שעשועון" → "שעשועונים", "תעודה" and "דוקו
  ותחקירים" → "דוקומנטרי", "תחקיר" → "תחקירים", "אוכל" → "בישול").
- **Newcomers:** `/` is a short page (what this is, the install link with a Stremio button, the project, the status);
  any method but GET/HEAD answers 405 with `Allow: GET, HEAD` and a sentence on every path the Worker answers (rows,
  search, streams, status, live pages; static files such as `manifest.json` get Cloudflare's own bare 405, which the
  Worker never sees — routing every request through it to add a header would cost a Worker request per file); the resolver-only example points at the
  real public catalog and logs where the docs say; the docs say Raspberry Pi needs its 64-bit system (the images are
  amd64 and arm64; no armv7 image is built).
- **Streams only for the declared types:** `series` for shows, `tv` for live channels; `/stream/movie/…` is empty.

**Live**

- **Programme guide** from the broadcasters' own schedules only (no third-party guide files of unknown licence):
  Keshet 12 (mako.co.il EPGResponse: UTC start + duration), Reshet 13 (13tv.co.il/tv-guide/ `__NEXT_DATA__`, Israel
  time, no ends: the next start), Channel 14 (c14.co.il wp-json, which its robots.txt allows; Israel-time starts and
  ends), the Knesset (knesset.tv's schedule page), and Kan 11, Kan Educational and Makan 33 (kan.org.il/tv-guide/,
  server-rendered per channel and day, UTC starts) through the Kan browser at one page per crawl slice. Mako's robots.txt
  disallows `/AjaxPage`; the project already reads Mako through it at a polite pace, and the guide adds one request
  every 6 hours. Not covered: i24 (its API holds an undated weekly template whose day numbering and time zone could
  not be confirmed, and its own site no longer shows a schedule), Channel 10 (behind Vercel's bot checkpoint, and
  reported to be closing), Channel 24, ynet and the 24/7 loop channels (no schedule published).
- **How the guide reaches apps:** Stremio's EPG (SDK docs/epg.md, 2026-09): `behaviorHints.epgProvider` in the
  manifest, a `date` extra on the live row, and `metasDetailed` pages with each channel's programmes for a UTC day.
  Programmes are **never** put in a channel's own meta as `videos`: Nuvio treats any meta with videos as a series
  (`isSeries = type == SERIES || videos.isNotEmpty()` in its MetaDetailsScreen), which would replace the live play
  button with an episode list. Instead every live tile's description starts with "עכשיו: … (עד 21:00) · אחר כך 21:00:
  …", computed at request time from `epg.json` (live meta pages now run through the Worker: `/meta/tv/*` joined
  `run_worker_first`). A guide entry's id (`<channel>:epg:<start>`) plays its channel, in the addon and the resolver.
- **Captioned feeds:** Keshet 12 with captions for the hard of hearing (a Mako path on CloudFront, played with a ticket
  like the other Mako channels: 200/200/206), Kan 11's (already there), the Knesset's (its "נגיש" feed is the channel
  with Hebrew captions burned in, as knesset.tv names it: now "כתוביות"). Reshet 13's captioned feed needs an `Origin`
  header and an Israeli address at its CDN: not offered.
- **Backups:** a second Reshet 13 backup (720p), ynet's adaptive playlist first (720p/480p), Kan 11/Kan
  Educational/Makan 33 as DASH (the same CDN as their HLS: covers a packager fault, not a CDN outage). DASH carries
  `notWebReady` (Stremio in a browser hands it to its streaming server); Nuvio recognises DASH by its content
  (checked in its PlayerMediaSourceFactory), Stremio's desktop player plays it.
- **New channels** (free, public, measured): Channel 9 (Russian-language, 1080p), Reshet 13's comedy, vacation and
  reality 24/7 channels (1080p), and Keshet's comedy, drama, music and food 24/7 channels (Mako paths, played with a
  ticket: 200/200/206; through the home helper). Their tiles are our own text tiles. Left out: Channel 16 and Kabbalah
  66 (what they are and their terms not confirmed), 100FM's studio camera, Musayof (does not answer), Hala TV (no public
  stream found), Big Brother 24/7 (seasonal, gone).
- **Every live stream checked daily:** the live check (with the full run) plays every stream of every channel, Mako
  channels through the home helper; a dead backup is named on `/status` (amber), a channel with no working stream is
  red, a refusal abroad is a label. The dashboard's Sources page lists each stream and each guide.
- **Radio row: not built.** Every station plays abroad, but as Icecast MP3/AAC (Kan's HLS radio playlists are empty;
  Makan radio is DASH only). Nuvio plays progressive URLs with parallel ranged reads when that setting is on (its
  PlayerMediaSourceFactory), which an endless Icecast stream may well not survive (not tested on a device); Stremio's
  desktop player would play them over a black screen. Without a TV to confirm, a row that may not play in the main
  app is worse than none. Revisit with an HLS source per station (103FM has one) and a device test.
- **VOD from Channel 14, i24 and the Knesset: not this round.** Channel 14 has a VOD API behind its apps (the same
  one that names its live feeds), i24 publishes clips, the Knesset an archive of sessions. Each is a new reader with
  its own numbering and terms to check; recorded for a later round.

**Manifest**

- **New ids:** `community.israel-tv` was generic, and apps and directories key installs on the id. Now
  `io.github.israeltv2.israel-tv` (catalog), `….resolver` (home helper) and `….resolver.remote` (away from home),
  before the stremio-addons.net listing is approved. Show and episode ids did not change, so watch progress stays;
  people reinstall both addons once.
- `contactEmail` (the project address), `behaviorHints.isLive` on live items, `epgProvider` when there is a guide.
  No `countryWhitelist`: it would hide labelled streams instead of showing them (visible failures over hiding).
  Nuvio's optional catalog hints were not needed.
- `stremioAddonsConfig`: config `addon.stremioAddonsConfig` puts stremio-addons.net's signature in the manifest once
  it is issued (the owner pastes it).

## Source triage: Reshet's "empty" shows and numbering notes (2026-11-07)

- **Reshet shows "with nothing to watch" (45): 30 had episodes.** All 45 pages were read again. 29 are older-template
  pages whose Kaltura record has no seasons left (their season pages answer HTTP 500), but the record names the
  show's own site page (`seriesHp`, e.g. `/vod/hostages/`), and that page still lists the episodes as posts, with
  Kaltura videos that all exist (420 of 420 checked). One more (`/shows/free-hour/`) is listed straight to such a
  page. The earlier hand check ("empty `Base` and `PaginationArray` grids") was right for the pages it looked at,
  wrong as a rule. These shows are now read from that page: a post is a full episode when it links to Reshet's
  VOD item (`/allshows/series/<id>/season/<n>/<item>/`) or sits under the show's own `episodes` section; clips,
  recipes and articles link elsewhere and stay out. Grids link to full lists (`…/season-04/episodes/`), which are
  read with their further pages (at most 40 pages per show; the longest, a daily show, has 26), in airing checks
  too (a season read replaces the stored one). Season numbers are the site's ("season-04" stays season 4).
- **Still empty, and why (15):** 14 pages list no videos at all (`post_count` 0: mostly foreign formats); one
  ("חצות ועוד יותר") links to the site's front page. Each says so in plain words on `/status`.
- **Reshet's Kaltura `EpisodeNumber` can be a placeholder.** In some seasons most episodes carry the same number
  (135 of 138 say 1 in one "המקור" season); it gave hundreds of "now פרק 1 at the source" warnings and numbered
  two seasons out of order at first fill (שבוע סוף 2, הטוב מכולם 2: their numbers stay, as all published numbers do).
  A number shared within a season is ignored; the title's own "פרק N" is used.
- **"מתוך פרק 1" is not an episode number.** Kan's songs collection titles songs "… - מתוך פרק 1" (from episode 1);
  two of them collided as episode 1. That phrase is no longer read as the item's number.
- **Expected numbering notes.** "source-renumbered … kept SxEy" stays for an episode whose printed number another
  episode already holds (it was numbered on, once, with "episode-number-taken"): published numbers never move. A
  warning is stored once per distinct text, so an unchanged note does not repeat.

## Public pages: landing and status (2026-11-07)

- **Pre-rendered, no framework.** Both pages are written at publish time by `packages/render` (`landing-html.ts`,
  `status-html.ts`, shared `page.ts`), CSS and a few lines of script inline: one request each, no build step, nothing
  for the Workers to run (the landing page is a static asset; `/status` is read from the assets by the API Worker as
  before). Lighthouse is 99–100 in every category on both. The script only makes times relative, remembers the
  theme and fills the install links when the address was not known at render time; the pages read complete without it.
- **Numbers come from what was published.** `renderSite` counts the rows it just wrote and puts them into
  `status.json` (`catalogs`) and the landing page, so the page, the status and the apps agree.
- **History is cheap:** one query of the runs table for 30 days (`Store.finishedRunsSince`, four columns), folded into
  one health per day per source at publish time. Runs are pruned after 60 days, so 30 always fit.
- **Times as `<time>`.** The fallback text is Israel time; the publisher's comparison drops `<time>` elements, so the
  hourly airing checks alone do not upload a new status page. The "next refresh" time rolls forward a day in the
  browser when the page is older than it.
- **Scrubbed by allowlist.** Error texts can carry the home helper's address, a tunnel, a LAN IP or a file path.
  Rather than trying to name what is private, `publicText` keeps only web addresses on the broadcasters' and
  well-known public hosts (origin and path: queries carry tickets and tokens) and the public addon's exact origin, and
  replaces every other address — with or without a scheme, single-word LAN names with a port — and every path.
  workers.dev and cloudflare.com are not allowed: the private API Worker lives there too. Applied to everything in the
  status file, both in `status.json` and on the page.
- **Two languages for the landing page, one for status.** The landing page is the viewer's way in, so it exists in
  English (`/`) and Hebrew (`/he/`, `dir="rtl"`) with `hreflang` links; the status page is English with the Hebrew row
  and channel names in `<bdi>`. A Hebrew status page can follow if viewers ask.
- **Absolute addresses:** canonical, Open Graph, sitemap and JSON-LD use the origin token, which publish replaces
  with `publisher.publicUrl` or the last deployed address; the addon app now also fills it in HTML, XML and text
  responses, so the local publisher and a first deploy serve correct addresses for whoever asks.
- **Icons and share image are committed files** (`assets/site/`, made by `pnpm images:site` from the branding with
  the installed Chrome): publishing only copies them, so a publish needs no browser. `favicon.ico` comes from a
  hand-drawn `icon.svg` of the logo (crisper at 16 px than a scaled bitmap).
- **Not indexed:** the addon's JSON (`X-Robots-Tag: noindex` from the app and in `_headers`; `Disallow` in
  robots.txt). The pages say `index,follow`.
- **No analytics, no donation links, no web fonts** (system fonts with Hebrew fallbacks). _Fonts superseded in round 9:
  two self-hosted families, see below._

## Kan's bot check (2026-11-07)

Kan's pages and images sit behind Cloudflare. Measured from outside Israel through the Israeli proxy exits:

| Setup                                                                                                                  | Pages challenged                      | Images challenged             |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------- |
| Stock Playwright, fresh browser context per page (what ran until now; 2 days of logs)                                  | 0 of ~555                             | 129 of 273 on one lobby (47%) |
| Stock Playwright, one persistent profile, pages in a row                                                               | 4 of 5 on kan.org.il (kankids passed) | –                             |
| **patchright, one persistent profile** (Google Chrome and Chrome for Testing, two exits, a reused and a fresh profile) | **0 of 34**                           | **0 of ~3,000**               |

- The per-page fresh session got pages through (Cloudflare lets the first navigation of a session in), but it never
  earned a clearance, so nearly half of every page's own images were answered with `cf-mitigated: challenge`: that
  is why 156 of 350 Kan shows had no copied poster ("could not copy its image (HTTP 403)") and the dashboard showed
  a placeholder. It also cost a new proxy session per page, which is why pages were spaced 75 s apart.
- **Chosen: [patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) (`patchright-core`, Apache-2.0), a
  drop-in Playwright build that removes the automation giveaways** (`navigator.webdriver`, `--enable-automation`,
  the `Runtime.enable` leak), with **one persistent profile per proxy exit** (`kan-browser-<exit>/` next to the database) reused across
  slices, the sandbox on (no `--no-sandbox` bar), no custom user agent or viewport, Israeli locale and time zone,
  and **one sticky proxy exit** (the first configured one; Cloudflare's `cf_clearance` cookie is tied to the exit's
  address). The managed check then clears on its own on the first page, as for a person's browser; we never click
  or solve anything, and no paid solving service is involved.
- Pacing follows: one browser per slice, pages 20 s apart, 12 pages per 10-minute slice (about 1,700 pages a day at
  most, less than one page a minute on average), concurrency 1. The first fill of every Kan row (about 2,200
  episode pages plus the archive) takes days less than before.
- **Considered and not taken:** FlareSolverr/Byparr (an extra service to run, and they solve the same way a stealth
  browser does); rebrowser-playwright-core (the same fix, kept as the fallback); camoufox/nodriver/undetected-chromedriver
  (Python, or a different browser engine; patchright keeps the Playwright API this code already uses); `cf_clearance`
  replay into plain HTTP (needs the same TLS fingerprint as the browser).
- **Kan's app API** names most episodes without a page read since 0.5: see "Kan's app API" below.
- **Reported, not hidden:** a page that still meets the check is "blocked by Kan's bot check (Cloudflare)"; the
  slice stops and waits 45 minutes, and no page is charged. The crawl keeps a per-day tally (`kan:crawl` →
  `botCheck`: pages, challenged, images, images challenged; two weeks), and `/status` says how many page loads the
  check stopped today when it stopped any.
- **Tuning:** `scraping.browserPagesPerRun` and `scraping.browserPageIntervalSec` (docs/configuration.md). If the
  tally shows challenges: delete `kan-browser-<exit>/` (a fresh profile clears again), check that the first `geo.urls`
  entry still answers, then slow the pace. Only one process may use the profile at a time (Chrome locks it): run
  `israel-tv kan` by hand only while the daemon is stopped.

**Episode pages that are not episodes.** The four pages reported as "no video player config on the page (layout
changed?)" were none of them a layout change. Two were episodes Kan took down when their rights ended (a
`rights-expired` overlay where the player was: "בשל הסכמי זכויות שידור, … כבר לא זמין לצפייה"); one was an interview
article linked among the episodes (a VideoObject with an empty `contentUrl`); one show's episodes were all taken down.
Episode pages are now classified: a video; the bot check (also when it answers 200); removed; not a video; or
unknown. Removed and not-a-video pages are skipped at once, never retried, and counted on `/status`; only an
unknown page is retried (three times, a day apart) and then given up visibly. A page with a Redge `contentUrl` but
no player config is read from its VideoObject.

**The archive row was empty** ("0 of 171 shows in the catalog, 0 episode pages to read") because its show pages, like
its episodes, waited until every other Kan row had nothing left to read, which at the old pace was a week away. The
archive's show pages are now read after the other rows' due ones in each slice, and episode pages of all rows share
one queue: newly published first, then the show with the fewest episodes (the archive only loses ties).

## Kan's app API (2026-11-07)

Kan's mobile app reads JSON from `mobapi.kan.org.il/api/mobile`: `program?id=<show page id>` lists every episode of
a show (200 per page, `&from=` for more), `subClass?id=<category>` lists a category's shows. From abroad it answers
`403 cf-mitigated: challenge`, like the site; inside the cleared browser session it answers 200. Behaviour learned
from public responses (and from what the Idan Plus Kodi addon requests); no code taken.

What it gives, measured against every stored Kan episode it lists (the live database, 2026-11-07):

- **The same ids:** an item's `id` is the episode's web page id, so its key is the stored `kan:<id>`; a show's
  program id is its `p-<id>`, and kankids shows with a slug address get theirs from the kids categories (4453, 4462).
- **The same title, season and publication day** as the episode page gives (the fields the numbering rules read);
  counts in the dry run below.
- **Streams:** a Kaltura `playManifest` URL. When the web page plays the Kaltura entry, its Redge URL is exactly
  `…/kancdn/vod/<entry id>/LIBCODER_SMOOTH_1080_KAN/Manifest.ism/playlist.m3u8?fmp4`; when the page plays another
  (numeric) Redge asset, that derived URL answers 404 (9 of 9 such cases). Some items carry a YouTube id instead.

How it is used (ids and numbers frozen):

- The crawl reads the same episodes in the same order: show pages still list the episode pages to read, oldest
  first, and a show never reads past a gap. For a show with pages waiting, the slice reads its app list once (one
  request instead of one page per episode). Each waiting episode the app names with a Kaltura entry whose derived
  Redge master answers 200 through the geo proxy is taken from the app (same id, title, season, date, and the same
  stream the page plays); anything else (missing from the app, YouTube, an empty entry, a master that does not
  answer) is read from its page exactly as before, in its turn. New episodes are numbered by the existing rules.
- Only page reads count against the slice's page budget; app-named episodes are capped at 400 per slice (each costs
  one small master-playlist request on Kan's CDN). If the app answers anything unusable, the slice reads pages and
  warns once.
- **Trusted per show, on evidence:** the app's season is not always the page's (42 of 356 stored episodes: the app
  says "s8" or nothing where the page player said 1 or 2), and some shows' pages play numeric Redge assets where the
  app names a Kaltura entry (33 stored episodes; 27 of those derived addresses answer 404, 5 answer 200 with another
  asset). So the app names a show's episodes only once at least two of its episodes read from pages (stored, or read
  earlier in the slice) are listed by the app with the same title, season, day and stream, and none differs; a new
  show reads its first two episodes from pages. 87 shows agree fully; 15 never use the app. Remaining risk, accepted:
  a new episode of an agreeing show whose page switches to a numeric asset while its Kaltura entry still plays would
  get the Kaltura stream (it plays; ids and numbers are unaffected).

**Dry run on a copy of the live database (2026-11-07):** the crawl with the app API, every web page answering 404 so
only app-named episodes could be added, real stream checks through the geo proxy: **all 390 stored Kan episodes kept
their ids and S/E numbers (0 changed, 0 gone); 208 new episodes named by the app** (214 stream checks). In production
about 735 more follow once their shows' two evidence pages are read; the rest of the 2,348 waiting pages (shows the
app plays from YouTube, shows that disagree, withdrawn episodes) are read as pages, as before.

## Kan's queue and pace with the app API (2026-11-07)

**Measured after 0.5.0:** three slices gave +13 (8 named by the app), +51 (47) and +3 (0) episodes: the queue still
put shows with the fewest episodes first, and those had no evidence yet, so most slices read pages for shows the app
could not name yet.

**Queue** (after newly published episodes, which stay first):

1. Shows the app is trusted for: one request each, then filled from the app in bulk, outside the page budget (each
   episode still checked).
2. Shows not judged yet that already have two episodes: one request decides them.
3. Shows still giving their evidence (fewer than two episodes): at most two pages each per turn.
4. Page-only shows: the app disagrees with their pages, or does not list them. Their pages, as before.

(0.6.0 put the evidence pages first; measured, the page budget then ran out before any trusted show got its turn, so
the order is by cost: cheapest unlock first.)

**App lists have their own budget** (as many requests per slice as the page budget, a quarter of the page pause
between them): measured on 0.6.1, show pages, fresh episodes and pages the app cannot name used up the page budget
before most shows got their app list, so slices named 0–1 episodes from the app. A real slice on a copy of the live
database with this change: +89 episodes, 17 shows trusted, 0 stored ids or numbers changed.

Each show's verdict (`trusted`, `disagrees`, `unlisted`) is kept in the crawl state; "disagrees" is final (the app is
never used for that show), "trusted" is re-checked against the episodes read in every slice.

**Pace:** after 228 pages and 420 images in a day with no challenge, the default is now 20 pages per 10-minute slice,
12 s apart (was 12, 20 s). **Rule:** the moment a page, image or app request meets Kan's bot check, the slice stops
and waits 45 minutes (unchanged), and for the next 24 hours slices run at half the pages and twice the pause (10 pages,
24 s with the defaults); `/status` and the log say "calm pace". The per-day tally (`botCheck`) shows whether to tune.

## Round 9: the website (2026-11-07)

**Redesign.** The owner asked for a dark, distinctive look instead of the generic blue one, with motion.

- **Palette from the branding's night picture:** night `#0d0c12` as the ground, the lamp-lit stone of Jerusalem's
  walls `#e8b96a` as the one accent, and red `#ff5141` kept for a single meaning, "on the air now". Dark is the
  default; light (warm paper `#f5f0e7`, accent `#83540c`) is a choice the theme button remembers. The logo keeps its
  own blues.
- **Type with Hebrew, self-hosted:** IBM Plex Sans Hebrew (400/600) for reading, Karantina (700, condensed, a
  broadcast-title voice) for headlines and numbers. Six WOFF2 files, Hebrew and Latin subsets, 49 KB in all
  (`assets/site/fonts`, SIL OFL licences beside them); the page's language preloads its two. No request to a font
  service (privacy). Swapping a face in must not move the page: every page preloads its language's faces (Hebrew
  pages also the Latin reading face, for digits and app names), and until a face arrives the text uses Arial scaled
  to its width per script (`size-adjust`, measured in the browser: Karantina is 70.6% of Arial Bold's width in
  Hebrew, 89.5% in Latin). Measured on the live `/he/`: layout shift 0.184 before, ≤0.04 after.
- The poster wall is anchored to the header's top, not sized from its height: sized from it, every rewrap of the
  text above moved the wall's lanes, which counted as a layout shift (0.34 measured).
- **One bold element, motion with a job:** the home page's header is a wall of real show posters drifting in three
  lanes behind the headline, and under it a "lower third" ticker of what every live channel is airing now. The
  headline lines rise in once on load (60 ms stagger). Everything else answers the reader: poster lift on hover
  (pointer devices only), button press scale 0.97, a pulsing on-air dot, and cross-document View Transitions (a
  poster on a row page grows into the show page's poster; the theme switch cross-fades). CSS and the View Transition
  API only, no library; easing `cubic-bezier(.23,1,.32,1)`, UI motion under 300 ms; `prefers-reduced-motion` turns
  all of it off (the wall and ticker stand still).
- Skills used for the design pass (installed for this agent in the working copy only, not committed):
  `frontend-design`, plus from the skills.sh ecosystem `emilkowalski/skills` (improve-animations,
  review-animations: easing and duration values), `vercel-labs/agent-skills` web-design-guidelines, and
  `addyosmani/web-quality-skills` (accessibility, performance, seo).

**The library on the website: yes.** Pre-rendered Hebrew pages for every row, every show (seasons and episode lists
with stills), the live channels with now/next, and search (details in operations.md, "The library on the website").

- **Static and deterministic.** Each page is a file next to the catalog (~1,100 pages for ~1,060 shows; the free
  plan's 20,000-file limit has room). The publisher uploads only changed files, so nothing in a page depends on the
  moment of rendering: the live guide is written in for its first 36 hours by the guide's own start time, and a
  few lines of script show what is on, hide what ended and draw progress. A test renders twice at different times and
  compares.
- **Stable addresses** from the series ids (`/show/iltv_reshet_10/`), never list positions; rows by their catalog id.
- **SEO:** per-page title, description, canonical, share card (the show's poster), `TVSeries` with `TVSeason` /
  `TVEpisode` and a breadcrumb on show pages, `ItemList` on rows, `BroadcastService` for live channels; every row and
  show page is in `sitemap.xml`. Search is a tool and stays out of the sitemap.
- **Images stay where they are hosted**, sized on request where the host can (Reshet's Cloudinary `w_…`, Kan's
  `width=`): a 1.2 MB Reshet poster comes down as ~30 KB. Mako's are used as they are.
- **Links out, not in:** "Watch in Stremio" opens the show (or episode, or channel) with a `stremio:///detail/…`
  link; Nuvio has no such link, so the page says to add the addon and search the title; "Watch on the broadcaster's
  site" uses the show's own page from the source, and for live channels only pages known to be the channel's.

**No playback on the website** (supervisor decision). Reasons:

- Keshet 12 plays only with a per-viewer ticket bound to the network of the player that asked for it; only the
  viewer's own home helper can get one.
- Kan and some Reshet titles are refused outside Israel.
- The broadcasters' video servers do not send CORS headers for our address, so a player on our page could only play
  them if we relayed the video. We never do that: it costs bandwidth the free plan does not have, and it would turn a
  link index into a re-streaming site, a legal exposure an addon pointing apps at the broadcasters does not have.
  The website links to the broadcaster's own player instead.

**Measured** (Lighthouse 12.8, mobile, against the local preview server on a copy of the live data, uncompressed):

| Page                             | Performance | Accessibility | Best practices | SEO |
| -------------------------------- | ----------- | ------------- | -------------- | --- |
| `/`, `/he/`                      | 99          | 100           | 100            | 100 |
| `/library/`                      | 99          | 100           | 100            | 100 |
| `/library/keshet12/` (660 shows) | 84          | 100           | 100            | 100 |
| a show page                      | 98          | 100           | 100            | 100 |
| `/live/`, `/search/`             | 98–99       | 100           | 100            | 100 |
| `/status`                        | 98          | 100           | 100            | 100 |

The large row's score is its first Mako poster (not resizable) on a server without compression; see the live numbers
below.

**Owner review of the live site (round 9, sections 4–5):**

- Links that leave the site open in a new tab (`target="_blank" rel="noopener noreferrer"`), with a hidden "opens in
  a new tab" for screen readers and, on text links, a small arrow (buttons already carry an icon). Applied to every
  finished page in one place (`externalLinks`, page.ts) and checked by a test over every rendered page. App links
  (`stremio://`) and the site's own links stay in the same tab.
- Right to left: icons stay at the label's inline start (document order in a flex row); directional ones (the
  external arrow, breadcrumb separator) are mirrored in Hebrew; media, search, theme and copy icons are not. The
  season chevron points to the inline end when closed and down when open in both directions (drawn with physical
  borders, so it does not flip twice).
- Bidi: a Hebrew page's tab title starts with a right-to-left mark and isolates its Latin names, so "Israel TV" stays
  whole. Hebrew quotes are plain `"…"` around an isolated title.
- Copy: "newest first" and similar filler removed; plural imperatives throughout the Hebrew pages.
- One logo tile everywhere (row cards, live tiles, status cards, the ticker): the same box, padding and corner, the
  logo contained. Kan's archive has no channel of its own, so it gets a lettered tile ("כאן / ארכיון"), never Kan 11's
  logo. A row in its first fill shows "First load: 1 of 171" with a bar instead of zeros, and the posters of the shows
  it lists before their episodes arrive.
- Row cards share rows (CSS subgrid): header, counts, where it plays, posters line up across a row of cards. Five
  cards are laid out as two wide and three narrow, four as two by two.

## Round 10, live and publishing: only real problems are errors (2026-11-07)

Measured on the home instance (runs, warnings, events.sqlite, logs; last 3 days) before changing anything.

- **Kan live channels "not answering (HTTP 403)"** (Kan Educational ×5 2026-11-06 06:00–06:22 UTC, Makan 33 08:34,
  Kan 11 2026-11-07 02:05). Cause: the old live check (before 0.3.0) read only each first master playlist with a
  bare `Mozilla/5.0` and called any 403 "down", even from abroad. Since 0.3.0 (deployed 2026-11-07 04:00 UTC) every
  stream is played like a player (ExoPlayer user agent, playlist → variant → segment) and a refusal abroad is a
  label: no such failure since. The refusals themselves were real and by programme: Kan Educational was refused for
  22 minutes straight, then played; a watch from the home instance (abroad) on 2026-11-07 (every 2 minutes, four Kan streams; a first pass with four
  user agents and none) saw every play 200/200/206, so it is not the user agent or a token. Decision: a stream that
  fails is played once more 30 s later (a refusal abroad is not: a programme's block lasts); each stream keeps
  its last 20 outcomes; the label says "זמין לצפייה רק בישראל" only for a stream never played abroad and "לפעמים
  זמין רק בישראל" for one refused sometimes; Kan's three channels (`geo`) always say at least "sometimes" (the home
  helper relays them when refused). Before, a single refusal turned a stream "Israel only" until the next check.
- **Channel 14 "variant is not a playlist"** (one run, 2026-11-07 02:09 UTC, with ynet 720p). Cause: its address is
  a media playlist (segments, no variants) and the old check took its first segment for a variant. Fixed in #117
  (0.3.0); every check since plays it; test with a trimmed copy of the real playlist.
- **Cloudflare publish failures** (9 in 8 minutes on 2026-11-06 09:25–09:33 UTC, "malformed response … no healthy
  upstream"; the next one passed). A publish now retries Cloudflare's own trouble 4 times with growing, jittered
  pauses (15 s → 3 min); a try resumes the uploads of the last one (assets go up by content hash). `/status` raises
  it only after 3 failed publishes in a row (a token or account problem at once, with the token hint, which outages
  no longer get). The one "versions API" error (Analytics Engine not enabled, 2026-11-06 11:47) is the API Worker's
  setup and handled since round 3 (deploys without it, `/status` says so).
- **Resolver "no stream for this id here" as `error`** (14 in 3 days: Channel 13 ×13, Channel 14 ×1, last
  2026-11-07 03:10). Apps ask every installed addon for every id, so the helper is asked for titles it has nothing
  to add to. Now outcome `not-mine` (never counted as a failure); `error` only where the helper had a job and failed
  it: Mako (a ticket per play), a relay it should have offered, or one of our own titles it does not know. Channel 13 and 14 already answered "none needed" since #124; the 14 old events were
  relabelled once at start-up (`fix:not-mine`).
- **Old Mako failures** (2026-11-06 12:09–12:13 UTC: master 403, then 502 "Invalid URL", two of them a viewer's): the
  round-6 bug, fixed by Mako's CloudFront fallback (#111, 2026-11-07). None since (checked in events.sqlite). The
  dashboard lists them as "fixed" with what was done and leaves them out of every count of open problems (failures,
  rate, since this version, health line; `KNOWN_FIXES`); the canary's own plays
  were already relabelled.
- **Not done:** the live check does not play refused Kan streams through the relay (each relay play is a geo proxy session, and the
  proxy provider locks the login after ~10 quick sessions); the daily canary already plays a relayed Kan title.
## Round 10, ingest correctness: numbering, Kan retries, bot checks, titles (2026-11-07)

Measured on a copy of the live database and the runs/warnings of the three days before.

- **Printed episode numbers win; seasons numbered against them moved once.** "source-renumbered" (31 warnings in the
  last Reshet full run, 15 of them on שבוע סוף) was real: viewers saw "פרק 14" as S2E1. Causes: (1) Reshet's
  Kaltura `EpisodeNumber` was preferred over the title's "פרק N", and it is often a placeholder (every episode 1) or
  a list position (טלוויזיה מהעתיד 2: the special is 1, "פרק 1" is 2), so a season was numbered in list order;
  (2) Kan's crawl reads a show over several slices, and an episode without a printed number read before its printed
  siblings took their number (מלכת השכונה: "מה לא עובד?" took 2, "פרק 2" became 5); (3) Kan re-published an
  episode under a new page, and the withdrawn page kept its number (השופטים). Fixes: the Reshet reader prefers the
  title's number and drops a number two episodes of one season claim (חוזרים לפספוסים: a title's 3 next to
  another episode's Kaltura 3); Kan holds an unnumbered episode back until its show's other pages are read when the
  show prints numbers (a show's very first episode cannot know yet). The stored numbers were moved by two recorded
  one-time migrations (`kan-printed-numbers-2026-11-07` at start-up, `reshet-printed-numbers-2026-11-07` after the
  first full Reshet read with the fixed reader): backup first, one transaction, a `.moves.json` parity list next to
  the backup and the report in `numbering:migrations:<id>`. Per season (never year seasons, never one whose printed
  numbers run against the air dates — the rules number those by date): printed numbers are taken; other episodes
  keep theirs unless a printed one claims it, then go after the season's highest. The owner accepted the one-time
  watch-progress move. Dry run on a copy of the live database after a full Reshet read with the fixed reader (270 shows, 0 failed): Reshet 1,183 episodes in 100 seasons of 58 shows (e.g. האח הגדול 1: "אירוע הפתיחה" was E9, now E1; משחקי השף 4: the final was E21, now E35), 1,105 "source-renumbered" warnings in that read and 0 after; no duplicate season/episode, guard consistent; Kan 7 episodes in 3 shows (זמן אמת, השופטים,
  מלכת השכונה). Not moved, on purpose: seasons where Kaltura's numbers are the only evidence and run against the
  upload dates (e.g. הישרדות 7). Their "air dates" are bulk upload dates (2015-11-0x, 2017-03-28, 2021-01-10,
  2023-03-30/04-03), so neither order is provable, and Kaltura's numbers were measured reversed in some seasons
  (משחקי השף 4: 1 is the announcement, 2 the final): the rules' date order stays.
- **Kan retries converge.** "N Kan shows wait to retry an episode page" kept ~150 slices "partial" in three days:
  3 shows waited on pages charged by an older reader ("no video player config"), and retries queued behind the
  whole backlog, so they were never tried again. A due retry now goes first (one page settles it), tries are 6 hours
  apart (3 tries), and a show waiting for a retry is a note on the slice and on `/status`, not a partial slice;
  only pages that fail in the slice itself make it partial. Pages given up on are counted on `/status`.
- **Reshet "Failed query: insert into episodes" (אזור בחירה and 36 more) and "neither a VodPlaylist grid nor a
  program" (חצות ועוד יותר, שעה חופשית):** both from the first full run (2026-11-06 05:06Z and 05:41Z), before
  "dedupe repeated episodes" (an entry listed twice inserted twice; test "an episode listed twice by the source is
  stored once") and "shows without VOD are empty, not failed". None since; re-read today: אזור בחירה reads with 0
  warnings, שעה חופשית is in the catalog, חצות ועוד יותר is noted as a link to the site's front page.
- **Reshet's 14 "its page lists no videos" are empty.** Read again 2026-11-07: every page has empty `Base` and
  `PaginationArray` grids, no Kaltura id anywhere in the page data. Not a geo or access profile: listings read
  from abroad include Israel-only entries (2,407 Reshet episodes are labelled Israel-only), so the site does not
  filter its lists by viewer country.
- **Mako's Radware bot check (`/radware/i` for 4 shows in 3 days)** delays a show and never fails a run: see
  docs/operations.md "bot protection". Measured from abroad at production pace: 0 blocks in 60 show pages (with
  and without a kept session); a forced block (script user agent) is a 302 to `validate.perfdrive.com` and a 200
  block page; a fresh request 0–5 s later passed (2 of 2). The fetcher used to recognise the block page only after
  its retries, so a block was never retried.
- **Site text in a title** (iltv_mako_654: "… | סרט דוקומנטרי לצפייה ישירה. makoTV"): Mako's page title carries a
  search-engine line and the site's name. Removed at the source and by the title cleaner in general; over all
  38,857 stored episode titles nothing the catalog audit calls site text is left.
||||||| 61549cd
