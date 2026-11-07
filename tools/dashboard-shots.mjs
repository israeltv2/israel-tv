// `pnpm shots:dashboard`: the dashboard's design check. Serves the built page (apps/dashboard/dist) with the daemon's
// own file server and content security policy, answers the admin API from the typed fixtures
// (apps/dashboard/test/fixtures.ts), freezes the clock, and screenshots every section at phone and desktop width in
// light and dark. Fails on page errors, console errors (CSP violations included), failed requests and sideways
// scrolling. Screenshots go to ./dashboard-screens/design (kept by CI).

import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { dashboardBuilt, dashboardCsp, dashboardFile, newNonce } from '../apps/dashboard/server/serve.ts';
import { FIXTURES, NOW } from '../apps/dashboard/test/fixtures.ts';

const repo = fileURLToPath(new URL('..', import.meta.url));
if (!dashboardBuilt()) {
  console.error('the dashboard is not built: run `pnpm build` first');
  process.exit(1);
}
const out = join(repo, 'dashboard-screens', 'design');
mkdirSync(out, { recursive: true });

const ROUTES = {
  '/api/v1/session': 'session',
  '/api/v1/health': 'health',
  '/api/v1/overview': 'overview',
  '/api/v1/sources': 'sources',
  '/api/v1/plays': 'plays',
  '/api/v1/failures': 'failures',
  '/api/v1/live': 'live',
  '/api/v1/deploys': 'deploys',
  '/api/v1/system': 'system',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname.startsWith('/api/v1/')) {
    const name = ROUTES[url.pathname] ?? (url.pathname.startsWith('/api/v1/trace/') ? 'trace' : undefined);
    if (url.pathname === '/api/v1/live/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write(`event: live\ndata: ${JSON.stringify(FIXTURES.live)}\n\n`);
      return; // kept open, like the daemon's
    }
    if (url.pathname.startsWith('/api/v1/actions/')) {
      res.writeHead(202, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(FIXTURES.canary));
    }
    if (!name) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"error":"not found"}');
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(FIXTURES[name]));
  }
  if (url.pathname === '/' || url.pathname === '/dash') {
    res.writeHead(302, { location: '/dash/' });
    return res.end();
  }
  if (url.pathname.startsWith('/dash/')) {
    const nonce = newNonce();
    const f = dashboardFile(url.pathname.slice('/dash/'.length), nonce);
    if (!f) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      'content-type': f.type,
      'content-security-policy': dashboardCsp(nonce),
      'x-content-type-options': 'nosniff',
    });
    return res.end(f.body);
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
const base = `http://127.0.0.1:${server.address().port}`;

/** A generated poster tile (no broadcaster artwork in the repo or in screenshots). */
const posterSvg = (n) => {
  const hues = [12, 205, 265, 160, 330, 40, 290];
  const h = hues[n % hues.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 55% 45%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360} 60% 22%)"/></linearGradient></defs><rect width="200" height="300" fill="url(#g)"/><circle cx="150" cy="70" r="46" fill="hsl(${h} 70% 70% / .35)"/><rect x="18" y="226" width="120" height="12" rx="6" fill="#fff" opacity=".85"/><rect x="18" y="248" width="76" height="9" rx="4.5" fill="#fff" opacity=".55"/></svg>`;
};

/** A generated square channel logo. */
const logoSvg = (n) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="88" fill="hsl(${(n * 97) % 360} 70% 48%)"/><text x="100" y="128" font-family="system-ui" font-size="84" font-weight="700" fill="#fff" text-anchor="middle">${n}</text></svg>`;

const SECTIONS = ['', 'sources', 'plays', 'failures', 'trace/1vBVjuqTAxOs', 'live', 'deploys', 'system'];
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
});
let failed = false;
try {
  for (const [vp, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1440, height: 900 }],
  ]) {
    for (const colorScheme of ['light', 'dark']) {
      const ctx = await browser.newContext({
        viewport,
        colorScheme,
        deviceScaleFactor: vp === 'phone' ? 2 : 1,
      });
      await ctx.route('https://img.example/**', (route) => {
        const url = route.request().url();
        // Refused, the way Kan answers outside Israel: the page must fall back to its own tile.
        if (url.includes('/refused-'))
          return route.fulfill({ status: 403, contentType: 'text/html', body: '<h1>Forbidden</h1>' });
        const n = Number(/-(\d+)\.svg/.exec(url)?.[1] ?? 0);
        const body = url.includes('/logo-') ? logoSvg(n) : posterSvg(n);
        return route.fulfill({ status: 200, contentType: 'image/svg+xml', body });
      });
      const page = await ctx.newPage();
      await page.clock.setFixedTime(new Date(NOW));
      const problems = [];
      page.on('pageerror', (e) => problems.push(`page error: ${e}`));
      // The refused fixture image is expected to fail (and is checked to fall back below).
      page.on(
        'console',
        (m) =>
          m.type() === 'error' &&
          !m.location().url.includes('/refused-') &&
          problems.push(`console: ${m.text()}`),
      );
      page.on('requestfailed', (r) => {
        const why = r.failure()?.errorText;
        if (why !== 'net::ERR_ABORTED') problems.push(`request failed: ${r.url()} (${why})`);
      });
      for (const section of SECTIONS) {
        await page.goto(`${base}/dash/#/${section}`);
        await page.locator('main h1').first().waitFor({ timeout: 15_000 });
        await page.waitForLoadState('networkidle').catch(() => undefined);
        // Charts load with their section: wait until no placeholder is left.
        await page.waitForFunction(() => document.querySelectorAll('.animate-pulse').length === 0, null, {
          timeout: 15_000,
        });
        await page.evaluate(() => document.fonts.ready);
        // Lazy images below the fold would be blank in a full-page shot: load them all first.
        await page.evaluate(() =>
          Promise.all(
            [...document.querySelectorAll('img[loading="lazy"]')].map((i) => {
              i.loading = 'eager';
              return i.decode().catch(() => undefined);
            }),
          ),
        );
        await page.waitForTimeout(250);
        if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1))
          problems.push(`${section || 'overview'}: scrolls sideways`);
        // Every show image either loaded or fell back to its tile: none is shown broken.
        const broken = await page.evaluate(() =>
          [...document.querySelectorAll('[data-poster] img')]
            .filter((i) => i.complete && i.naturalWidth === 0)
            .map((i) => i.getAttribute('src')),
        );
        if (broken.length) problems.push(`${section || 'overview'}: broken images ${broken.join(', ')}`);
        const name = `${vp}-${colorScheme}-${(section || 'overview').replace(/\/.*/, '')}.png`;
        await page.screenshot({ path: join(out, name), fullPage: true });
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
  server.close();
}
console.log(`screenshots: ${out}`);
process.exit(failed ? 1 : 0);
