# Changelog

Versions follow [Semantic Versioning](https://semver.org/); entries come from the commit history
([Conventional Commits](https://www.conventionalcommits.org/)). Israel TV is in beta: anything may still change.

## 0.1.0 (2026-11-06)

First versioned release (beta).

- Catalog rows in Hebrew for Keshet 12 (Mako), Reshet 13, Kan 11 and Kan Kids, newest episode first, with search and
  show pages; 16 live channels; permanent ids so watch progress never moves.
- Public catalog on Cloudflare as two Workers (a public one with the catalog and a tiny router, a private API
  one), batched publishing, per-Worker rollbacks.
- The home helper (resolver): Mako playback on your own network, an optional away-from-home link, and relaying of
  Israel-only titles through a proxy with an Israeli exit, reading the catalog through a versioned contract.
- Runs on Windows, macOS and Linux; ready images for amd64 and arm64.
