import type { ScrapedShow } from '@israel-tv/core';
import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import { buildStatus } from '../src/publish.ts';
import { runAiring, runFull, runOne } from '../src/runner.ts';
import type { ShowEntry, SourceAdapter } from '../src/sources.ts';

type Fake = Record<string, ScrapedShow | Error>;

function adapter(
  index: ShowEntry[] | Error,
  shows: Fake,
): SourceAdapter & { calls: { key: string; current: boolean }[] } {
  const calls: { key: string; current: boolean }[] = [];
  return {
    source: 'mako',
    calls,
    requests: 0,
    async listShows() {
      if (index instanceof Error) throw index;
      return index;
    },
    async fetchShow(entry, opts) {
      calls.push({ key: entry.key, current: opts.currentSeasonOnly });
      const s = shows[entry.key];
      if (!s || s instanceof Error) throw s ?? new Error('missing');
      return s;
    },
  };
}

const eps = (prefix: string, n: number, date = '2026-11-01') =>
  Array.from({ length: n }, (_, i) => ({
    key: `${prefix}${i + 1}`,
    title: `${i + 1}`,
    numberHint: i + 1,
    airDate: date,
    streams: [],
  }));

function show(key: string, seasons: { key: string; title: string; n: number; date?: string }[]): ScrapedShow {
  return {
    source: 'mako',
    key,
    title: key,
    catalog: 'iltv_keshet12',
    seasons: seasons.map((s) => ({
      key: s.key,
      title: s.title,
      episodes: eps(`${key}${s.key}-`, s.n, s.date),
    })),
  };
}

const opts = { minShareOfPrevious: 0.8 };
const entries = (...keys: string[]) => keys.map((key) => ({ key, title: key }));

test('full run saves shows, skips empty ones, and allocates ids only for real shows', async () => {
  const store = Store.open(':memory:');
  const a = adapter(entries('/a', '/empty', '/b'), {
    '/a': show('/a', [{ key: 's1', title: 'עונה 1', n: 3 }]),
    '/empty': show('/empty', []),
    '/b': show('/b', [{ key: 's1', title: 'עונה 1', n: 2 }]),
  });
  const r = await runFull(store, a, opts);
  expect(r).toMatchObject({ status: 'ok', showsOk: 3, showsFailed: 0, newEpisodes: 5 });
  expect(store.listShows().map((s) => s.seriesId)).toEqual(['iltv_mako_1', 'iltv_mako_2']);
});

test('a listed show without episodes is never dropped silently: warned, and named on /status', async () => {
  const store = Store.open(':memory:');
  const a = adapter(entries('/a', '/empty'), {
    '/a': show('/a', [{ key: 's1', title: 'עונה 1', n: 3 }]),
    '/empty': show('/empty', []),
  });
  await runFull(store, a, opts);
  expect(store.recentWarnings(10).map((w) => w.message)).toContain(
    '/empty: listed, but its page has no episodes',
  );
  const status = buildStatus(store, ['mako'], Date.now());
  const mako = status.sources.find((x) => x.source === 'mako');
  expect(mako?.health).toBe('ok');
  expect(mako?.notes.join(' ')).toContain('1 shows listed by the site have no episodes on their page');
});

test('a failing show keeps its last good data and is marked', async () => {
  const store = Store.open(':memory:');
  await runFull(
    store,
    adapter(entries('/a'), { '/a': show('/a', [{ key: 's1', title: 'עונה 1', n: 3 }]) }),
    opts,
  );
  const r = await runFull(
    store,
    adapter(entries('/a'), { '/a': new Error('blocked by www.mako.co.il') }),
    opts,
  );
  expect(r.status).toBe('failed');
  const row = store.getShow('iltv_mako_1');
  expect(row?.lastError).toContain('blocked');
  expect(row?.show.seasons[0]?.episodes.length).toBe(3);
});

test('a thin result (episodes halved) is rejected', async () => {
  const store = Store.open(':memory:');
  await runFull(
    store,
    adapter(entries('/a'), { '/a': show('/a', [{ key: 's1', title: 'עונה 1', n: 20 }]) }),
    opts,
  );
  const r = await runFull(
    store,
    adapter(entries('/a'), { '/a': show('/a', [{ key: 's1', title: 'עונה 1', n: 4 }]) }),
    opts,
  );
  expect(r.status).toBe('failed');
  expect(store.getShow('iltv_mako_1')?.show.seasons[0]?.episodes.length).toBe(20);
  expect(store.recentWarnings()[0]?.code).toBe('thin-result');
});

test('an index much smaller than before is refused and nothing is delisted', async () => {
  const store = Store.open(':memory:');
  const all = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`/s${i}`, show(`/s${i}`, [{ key: 'x', title: 'עונה 1', n: 1 }])]),
  );
  await runFull(store, adapter(entries(...Object.keys(all)), all), opts);
  const r = await runFull(store, adapter(entries('/s0', '/s1'), all), opts);
  expect(r).toMatchObject({ status: 'failed' });
  expect(r.error).toMatch(/lists 2 shows, previously 10/);
  expect(store.listShows({ state: 'listed' }).length).toBe(10);
});

