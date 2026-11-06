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
    /P_PASS, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN/,
  );
  expect(() =>
    checkSecrets(c, { P_USER: 'x', P_PASS: 'y', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 'b' }),
  ).not.toThrow();
});
