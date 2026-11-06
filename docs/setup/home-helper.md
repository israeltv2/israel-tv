# Set up the home helper

The home helper is a small program that plays **Keshet 12 (Mako)** for you, and — if you live outside Israel, together
with an Israeli proxy ([see below](#watching-from-abroad)) — the episodes that only play from Israel. It runs on a computer at home that stays on, and you add it to your app as a
second link, next to the [Israel TV link](../../README.md#install).

**Which computer?** Any computer that stays switched on and connected at home: a desktop PC or Mac, a storage box
(NAS) or a small always-on computer like a Raspberry Pi. A laptop works only while it is open, awake and at home —
Keshet 12 stops when it sleeps or leaves the house.

It takes about 15 minutes. Pick one way:

- **[The easy way: Docker](#the-easy-way-docker)** — copy one command.
- **Ask an AI assistant to do it** — one that can use your computer's terminal (not a chat on your phone): give it
  [this guide for assistants](for-agents.md).
- **[Without Docker](resolver-only.md)** — for people who are comfortable with a terminal.

## The easy way: Docker

Docker is a free program that runs ready-made apps like this one.

1. **Install Docker.** Windows and Mac: download **Docker Desktop** from
   [docker.com](https://www.docker.com/products/docker-desktop/) and install it. On Windows it may ask to install
   "WSL" and to restart — say yes. You can skip signing in. A NAS usually has Docker in its app store ("Container
   Manager" on Synology).
   _You should see:_ Docker Desktop open, with "Engine running" at the bottom.
2. **Start the home helper.** Open a terminal — Windows: click Start, type **PowerShell**, open it; Mac: open
   **Terminal** (in Applications → Utilities); NAS: its terminal or SSH. Paste this whole line and press Enter:

   ```
   docker run -d --name israel-tv-helper --restart unless-stopped -p 7701:7701 -v israel-tv:/data ghcr.io/israeltv2/israel-tv-resolver
   ```

   _You should see:_ a minute of downloading, then one long line of letters and numbers. That is all. (If it says
   `docker` is not recognized, Docker Desktop is not running yet: open it and try again.) **Windows:** if a window asks
   whether to allow Docker on networks, choose **Allow** for private networks.
3. **Find this computer's address on your home network** — four numbers with dots, usually starting with `192.168.`
   or `10.`:
   - Windows: _Settings → Network & internet → Wi-Fi (or Ethernet) → your network's properties_, the line
     **IPv4 address**. If you see several, use the one of your Wi-Fi or Ethernet connection.
   - Mac: _System Settings → Wi-Fi → Details_ (or _Network → Ethernet → Details_), the line **IP address**.
   - NAS or Linux: the NAS's admin page shows it, and so does your router's list of connected devices.
4. **Add the helper to your app**, with your phone or computer on your home Wi-Fi — easiest from a phone or computer
   signed in to the same Stremio account as your TV (it then appears on the TV too). The link, with your computer's
   address in place of `ADDRESS`:

   ```
   http://ADDRESS:7701/manifest.json
   ```

   (For example, if the address is `192.168.` followed by two more numbers, the link starts `http://192.168.`.)
   - **Stremio app:** _Addons_ → paste the link into the search box → _Install_.
   - **Nuvio:** _Settings → Addons → Add addon_ → paste the link.

   _You should see:_ an addon called **Israel TV · home helper**. (Use the app; Stremio in a web browser cannot use a
   home `http://` link.) If it does not appear on another device (for example the TV, or Nuvio on another device), add
   the same link there too.
5. **Try it:** open a Keshet 12 show and play an episode. Under the episode, the source is **Israel TV · home helper**.

**Keep it running.** In Docker Desktop's settings, turn on _Start Docker Desktop when you sign in_; the helper starts
whenever Docker does. Keep the computer awake: Windows _Settings → System → Power → Screen and sleep → when plugged
in, put my device to sleep after: Never_; Mac _System Settings → Energy → Prevent automatic sleeping_. After a restart
(for example a system update), sign in once so Docker starts.

**Windows only:** your home network must be set to Private (_Settings → Network & internet → your connection → Network
profile type: Private_), and Docker allowed on private networks. If you closed or refused the question in step 2:
_Windows Security → Firewall & network protection → Allow an app through firewall → Docker Desktop Backend → Private_.
Otherwise your TV cannot reach the helper.

If the computer's address changes (for example after the router restarts), update the link in the app — or ask your
router to always give that computer the same address (often called "DHCP reservation"; whoever set up your router can
help).

### Watching from abroad

Outside Israel, Reshet and Kan episodes (and at times the Kan live channels) only play through an Israeli internet
connection. Keshet 12 does not need one: the helper alone plays it on your home network, wherever in the world your home is.

You need a **proxy with an Israeli location**. Many VPN services include one: in your VPN account or its help pages,
look for "proxy" or "SOCKS5". Note the address of a server **in Israel**, its port (a number such as 1080 or 3128), and
the proxy user name and password — often a separate login from your app login (some providers call it "service
credentials").

1. In your terminal, create a small text file in the folder the terminal is in: type `notepad israel-tv.env`
   (Windows; say Yes to creating it) or `nano israel-tv.env` (Mac, Linux, NAS). Write these three lines — your own
   values — then save and close:

   ```
   ISRAEL_TV_PROXY=http://PROXY-ADDRESS:PORT
   ISRAEL_TV_PROXY_USER=your proxy user name
   ISRAEL_TV_PROXY_PASSWORD=your proxy password
   ```

   If your provider calls it SOCKS5, write `socks5://` instead of `http://`.
2. Remove the helper you started before (your settings are kept): `docker rm -f israel-tv-helper`
3. Start it again with the file:

   ```
   docker run -d --name israel-tv-helper --restart unless-stopped -p 7701:7701 -v israel-tv:/data --env-file israel-tv.env ghcr.io/israeltv2/israel-tv-resolver
   ```

4. Check it: `docker exec israel-tv-helper node apps/resolver/src/cli.ts check-proxy`. _You should see:_ a line ending
   with `exits in IL ✓` ("goes out through Israel"). Otherwise it says what is wrong: "refused the login" → re-check the
   user name and password in the file; "not an Israeli exit" → use the address of a server in Israel; "host not found"
   → re-check the address. Fix the file, then repeat steps 2–4.

Episodes that only play from Israel then show two sources: one marked **ישראל בלבד** (Israel only — it will not play
abroad) and one called **דרך ישראל · via Israel** — pick that one.

### Keshet 12 away from home

The helper answers only on your home network: on a phone outside the house, Keshet 12 and the "via Israel" sources will
not play (the public link's other episodes and the live channels still do). Opening it to the
outside safely needs a domain name of your own and some technical setup, and is not part of the easy way: see
[Away from home](resolver-only.md#away-from-home) if you or someone helping you is comfortable with that (it is written for
the install without Docker).

### If something goes wrong

- **It worked yesterday, not today:** after a system update restart, sign in to the computer once so Docker starts.
- **The app cannot reach the helper:** the computer is off or asleep, Docker is not running, the address changed
  (step 3), or on Windows the network is not Private (see above).
- **Keshet 12 shows no play option:** add the helper's link (step 4); the main Israel TV link alone cannot play it.
- **`docker: Error … denied` or `not found` when starting:** the command was not copied completely — copy the whole
  line again.
- **Updating** (now and then, or when an issue says so): `docker pull ghcr.io/israeltv2/israel-tv-resolver`, then
  `docker rm -f israel-tv-helper`, then the same `docker run` line you used before (abroad: the one with
  `--env-file`). Your settings are kept.
- **What it is doing:** `docker logs israel-tv-helper` — send this when you report a problem (it never contains your
  proxy password).
- Still stuck? [Open an issue](https://github.com/israeltv2/israel-tv/issues/new/choose).
