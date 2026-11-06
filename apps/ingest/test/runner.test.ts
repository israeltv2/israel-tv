import type { ScrapedShow } from '@israel-tv/core';
import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
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
