// `pnpm e2e:dashboard`: the owner's dashboard in a real browser (Chrome or Edge, found by Playwright). Starts a
// local-only instance with every source off (no site contacted), opens the dashboard the way the admin-url link
// does, visits every section at phone and desktop size in light and dark, and fails on any page error, failed
// request or sideways scrolling. Screenshots go to ./dashboard-screens (kept by CI).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const repo = fileURLToPath(new URL('..', import.meta.url));
const home = mkdtempSync(join(tmpdir(), 'israel-tv-e2e-'));
writeFileSync(
  join(home, 'israel-tv.config.json'),
  JSON.stringify({
    role: 'local-only',
    sources: { mako: false, reshet: false, kan: false, live: false },
    browser: { type: 'none' },
    publisher: { type: 'local', host: '127.0.0.1', port: 17950 },
    resolver: { host: '127.0.0.1', port: 17951 },
    admin: { host: '127.0.0.1', port: 17952 },
  }),
);
const env = {
  ...process.env,
  ISRAEL_TV_HOME: home,
  ISRAEL_TV_ADMIN_TOKEN: 'e2e-admin-token-not-secret-000000',
};
const daemon = spawn(process.execPath, ['apps/ingest/src/cli.ts', 'start', '--no-initial-run'], {
  cwd: repo,
  env,
  stdio: 'ignore',
});
const out = join(repo, 'dashboard-screens');
mkdirSync(out, { recursive: true });
let failed = false;
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
});
try {
  for (let i = 0; i < 60; i++) {
    const ok = await fetch('http://127.0.0.1:17952/api/v1/session', {
      headers: { authorization: `Bearer ${env.ISRAEL_TV_ADMIN_TOKEN}` },
    }).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  for (const [name, viewport, colorScheme] of [
    ['phone-light', { width: 390, height: 844 }, 'light'],
    ['phone-dark', { width: 390, height: 844 }, 'dark'],
    ['desktop-light', { width: 1280, height: 860 }, 'light'],
    ['desktop-dark', { width: 1280, height: 860 }, 'dark'],
  ]) {
    const ctx = await browser.newContext({ viewport, colorScheme });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    // A live stream closed by leaving its section is aborted on purpose; anything else that fails is a problem.
    page.on(
      'requestfailed',
      (r) => r.failure()?.errorText !== 'net::ERR_ABORTED' && problems.push(`request failed: ${r.url()}`),
    );
    await page.goto(`http://127.0.0.1:17952/dash/?token=${env.ISRAEL_TV_ADMIN_TOKEN}`, {
      waitUntil: 'networkidle',
    });
    for (const tab of ['', 'sources', 'plays', 'failures', 'live', 'deploys', 'system']) {
      await page.goto(`http://127.0.0.1:17952/dash/#/${tab}`, { waitUntil: 'networkidle' });
      await page.locator('section').first().waitFor({ timeout: 10_000 });
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
        problems.push(`${tab || 'overview'}: scrolls sideways`);
      await page.screenshot({ path: join(out, `${name}-${tab || 'overview'}.png`) });
    }
    console.log(
      `${problems.length ? 'FAIL' : 'ok  '} ${name}${problems.length ? `: ${problems.join(' | ')}` : ''}`,
    );
    if (problems.length) failed = true;
    await ctx.close();
  }
} catch (err) {
  failed = true;
  console.error(`FAIL ${err.message}`);
} finally {
  await browser.close();
  daemon.kill();
}
process.exit(failed ? 1 : 0);
