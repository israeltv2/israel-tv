# Setting up Israel TV — a guide for AI assistants

You are helping a person set up Israel TV, a free addon that brings Israeli TV into the Stremio and Nuvio apps. Most
people need very little. Follow this page; do not improvise commands.

**A prompt the person can give you:** _"Help me set up Israel TV for my TV. Follow
https://github.com/israeltv2/israel-tv/blob/main/docs/setup/for-agents.md exactly, ask me the questions it lists
first, and never ask me to paste passwords or tokens into the chat."_

## 1. Ask these questions first (one at a time, in plain words)

1. **Which app do you watch on?** (Stremio or Nuvio; on a TV, phone or computer.)
2. **Do you live in Israel?**
3. **Do you want Keshet 12 (Mako)?** (Most people do.)
4. **Do you have a computer at home that stays on?** (PC, Mac, NAS or Raspberry Pi — needed only for Keshet 12, and
   abroad for Reshet and Kan episodes.) Which system is it? Is Docker installed (or may you install Docker Desktop)?
5. **Did someone give you their own Israel TV link?** (If not, use the public one.)
6. Only if they ask for it: **do you want your own copy of everything**, at home or shared with friends?

## 2. Decide

| Answers                                                   | Do                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| No Keshet 12 wanted, in Israel                            | Step 3A only.                                                                  |
| Keshet 12 wanted, or abroad and wants Reshet/Kan episodes | Step 3A, then 3B (the home helper).                                            |
| Abroad                                                    | In 3B also the proxy part; they need a VPN/proxy service with an Israeli exit. |
| Wants their own copy                                      | Stop here and follow [Choose your setup](README.md) with them.                 |

What they do **not** need: a Cloudflare account, a database, an API key or a proxy (unless abroad) — for 3A and 3B.

## 3A. Install the link in the app

The link: `https://israel-tv.israeltv2.workers.dev/manifest.json` (or the one someone gave them).
Stremio: Addons → paste the link in the search box → Install (or open
`stremio://israel-tv.israeltv2.workers.dev/manifest.json`). Nuvio: Settings → Addons → Add addon → paste.
**Verify:** new rows appear: קשת 12, רשת 13, כאן 11, כאן חינוכית: ילדים ונוער, שידור חי.

## 3B. The home helper

Prefer Docker. Exact steps, and what each shows: [home helper](home-helper.md#the-easy-way-docker). The command:

```
docker run -d --name israel-tv-helper --restart unless-stopped -p 7701:7701 -v israel-tv:/data ghcr.io/israeltv2/israel-tv-resolver
```

- If they were given someone else's link, add `-e ISRAEL_TV_CATALOG_URL=<that link>` before the image name.
- Abroad: add `-e ISRAEL_TV_PROXY=http://USER:PASSWORD@HOST:PORT` — **let the person type this line themselves**
  in their terminal; never ask them to send you the password.
- **Verify:** `docker logs israel-tv-helper` shows a line with `install in your app: http://<this computer's address>:7701/manifest.json`.
  Help them find the computer's address in the system settings (Windows: Settings → Network → Properties → IPv4
  address; Mac: System Settings → Wi-Fi → Details → IP address). They add
  `http://<address>:7701/manifest.json` in the app; an addon "Israel TV · home resolver" appears; a Keshet 12
  episode plays. Abroad: `docker exec israel-tv-helper node apps/resolver/src/cli.ts check-proxy` ends with
  `exits in IL ✓`.
- No Docker and they are comfortable with a terminal: [without Docker](resolver-only.md) (Node 24.11+).

## 4. Common problems

| Symptom                        | Fix                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| App cannot reach the helper    | Computer asleep/off, Docker not running, wrong address, or the firewall blocked it (allow on private networks). |
| Keshet 12 has no play option   | The helper's link is not added in the app.                                                                      |
| Abroad, Reshet/Kan do not play | Proxy missing or not Israeli: run check-proxy; pick the "דרך ישראל · via Israel" stream.                        |
| `docker: command not found`    | Docker Desktop is not installed or not started.                                                                 |
| Port 7701 already in use       | Another copy is running: `docker rm -f israel-tv-helper`, then run again.                                       |
| Rows show ⚠ or are old         | A site was not read recently; nothing to fix on their side.                                                     |

## 5. Do not

- Ask for, read aloud or store passwords, proxy logins or tokens. The person types secrets into their own terminal
  or `.env` file.
- Expose port 7701 to the internet (port forwarding): the helper has no login.
- Disable their firewall; allow Node/Docker on private networks only.
- Install anything the steps above do not name, or run commands with administrator rights unless a step says so.
- Promise that Israel-only titles play abroad without a working Israeli proxy.

More: [llms.txt](../../llms.txt) (map of the docs), [Choose your setup](README.md).
