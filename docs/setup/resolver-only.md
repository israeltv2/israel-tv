# Home helper without Docker (role `resolver-only`)

The home helper (the "resolver") plays Keshet 12 (Mako) and, abroad, relays Israel-only episodes through a proxy.
It plays from a published Israel TV catalog — the public one by default — so it reads no broadcaster site, keeps no
catalog database and needs no account. The easy way is [Docker](home-helper.md); this page installs it with Node.

## Requirements

- [Node.js](https://nodejs.org) 24.11 or newer (`node -v`) and git.
- A computer on your home network that stays on.
- Abroad only: a proxy with an Israeli exit (HTTP(S) or SOCKS5; many VPN services offer one).

## Install

```bash
git clone https://github.com/israeltv2/israel-tv.git
cd israel-tv
corepack enable          # or: npm i -g pnpm@12.15.0
pnpm install --prod --filter "@israel-tv/resolver..."     # only the helper and what it uses (~85 MB)
pnpm resolver paths       # shows your config folder
```

**On Windows** (PowerShell): first allow `pnpm` to run, once — `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
— and install it with `npm i -g pnpm@12.15.0` (instead of `corepack enable`, which needs an administrator window
there). On macOS and Linux `corepack enable` may need `sudo` when Node was installed system-wide; `npm i -g
pnpm@12.15.0` is the alternative.

**Creating the config file:** the config folder may not exist yet. Windows: `mkdir "$env:LOCALAPPDATA\israel-tv"
-Force; notepad "$env:LOCALAPPDATA\israel-tv\israel-tv.config.json"` (Notepad offers to create it; keep the name
exactly, not `.txt`). macOS/Linux: `mkdir -p` the folder `paths` shows, then edit the file there. The same for `.env`.

Create `israel-tv.config.json` in that folder (start from
[examples/resolver-only](../../examples/resolver-only/israel-tv.config.example.json)):

```json
{
  "role": "resolver-only",
  "resolver": { "catalogUrl": "https://israel-tv.israeltv2.workers.dev/manifest.json" }
}
```

`catalogUrl` is the catalog you use: the public one, or a friend's.

## Start and verify

```bash
pnpm resolver check-catalog   # → catalog ok
pnpm resolver start           # prints the link to add in your app
pnpm resolver urls            # the same link, any time
```

Add `http://<this computer's address>:7701/manifest.json` in your app next to the catalog link; you should see
**Israel TV · home helper**. Play a Keshet 12 episode to check. To keep it running at startup, see
[background](background.md).

## Abroad: add a proxy

In `israel-tv.config.json`:

```json
{
  "geo": {
    "type": "http-proxy",
    "urls": ["http://proxy.example.net:3128"],
    "usernameEnv": "GEO_PROXY_USERNAME",
    "passwordEnv": "GEO_PROXY_PASSWORD"
  }
}
```

and in `.env` in the same folder (never in the config file):

```
GEO_PROXY_USERNAME=your-proxy-user
GEO_PROXY_PASSWORD=your-proxy-password
```

Use the scheme your provider gives (`http://`, `https://` for a proxy that speaks TLS, or `socks5://` with
`"type": "socks5"`). Several URLs can be listed; the next is tried when one fails. Then
`pnpm resolver check-proxy` should say `exits in IL ✓`. Episodes refused from your network then get a second stream,
**"דרך החיבור הישראלי שלך"** (via your Israeli connection), that goes through the proxy; the helper checks each show's direct stream every 6 hours
and offers the relay only where it is refused. Mako and most live channels never go through the proxy.

## Away from home

The helper answers only on your network. With a domain of your own on Cloudflare you can give it a tunnel, and then
install **one helper link** that works at home and away (at home with everything, away with Keshet 12): see
[The helper through a Cloudflare Tunnel](tunnel.md).

## Troubleshoot

- `pnpm resolver check-catalog` says what is wrong with `catalogUrl` (a typo, or a catalog speaking another
  version of the [contract](../contract.md)).
- `pnpm resolver events --errors` lists recent failures; the log is in the config folder's `data/logs/current.log` (Windows: the newest `israel-tv.*.log` there).
- Updating: `git pull`, `pnpm install --prod --filter "@israel-tv/resolver..."`, restart.
- Ports: 7701 (the helper), 7703 (the tunnel door, for the tunnel on this computer only). Do not expose 7701 to the
  internet: it has no login and would relay through your proxy.