test('airing check reads only the current season and keeps older seasons', async () => {
  const store = Store.open(':memory:');
  const today = new Date().toISOString().slice(0, 10);
  const full = show('/a', [
    { key: 's1', title: 'עונה 1', n: 5, date: '2020-01-01' },
    { key: 's2', title: 'עונה 2', n: 2, date: today },
  ]);
  await runFull(store, adapter(entries('/a'), { '/a': full }), opts);
  // The airing read returns season 2 with one more episode and season 1 empty (not fetched).
  const partial = show('/a', [
    { key: 's1', title: 'עונה 1', n: 0 },
    { key: 's2', title: 'עונה 2', n: 3, date: today },
  ]);
  const a = adapter([], { '/a': partial });
  const r = await runAiring(store, a, 14, opts);
  expect(a.calls).toEqual([{ key: '/a', current: true }]);
  expect(r.newEpisodes).toBe(1);
  const row = store.getShow('iltv_mako_1');
  expect(row?.show.seasons.map((s) => s.episodes.length)).toEqual([5, 3]);
});

test('single-show run re-reads all seasons', async () => {
  const store = Store.open(':memory:');
  const a = adapter([], { '/a': show('/a', [{ key: 's1', title: 'עונה 1', n: 1 }]) });
  const r = await runOne(store, a, { key: '/a', title: 'a' }, opts);
  expect(r.status).toBe('ok');
  expect(a.calls).toEqual([{ key: '/a', current: false }]);
});

test('a never-seen show whose page is gone is noted, not failed', async () => {
  const store = Store.open(':memory:');
  const gone = Object.assign(new Error('HTTP 404'), { status: 404 });
  const r = await runFull(store, adapter(entries('/gone'), { '/gone': gone }), opts);
  expect(r).toMatchObject({ status: 'ok', showsFailed: 0 });
  expect(store.recentWarnings()[0]?.message).toMatch(/page is gone/);
});

test('an episode listed twice by the source is stored once', async () => {
  const store = Store.open(':memory:');
  const s = show('/a', [
    { key: 's1', title: 'עונה 1', n: 2 },
    { key: 's2', title: 'עונה 2', n: 0 },
  ]);
  const dup = s.seasons[0]?.episodes[0];
  if (!dup) throw new Error('fixture');
  s.seasons[0]?.episodes.push({ ...dup, numberHint: 9 });
  s.seasons[1]?.episodes.push(dup);
  const r = await runFull(store, adapter(entries('/a'), { '/a': s }), opts);
  expect(r).toMatchObject({ status: 'ok', newEpisodes: 2 });
});

test('admin refuses cross-site requests from web pages', async () => {
  const { adminApp, Daemon } = await import('../src/daemon.ts');
  const { parseConfig } = await import('@israel-tv/core');
  const app = adminApp(new Daemon(parseConfig({}), Store.open(':memory:'), () => {}));
  const env = { incoming: { socket: { remoteAddress: '192.168.1.5' } } };
  const viaPage = await app.request(
    '/run/full',
    { method: 'POST', headers: { origin: 'http://evil.example', host: '192.168.1.10:7702' } },
    env,
  );
  expect(viaPage.status).toBe(403);
  const status = await app.request('/status', { headers: { host: '192.168.1.10:7702' } }, env);
  const rebound = await app.request('/status', { headers: { host: 'evil.example:7702' } }, env);
  expect(rebound.status).toBe(403);
  expect(status.status).toBe(200);
  const outside = await app.request(
    '/status',
    { headers: { host: '192.168.1.10:7702' } },
    { incoming: { socket: { remoteAddress: '8.8.8.8' } } },
  );
  expect(outside.status).toBe(403);
});

test('a known show that suddenly has no seasons is a failed read, not an empty show', async () => {
  const store = Store.open(':memory:');
  await runFull(
    store,
    adapter(entries('/a'), { '/a': show('/a', [{ key: 's1', title: 'עונה 1', n: 3 }]) }),
    opts,
  );
  const r = await runFull(store, adapter(entries('/a'), { '/a': show('/a', []) }), opts);
  expect(r.status).toBe('failed');
  expect(store.getShow('iltv_mako_1')?.lastError).toMatch(/no seasons/);
});

test('a full read in which every season comes back empty is a failed read', async () => {
  const store = Store.open(':memory:');
  await runFull(
    store,
    adapter(entries('/a'), { '/a': show('/a', [{ key: 's1', title: 'עונה 1', n: 3 }]) }),
    opts,
  );
  const r = await runFull(
    store,
    adapter(entries('/a'), { '/a': show('/a', [{ key: 's1', title: 'עונה 1', n: 0 }]) }),
    opts,
  );
  expect(r.status).toBe('failed');
  expect(store.getShow('iltv_mako_1')?.lastError).toMatch(/every season read empty/);
});

test('a Kan refresh during a back-off does not spin the event loop', async () => {
  const { Daemon } = await import('../src/daemon.ts');
  const { parseConfig } = await import('@israel-tv/core');
  const store = Store.open(':memory:');
  store.setState('kan:crawl', { shows: {}, backoffUntil: new Date(Date.now() + 3_600_000).toISOString() });
  const d = new Daemon(parseConfig({ browser: { type: 'chrome' } }), store, () => {});
  (d as unknown as { kanRefresh: Set<string> }).kanRefresh.add(
    'https://www.kan.org.il/content/kan/kan-11/p-1/',
  );
  d.kanCrawl();
  let ticked = false;
  await new Promise<void>((resolve) =>
    setTimeout(() => {
      ticked = true;
      resolve();
    }, 20),
  );
  expect(ticked).toBe(true);
  expect((d as unknown as { kanRefresh: Set<string> }).kanRefresh.size).toBe(1); // kept for the next slice
});
