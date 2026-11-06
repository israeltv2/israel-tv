# Decisions and measurements

Each entry: what was measured, the result, and what it decided. Dates are when measured.

## Toolchain (2026-11-06)

- **Drizzle:** the stable release (`drizzle-orm` 0.45.4) has no `node:sqlite` driver; `1.0.0-rc.5` ships
  `drizzle-orm/node-sqlite`. Pinned `drizzle-orm` and `drizzle-kit` at `1.0.0-rc.5`.
- **Vitest:** `@cloudflare/vitest-pool-workers` 0.23.0 (latest) peers on Vitest `^4.1.0`. Node packages use
  Vitest 5.1.0; the Worker app pins Vitest 4.1.12 until the pool supports 5.
- **Workspace setup** lives in `.paradev/config.toml` (current format; `config.json` is the old one).

## Spike 1a: Kan pages in real Chrome through Nord Israel (2026-11-06)

Setup: installed Google Chrome via `playwright-core`, headed, window off-screen, locale `he-IL`,
proxy `https://ilNN.proxy.nordvpn.com:89` with Playwright's `proxy` option. Exit IP: Tel Aviv, datacenter ASN.

- Proxies `il93`–`il102` worked; `il79`–`il82` refused connections (`proxy_ssl` is listed for them anyway).
- **`/lobby/kan-box/` loads (200, real page, screenshot checked) on the first navigation of a fresh
  browser context**, on two different servers.
- In one context, after a first `kan.org.il` page loads, later `kan.org.il` pages get a Cloudflare
  challenge ("רק רגע...", 403) that did not clear within 45 s. `kankids.org.il` (separate site) kept loading.
- After roughly 10 Chrome sessions in a few minutes, every Nord server answered **407** for the same
  credentials (and still did 20+ minutes later). Treat Nord auth as rate-limited: one proxy session at a
  time, reuse it, and back off on 407.
- Status: **partial pass.** kan-box is reachable from Israel; the per-context challenge and the 407
  lockout need a retest with a fresh context per page and slow pacing.

## Spike 1b: stored Kan stream URLs through Israel

Pending (blocked on the Nord 407 above).

## Spike 1c: deploy time on workers.dev (2026-11-06)

Dummy Worker (Hono) + static assets, `wrangler deploy` with an API token, from this laptop.

| Case             | Assets                            | Time                                     |
| ---------------- | --------------------------------- | ---------------------------------------- |
| First deploy     | 1                                 | 14 s                                     |
| Bulk upload      | 5,000 (meta + per-season streams) | 29 s (assets 14 s)                       |
| One file changed | 5,000 (4,999 already uploaded)    | 15 s (assets 1.4 s; Worker upload ~11 s) |

The changed file was served immediately after deploy. Decision: **publish by `wrangler deploy` per
refresh is fine** (one-show refresh ≈ 15 s end to end). Batch airing-show refreshes into one deploy per
cycle. Keep `Cache-Control` short on meta/stream files (minutes), longer on catalog images only.

## Spike 1d: search CPU on the free plan (2026-11-06)

1,500 Hebrew names (Mako index titles, padded), normalized (niqqud, geresh/gershayim, final letters,
punctuation), substring scan, bundled into the Worker.

- Local: index build 3.2 ms once per isolate; query 0.3–0.9 ms.
- Cloudflare (`wrangler tail` `cpuTime`): **0–2 ms per search request**, including cold isolates.
- Decision: **bundle a pre-normalized search index into the Worker and scan linearly.** No D1 needed.
