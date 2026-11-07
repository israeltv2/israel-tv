// `pnpm shots:site`: the public pages' design check. Renders the landing page (English and Hebrew), the status
// page and the library pages from the fixture (packages/render/test/fixtures/site.ts) with the site's images, serves them with the local
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
import { sitePaths } from '../packages/core/src/site.ts';
import {
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
for (const [path, html] of renderLibrary(LIBRARY)) write(path, html);
write(sitePaths.status, JSON.stringify(SITE_STATUS));
write(sitePaths.robots, robotsTxt());
write(sitePaths.sitemap, sitemapXml());
write(sitePaths.webManifest, webManifest());
write(sitePaths.manifest, JSON.stringify({ id: 'fixture', name: LANDING.name }));
cpSync(join(repo, 'assets/site'), dir, { recursive: true });
mkdirSync(join(dir, 'logos'));
for (const f of readdirSync(join(repo, 'assets/logos')))
  copyFileSync(join(repo, 'assets/logos', f), join(dir, 'logos', f));

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
    ['library', '/library/'],
    ['row', '/library/reshet13/'],
    ['show', '/show/iltv_reshet_1/'],
    ['live', '/live/'],
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
