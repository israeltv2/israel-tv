# Set up the home helper

The home helper is a small program that plays **Keshet 12 (Mako)** for you, and — if you live outside Israel — the
episodes that only play from Israel. It runs on a computer at home that stays on (a PC, a Mac, a NAS or a
Raspberry Pi), and you add it to your app as a second link, next to the [Israel TV link](../../README.md#install).

It takes about 10 minutes. Pick one way:

- **[The easy way: Docker](#the-easy-way-docker)** — copy one command.
- **[Ask an AI assistant](for-agents.md)** — give it [this guide for assistants](for-agents.md) and it walks you
  through.
- **[Without Docker](resolver-only.md)** — for people who are comfortable with a terminal.

## The easy way: Docker

Docker is a free program that runs ready-made apps like this one.

1. **Install Docker.** Windows and Mac: download **Docker Desktop** from [docker.com](https://www.docker.com/products/docker-desktop/),
   install it and open it once. A NAS usually has Docker in its app store ("Container Manager" on Synology).
   _You should see:_ the Docker Desktop window, with a green "running" sign at the bottom.
2. **Start the home helper.** Open _PowerShell_ (Windows) or _Terminal_ (Mac), paste this line and press Enter:

   ```
   docker run -d --name israel-tv-helper --restart unless-stopped -p 7701:7701 -v israel-tv:/data ghcr.io/israeltv2/israel-tv-resolver
   ```

   _You should see:_ a minute of downloading, then one long line of letters and numbers. That is all.
3. **Find this computer's address on your home network.** Windows: _Settings → Network & internet → (your
   connection) → Properties_, the line **IPv4 address**. Mac: _System Settings → Wi-Fi → Details_ (or
   _Network → Ethernet → Details_), the line **IP address**. It is four numbers with dots between them.
4. **Add the helper to your app**, the same way you added Israel TV, with this link — put your computer's address
   in place of `<address>`:

   ```
   http://<address>:7701/manifest.json
   ```

   _You should see:_ an addon called **Israel TV · home resolver**.
5. **Try it:** open a Keshet 12 show and play an episode. It plays from the helper's link.

Keep that computer on and awake: in Docker Desktop's settings, turn on _Start Docker Desktop when you sign in_.
The helper starts by itself whenever Docker does. If the computer's address changes after a restart of your router,
update the link in the app — or ask your router to always give that computer the same address (often called
"DHCP reservation").

### Watching from abroad

Outside Israel, Reshet and Kan episodes only play through an Israeli internet connection. Many VPN services also
offer a **proxy** with an Israeli location — look for "proxy", "SOCKS5" or "service credentials" in your VPN
account. You need its address and your proxy user name and password. Then start the helper with one more part
(stop the old one first with `docker rm -f israel-tv-helper`):

```
docker run -d --name israel-tv-helper --restart unless-stopped -p 7701:7701 -v israel-tv:/data -e ISRAEL_TV_PROXY=http://USER:PASSWORD@PROXY-ADDRESS:PORT ghcr.io/israeltv2/israel-tv-resolver
```

Check it: `docker exec israel-tv-helper node apps/resolver/src/cli.ts check-proxy` should end with
`exits in IL ✓` (if not, it says why). Episodes that only play from Israel then get a second choice called
**"דרך ישראל · via Israel"** — pick that one.

### Keshet 12 away from home

The helper answers only on your home network. To watch Keshet 12 on your phone elsewhere, you can open a narrow,
private door to it — this needs a domain name of your own on Cloudflare: see
[Away from home](resolver-only.md#away-from-home).

### If something goes wrong

- **The app says it cannot reach the helper:** the computer is off or asleep, Docker is not running, or the address
  changed (step 3). On Windows, allow Docker when the firewall asks.
- **Keshet 12 shows no play button:** add the helper's link (step 4); the main Israel TV link alone cannot play it.
- **Updating:** `docker rm -f israel-tv-helper`, `docker pull ghcr.io/israeltv2/israel-tv-resolver`, then step 2
  again (your settings are kept in the `israel-tv` volume).
- **What it is doing:** `docker logs israel-tv-helper`.
- Still stuck? [Open an issue](https://github.com/israeltv2/israel-tv/issues/new/choose).
