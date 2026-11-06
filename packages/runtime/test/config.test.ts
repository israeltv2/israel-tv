import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { configLocation, platformHome } from '../src/config.ts';

test('the usual app folder, per platform', () => {
  expect(platformHome({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32', 'C:\\Users\\a')).toBe(
    join('C:\\Users\\a\\AppData\\Local', 'israel-tv'),
  );
  expect(platformHome({}, 'darwin', '/Users/a')).toBe(
    join('/Users/a', 'Library', 'Application Support', 'israel-tv'),
  );
  expect(platformHome({}, 'linux', '/home/a')).toBe(join('/home/a', '.config', 'israel-tv'));
  expect(platformHome({ XDG_CONFIG_HOME: '/x' }, 'linux', '/home/a')).toBe(join('/x', 'israel-tv'));
});

test('where the config is: explicit file, then ISRAEL_TV_HOME, then the current folder, then the usual folder', () => {
  const here = mkdtempSync(join(tmpdir(), 'cwd-'));
  expect(configLocation({ ISRAEL_TV_CONFIG: join(here, 'c.json') }, here)).toEqual({
    file: join(here, 'c.json'),
    why: 'ISRAEL_TV_CONFIG',
  });
  expect(configLocation({ ISRAEL_TV_HOME: join(here, 'h') }, here).file).toBe(
    join(here, 'h', 'israel-tv.config.json'),
  );
  expect(configLocation({}, here).why).toBe("this computer's usual app folder");
  writeFileSync(join(here, 'israel-tv.config.json'), '{}');
  expect(configLocation({}, here)).toEqual({
    file: join(here, 'israel-tv.config.json'),
    why: 'the current folder',
  });
});

test('a container can be set up from the environment; a config file wins', async () => {
  const { withEnvSettings } = await import('../src/config.ts');
  const env = {
    ISRAEL_TV_CATALOG_URL: 'https://catalog.example/manifest.json',
    ISRAEL_TV_PROXY: 'http://u:p@proxy.example:3128',
  };
  expect(withEnvSettings({}, env, false)).toEqual({
    role: 'resolver-only',
    resolver: { catalogUrl: 'https://catalog.example/manifest.json' },
    geo: { type: 'http-proxy', urls: ['http://u:p@proxy.example:3128'] },
  });
  expect(withEnvSettings({ role: 'local-only' }, env, true)).toMatchObject({ role: 'local-only' });
  expect(withEnvSettings({ geo: { type: 'none' } }, env, true)).toEqual({ geo: { type: 'none' } });
  expect(withEnvSettings({}, { ISRAEL_TV_PROXY: 'socks5://h:1080' }, false)).toEqual({
    geo: { type: 'socks5', urls: ['socks5://h:1080'] },
  });
  expect(() => withEnvSettings({}, { ISRAEL_TV_PROXY: 'nonsense' }, false)).toThrow(/not a URL/);
});

test('an image without a browser turns Kan episodes off, unless the config says otherwise', async () => {
  const { withEnvSettings } = await import('../src/config.ts');
  expect(withEnvSettings({}, { ISRAEL_TV_BROWSER: 'none' }, false)).toEqual({ browser: { type: 'none' } });
  expect(withEnvSettings({ browser: { type: 'chrome' } }, { ISRAEL_TV_BROWSER: 'none' }, true)).toEqual({
    browser: { type: 'chrome' },
  });
});

test('the proxy login can come separately (any characters, from an env file)', async () => {
  const { withEnvSettings } = await import('../src/config.ts');
  const env = {
    ISRAEL_TV_PROXY: 'socks5://proxy.example:1080',
    ISRAEL_TV_PROXY_USER: 'u',
    ISRAEL_TV_PROXY_PASSWORD: 'p@:/#',
  };
  expect(withEnvSettings({}, env, false)).toEqual({
    geo: {
      type: 'socks5',
      urls: ['socks5://proxy.example:1080'],
      usernameEnv: 'ISRAEL_TV_PROXY_USER',
      passwordEnv: 'ISRAEL_TV_PROXY_PASSWORD',
    },
  });
});

test('addresses to install: home network first, virtual adapters left out', async () => {
  const { homeAddresses } = await import('../src/serve.ts');
  expect(
    homeAddresses([
      { name: 'vEthernet (WSL)', address: '172.28.0.1' },
      { name: 'docker0', address: '172.17.0.1' },
      { name: 'Wi-Fi', address: '192.168.7.4' },
      { name: 'Ethernet 2', address: '169.254.3.3' },
      { name: 'en0', address: '10.1.2.3' },
    ]),
  ).toEqual(['192.168.7.4', '10.1.2.3']);
  expect(homeAddresses([{ name: 'utun3', address: '100.64.0.2' }])).toEqual(['100.64.0.2']);
  expect(homeAddresses([])).toEqual(['127.0.0.1']);
});
