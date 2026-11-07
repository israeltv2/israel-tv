# Choose your setup

Most people need nothing from this page: [install the public link](../../README.md#install), and add the
[home helper](home-helper.md) for Keshet 12. This page is for running your own copy.

## Which one?

1. **Do you already have an Israel TV link from someone (or use the public one), and only want Keshet 12 — or,
   abroad, the Israel-only episodes?** → [Home helper](home-helper.md) (easy, with Docker) or
   [Home helper without Docker](resolver-only.md). Nothing else.
2. **Do you want your own catalog, only on your home network, and you live in Israel?** →
   [Your own copy at home](local-only.md).
3. **Do you want your own catalog reachable from anywhere, to share with family and friends?** →
   [Your own copy on Cloudflare](host.md) (a free Cloudflare account).

One account for all your devices (the usual case)? Then they all get the same helper link: with a domain on
Cloudflare, [a tunnel](tunnel.md) makes that one link work at home and away.

Outside Israel? Options 2 and 3 also need a proxy or VPN service with an Israeli exit; it is described in each guide.
You do not need one inside Israel.

| Setup ("role")                                    | Runs on your computer                   | Accounts needed           |
| ------------------------------------------------- | --------------------------------------- | ------------------------- |
| [Home helper](resolver-only.md) (`resolver-only`) | the helper only                         | none (abroad: a proxy)    |
| [At home](local-only.md) (`local-only`)           | everything; the catalog on your network | none (abroad: a proxy)    |
| [On Cloudflare](host.md) (`host`)                 | everything; the catalog on Cloudflare   | a free Cloudflare account |

## For all of them

- **Requirements:** a computer that stays on — Windows, macOS, Linux, a NAS or a Raspberry Pi (64-bit system). The own-copy setups
  need [Node.js](https://nodejs.org) 24.11 or newer, or Docker.
- **Where things are:** your settings (`israel-tv.config.json`), your secrets (`.env`) and the data live in one
  folder; `pnpm israel-tv paths` shows where (`pnpm resolver paths` for the helper alone). Set `ISRAEL_TV_HOME` to
  use another folder.
- **Your links:** `pnpm israel-tv urls` (or `pnpm resolver urls`) prints the links to add in your app, as other
  devices on your network see them.
- **Running in the background and at startup:** [one page per system](background.md).
- **Every setting:** [configuration reference](../configuration.md). **Day-to-day:** [operations](../operations.md).
- **Letting an AI assistant do it:** [guide for assistants](for-agents.md).
