import { parseConfig } from '@israel-tv/core';
import { expect, test } from 'vitest';
import { proxyEndpoints, proxyUrlWithAuth } from '../src/geo.ts';

test('no proxies inside Israel', () => {
  expect(proxyEndpoints(parseConfig({}).geo, {})).toEqual([]);
});

test('credentials come from the named env vars and are URL-encoded', () => {
  const geo = parseConfig({
    geo: {
      type: 'http-proxy',
      urls: ['https://p1.example:89', 'https://p2.example:89'],
      usernameEnv: 'U',
      passwordEnv: 'P',
    },
  }).geo;
  const eps = proxyEndpoints(geo, { U: 'me', P: 'p@ss:word' });
  expect(eps.map((e) => e.server)).toEqual(['https://p1.example:89', 'https://p2.example:89']);
  const [first] = eps;
  if (!first) throw new Error('no proxy');
  expect(proxyUrlWithAuth(first)).toBe('https://me:p%40ss%3Aword@p1.example:89/');
});
