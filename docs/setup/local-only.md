# Your own copy at home (role `local-only`)

Everything runs on one computer at home: the reader that visits the broadcasters' sites, the catalog your app
talks to, and the home helper for Keshet 12. The catalog is reachable on your home network only. No account is
needed.

## Requirements

- A computer that stays on (Windows, macOS, Linux, NAS, Raspberry Pi), with [Node.js](https://nodejs.org) 24.11+
  and git — or Docker (see [background](background.md#docker)).
- For **Kan episodes**: Google Chrome, Microsoft Edge or Chromium on that computer (a desktop session; see
  [Kan](#kan-episodes)). Without one, everything except Kan episodes works.
- **Outside Israel**: a proxy with an Israeli exit (see [Abroad](#abroad)).

## Install and start

```bash
git clone https://github.com/israeltv2/israel-tv.git
cd israel-tv
corepack enable          # or: npm i -g pnpm@12.15.0
pnpm install
pnpm start
```

No settings are needed. `pnpm start` prints the links to add in your app (also `pnpm israel-tv urls` any time):

```
addon — install this in your app: http://<this computer's address>:7700/manifest.json
resolver — install this too, at home: http://<this computer's address>:7701/manifest.json
```

Add **both** in your app. The first gives the rows, show pages, search and the streams that need nothing else; the
second plays Keshet 12 (and, abroad, relays Israel-only episodes).

_What to expect:_ the first start reads Keshet 12 and Reshet right away (about 30 minutes; one request a second, so
the sites are not hammered), then every night, and airing shows every hour (every 15 minutes in the evening).
`pnpm start --no-initial-run` skips the first read for a quick try. Stop with Ctrl-C.

## Settings

To change anything, create `israel-tv.config.json` in your config folder (`pnpm israel-tv paths` shows it), starting
from [examples/local-only](../../examples/local-only/israel-tv.config.example.json). Every option:
[configuration](../configuration.md). Secrets go in `.env` in the same folder.

The admin page (status, usage) is yours only: `pnpm israel-tv admin-url` prints its link with your token; open it
once and the browser keeps it for 30 days.

## Kan episodes

Kan's site shows a browser one page per session before it asks for a human check, and each episode's video is only
on its own page. So Kan is read slowly on purpose: a few pages every ten minutes, each in a fresh browser session,
pausing 45 minutes when the site pushes back. The first fill takes a few days; after that new episodes appear
within hours. The admin `/status` shows how many pages are still waiting.

The browser window is real but placed off-screen (Kan's check passes far more often that way), so it needs a
desktop session. On a server without a screen, run it under `xvfb-run`, or set `"browser": { "type": "none" }` to
leave Kan episodes off. Israel TV finds Chrome, Edge or Chromium by itself; `browser.executablePath` points it at
another.

## Abroad

Add a proxy with an Israeli exit, exactly as for the [home helper](resolver-only.md#abroad-add-a-proxy) (the `geo`
block and `.env`), then `pnpm israel-tv check-proxy`. The proxy is used by the helper to relay Israel-only episodes
and by the Kan reader; everything else goes out directly.

## Keep it running

[Background and startup, per system](background.md). Reserve the computer's address in your router so the links in
your app keep working, and set the computer not to sleep.

## Troubleshoot

- `pnpm israel-tv status` — recent runs and warnings; the admin page shows the same with more detail.
- `pnpm logs --errors` — recent failures; `pnpm logs --play <id>` follows one play.
- [Operations](../operations.md) covers investigating a failed play, backups and updating.
