import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '@israel-tv/core';
import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import {
  batches,
  INDEXNOW_LAST,
  indexNowKey,
  indexNowNote,
  pageFor,
  STATUS_EVERY_MS,
  submitIndexNow,
} from '../src/indexnow.ts';
import { publishSite } from '../src/publish.ts';

const BASE = 'https://israel-tv.example.workers.dev';
const tmp = () => mkdtempSync(join(tmpdir(), 'iltv-indexnow-'));
const store = () => Store.open(join(tmp(), 'israel-tv.sqlite'));
const cloudflare = (extra: Record<string, unknown> = {}) =>
  parseConfig({
    publisher: { type: 'cloudflare', dir: join(tmp(), 'site'), publicUrl: BASE },
    ...extra,
  });

/** A fetch that records each request and answers with `status` (or throws). */
function fakeFetch(status: number | Error = 200) {
  const calls: {
    url: string;
    body: { host: string; key: string; keyLocation: string; urlList: string[] };
  }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    if (status instanceof Error) throw status;
    return new Response(status === 200 ? '' : 'Key not valid', { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ALL = [
  'index.html',
  'he/index.html',
  'status.html',
  'he/status.html',
  'status.json',
  'library/index.html',
  'library/mako/index.html',
  'show/iltv_mako_1/index.html',
  'live/index.html',
  'live/guide/index.html',
  'en/live/guide/index.html',
  'search/index.html',
  '404.html',
  'sitemap.xml',
  'manifest.json',
  'meta/series/iltv_mako_1.json',
  'art/iltv_kan_3.jpg',
];

test('site files map to the public pages the sitemap lists; data, images, search and 404 are not pages', () => {
  expect(Object.fromEntries(ALL.map((f) => [f, pageFor(f)]))).toEqual({
    'index.html': '',
    'he/index.html': 'he/',
    'status.html': 'status',
    'he/status.html': 'he/status',
    'status.json': undefined,
    'library/index.html': 'library/',
    'library/mako/index.html': 'library/mako/',
    'show/iltv_mako_1/index.html': 'show/iltv_mako_1/',
    'live/index.html': 'live/',
    'live/guide/index.html': 'live/guide/',
    'en/live/guide/index.html': 'en/live/guide/',
    'search/index.html': undefined,
    '404.html': undefined,
    'sitemap.xml': undefined,
    'manifest.json': undefined,
    'meta/series/iltv_mako_1.json': undefined,
    'art/iltv_kan_3.jpg': undefined,
  });
});

test('batches of at most 10,000 addresses', () => {
  const urls = Array.from({ length: 25_001 }, (_, i) => `u${i}`);
  expect(batches(urls).map((b) => b.length)).toEqual([10_000, 10_000, 5_001]);
  expect(batches([])).toEqual([]);
});

test('a generated key is 32 hex characters, kept; a configured one wins', () => {
  const s = store();
  const key = indexNowKey(s, cloudflare());
  expect(key).toMatch(/^[0-9a-f]{32}$/);
  expect(indexNowKey(s, cloudflare())).toBe(key);
  expect(indexNowKey(s, cloudflare({ indexNow: { key: 'abcdef0123456789' } }))).toBe('abcdef0123456789');
});

test('first submission is the whole site; later ones only changed and removed pages; /status once a day', async () => {
  const s = store();
  const config = cloudflare();
  const f = fakeFetch(202);
  const lines: string[] = [];
  const t0 = Date.parse('2026-11-08T10:00:00Z');
  const run = (changed: string[], removed: string[], now: number) =>
    submitIndexNow(s, config, {
      base: BASE,
      changed,
      removed,
      all: ALL,
      fetch: f.fn,
      now,
      log: (l) => lines.push(l),
    });

  await run(['manifest.json'], [], t0);
  expect(f.calls).toHaveLength(1);
  const first = f.calls[0];
  if (!first) throw new Error('no call');
  expect(first.url).toBe('https://api.indexnow.org/indexnow');
  expect(first.body.host).toBe('israel-tv.example.workers.dev');
  expect(first.body.keyLocation).toBe(`${BASE}/${first.body.key}.txt`);
  expect(first.body.urlList.sort()).toEqual(
    [
      '',
      'he/',
      'status',
      'he/status',
      'library/',
      'library/mako/',
      'show/iltv_mako_1/',
      'live/',
      'live/guide/',
      'en/live/guide/',
    ]
      .map((p) => `${BASE}/${p}`)
      .sort(),
  );
  expect(lines.at(-1)).toMatch(/api\.indexnow\.org answered 202 for 10 URLs \(the whole site/);

  // An hour later: a changed show page, a removed one, and /status again (too soon: left out).
  await run(
    ['show/iltv_mako_1/index.html', 'status.html', 'he/status.html', 'status.json'],
    ['show/iltv_mako_2/index.html'],
    t0 + 3_600_000,
  );
  expect(f.calls[1]?.body.urlList).toEqual([`${BASE}/show/iltv_mako_1/`, `${BASE}/show/iltv_mako_2/`]);

  // Only /status changed, still within the day: nothing is sent at all.
  await run(['status.html'], [], t0 + 2 * 3_600_000);
  expect(f.calls).toHaveLength(2);

  // A day after it was last sent, /status goes again.
  await run(['status.html', 'he/status.html'], [], t0 + STATUS_EVERY_MS);
  expect(f.calls[2]?.body.urlList).toEqual([`${BASE}/status`, `${BASE}/he/status`]);

  // Only data changed: nothing to send.
  await run(['catalog/series/mako.json'], [], t0 + STATUS_EVERY_MS + 1);
  expect(f.calls).toHaveLength(3);
});

test('the programme guide changes with every publish: each language is sent at most once a day', async () => {
  const s = store();
  const config = cloudflare();
  const f = fakeFetch(202);
  const t0 = Date.parse('2026-11-08T10:00:00Z');
  const run = (changed: string[], now: number) =>
    submitIndexNow(s, config, {
      base: BASE,
      changed,
      removed: [],
      all: ALL,
      fetch: f.fn,
      now,
      log: () => {},
    });
  const guide = ['live/guide/index.html', 'en/live/guide/index.html', 'airings.json', 'epg.json'];
  await run(['index.html'], t0); // the whole site, the guide with it
  await run(guide, t0 + 1_800_000);
  await run([...guide, 'show/iltv_mako_1/index.html'], t0 + 3_600_000);
  expect(f.calls).toHaveLength(2);
  // A show page that changed for its own reasons still goes at once; the guide does not.
  expect(f.calls[1]?.body.urlList).toEqual([`${BASE}/show/iltv_mako_1/`]);
  await run(guide, t0 + STATUS_EVERY_MS);
  expect(f.calls[2]?.body.urlList).toEqual([`${BASE}/live/guide/`, `${BASE}/en/live/guide/`]);
  // Sending the guide does not reset /status's day, and the other way round.
  await run(['status.html'], t0 + STATUS_EVERY_MS + 60_000);
  expect(f.calls[3]?.body.urlList).toEqual([`${BASE}/status`]);
});

test('a failed submission is a warning and a note, and its addresses go with the next one', async () => {
  const s = store();
  const config = cloudflare();
  const lines: string[] = [];
  const now = Date.parse('2026-11-08T10:00:00Z');
  const bad = fakeFetch(403);
  await submitIndexNow(s, config, {
    base: BASE,
    changed: [],
    removed: [],
    all: ALL,
    fetch: bad.fn,
    now,
    log: (l) => lines.push(l),
  });
  expect(lines.at(-1)).toMatch(
    /^indexnow warning: api\.indexnow\.org answered HTTP 403: Key not valid for 10 URLs/,
  );
  expect(indexNowNote(s, config)).toMatch(/IndexNow: the last submission .* failed: HTTP 403/);

  const thrown = fakeFetch(new Error('fetch failed'));
  await submitIndexNow(s, config, {
    base: BASE,
    changed: [],
    removed: [],
    all: ALL,
    fetch: thrown.fn,
    now,
    log: (l) => lines.push(l),
  });
  expect(lines.at(-1)).toMatch(/indexnow warning: submission failed \(fetch failed\)/);

  const good = fakeFetch(200);
  await submitIndexNow(s, config, {
    base: BASE,
    changed: [],
    removed: [],
    all: ALL,
    fetch: good.fn,
    now,
    log: (l) => lines.push(l),
  });
  expect(good.calls[0]?.body.urlList).toHaveLength(10);
  expect(indexNowNote(s, config)).toBeUndefined();
  expect(s.getState<{ ok: boolean }>(INDEXNOW_LAST)?.ok).toBe(true);
});

test('off when turned off, and with the local publisher (no public site)', async () => {
  const s = store();
  const f = fakeFetch();
  const log = () => {};
  await submitIndexNow(s, cloudflare({ indexNow: { enabled: false } }), {
    base: BASE,
    changed: [],
    removed: [],
    all: ALL,
    fetch: f.fn,
    log,
  });
  await submitIndexNow(s, parseConfig({ publisher: { type: 'local', dir: join(tmp(), 'site') } }), {
    base: BASE,
    changed: [],
    removed: [],
    all: ALL,
    fetch: f.fn,
    log,
  });
  expect(f.calls).toHaveLength(0);
});

test('a publish whose IndexNow submission fails is still a good publish; the key file is published', async () => {
  const s = store();
  const config = cloudflare();
  const lines: string[] = [];
  const f = fakeFetch(new Error('getaddrinfo ENOTFOUND api.indexnow.org'));
  const ok = await publishSite(s, config, (l) => lines.push(l), undefined, {
    deploy: async () => ({ ms: 1, detail: 'Uploaded 3 files' }),
    fetch: f.fn,
  });
  expect(ok).toBe(true);
  expect(s.lastRun('publish', 'cloudflare')?.status).toBe('ok');
  expect(f.calls).toHaveLength(1);
  expect(lines.join('\n')).toMatch(/indexnow warning: submission failed/);
  const key = indexNowKey(s, config);
  const keyPath = join(config.publisher.dir, `${key}.txt`);
  expect(existsSync(keyPath)).toBe(true);
  expect(readFileSync(keyPath, 'utf8')).toBe(key);
  expect(f.calls[0]?.body.urlList).toContain(`${BASE}/`);
});
