# Israel TV — notes for coding agents

These are maintainer rules for AI coding agents working in this repo; users can ignore this file.

Open-source Stremio-protocol addon for Israeli TV (Mako / Keshet 12, Reshet 13, Kan, live channels).

## Identity rules (hard, check before every git or gh action)

This project publishes under its own identity only. Nothing in it may identify the people behind it.

- **Commit identity** is repo-local: `Israel TV <353162302+israeltv2@users.noreply.github.com>`.
  Before committing, confirm `git config user.email` prints that address.
- **Commit and tag signing stay off** (`commit.gpgsign=false`, `tag.gpgsign=false` in the repo config).
  Never enable signing or pass `-S`.
- **Remote** is only `git@github-israeltv:israeltv2/israel-tv.git` (SSH host alias with the project key).
  Never add or push to an `https://github.com/...` remote.
- **gh** always runs as `GH_CONFIG_DIR=~/.config/gh-israeltv gh ...`, every single command.
  Before any gh write, confirm `GH_CONFIG_DIR=~/.config/gh-israeltv gh api user --jq .login` prints `israeltv2`.
- **Cloudflare**: use only the project's own Cloudflare account.
- Changing the repository's visibility is the maintainer's decision, never an agent's.

## Content rules

- Never write personal details into the repo: real names, personal accounts or logins, personal domains,
  hostnames, LAN IPs, emails other than the project noreply, locations, or details of anyone's home setup.
  Docs describe a standalone project.
- Secrets (VPN/proxy credentials, Cloudflare tokens, Mako tickets) are never committed, printed, or pasted
  into chat. They live outside the repo (e.g. `~/.config/israel-tv/*.env`, mode 600) and are read by
  scripts at run time. Commands that need them are run by the owner.
- Clean-room rule: existing community addons for these sources have no license. Study their behaviour and
  the public endpoints; never copy their code.

## Working style

- Measure before designing; keep real responses as test fixtures.
- Failures are visible and labelled (keep last good data, report on `/status`), never silently filtered.
- Series and episode ids come from the source, never from list position.
