# Run it in the background and at startup

Pick your system. In every case the settings, secrets and data stay in your config folder
(`pnpm israel-tv paths` / `pnpm resolver paths` shows it), and `pnpm israel-tv urls` / `pnpm resolver urls` prints
your links. "Full instance" means the [at home](local-only.md) and [Cloudflare](host.md) setups; "helper" means the
[home helper](resolver-only.md) alone.

## Docker

Any system with Docker (Windows and macOS with Docker Desktop, Linux, NAS). Images for amd64 and arm64 (Raspberry Pi):

- **Helper:** the one-line `docker run` in [home helper](home-helper.md#the-easy-way-docker) (`--restart unless-stopped`
  brings it back after a restart).
- **Full instance** (without a browser, so no Kan episodes):

  ```
  docker run -d --name israel-tv --restart unless-stopped -p 7700:7700 -p 7701:7701 -p 7702:7702 -v israel-tv-data:/data ghcr.io/israeltv2/israel-tv
  ```

  Put `israel-tv.config.json` and `.env` in the volume's folder if you need settings
  (`docker exec israel-tv node apps/ingest/src/cli.ts paths`).
- From the repository instead: [`deploy/docker-compose.yml`](../../deploy/docker-compose.yml) and
  [`deploy/docker-compose.resolver.yml`](../../deploy/docker-compose.resolver.yml) (instructions at their top).

Update: `docker pull` the image, remove the container (`docker rm -f <name>`) and run it again; data is kept in the
volume. Logs: `docker logs <name>`.

## Windows

A ready script registers a Task Scheduler task that starts at logon and restarts after a crash — in PowerShell, from
the repository folder:

```
powershell -ExecutionPolicy Bypass -File deploy\windows\install-task.ps1             # full instance
powershell -ExecutionPolicy Bypass -File deploy\windows\install-task.ps1 -Resolver   # helper
```

Remove it with `-Remove` (and `-Resolver` for the helper). Restart after an update or a settings change:
`schtasks /End /TN "Israel TV"` then `schtasks /Run /TN "Israel TV"` (or `"Israel TV resolver"`). When Windows asks
whether Node may use the network, allow it on private networks. The task runs while you are signed in.

## macOS

A launchd agent: [`deploy/org.israel-tv.plist`](../../deploy/org.israel-tv.plist) (full instance) or
[`deploy/org.israel-tv.resolver.plist`](../../deploy/org.israel-tv.resolver.plist) (helper); the steps are in each
file's header (replace two paths, copy it to `~/Library/LaunchAgents`, `launchctl bootstrap`). Restart:
`launchctl kickstart -k gui/$(id -u)/org.israel-tv` (or `org.israel-tv.resolver`). It runs while you are logged in:
after a restart, log in, or turn on automatic login. Set the Mac not to sleep (_System Settings → Energy_), and
choose _Allow_ when macOS asks whether `node` may accept incoming connections.

## Linux

A systemd unit: [`deploy/israel-tv.service`](../../deploy/israel-tv.service) (full instance) or
[`deploy/israel-tv-resolver.service`](../../deploy/israel-tv-resolver.service) (helper); the setup commands are in each
file's header. Restart: `systemctl restart israel-tv` (or `israel-tv-resolver`). Logs: in the config folder's
`data/logs/` (`tail -f …/current.log`). Kan episodes need a browser and a display: run under `xvfb-run`, or turn
Kan off.

## Updating (from the repository)

`git pull`, then `pnpm install --prod` (helper: `pnpm install --prod --filter "@israel-tv/resolver..."`), then
restart as above. With Cloudflare, also `pnpm israel-tv deploy-api`.
