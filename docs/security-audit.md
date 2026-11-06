# Security

How Israel TV protects its users and the people who run it. A full audit is recorded at the end of this page when one
is done.

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
