# Changelog

Versions follow [Semantic Versioning](https://semver.org/); entries come from the commit history
([Conventional Commits](https://www.conventionalcommits.org/)). Israel TV is in beta: anything may still change.

## [0.4.0](https://github.com/israeltv2/israel-tv/compare/v0.3.0...v0.4.0) (2026-11-07)


### Features

* public landing and status pages, icons and SEO ([#123](https://github.com/israeltv2/israel-tv/issues/123)) ([9d23720](https://github.com/israeltv2/israel-tv/commit/9d237204b0e9bf3a55dce16487c5373848e75dd8))


### Bug Fixes

* Kan clears its bot check (patchright, persistent profile), classifies episode pages, fills the archive row ([#125](https://github.com/israeltv2/israel-tv/issues/125)) ([d59e5ab](https://github.com/israeltv2/israel-tv/commit/d59e5ab5e75153c389c450ed25974657bb769dcf))
* **mako:** strip a trailing separator left after Mako's boilerplate in film titles ([#120](https://github.com/israeltv2/israel-tv/issues/120)) ([9044d02](https://github.com/israeltv2/israel-tv/commit/9044d02d42c7dca6c766ad1f05db16ae1c3d7a84))
* real images on every dashboard row, image audit, dashboard icon, honest usage numbers ([#122](https://github.com/israeltv2/israel-tv/issues/122)) ([7bceef4](https://github.com/israeltv2/israel-tv/commit/7bceef4af69b10e9374e61f4769fa580f14cca6f))
* **reshet:** read 30 "empty" shows from their own site pages; placeholder episode numbers ignored ([#124](https://github.com/israeltv2/israel-tv/issues/124)) ([717564b](https://github.com/israeltv2/israel-tv/commit/717564ba748d560f6aa86ceca781465db4b50eb7))

## [0.3.0](https://github.com/israeltv2/israel-tv/compare/v0.2.2...v0.3.0) (2026-11-07)


### Features

* programme guide, more live channels, measured Israel-only labels, new addon ids and audit fixes ([#115](https://github.com/israeltv2/israel-tv/issues/115)) ([f70f712](https://github.com/israeltv2/israel-tv/commit/f70f712c2bc04e1579ddaf7d0be7e6a19d490230))
* the owner's dashboard rebuilt (React, Tailwind, Recharts) with a health verdict, source cards and play traces ([#112](https://github.com/israeltv2/israel-tv/issues/112)) ([7317981](https://github.com/israeltv2/israel-tv/commit/73179811497c223b6c1d08ef1a14c2c365b3b881))


### Bug Fixes

* a new release's manifest is published at start and cached for five minutes ([#109](https://github.com/israeltv2/israel-tv/issues/109)) ([907969a](https://github.com/israeltv2/israel-tv/commit/907969acfe88d1592446efd3d61ead02a11b7b12))
* dashboard polish — real memory use, full-height layout, clearer cards, failures since this version, Kan art retried every 6 h ([#114](https://github.com/israeltv2/israel-tv/issues/114)) ([61698d6](https://github.com/israeltv2/israel-tv/commit/61698d6fc173367229f1c1c92edd547e10df7cea))
* Kan probes take at most half of each call, so Reshet qualities are measured too ([#119](https://github.com/israeltv2/israel-tv/issues/119)) ([2c58d35](https://github.com/israeltv2/israel-tv/commit/2c58d354d0b70519a07d7e5b598690ab99483fed))
* Mako CloudFront fallback, canary that tells a dead episode from a broken source, probes kept out of usage, featured-video Mako pages, bot-block retries ([#111](https://github.com/israeltv2/israel-tv/issues/111)) ([494c177](https://github.com/israeltv2/israel-tv/commit/494c17748dba8a0cf071fd6ce9eaa734cfcbcd12))
* Reshet stills stored before sizing are published at 640×360 too ([#118](https://github.com/israeltv2/israel-tv/issues/118)) ([0d4b83c](https://github.com/israeltv2/israel-tv/commit/0d4b83c2a16448d3cca768bf5079bae84ead77e8))
* the live check plays media playlists (Channel 14, ynet 720p) instead of calling them broken ([#117](https://github.com/israeltv2/israel-tv/issues/117)) ([9e8f370](https://github.com/israeltv2/israel-tv/commit/9e8f37087ed8920e707fbd4c612f038a0a27c23c))
* top shows list only shows that were played ([#113](https://github.com/israeltv2/israel-tv/issues/113)) ([342472e](https://github.com/israeltv2/israel-tv/commit/342472ec4c8b3f9c629ea4f3413de1990fc20763))

## [0.2.2](https://github.com/israeltv2/israel-tv/compare/v0.2.1...v0.2.2) (2026-11-06)


### Bug Fixes

* right-to-left embedding instead of a mark (Nuvio lays lines out left to right); status and lastAirDate for the year line ([#107](https://github.com/israeltv2/israel-tv/issues/107)) ([add8713](https://github.com/israeltv2/israel-tv/commit/add871388260d4817b04ee74abd95933ef2634c5))
* right-to-left mark on Hebrew lines with Latin letters or digits; filler endings dropped from episode titles ([#104](https://github.com/israeltv2/israel-tv/issues/104)) ([5cb2114](https://github.com/israeltv2/israel-tv/commit/5cb21140253e8aabaa52c2a1bc2935d2c927f75b))
* year line in the usual form — 2024–present while running, 2021–2024 or one year once ended ([#108](https://github.com/israeltv2/israel-tv/issues/108)) ([4d13576](https://github.com/israeltv2/israel-tv/commit/4d135766b232e88b8def24fe1086ecb46a867df5))

## [0.2.1](https://github.com/israeltv2/israel-tv/compare/v0.2.0...v0.2.1) (2026-11-06)


### Bug Fixes

* episode titles lose trailing separators and SEO endings (found by the catalog audit) ([#102](https://github.com/israeltv2/israel-tv/issues/102)) ([ed25a8f](https://github.com/israeltv2/israel-tv/commit/ed25a8facc837061c38e82d164d641fd230058b4))
* Kan numbered by its own titles, Reshet untitled daily seasons by air year (one-time recorded renumber with backup); numbering frozen — rules test and a publish guard against moved episodes ([#98](https://github.com/israeltv2/israel-tv/issues/98)) ([16ce726](https://github.com/israeltv2/israel-tv/commit/16ce72694e049c1bcfabf2fb584d9e4c1ca2b701))
* live sweep — one Cache-Control, clean Kan names, useful stream labels, live backdrops, English search aliases, hide switch and removal requests, free-plan quota on the dashboard; Kan subtitles recorded ([#95](https://github.com/israeltv2/israel-tv/issues/95)) ([5117956](https://github.com/israeltv2/israel-tv/commit/5117956f903ea784c966cca1832f65c3399232d3))
* named seasons below 101 (recorded migration), empty seasons unnumbered, cleaner descriptions, no stream for gone Reshet entries, built-in catalog audit on /status ([#100](https://github.com/israeltv2/israel-tv/issues/100)) ([abcbda8](https://github.com/israeltv2/israel-tv/commit/abcbda83f1c753736079f7b081377c8e150dbb50))
* one-time migrations are written to the service log and their report kept in the database ([#99](https://github.com/israeltv2/israel-tv/issues/99)) ([e3ab209](https://github.com/israeltv2/israel-tv/commit/e3ab2097ec873334ad2371344c35562cc8d9f7e4))
* persona review — Reshet descriptions, tidy episode titles and texts, no untitled-season prefix, Kan name leftovers, plain live texts, cleaner genre filters, whole-word search with live channel names ([#97](https://github.com/israeltv2/israel-tv/issues/97)) ([f302947](https://github.com/israeltv2/israel-tv/commit/f3029474f492a4fe3f72e71e4ced32bd9a9be51e))
* releaseInfo is first–last episode year or one year, never open-ended ([#96](https://github.com/israeltv2/israel-tv/issues/96)) ([a074867](https://github.com/israeltv2/israel-tv/commit/a07486760b035e239f7bff92cc8cff2f4cd14f9f))
* Reshet daily shows stay split by year whatever one read sees; repair the 11 shows folded back during the deploy ([#101](https://github.com/israeltv2/israel-tv/issues/101)) ([d54f202](https://github.com/israeltv2/israel-tv/commit/d54f2023dcb857f737d2931459bac99305889f3a))
* **security:** audit fixes — router refuses non-GET, owner-only databases and backups, pinned actions, release tag via env; audit record; dashboard links ([#91](https://github.com/israeltv2/israel-tv/issues/91)) ([253fbe3](https://github.com/israeltv2/israel-tv/commit/253fbe3b12b891998748708a7492e5800bc6a002))
* series posters are portrait — posterShape poster, measured posters, portrait versions of landscape images, never a poster refused abroad ([#93](https://github.com/israeltv2/israel-tv/issues/93)) ([6f12abf](https://github.com/israeltv2/israel-tv/commit/6f12abf7591547d62c13299a252adc6a057ddfcc))
* show metadata — year seasons numbered by position (one-time renumber), no year prefix in titles, first-aired releaseInfo ranges, genres with a row filter, imdb_id, release version and a plain description ([#94](https://github.com/israeltv2/israel-tv/issues/94)) ([6417086](https://github.com/israeltv2/israel-tv/commit/64170865d0cdcaeaffb7ef3c7dfcbf9f906f5f30))

## [0.2.0](https://github.com/israeltv2/israel-tv/compare/v0.1.0...v0.2.0) (2026-11-06)

### Features

- the owner's dashboard ([#88](https://github.com/israeltv2/israel-tv/issues/88)) ([2734165](https://github.com/israeltv2/israel-tv/commit/2734165a35982fc1ee1dbd6767ff6dad8e0f29fb))

### Bug Fixes

- docs review round 1 and the Windows, logging and proxy findings ([#86](https://github.com/israeltv2/israel-tv/issues/86)) ([925385b](https://github.com/israeltv2/israel-tv/commit/925385b8d6038add3ff5fa195539e7eedd16ab24))
- docs review round 2, Windows logging and proxy log readability ([#87](https://github.com/israeltv2/israel-tv/issues/87)) ([9b3d5df](https://github.com/israeltv2/israel-tv/commit/9b3d5dfeab91e4072f868f4fb91ab9fe19c9e62d))

## 0.1.0 (2026-11-06)

First versioned release (beta).

- Catalog rows in Hebrew for Keshet 12 (Mako), Reshet 13, Kan 11 and Kan Kids, newest episode first, with search and
  show pages; 16 live channels; permanent ids so watch progress never moves.
- Public catalog on Cloudflare as two Workers (a public one with the catalog and a tiny router, a private API
  one), batched publishing, per-Worker rollbacks.
- The home helper (resolver): Mako playback on your own network, an optional away-from-home link, and relaying of
  Israel-only titles through a proxy with an Israeli exit, reading the catalog through a versioned contract.
- Runs on Windows, macOS and Linux; ready images for amd64 and arm64.
