// Spike: one persistent Chrome profile through the configured Israeli-exit proxy; visit URLs slowly
// and save each page's HTML, to see whether Cloudflare clearance carries over between pages.
// Run: node --env-file=../.env src/kan-dump.ts <out-dir> <url>...
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { pickProxy } from './proxy.ts';

const [out = '.', ...urls] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const context = await chromium.launchPersistentContext(join(out, 'profile'), {
  channel: 'chrome',
  headless: false,
  args: ['--window-position=-2400,-2400', '--window-size=1280,900'],
  proxy: pickProxy(Number(process.env.PROXY_INDEX ?? 0)),
  locale: 'he-IL',
  timezoneId: 'Asia/Jerusalem',
});
const page = context.pages()[0] ?? (await context.newPage());
// Fewer proxy connections per page: skip images, fonts and media (the challenge needs only HTML + JS).
await context.route('**/*', (route) =>
  ['image', 'font', 'media'].includes(route.request().resourceType()) ? route.abort() : route.continue(),
);
let requests = 0;
context.on('request', () => {
  requests++;
});
for (const [i, url] of urls.entries()) {
  const t0 = Date.now();
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
  for (let k = 0; k < 30 && /רק רגע|Just a moment/.test(await page.title()); k++)
    await page.waitForTimeout(1000);
  await page.waitForTimeout(2000);
  const html = await page.content();
  writeFileSync(join(out, `page-${i}.html`), html);
  console.log(
    `${i} ${res?.status() ?? 0} "${(await page.title()).slice(0, 50)}" ${html.length}b ${Date.now() - t0}ms ${requests}req ${url}`,
  );
  await page.waitForTimeout(12_000);
}
await context.close();
