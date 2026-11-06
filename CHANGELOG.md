# Changelog

Versions follow [Semantic Versioning](https://semver.org/); entries come from the commit history
([Conventional Commits](https://www.conventionalcommits.org/)). Israel TV is in beta: anything may still change.

## [0.2.0](https://github.com/israeltv2/israel-tv/compare/v0.1.0...v0.2.0) (2026-11-06)


### Features

* the owner's dashboard ([#88](https://github.com/israeltv2/israel-tv/issues/88)) ([2734165](https://github.com/israeltv2/israel-tv/commit/2734165a35982fc1ee1dbd6767ff6dad8e0f29fb))


### Bug Fixes

* docs review round 1 and the Windows, logging and proxy findings ([#86](https://github.com/israeltv2/israel-tv/issues/86)) ([925385b](https://github.com/israeltv2/israel-tv/commit/925385b8d6038add3ff5fa195539e7eedd16ab24))
* docs review round 2, Windows logging and proxy log readability ([#87](https://github.com/israeltv2/israel-tv/issues/87)) ([9b3d5df](https://github.com/israeltv2/israel-tv/commit/9b3d5dfeab91e4072f868f4fb91ab9fe19c9e62d))

## 0.1.0 (2026-11-06)

First versioned release (beta).

- Catalog rows in Hebrew for Keshet 12 (Mako), Reshet 13, Kan 11 and Kan Kids, newest episode first, with search and
  show pages; 16 live channels; permanent ids so watch progress never moves.
- Public catalog on Cloudflare as two Workers (a public one with the catalog and a tiny router, a private API
  one), batched publishing, per-Worker rollbacks.
- The home helper (resolver): Mako playback on your own network, an optional away-from-home link, and relaying of
  Israel-only titles through a proxy with an Israeli exit, reading the catalog through a versioned contract.
- Runs on Windows, macOS and Linux; ready images for amd64 and arm64.
