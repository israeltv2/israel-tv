import { expect, test } from 'vitest';
import { LIMITS, limitKind, memoryLimiter, tooMany } from '../src/limit.ts';

test('search and stream requests are limited; browsing is not', () => {
  expect(limitKind(new URL('https://a/stream/series/iltv_mako_1:1:1.json'))).toBe('stream');
  expect(limitKind(new URL('https://a/catalog/series/iltv_keshet12/search=%D7%90.json'))).toBe('search');
  expect(limitKind(new URL('https://a/catalog/series/iltv_keshet12.json'))).toBeUndefined();
  expect(limitKind(new URL('https://a/meta/series/iltv_mako_1.json'))).toBeUndefined();
});

test('the fallback limiter allows a family-sized burst, then refuses until the minute is over', async () => {
  let t = 0;
  const l = memoryLimiter(LIMITS.stream, () => t);
  for (let i = 0; i < LIMITS.stream; i++) expect((await l.limit({ key: 'home' })).success).toBe(true);
  expect((await l.limit({ key: 'home' })).success).toBe(false);
  expect((await l.limit({ key: 'other' })).success).toBe(true);
  t = 60_000;
  expect((await l.limit({ key: 'home' })).success).toBe(true);
});

test('over the limit: 429 with a clear message', async () => {
  const r = tooMany('stream');
  expect(r.status).toBe(429);
  expect(r.headers.get('retry-after')).toBe('60');
  expect((await r.json()).error).toMatch(/Too many stream requests/);
});
