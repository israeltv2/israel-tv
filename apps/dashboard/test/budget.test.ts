// The size budget: everything the page loads at first, compressed as a browser receives it.
import { gzipSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { dashboardFile, dashboardFiles } from '../src/server.ts';

const BUDGET_KB = { js: 45, css: 12 };

test('the dashboard stays small (gzip)', () => {
  let js = 0;
  let css = 0;
  for (const path of dashboardFiles()) {
    const f = dashboardFile(path);
    expect(f, path).toBeDefined();
    const size = gzipSync(f?.body ?? '').length;
    if (path.endsWith('.css')) css += size;
    else if (!path.endsWith('.html')) js += size;
  }
  console.log(`dashboard: ${(js / 1024).toFixed(1)} KB JS, ${(css / 1024).toFixed(1)} KB CSS (gzip)`);
  expect(js / 1024).toBeLessThan(BUDGET_KB.js);
  expect(css / 1024).toBeLessThan(BUDGET_KB.css);
});

test('only plain module names under web/ are served', () => {
  expect(dashboardFile('app/../src/server.ts')).toBeUndefined();
  expect(dashboardFile('app/main.js')).toBeUndefined();
  expect(dashboardFile('vendor/../../package.json')).toBeUndefined();
});
