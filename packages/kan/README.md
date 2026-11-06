# @israel-tv/kan — reads Kan (kan.org.il, kankids.org.il) pages through a real browser

Kan's pages sit behind a Cloudflare challenge that only a real browser passes, and video URLs appear only in
an episode page's player config. This package holds the browser adapter that loads one page per fresh browser
context, and the parsers for lobby, show and episode pages. The crawl schedule itself lives in
`apps/ingest` (`src/kan.ts`).

## Responsibility

- Loading a page in installed Chrome/Edge or a configured Chromium (`playwright-core`), with images, fonts and
  media blocked, optionally through the geo proxy.
- Detecting a challenge page instead of content (`isChallenge`), so a block is reported, not parsed as empty.
- Parsing lobby → show pages → episode pages into links, posters and the episode's HLS URL.

## Must not

- Be used by the Workers or the resolver (`workers-only-worker-safe-packages`,
  `resolver-not-ingest-or-catalog-db`).
- Import an app, or reach into another package by path.
- Contact Kan from tests.
- Copy code from other community addons (clean-room: study behaviour and public pages only).

## Inputs and outputs

- `createChromeLoader(browserConfig, proxy?)` — a `PageLoader` that loads one page per fresh browser context.
- `browserCandidates(executablePath?)`, `BrowserCandidate` — browsers to try: the configured path, else Chrome, Edge, a Linux Chromium.
- `PageLoader`, `LoadedPage`, `LoadOptions`, `CapturedImage` — loader types.
- `KAN_ORIGIN`, `isChallenge(html)` — the site origin and block detection.
- `parseLobby(html, origin, channelPath)`, `parseLobbyPosters(html)` — show links and posters from a lobby.
- `parseShowPage(html, showPath)` → `KanShowPage` — title, description, image and `KanEpisodeLink`s.
- `parseEpisodePage(html, origin?)` → `KanEpisode` — one episode, with its stream URL.

## Run and test it alone

```bash
pnpm --filter @israel-tv/kan test
pnpm --filter @israel-tv/kan typecheck
```
Tests parse recorded pages in `test/fixtures/` (`lobby-*.html`, `show-*.html`, `episode-*.html`); they never
contact Kan. To add or refresh a fixture, save the page's full HTML as Chrome received it after the challenge
(for example with `spikes/src/kan-dump.ts`, which saves each page it visits; see its header), put it in
`test/fixtures/` under a descriptive name, and assert on it in `test/parse.test.ts`. Keep the real page as it
came; do not hand-edit it. To try the live crawl once: `pnpm israel-tv kan` (needs a browser and, outside
Israel, the geo proxy).

## Related

- [../../docs/architecture.md](../../docs/architecture.md)
- [../../docs/contract.md](../../docs/contract.md)
- [../../docs/configuration.md](../../docs/configuration.md)
- [../../docs/operations.md](../../docs/operations.md)
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md)
