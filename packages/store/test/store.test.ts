import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assignNumbers, type ScrapedShow } from '@israel-tv/core';
import { expect, test } from 'vitest';
import { INTERRUPTED, SHUTDOWN_KEY, STOPPED_FOR_RESTART, Store } from '../src/store.ts';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'iltv-store-')), 'db.sqlite');

const show = (eps: string[]): ScrapedShow => ({
  source: 'mako',
  key: '/a',
  title: 'A',
  catalog: 'iltv_keshet12',
  seasons: [
    {
      key: '/a-s1',
      title: 'עונה 1',
      episodes: eps.map((k, i) => ({ key: k, title: k, numberHint: i + 1, streams: [] })),
    },
  ],
});

test('series ids are allocated once per source key and never reused', () => {
  const s = Store.open(tmp());
  expect(s.seriesIdFor('mako', '/a')).toBe('iltv_mako_1');
  expect(s.seriesIdFor('mako', '/b')).toBe('iltv_mako_2');
  expect(s.seriesIdFor('mako', '/a')).toBe('iltv_mako_1');
  expect(s.seriesIdFor('reshet', '/a')).toBe('iltv_reshet_1');
});

test('numbers survive reopening; only new episodes are added', () => {
  const path = tmp();
  let s = Store.open(path);
  const id = s.seriesIdFor('mako', '/a');
  const r1 = assignNumbers(show(['e1', 'e2']), s.assignments(id));
  expect(s.saveShow(id, show(['e1', 'e2']), r1.added, '2026-11-01')).toBe(2);
  s.close();
  s = Store.open(path);
  const r2 = assignNumbers(show(['e1', 'e2', 'e3']), s.assignments(id));
  expect(r2.added.episodes).toEqual([{ key: 'e3', season: 1, episode: 3 }]);
  expect(s.saveShow(id, show(['e1', 'e2', 'e3']), r2.added, '2026-11-05')).toBe(1);
  expect(s.getShow(id)?.show.seasons[0]?.episodes.length).toBe(3);
  expect(s.airingShows('mako', '2026-11-03').map((r) => r.seriesId)).toEqual([id]);
});

test('a name stored with page-title boilerplate is read clean; id and numbers stay', () => {
  const s = Store.open(tmp());
  const id = s.seriesIdFor('reshet', '/a');
  const raw = { ...show(['e1', 'e2']), source: 'reshet' as const, title: 'שקשוקה | באדיבות כאן חינוכית' };
  s.saveShow(id, raw, assignNumbers(raw, s.assignments(id)).added, undefined);
  const row = s.getShow(id);
  expect(row?.seriesId).toBe('iltv_reshet_1');
  expect(row?.title).toBe('שקשוקה');
  expect(row?.show.title).toBe('שקשוקה');
  expect(s.assignments(id).episodes.map((e) => e.episode)).toEqual([1, 2]);
});

test('a failed check keeps the last good data', () => {
  const s = Store.open(tmp());
  const id = s.seriesIdFor('mako', '/a');
  s.saveShow(id, show(['e1']), assignNumbers(show(['e1']), s.assignments(id)).added, undefined);
  s.markShowFailed(id, 'blocked');
  const row = s.getShow(id);
  expect(row?.lastError).toBe('blocked');
  expect(row?.show.seasons[0]?.episodes.length).toBe(1);
});

test('delisted shows are kept but marked', () => {
  const s = Store.open(tmp());
  const a = s.seriesIdFor('mako', '/a');
  s.saveShow(a, show(['e1']), assignNumbers(show(['e1']), s.assignments(a)).added, undefined);
  expect(s.syncListed('mako', [])).toBe(1);
  expect(s.getShow(a)?.state).toBe('delisted');
});

test('runs and stale-run cleanup', () => {
  const s = Store.open(tmp());
  const r = s.startRun('full', 'mako');
  // Called at startup, before this process starts runs: a run with our own pid is a leftover (e.g. pid 1 in
  // a container); a run of another live process is kept.
  expect(s.closeStaleRuns(() => true)).toEqual({ stopped: 0, failed: 1 });
  // No deliberate stop was recorded: a crash, a kill or a power cut, labelled so.
  expect(s.lastRun('full', 'mako')).toMatchObject({ id: r, status: 'failed', error: INTERRUPTED });
});

test('a run left open by a process that had begun a deliberate stop is closed as stopped, not failed', () => {
  const s = Store.open(tmp());
  const gone = 999_999;
  const insert = (scope: string, pid: number) =>
    s.db.$client
      .prepare("INSERT INTO runs (kind, scope, startedAt, status, pid) VALUES ('crawl', ?, ?, 'running', ?)")
      .run(scope, new Date().toISOString(), pid);
  insert('kan', gone);
  insert('kan:other', gone + 1); // another process, gone without a stop
  s.noteShutdown(gone);
  expect(s.closeStaleRuns(() => false)).toEqual({ stopped: 1, failed: 1 });
  expect(s.lastRun('crawl', 'kan')).toMatchObject({ status: 'stopped' });
  expect(s.lastRun('crawl', 'kan')?.error).toMatch(/^stopped for restart/);
  expect(s.lastRun('crawl', 'kan:other')).toMatchObject({ status: 'failed', error: INTERRUPTED });
  // Used once: a later process with the same pid does not inherit it.
  expect(s.getState(SHUTDOWN_KEY)).toBeNull();
  // Stopped runs judge nothing: not the last settled run, not good, not in the history.
  expect(s.lastRun('crawl', 'kan', { settled: true })).toBeUndefined();
  expect(s.lastGoodRun('crawl', 'kan')).toBeUndefined();
  expect(s.finishedRunsSince('2000-01-01', ['crawl'])).toHaveLength(1);
});

