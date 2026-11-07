# Run it in the background and at startup

Pick your system. In every case the settings, secrets and data stay in your config folder
(`pnpm israel-tv paths` / `pnpm resolver paths` shows it), and `pnpm israel-tv urls` / `pnpm resolver urls` prints
your links. "Full instance" means the [at home](local-only.md) and [Cloudflare](host.md) setups; "helper" means the
[home helper](resolver-only.md) alone.

## Docker

Any system with Docker (Windows and macOS with Docker Desktop, Linux, NAS). Images for amd64 and arm64 (a 64-bit Raspberry Pi system; 32-bit systems are not supported):

- **Helper:** the one-line `docker run` in [home helper](home-helper.md#the-easy-way-docker) (`--restart unless-stopped`
  brings it back after a restart).
- **Full instance** (without a browser, so no Kan episodes):

  ```
  docker run -d --name israel-tv --restart unless-stopped -p 7700:7700 -p 7701:7701 -p 7702:7702 -v israel-tv-data:/data ghcr.io/israeltv2/israel-tv
  ```

  Your links: `docker logs israel-tv` (the first lines). The dashboard: `docker exec israel-tv node
  apps/ingest/src/cli.ts admin-url`, with your computer's address in place of `<this computer's address>`.
  Settings, if you need any: copy them into the container's folder and restart it —
  `docker cp israel-tv.config.json israel-tv:/data/`, `docker cp .env israel-tv:/data/`, `docker restart israel-tv`.
- From the repository instead: [`deploy/docker-compose.yml`](../../deploy/docker-compose.yml) and
  [`deploy/docker-compose.resolver.yml`](../../deploy/docker-compose.resolver.yml) (instructions at their top).

Update: `docker pull` the image, remove the container (`docker rm -f <name>`) and run it again; data is kept in the
volume. Logs: `docker logs <name>`.

## Windows

A ready script registers a Task Scheduler task that starts at sign-in, runs without a window, and starts the app
again 30 seconds after it stops for any reason. In PowerShell, from the repository folder (stop any copy you started by
hand first, with Ctrl-C):

```
powershell -ExecutionPolicy Bypass -File deploy\windows\install-task.ps1             # full instance
powershell -ExecutionPolicy Bypass -File deploy\windows\install-task.ps1 -Resolver   # helper
```

After an update or a settings change, restart it with the same script and `-Restart` (`-Stop` stops it, `-Remove`
removes it; add `-Resolver` for the helper). **Logs:** the newest `israel-tv.*.log` in the config folder's `data\logs`;
to follow it: `Get-ChildItem "$env:LOCALAPPDATA\israel-tv\data\logs\israel-tv*.log" | Sort-Object LastWriteTime | Select-Object -Last 1 | Get-Content -Wait -Tail 50`. If the
links do not work at all, the reason is in `task-output.txt` (`task-output-resolver.txt` for the helper) in the config folder (a settings error or a taken port).
Before installing the task, run it once by hand (`pnpm start`, or `pnpm resolver start`) to see that it works.

So your TV can reach it: set your home network to Private (_Settings → Network & internet → your connection →
Network profile type: Private_), and when Windows asks whether Node may use the network, allow private networks (if
you closed that prompt: _Windows Security → Firewall → Allow an app through firewall → Node.js → Private_). Keep the PC
awake when plugged in (_Settings → System → Power → Screen and sleep_). The task runs while you are signed in: after a
Windows Update restart, sign in once.

## macOS

A launchd agent: [`deploy/org.israel-tv.plist`](../../deploy/org.israel-tv.plist) (full instance) or
[`deploy/org.israel-tv.resolver.plist`](../../deploy/org.israel-tv.resolver.plist) (helper); the steps are in each
file's header (replace two paths, copy it to `~/Library/LaunchAgents`, `launchctl bootstrap`). Restart:
`launchctl kickstart -k gui/$(id -u)/org.israel-tv` (or `org.israel-tv.resolver`). It runs while you are logged in:
after a restart, log in, or turn on automatic login. Set the Mac not to sleep (_System Settings → Energy_), and
choose _Allow_ when macOS asks whether `node` may accept incoming connections.

## Linux

Two ready systemd units:

- **For you, with your clone and config folder** (simplest):
  [`deploy/israel-tv.user.service`](../../deploy/israel-tv.user.service) — copy it to `~/.config/systemd/user/`, set the
  two paths at its top, then `systemctl --user daemon-reload && systemctl --user enable --now israel-tv`, and once
  `loginctl enable-linger $USER` so it runs without you signed in. For the helper alone, change `apps/ingest` to
  `apps/resolver` in its `ExecStart`. Restart: `systemctl --user restart israel-tv`.
- **A separate system install** under its own user in `/opt/israel-tv` (a server):
  [`deploy/israel-tv.service`](../../deploy/israel-tv.service) or
  [`deploy/israel-tv-resolver.service`](../../deploy/israel-tv-resolver.service); the steps are in each file's header.
  Its config is `/opt/israel-tv/israel-tv.config.json`, not your own folder.

Logs: the config folder's `data/logs/current.log` (`tail -f`). Kan episodes need a browser and a display: on a machine
without a screen, wrap the start in `xvfb-run -a` (an example line is in the unit), or turn Kan off with
`"browser": { "type": "none" }`.

## Updating (from the repository)

`git pull`, then `pnpm install --prod` (helper: `pnpm install --prod --filter "@israel-tv/resolver..."`), then
restart as above. With Cloudflare, also `pnpm israel-tv deploy-api`.
