# Setting up Israel TV — a guide for AI assistants

You are helping a person set up Israel TV, a free addon that brings Israeli TV into the Stremio and Nuvio apps. Most
people need very little. Follow this page; do not improvise commands. You need to be able to run commands in the
person's terminal (or guide them step by step).

**A prompt the person can give you:** _"Help me set up Israel TV for my TV. Follow
https://github.com/israeltv2/israel-tv/blob/main/docs/setup/for-agents.md exactly, ask me the questions it lists
first, and never ask me to paste passwords or tokens into the chat."_

## 1. Ask these questions first (one at a time, in plain words)

1. **Which app do you watch on, and on which devices?** (Stremio or Nuvio; TV, phone, computer.)
2. **Do you live in Israel?**
3. **Do you want Keshet 12 (Mako)?** (Most people do.)
4. **Is there a computer at home that stays on?** (Desktop PC, Mac, storage box/NAS, Raspberry Pi; a laptop only
   works while open, awake and at home.) Which system? Is Docker installed, or may they install Docker Desktop?
5. **Did someone give you their own Israel TV link?** (If not, use the public one.)
6. Only if they bring it up: **do you want your own copy of everything** (at home, or shared with friends)?

## 2. Decide

| Answers                              | Do                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| In Israel, no Keshet 12              | 3A only.                                                                                  |
| Keshet 12 wanted (anywhere)          | 3A, then 3B.                                                                              |
| Abroad and wants Reshet/Kan episodes | 3A, then 3B with the proxy part (they need a VPN/proxy service with an Israeli location). |
| Wants their own copy                 | Section 6.                                                                                |

For 3A and 3B they do **not** need: a Cloudflare account, a database, an API key, Node or git (Docker is enough), or a
proxy (unless abroad). Keshet 12 itself needs no proxy, anywhere.

## 3A. Install the link in the app

The link: `https://israel-tv.israeltv2.workers.dev/manifest.json` (or the one someone gave them).

- Stremio: in the app, _Addons_ → paste the link in the search box → _Install_; or open
  `https://web.stremio.com/#/addons?addon=https%3A%2F%2Fisrael-tv.israeltv2.workers.dev%2Fmanifest.json` while signed
  in. Installed on a phone or computer signed in to the same account, it also appears on their TV.
- Nuvio: _Settings → Addons → Add addon_ → paste.

**Verify (you):** `curl -s https://israel-tv.israeltv2.workers.dev/manifest.json` contains `"name":"Israel TV"`.
**Verify (person):** new rows appear: קשת 12, רשת 13, כאן 11, כאן חינוכית: ילדים ונוער, שידור חי.

## 3B. The home helper (Docker)

