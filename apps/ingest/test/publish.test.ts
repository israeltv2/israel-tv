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
      ['status.json', status('2026-11-06T05:00:00.000Z')],
    ]),
  );
  expect(first.changed.sort()).toEqual(['.assetsignore', '_headers', 'a.json', 'b.json', 'status.json']);
  const second = writeSite(
    d,
    new Map([
      ['a.json', '1'],
      ['status.json', status('2026-11-06T06:00:00.123Z')],
    ]),
  );
  expect(second).toMatchObject({ changed: [], deleted: 1 });
  mkdirSync(join(d, 'x'));
});

test('a Cloudflare deploy without the configured token is refused (never falls back to a stored login)', async () => {
  const { deploy } = await import('../src/publish.ts');
  const { parseConfig } = await import('@israel-tv/core');
  const config = parseConfig({ publisher: { type: 'cloudflare', dir: join(dir(), 'site') } });
  await expect(deploy(config, { PATH: process.env.PATH })).rejects.toThrow(/deploy refused/);
});

test('static headers: every path gets one Cache-Control value (rules add up on Cloudflare)', async () => {
  const { HEADERS_FILE } = await import('../src/publish.ts');
  const rules: { path: string; lines: string[] }[] = [];
  for (const line of HEADERS_FILE.split('\n').filter(Boolean)) {
    if (!line.startsWith(' ')) rules.push({ path: line, lines: [] });
    else rules.at(-1)?.lines.push(line.trim());
  }
  const sets = (r: { lines: string[] }) => r.lines.some((l) => /^cache-control:/i.test(l));
  for (const r of rules.filter((x) => x.path !== '/*' && sets(x)))
    expect(r.lines, r.path).toContain('! Cache-Control');
});
