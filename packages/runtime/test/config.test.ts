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
