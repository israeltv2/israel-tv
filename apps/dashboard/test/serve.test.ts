import { expect, test } from 'vitest';
import { dashboardCsp, dashboardFile } from '../server/serve.ts';

test('only files inside dist are served; the page gets its nonce', () => {
  for (const p of [
    '../package.json',
    'assets/../../package.json',
    '/etc/passwd',
    'assets/%2e%2e/x.js',
    'server/serve.ts',
  ])
    expect(dashboardFile(p), p).toBeUndefined();
  const page = dashboardFile('', 'n0nce');
  expect(page?.type).toMatch(/text\/html/);
  expect(page?.immutable).toBe(false);
  expect(String(page?.body)).not.toContain('__CSP_NONCE__');
});

test('the content security policy: no inline script, no other origins but https images', () => {
  const csp = dashboardCsp('abc');
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toMatch(/script-src[^;]*unsafe/);
  expect(csp).toContain("style-src 'self' 'nonce-abc'");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
});