test('a stop that runs out of time closes only its own open runs, as stopped', () => {
  const s = Store.open(tmp());
  const mine = s.startRun('publish', 'local');
  s.db.$client
    .prepare(
      "INSERT INTO runs (kind, scope, startedAt, status, pid) VALUES ('full', 'mako', ?, 'running', 1)",
    )
    .run(new Date().toISOString());
  expect(s.openRuns((pid) => pid === process.pid).map((r) => r.id)).toEqual([mine]);
  expect(s.stopOpenRuns()).toBe(1);
  expect(s.lastRun('publish', 'local')).toMatchObject({ status: 'stopped', error: STOPPED_FOR_RESTART });
  expect(s.lastRun('full', 'mako')?.status).toBe('running');
});

test('a warning already recorded for the same show is not repeated', () => {
  const s = Store.open(tmp());
  s.addWarnings(null, 'iltv_mako_1', [{ code: 'x', message: 'same' }]);
  s.addWarnings(null, 'iltv_mako_1', [
    { code: 'x', message: 'same' },
    { code: 'x', message: 'other' },
  ]);
  expect(
    s
      .recentWarnings()
      .map((w) => w.message)
      .sort(),
  ).toEqual(['other', 'same']);
});

test('prune removes old warnings before the runs they belong to', () => {
  const s = Store.open(tmp());
  const r = s.startRun('full', 'mako');
  s.finishRun(r, { status: 'ok' });
  s.addWarnings(r, null, [{ code: 'x', message: 'y' }]);
  s.db.$client.exec("update runs set startedAt = '2000-01-01T00:00:00.000Z'");
  expect(() => s.prune(60)).not.toThrow();
  expect(s.recentRuns()).toEqual([]);
  expect(s.recentWarnings()).toEqual([]);
});

test('the catalog database and its backups are readable by their owner only', async () => {
  if (process.platform === 'win32') return;
  const { mkdtempSync, statSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'perm-'));
  const store = Store.open(join(dir, 'data', 'israel-tv.sqlite'));
  expect(statSync(join(dir, 'data', 'israel-tv.sqlite')).mode & 0o077).toBe(0);
  expect(statSync(join(dir, 'data')).mode & 0o077).toBe(0);
  store.backupTo(join(dir, 'backup.sqlite'));
  expect(statSync(join(dir, 'backup.sqlite')).mode & 0o077).toBe(0);
  store.close();
});

test('year seasons stored with the year as their number move to position numbers, with their episodes', () => {
  const store = Store.open(':memory:');
  const c = store.db.$client;
  const at = '2026-11-06T00:00:00Z';
  const id = store.seriesIdFor('mako', '/show');
  const other = store.seriesIdFor('mako', '/mixed');
  const season = c.prepare(
    'INSERT INTO seasons (seriesId, key, number, kind, createdAt) VALUES (?, ?, ?, ?, ?)',
  );
  const episode = c.prepare(
    'INSERT INTO episodes (seriesId, key, season, episode, createdAt) VALUES (?, ?, ?, ?, ?)',
  );
  season.run(id, 'y26', 2026, 'year', at);
  season.run(id, 'y24', 2024, 'year', at);
  episode.run(id, 'a', 2024, 1, at);
  episode.run(id, 'b', 2026, 1, at);
  season.run(other, 's1', 1, 'numbered', at);
  season.run(other, 's2', 2, 'numbered', at);
  season.run(other, 'vip', 101, 'named', at);
  season.run(other, 'y20', 2020, 'year', at);
  episode.run(other, 'c', 2020, 4, at);
  expect(store.renumberYearSeasons()).toBe(3);
  const a = store.assignments(id);
  expect(a.seasons.map((s) => [s.key, s.number]).sort()).toEqual([
    ['y24', 1],
    ['y26', 2],
  ]);
  expect(a.episodes.map((e) => [e.key, e.season, e.episode]).sort()).toEqual([
    ['a', 1, 1],
    ['b', 2, 1],
  ]);
  const m = store.assignments(other);
  expect(m.seasons.map((s) => [s.key, s.number]).sort()).toEqual([
    ['s1', 1],
    ['s2', 2],
    ['vip', 101],
    ['y20', 3],
  ]);
  expect(m.episodes).toEqual([{ key: 'c', season: 3, episode: 4 }]);
  expect(store.renumberYearSeasons()).toBe(0); // once
});
