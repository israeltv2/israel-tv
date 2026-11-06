// Spike 1a follow-up: wait out the challenge on one Kan URL and save a screenshot + lobby links.
// Run: node --env-file=../.env src/kan-probe.ts <url> [server] [waitSeconds]
import { chromium } from 'playwright-core';
import { nordProxy } from './nord.ts';

const [url = 'https://www.kan.org.il/lobby/kan-box/', server = 'il100', wait = '60'] = process.argv.slice(2);
const out = process.env.SPIKE_OUT ?? '.';
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--window-position=-2400,-2400', '--window-size=1280,900'],
  proxy: nordProxy(server),
});
const page = await (await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })).newPage();
const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
console.log(`first status=${res?.status()}`);
const deadline = Date.now() + Number(wait) * 1000;
while (Date.now() < deadline && /רק רגע|Just a moment/i.test(await page.title()))
  await page.waitForTimeout(2000);
console.log(`final title="${await page.title()}" url=${page.url()}`);
await page.screenshot({ path: `${out}/kan-probe.png` });
const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).href));
console.log(
  [...new Set(hrefs)]
    .filter((h) => /kan\.org\.il|kankids/.test(h))
    .slice(0, 80)
    .join('\n'),
);
await browser.close();
