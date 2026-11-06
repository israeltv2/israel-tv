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

test('credentials written into a proxy URL are moved out of it', () => {
  const geo = parseConfig({ geo: { type: 'http-proxy', urls: ['https://me:secret@p.example:3128'] } }).geo;
  const [p] = proxyEndpoints(geo, {});
  expect(p).toEqual({ server: 'https://p.example:3128', username: 'me', password: 'secret' });
});

test('common proxy failures are explained in plain words', async () => {
  const { explainNetError } = await import('../src/geo.ts');
  expect(explainNetError({ cause: { code: 'ENOTFOUND' } })).toMatch(/host not found/);
  expect(explainNetError({ cause: { code: 'ECONNREFUSED' } })).toMatch(/nothing is listening/);
  expect(explainNetError({ cause: { code: 'ERR_SSL_WRONG_VERSION_NUMBER' } })).toMatch(/with http:\/\//);
  expect(explainNetError({ message: 'Proxy response (407) !== 200 when HTTP Tunneling' })).toMatch(
    /rejected the login/,
  );
});

test('a proxy that refuses the login (407 on CONNECT) is reported as such', async () => {
  const { createServer } = await import('node:http');
  const { createGeoFetch } = await import('../src/geo-fetch.ts');
  const server = createServer((_q, r) => r.writeHead(407).end());
  server.on('connect', (_req, socket) => {
    socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\n\r\n');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const geoFetch = createGeoFetch([{ server: `http://127.0.0.1:${port}`, username: 'u', password: 'wrong' }]);
  await expect(geoFetch('https://example.invalid/')).rejects.toThrow(/rejected the login \(407\)/);
  server.close();
});
