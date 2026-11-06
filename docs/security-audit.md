# Security

How Israel TV protects its users and the people who run it, and the record of its audits.

## By design

- **No accounts and no addresses kept.** Devices are counted by a daily-changing code (see [privacy](privacy.md)).
- **The public catalog is files plus a small API.** The data Worker serves static files; its router forwards only rows,
  search, streams and status, through a private binding, to an API Worker that has no public address. The router
  reads only safe catalog paths for the API; the API refuses envelopes of another contract version.
- **Per-client limits** on search and streams; Cloudflare's daily cap bounds cost.
- **The home helper has no public surface.** It answers on the home network. The optional away-from-home door is a
  narrow allowlist of Mako routes behind a long secret token (compared in constant time), rate-limited, with no relay
  and no admin; anything else is an empty 404.
- **The relay goes only to the broadcasters' own hosts** (https only), and checks every redirect; a catalog cannot make
  a home helper reach anything else. Catalog files are size-capped and schema-checked.
- **The admin page** answers only on private network addresses, needs its own token (cookie, `HttpOnly`,
  `SameSite=Strict`), and refuses cross-site requests.
- **Secrets** (Cloudflare token, proxy login, admin and remote tokens) live in `.env` outside the repository; their
  values are redacted from every log line and published file; deploys use only the configured token (never a stored
  login).
- **Code checks in CI:** architecture boundaries, unused code and dependencies, strict lint, deprecations, a scan for
  private addresses, a dependency audit on every pull request.

## Audit of 2026-11-06

A full audit after all features were built and deployed, by the project itself (the owner's own systems, authorized).
Non-destructive only: no load or brute-force testing; no third-party systems touched. Secrets were never printed:
checks on the home machine read them there and reported counts.

### Codebase

- **Security review of the whole repository** (an independent reviewer, read-only): no qualifying vulnerability.
  Covered: the Workers (envelope-only API, safe paths, no host injection), the home helper (signed relay URLs,
  host allowlist re-checked on every redirect, Mako-only CDN hosts, the remote door's constant-time token and path
  allowlist, a malicious catalog cannot redirect fetches), the admin gate and dashboard (local address, local Host
  header, Origin, token, CSRF, strict CSP, escaped rendering), the local server's file reads, publishing (no shell,
  minimal environment, secrets file removed after use), logging redaction, the Kan browser, CI and the images.
- **Dependencies:** `pnpm audit --prod`: no known vulnerabilities (also run on every pull request).
- **Secrets in the tree and the full git history** (gitleaks over every commit): 8 matches, all public keys inside
  recorded broadcaster pages (a real-user-monitoring key on Reshet's pages, an attribute on Kan's lobby page) that
  every visitor's browser receives; none of the project's. Searches of every commit for the owner's identifiers
  (names, logins, domains, home paths, home addresses) found nothing; every commit carries the project identity.
  Known and left to the owner: the Cloudflare **account id** in 4 commits of history (removed from the tree on the
  same day). Mentioned in early history: the VPN provider used for the proxy during measurements.
- **CI supply chain:** every action is pinned to a commit SHA (tag in a comment); workflows have read-only permissions
  by default and raise them per job only where needed (release, image push); no `pull_request_target`, so fork pull
  requests get a read-only token and no secrets; the pull-request title check passes the title through an environment
  variable (no injection); installs use the frozen lockfile; only GitHub's own actions and the named pnpm,
  release-please and Docker actions may run in the repository.

### Live surfaces

Tested from outside Israel (a Netherlands exit) and on the home network:

- **Public catalog:** path traversal refused by Cloudflare (400) or harmless (public files only); no reflection of query
  strings; `/status` and errors show no account id, path or secret; `.env`, wrangler config and the router's internal
  path are not reachable; the API Worker has no public address (404); CORS `*` on public files only (nothing private
  is served there); rate limits hold per connection (a burst over many connections is limited only by Cloudflare's
  approximate limiter — a known limit).
- **Away-from-home door (through the tunnel):** without the token, with a wrong one, and on every path outside the
  Mako allowlist (relay, admin, dashboard, API, Reshet streams, traversal, POST): an empty 404.
- **Home network:** the dashboard, API and live stream answer 404 without the token; a token in the address is refused
  on the API; a foreign Host header and a cross-site POST get 403; the cookie is `HttpOnly; SameSite=Strict` (no
  `Secure`: the admin page is plain HTTP on the home network); the relay refuses any target it did not sign (403).
- **Secrets in outputs:** no secret value in any log line, the usage database or any published file (counted on the
  home machine).

### The home machine (read-only, except Israel TV's own files)

- Israel TV listens on three ports: the home helper (home network, by design), the admin page (all interfaces, but its
  gate refuses anything not from a local address), and the away-from-home door on 127.0.0.1 for the tunnel only. The
  tunnel's rules route one hostname to that door, others to the owner's other services, and end with a 404 catch-all.
- Israel TV's config folder is private (700); its secrets file 600; the tunnel's credentials 400/600.
- Owner's observations (not Israel TV's): the macOS firewall is off; other services listen on all interfaces; two older
  tunnel config backups remain; the disk is 93% full.

### Accounts and tools

- **Cloudflare token:** active, no expiry date; it cannot read its own permission list (a sign of narrow scope). Used:
  Workers Scripts edit (deploying both Workers), Account Analytics read (usage counts), account settings read (wrangler).
- **GitHub:** private; squash-merge only, branches deleted after merge; Actions' default token read-only; no deploy keys
  and no repository secrets. Branch protection and secret scanning/push protection are not available on a private
  repository of a free account.
- **Laptop:** the project's config folder is private; its SSH key is used only through its own host alias.

### Fixed in this audit

- The router refuses anything but GET and HEAD (405) instead of treating other methods as GET (harmless, but costs an
  API call); test added.
- Databases (the catalog database holds the id registry, the usage database the counting secret) and backups are now
  created owner-only (600) in owner-only folders (700), wherever they live; test added.
- The release workflow passes the release tag through an environment variable; every action is pinned by SHA; the
  repository allows only the actions the workflows use.

### Left to the owner

See the final report: rotating or setting an expiry on the Cloudflare token and removing unused permissions; deciding on
rewriting history for the account id; when publishing — branch protection with required checks, secret scanning and
push protection, making the images public; the macOS firewall; `chmod 700 ~/.config/gh-israeltv`.
