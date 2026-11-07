# The helper through a Cloudflare Tunnel (one link, at home and away)

The [home helper](home-helper.md) answers on your home network only. Most people have one Stremio or Nuvio account
for every device, and an app installs the same addons on all of them: a home-network link then does nothing on a
phone outside the house. A **tunnel** gives the helper a second, narrow door with an `https://` address, so you can
install **one helper link** that works everywhere:

- **At home**, the tunnel link offers everything the home-network link does: Keshet 12, its live channels, and (with
  a proxy set up, see [watching from abroad](home-helper.md#watching-from-abroad)) the **דרך החיבור הישראלי שלך**
  (via your Israeli connection) sources. Those sources point at the helper's address on your home network, so their
  video never goes through the tunnel.
- **Away**, it plays Keshet 12 and its live channels. Keshet 12's video goes from its own servers to your phone; only
  the small play list (about 1 KB) comes through your home. The Israel-only sources are not offered away.

A phone at home on mobile data counts as away. Without a tunnel nothing changes: keep the home-network link.

## What you need

- the helper running (the [install without Docker](resolver-only.md), or [Docker](#with-docker));
- a free [Cloudflare account](https://dash.cloudflare.com/sign-up) with a domain of your own added to it (a
  `workers.dev` name cannot be used for tunnels);
- `cloudflared`, Cloudflare's tunnel program, on the same computer as the helper
  ([downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)).

## Steps

1. **A token.** Make a secret of 32 or more letters and digits — macOS/Linux: `openssl rand -hex 32`; Windows
   PowerShell: `-join ((48..57)+(97..122) | Get-Random -Count 40 | % {[char]$_})` — and put it in the helper's `.env`
   as `ISRAEL_TV_REMOTE_TOKEN=…`. It becomes part of the link; changing it revokes every install.
2. **The config.** In `israel-tv.config.json`, with a hostname of your domain for the helper (here
   `tv-helper.example.net`) and this computer's address on your home network (the one in your home-network link):

   ```json
   "resolver": {
     "remote": {
       "enabled": true,
       "publicUrl": "https://tv-helper.example.net",
       "home": { "lanUrl": "http://<this computer's address>:7701" }
     }
   }
   ```

   `lanUrl` is what makes the link complete at home; leave it out and the tunnel link plays Keshet 12 and live
   channels only. The helper tells home from away by your home's public internet address, which it looks up itself
   every 10 minutes (from Cloudflare's `1.1.1.1/cdn-cgi/trace`); that address is never logged or stored.
3. **The tunnel.** Point the hostname at the helper's tunnel port, `http://127.0.0.1:7703`, and nothing else:

   ```
   cloudflared tunnel login
   cloudflared tunnel create israel-tv
   ```

   (`create` prints an id and writes a credentials file in your `.cloudflared` folder.) Write
   `.cloudflared/config.yml`:

   ```yaml
   tunnel: <id>
   credentials-file: <full path to the .cloudflared folder>/<id>.json
   ingress:
     - hostname: tv-helper.example.net
       service: http://127.0.0.1:7703
     - service: http_status:404
   ```

   then `cloudflared tunnel route dns israel-tv tv-helper.example.net`, and `cloudflared service install` so it
   survives restarts (on Windows, from an administrator PowerShell; the Windows service reads its settings from
   `C:\Windows\System32\config\systemprofile\.cloudflared\`, so copy `config.yml` and the credentials file there).
4. **Restart the helper** and print the link: `pnpm resolver remote-url` (a full copy: `pnpm israel-tv remote-url`).
5. **Install that one link** on your account (_Stremio: Addons → paste → Install_; _Nuvio: Settings → Addons → Add
   addon_), and **remove the home-network helper link** if you had it, or Keshet 12 shows up twice. The addon is
   called **Israel TV · home helper** either way. Keep the link private: it contains the token.
6. **Try it:** at home, play a Keshet 12 episode and (with a proxy) an Israel-only one, picking **דרך החיבור הישראלי
   שלך**; then on the phone on mobile data, a Keshet 12 episode.

## With Docker

Inside a container the tunnel door must listen on all of the container's interfaces, and the port is published to
this computer only. Put a config file in the container's data folder (`/data/israel-tv.config.json`) with
`"host": "0.0.0.0"` in `resolver` and in `remote`, the settings of step 2, and the token in `/data/.env`; publish the
port with `-p 127.0.0.1:7703:7703` next to `-p 7701:7701` (the compose files in `deploy/` already do). `cloudflared`
runs on the computer itself, as in step 3.

## What the tunnel can reach

Only the manifest, stream answers and Keshet 12's small play lists, under `/<token>/…`. Any other path, any request
without the token or with another method gets an empty 404, and each client is rate-limited. There is no relay
route: video never passes through the tunnel, and the admin page is on a different port the tunnel never points at.
