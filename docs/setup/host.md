# Your own copy on Cloudflare (role `host`)

Like [your own copy at home](local-only.md), but the catalog is published to your free Cloudflare account, so it is
reachable from anywhere and you can share the link with family and friends. The reader and the home helper still
run on your computer at home.

## Requirements

Everything in [your own copy at home](local-only.md#requirements), plus a free [Cloudflare](https://cloudflare.com)
account.

## Set up Cloudflare (once)

1. Create a free account and open **Workers & Pages**. Choose your `<subdomain>.workers.dev` subdomain when asked.
   The **Account ID** is in the right-hand column of that page.
2. Create an API token: _My Profile → API Tokens → Create Token_, template **Edit Cloudflare Workers**, limited to
   your account. For the public link's usage counts, add the permission **Account → Account Analytics → Read**, and
   turn on **Workers Analytics Engine** once (_Workers & Pages → Analytics Engine → enable_; free).
3. In `.env` in your config folder (`pnpm israel-tv paths` shows it):

   ```
   CLOUDFLARE_API_TOKEN=…
   CLOUDFLARE_ACCOUNT_ID=…
   ```

4. In `israel-tv.config.json` (start from [examples/host](../../examples/host/israel-tv.config.example.json)):

   ```json
   { "role": "host", "publisher": { "type": "cloudflare", "workerName": "israel-tv" } }
   ```

5. Install and deploy:

   ```bash
   git clone https://github.com/israeltv2/israel-tv.git && cd israel-tv
   corepack enable && pnpm install
   pnpm israel-tv deploy     # once, and after each update
   pnpm start
   ```

   `deploy` puts up two Workers — a public one with the catalog files and a tiny router, and a private one (no
   public address) with the code — and prints your link: `https://israel-tv.<subdomain>.workers.dev/manifest.json`
   (a brand-new name can take a minute to work). Add it in your app, plus the home helper's link that `pnpm start`
   prints.

## What it costs and what is public

Free. Show pages, images and the manifest are plain files (free and unlimited); rows, search, streams and `/status`
run code and count toward the free plan's 100,000 requests a day — plenty for a household and friends (past it,
Cloudflare answers errors until midnight UTC). Search and streams are also limited per client: 60 searches and 120
stream requests a minute.

| Public (anyone with the link)                                   | Your home network only | Admin (you only)      |
| --------------------------------------------------------------- | ---------------------- | --------------------- |
| The catalog: rows, show pages, search, plain streams, `/status` | The home helper        | Status details, usage |

Changes are published gathered into one update at most every half hour (`publisher.minIntervalMinutes`); a full
run's end and a show refresh you ask for go out at once. Each Worker can be rolled back on its own
([operations](../operations.md#rolling-back-on-cloudflare)).

## Sharing with friends

Friends who install your link get the rows, show pages and search, live channels that need nothing extra, and
Reshet and Kan episodes inside Israel. **Not** Keshet 12 — that needs a home helper on their own network: send them
[Set up the home helper](home-helper.md) with your link as `ISRAEL_TV_CATALOG_URL` (Docker) or `catalogUrl`. Never
expose your own helper to the internet. Tell them about [privacy](../privacy.md).

## Abroad, Kan, keeping it running, troubleshooting

As for [your own copy at home](local-only.md): [abroad](local-only.md#abroad), [Kan](local-only.md#kan-episodes),
[background](background.md), [troubleshoot](local-only.md#troubleshoot). A failed upload is retried after the next
run and shows on `/status` with Cloudflare's reason.
