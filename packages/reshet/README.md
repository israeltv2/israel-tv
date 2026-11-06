# @israel-tv/reshet — reads Reshet 13 (13tv.co.il) shows and labels geo-blocked episodes

Reshet's pages are Next.js HTML with the data embedded in `__NEXT_DATA__`; video is on Kaltura. This package
lists the shows, reads one show with all its seasons into the common model, and asks Kaltura which episodes are
blocked outside Israel so they can be labelled. It is a package so the scraping stays apart from scheduling and
storage in `apps/ingest`.

## Responsibility

- The all-shows page → show entries; a show page plus each season page → `ScrapedShow`.
- A season Reshet lists but whose page is gone (404) becomes a note on the show, not a failed show.
- Each episode's direct HLS URL (Kaltura `playManifest`).
- The "blocked outside Israel" label from Kaltura access-control profiles, checked once per profile; if Kaltura
  fails, the show is still read and the failure noted.

## Must not

- Be used by the Workers or the resolver (`workers-only-worker-safe-packages`,
  `resolver-not-ingest-or-catalog-db`).
- Import an app, or reach into another package by path.
- Fetch the site except through the `Fetcher` from `@israel-tv/net` it is given.
- Contact Reshet or Kaltura from tests.
- Copy code from other community addons (clean-room: study behaviour and the public pages only).

## Inputs and outputs

- `RESHET_ORIGIN`, `RESHET_CATALOG` (`iltv_reshet13`), `KALTURA_PARTNER` — the site, its row, the Kaltura partner.
- `fetchIndex(fetcher)` → `ReshetIndexEntry[]` — every show on the all-shows page.
- `fetchShow(fetcher, entry, { currentSeasonOnly?, profiles?, kaltura? })` → `ScrapedShow` — one show.
- `blockedEntries(entryIds, profiles, post?)` → entry id → blocked here; `kalturaPost`; `ISRAEL_ONLY_PROFILES`.
- `playManifestUrl(entryId)` — an episode's HLS URL.
- `nextData`, `parseAllShows`, `parseShowPage`, `parseSeasonPage`, `fromOld` — the pure parsers behind the above.

## Run and test it alone

```bash
pnpm --filter @israel-tv/reshet test
pnpm --filter @israel-tv/reshet typecheck
```
Tests parse recorded pages in `test/fixtures/` (`all-shows.html`, `show-*.html`,
`kitchen-nightmares-season-2.html`): `test/reshet.test.ts` serves them by path through a fixture `Fetcher`
(unknown paths answer 404) and replaces Kaltura with a stub `kaltura` function, so tests never contact the
network. To add or refresh a fixture, save the raw HTML of `https://13tv.co.il/<path>` (View source → save, or
`curl -sL https://13tv.co.il/<path> -o test/fixtures/<name>.html`; retry once on a 403) — not a browser's saved or
inspected page; the parser reads the page's `__NEXT_DATA__` JSON, which is also the part to compare. Unedited except
removing anything personal (pages normally contain none). A parser test calls `parseShowPage(html('<name>'))` directly;
map the path in the test's fake fetcher only to test reading a whole show.
To try a real read once: `pnpm israel-tv full --source reshet --limit 5`.

## Related

- [../../docs/architecture.md](../../docs/architecture.md)
- [../../docs/contract.md](../../docs/contract.md)
- [../../docs/configuration.md](../../docs/configuration.md)
- [../../docs/operations.md](../../docs/operations.md)
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md)
