// Spike 1a: load Kan pages in installed Chrome through the configured Israeli-exit proxy.
// Run: node --env-file=../.env src/kan-pages.ts [proxy-index] [--fresh]  (proxy from israel-tv.config.json)
import { chromium } from 'playwright-core';
import { pickProxy } from './proxy.ts';

const PAGES = [
  'https://www.kan.org.il/lobby/kan11/',
  'https://www.kan.org.il/lobby/kan-box/',
  'https://www.kankids.org.il/lobby-kids/kids-teens',
  'https://www.kan.org.il/lobby/archive/',
  'https://www.kan.org.il/content/kan/kan-11/',
];

const proxyIndex = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 0);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--window-position=-2400,-2400', '--window-size=1280,900'],
  proxy: pickProxy(proxyIndex),
});
const fresh = process.argv.includes('--fresh');
const newPage = async () =>
  (await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })).newPage();
let page = await newPage();

const ipPage = await page.goto('https://ipinfo.io/json');
const ip = JSON.parse((await ipPage?.text()) ?? '{}');
console.log(`exit: ${ip.country} ${ip.city} ${ip.org}`);

for (const url of PAGES) {
  if (fresh) {
    await page.context().close();
    page = await newPage();
  }
  const t0 = Date.now();
  let status = 0;
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    status = res?.status() ?? 0;
    // Give a Cloudflare challenge time to resolve itself.
    for (let i = 0; i < 45 && /רק רגע|Just a moment/i.test(await page.title()); i++)
      await page.waitForTimeout(1000);
    await page.waitForTimeout(1500);
  } catch (err) {
    console.log(`${url} ERROR ${(err as Error).message.split('\n')[0]}`);
    continue;
  }
  const title = await page.title();
  const links = await page.$$eval('a[href]', (as) => as.length);
  console.log(`${url} status=${status} title="${title.slice(0, 60)}" links=${links} ms=${Date.now() - t0}`);
}
await browser.close();