The whole procedure, with what each step shows: [home helper](home-helper.md#the-easy-way-docker). In short:

1. Docker Desktop installed and running ("Engine running"); on Windows it may need WSL and a restart.
2. In Israel:

   ```
   docker run -d --name israel-tv-helper --restart unless-stopped -p 7701:7701 -v israel-tv:/data ghcr.io/israeltv2/israel-tv-resolver
   ```

   Abroad: first the person creates a file `israel-tv.env` **themselves** (you never see or type the password):

   ```
   ISRAEL_TV_PROXY=http://PROXY-ADDRESS:PORT
   ISRAEL_TV_PROXY_USER=…
   ISRAEL_TV_PROXY_PASSWORD=…
   ```

   (`socks5://` if their provider says SOCKS5), then:

   ```
   docker run -d --name israel-tv-helper --restart unless-stopped -p 7701:7701 -v israel-tv:/data --env-file israel-tv.env ghcr.io/israeltv2/israel-tv-resolver
   ```

   Someone else's catalog: add `-e ISRAEL_TV_CATALOG_URL=<their link>` before the image name.

3. **Verify (you):** after about a minute `docker ps` shows the container as `(healthy)` (`health: starting` before that
   is normal); `curl -s http://localhost:7701/manifest.json` contains `"name":"Israel TV · home helper"`;
   `docker logs israel-tv-helper` shows `catalog check: ok` and a line
   `install in your app: http://<this computer's address>:7701/manifest.json` — that `<this computer's address>` is
   printed literally: the container cannot know the address; step 4 finds it. Abroad:
   `docker exec israel-tv-helper node apps/resolver/src/cli.ts check-proxy` ends with `exits in IL ✓` (otherwise it
   says what to fix; the log also shows a `proxy check:` line at start).
4. **The computer's address:** Windows _Settings → Network & internet → Wi-Fi/Ethernet → properties → IPv4 address_
   (the Wi-Fi or Ethernet one, not "vEthernet"); Mac _System Settings → Wi-Fi → Details_ or _Network → Ethernet →
   Details_; NAS or Linux: its admin page, the router's device list, or `hostname -I` (first address).
5. **In the app:** add `http://<that address>:7701/manifest.json` (easiest from a phone or computer on the same
   account; if it does not appear on another device, such as the TV or Nuvio elsewhere, add the link there too).
   **Verify (person):** an addon "Israel TV · home helper" appears; a Keshet 12 episode plays; abroad,
   Israel-only episodes show a source "דרך ישראל · via Israel". Stremio in a web browser cannot use this `http://`
   link; the apps can.
6. **Keep it running:** Docker Desktop → Settings → _Start Docker Desktop when you sign in_; the computer never sleeps
   when plugged in (Windows _Settings → System → Power_; Mac _System Settings → Energy → Prevent automatic sleeping_);
   after a system restart someone must sign in. Windows: the home network must be _Private_ and Docker allowed on
   private networks. Mac: if asked whether Docker may accept incoming connections, allow it.
7. **Tell them:** the helper's sources (Keshet 12, and abroad the "via Israel" ones) play on the home network only;
   away from home the public link's other episodes and live channels still work. Opening the helper to the outside
   needs a domain and the install without Docker ([away from home](resolver-only.md#away-from-home)) — do not
   attempt it unless they ask.

No Docker and they are comfortable with a terminal: [without Docker](resolver-only.md).

## 4. Common problems

| Symptom                                      | Fix                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| App cannot reach the helper                  | Computer asleep/off, Docker not running, wrong address, Windows network not Private, firewall prompt refused. |
| Keshet 12 has no play option                 | The helper's link is not added in the app.                                                                    |
| Abroad, Reshet/Kan do not play               | Proxy missing or not Israeli: run check-proxy; pick the "דרך ישראל · via Israel" source.                      |
| `docker: command not found` / not recognized | Docker Desktop not installed or not running.                                                                  |
| `denied` / `not found` pulling the image     | Image name mistyped; copy the command again.                                                                  |
| Port 7701 already in use                     | Another copy is running: `docker rm -f israel-tv-helper`, then run again.                                     |
| Rows show ⚠ or are old                       | A site was not read recently; nothing to fix on their side.                                                   |

Updating later: `docker pull ghcr.io/israeltv2/israel-tv-resolver`, `docker rm -f israel-tv-helper`, then the same
`docker run` they used (abroad: with `--env-file`).

## 5. Do not

- Ask for, repeat, or store passwords, proxy logins or tokens. The person types secrets into their own file or terminal.
- Put a password on the command line: use the `--env-file` above.
- Expose port 7701 to the internet (port forwarding): the helper has no login.
- Turn off a firewall; allow Docker/Node on private networks only.
- Install anything the steps do not name, or use administrator rights unless a step says so.
- Promise that Israel-only titles play abroad without a working Israeli proxy.

## 6. Their own copy (only if they asked)

Follow [Choose your setup](README.md) with them: [at home](local-only.md) (in Israel, no accounts) or
[on Cloudflare](host.md) (shared; they create the Cloudflare account and token and type them into `.env` themselves).
Verify with `pnpm israel-tv urls` (the links), both manifests answering, and `pnpm israel-tv status`. Do not start a
copy that reads the broadcasters' sites unless they mean to keep it.

More: [llms.txt](../../llms.txt) (map of the docs), [Choose your setup](README.md).
