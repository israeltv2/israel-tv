import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { writeSite } from '../src/publish.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'iltv-site-'));

test('a folder israel-tv did not create is never cleaned', () => {
  const d = dir();
  writeFileSync(join(d, 'israel-tv.sqlite'), 'precious');
  expect(() => writeSite(d, new Map([['manifest.json', '{}']]))).toThrow(
    /not empty and was not created by israel-tv/,
  );
});

test('stale files are removed; status timestamps alone are not a change', () => {
  const d = join(dir(), 'site');
  const status = (at: string) => JSON.stringify({ generatedAt: at, health: 'ok' });
  const first = writeSite(
    d,
    new Map([
      ['a.json', '1'],
      ['b.json', '2'],
      ['status.json', status('t1')],
    ]),
  );
  expect(first.changed.sort()).toEqual(['.assetsignore', '_headers', 'a.json', 'b.json', 'status.json']);
  const second = writeSite(
    d,
    new Map([
      ['a.json', '1'],
      ['status.json', status('t2')],
    ]),
  );
  expect(second).toMatchObject({ changed: [], deleted: 1 });
  mkdirSync(join(d, 'x'));
});
