# @israel-tv/mako — reads Mako (Keshet 12) VOD: index, shows with all seasons, playlists

Mako serves its VOD as JSON (`?platform=responsive`). This package lists the shows, reads one show with all its
seasons into the common model, and builds and parses the playlist request for one episode. It is shared by
`ingest` (catalog) and `resolver` (play time), so it lives in a package of its own.

## Responsibility

- The index (`/mako-vod-index`) → show entries; one show page plus each season's page → `ScrapedShow`.
- Skipping a season Mako lists but whose page is gone (404), with a note on the show instead of failing it.
- Validating every response with `zod` schemas, so a changed site fails loudly instead of producing empty data.
- The unsigned `playlist.jsp` URL and its parsing (the resolver adds the ticket at play time).

## Must not

- Be used by the Workers (`workers-only-worker-safe-packages`).
- Import an app, or reach into another package by path.
- Make its own HTTP client: requests go through the `Fetcher` from `@israel-tv/net` it is given.
- Contact Mako from tests.
- Copy code from other community addons (clean-room: study behaviour and the public endpoints only).

## Inputs and outputs

- `MAKO_ORIGIN`, `MAKO_CATALOG` (`iltv_keshet12`) — the site and its catalog row.
- `fetchIndex(fetcher)` → `MakoIndexEntry[]` — every show in the index.
- `fetchShow(fetcher, entry, { currentSeasonOnly? })` → `ScrapedShow` — one show (airing checks read only the
  current season).
- `MakoPlay`, `makoPlaylistUrl(play)`, `parsePlaylist(raw)`, `fetchPlaylist(fetcher, play)` — one episode's HLS
  media URLs, unsigned.
- `parseIndex`, `parseShowPage`, `episodesFromPage`, `seasonRefs`, `seasonsFrom`, `showArtwork`, `SeasonRef` —
  the pure parsers behind the above.

## Run and test it alone

```bash
pnpm --filter @israel-tv/mako test
pnpm --filter @israel-tv/mako typecheck
```
Tests run on recorded JSON responses in `test/fixtures/` (`index.json`, `show-*.json`, `season-*.json`,
`playlist-*.json`); a fixture `Fetcher` in `test/mako.test.ts` maps each request path to a fixture and fails on
any path it does not know, so tests never contact Mako. To add or refresh a fixture, save the real response of
`https://www.mako.co.il/<path>?platform=responsive` unedited (except removing anything personal; responses normally contain none) as `test/fixtures/<name>.json`, map its path in the
test's `fixtureFetcher({ ... })`, and assert on it. To try a real read once: `pnpm israel-tv full --source mako
--limit 5`.

## Related

- [../../docs/architecture.md](../../docs/architecture.md)
- [../../docs/contract.md](../../docs/contract.md)
- [../../docs/configuration.md](../../docs/configuration.md)
- [../../docs/operations.md](../../docs/operations.md)
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md)
