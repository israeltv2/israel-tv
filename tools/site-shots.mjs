// `pnpm shots:site`: the public pages' design check. Renders the landing and status pages (English and Hebrew)
// and the library pages from the fixture (packages/render/test/fixtures/site.ts) with the site's images, serves them with the local
// publisher's own server, freezes the clock and screenshots each at phone (375 px) and desktop width in light and dark.
// Fails on page errors, console errors, failed requests and sideways scrolling. Screenshots go to ./site-screens.
// `--serve` only serves the pages (http://127.0.0.1:7790/) for a look or a Lighthouse run; `--readme` also writes
// the README's screenshots to docs/images.
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { localAddonApp } from '../apps/ingest/src/local-server.ts';
import { guideMatcher } from '../packages/core/src/guide-match.ts';
import { normalizeForSearch } from '../packages/core/src/hebrew.ts';
import { sitePaths } from '../packages/core/src/site.ts';
import {
  airingsFile,
  renderGuidePage,
  renderLandingHtml,
  renderLibrary,
  renderStatusHtml,
  robotsTxt,
  sitemapXml,
  webManifest,
} from '../packages/render/src/index.ts';
import { LANDING, LIBRARY, NOW, SITE_STATUS } from '../packages/render/test/fixtures/site.ts';
import { listen } from '../packages/runtime/src/serve.ts';

const repo = fileURLToPath(new URL('..', import.meta.url));
const serveOnly = process.argv.includes('--serve');
const readme = process.argv.includes('--readme');

const dir = mkdtempSync(join(tmpdir(), 'israel-tv-site-'));
const write = (path, body) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), body);
};
// The public address as it is published (the install links and the link shown).
const landing = { ...LANDING, publicUrl: 'https://israel-tv.israeltv2.workers.dev' };
write(sitePaths.landing, renderLandingHtml(landing, 'en'));
write(sitePaths.landingHe, renderLandingHtml(landing, 'he'));
write(sitePaths.statusPage, renderStatusHtml(SITE_STATUS));
write(sitePaths.statusPageHe, renderStatusHtml(SITE_STATUS, {}, 'he'));
for (const [path, html] of renderLibrary(LIBRARY)) write(path, html);
const guideInput = {
  live: LIBRARY.live,
  guide: LIBRARY.guide ?? {},
  showFor: guideMatcher(
    LIBRARY.rows.flatMap((r) => r.shows.map((s) => ({ id: s.meta.id, catalog: r.id, title: s.meta.name }))),
  ),
};
write(sitePaths.guidePage, renderGuidePage(guideInput, 'he'));
write(sitePaths.guidePageEn, renderGuidePage(guideInput, 'en'));
write(sitePaths.airings, JSON.stringify(airingsFile(guideInput)));
write(
  sitePaths.search,
  JSON.stringify(
    LIBRARY.rows.flatMap((r) =>
      r.shows.map((s) => [s.meta.id, 'series', r.id, s.meta.name, normalizeForSearch(s.meta.name), '']),
    ),
  ),
);
write(sitePaths.status, JSON.stringify(SITE_STATUS));
write(sitePaths.robots, robotsTxt());
write(sitePaths.sitemap, sitemapXml());
write(sitePaths.webManifest, webManifest());
write(sitePaths.manifest, JSON.stringify({ id: 'fixture', name: LANDING.name }));
cpSync(join(repo, 'assets/site'), dir, { recursive: true });
mkdirSync(join(dir, 'logos'));
for (const f of readdirSync(join(repo, 'assets/logos')).filter((x) => x.endsWith('.png')))
  copyFileSync(join(repo, 'assets/logos', f), join(dir, 'logos', f));
for (const f of readdirSync(join(repo, 'assets/logos/site')))
  copyFileSync(join(repo, 'assets/logos/site', f), join(dir, 'logos', f));

const port = serveOnly ? 7790 : 7791;
await listen(localAddonApp(dir).fetch, '127.0.0.1', port, '--port');
const base = `http://127.0.0.1:${port}`;
if (serveOnly) {
  console.log(`serving the public pages from the fixture on ${base}/ (Ctrl+C to stop)`);
} else {
  const out = join(repo, 'site-screens');
  mkdirSync(out, { recursive: true });
  const PAGES = [
    ['landing', '/'],
    ['landing-he', '/he/'],
    ['status', '/status'],
    ['status-he', '/he/status'],
    ['library', '/library/'],
    ['row', '/library/reshet13/'],
    ['show', '/show/iltv_reshet_1/'],
    ['live', '/live/'],
    ['guide', '/live/guide/'],
    ['guide-en', '/en/live/guide/'],
    ['search', '/search/?q=%D7%94%D7%99%D7%A9%D7%A8%D7%93%D7%95%D7%AA'],
  ];
  const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
  let failed = false;
  try {
    for (const [vp, viewport] of [
      ['phone', { width: 375, height: 812 }],
      ['desktop', { width: 1440, height: 900 }],
    ]) {
      for (const colorScheme of ['light', 'dark']) {
        const ctx = await browser.newContext({ viewport, colorScheme, deviceScaleFactor: 2 });
        const page = await ctx.newPage();
        await page.clock.setFixedTime(new Date(NOW));
        const problems = [];
        page.on('pageerror', (e) => problems.push(`page error: ${e}`));
        page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
        page.on('requestfailed', (r) =>
          problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`),
        );
        page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url()}`));
        for (const [name, path] of PAGES) {
          await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
          if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1))
            problems.push(`${name}: scrolls sideways`);
          const file = `${vp}-${colorScheme}-${name}.png`;
          await page.screenshot({ path: join(out, file), fullPage: true });
          if (readme && ['landing', 'status'].includes(name) && colorScheme === 'light') {
            mkdirSync(join(repo, 'docs/images'), { recursive: true });
            await page.screenshot({
              path: join(repo, 'docs/images', `site-${name}-${vp}.jpg`),
              type: 'jpeg',
              quality: 82,
              fullPage: false,
            });
          }
        }
        console.log(
          `${problems.length ? 'FAIL' : 'ok  '} ${vp} ${colorScheme}${problems.length ? `\n  ${[...new Set(problems)].join('\n  ')}` : ''}`,
        );
        if (problems.length) failed = true;
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`screenshots in ${out}`);
  process.exit(failed ? 1 : 0);
}
