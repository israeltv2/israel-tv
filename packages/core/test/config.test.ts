import { expect, test } from 'vitest';
import { ConfigError, checkSecrets, parseConfig } from '../src/config.ts';

test('empty config gets working defaults (inside Israel, local publisher)', () => {
  const c = parseConfig({});
  expect(c.geo).toEqual({ type: 'none' });
  expect(c.publisher.type).toBe('local');
  expect(c.store.path).toBe('./data/israel-tv.sqlite');
  expect(c.schedule.timezone).toBe('Asia/Jerusalem');
  expect(c.resolver.enabled).toBe(true);
});

test('errors name the option', () => {
  expect(() => parseConfig({ geo: { type: 'http-proxy', urls: [] } })).toThrow(/geo\.urls/);
  expect(() => parseConfig({ publisher: { type: 'ftp' } })).toThrow(ConfigError);
  expect(() => parseConfig({ unknownOption: 1 })).toThrow(/unknownOption|Unrecognized/);
});

test('missing secrets are listed together', () => {
  const c = parseConfig({
    geo: {
      type: 'http-proxy',
      urls: ['https://proxy.example:89'],
      usernameEnv: 'P_USER',
      passwordEnv: 'P_PASS',
    },
    publisher: { type: 'cloudflare' },
  });
  expect(() => checkSecrets(c, { P_USER: 'x' })).toThrow(
    /P_PASS \(needed by geo.passwordEnv\), CLOUDFLARE_ACCOUNT_ID \(needed by publisher.accountIdEnv\)/,
  );
  expect(() =>
    checkSecrets(c, { P_USER: 'x', P_PASS: 'y', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 'b' }),
  ).not.toThrow();
});

test('a section without "type" gets the default kind', () => {
  const c = parseConfig({ publisher: { port: 8000 }, browser: { headed: false } });
  expect(c.publisher).toMatchObject({ type: 'local', port: 8000 });
  expect(c.browser).toMatchObject({ type: 'chrome', headed: false });
});

test('proxy URLs must match the proxy type', () => {
  expect(() => parseConfig({ geo: { type: 'http-proxy', urls: ['il.proxy.example.net:3128'] } })).toThrow(
    /geo\.urls\.0: must be a full proxy URL starting with http:\/\/ or https:\/\//,
  );
  expect(() => parseConfig({ geo: { type: 'http-proxy', urls: ['socks5://p:1080'] } })).toThrow(
    /geo\.urls\.0/,
  );
  expect(() => parseConfig({ geo: { type: 'socks5', urls: ['https://p:3128'] } })).toThrow(/socks5:\/\//);
  expect(parseConfig({ geo: { type: 'http-proxy', urls: ['https://p.example:3128'] } }).geo.type).toBe(
    'http-proxy',
  );
});
