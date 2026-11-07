// A stop for a restart (SIGTERM / SIGINT) ends work at a safe point and records it as `stopped`, never as a failure.
import { readFileSync } from 'node:fs';
import { assignNumbers, parseConfig, type ScrapedShow } from '@israel-tv/core';
import { EventStore } from '@israel-tv/events';
import type { PageLoader } from '@israel-tv/kan';
import { SHUTDOWN_KEY, Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import { Daemon, FULL_PENDING_KEY } from '../src/daemon.ts';
import { crawlKan } from '../src/kan.ts';
import { runHistory } from '../src/public-status.ts';
import { buildStatus } from '../src/publish.ts';
import { emptyShowsKey, retryKey, runFull } from '../src/runner.ts';
import type { ShowEntry, SourceAdapter } from '../src/sources.ts';

const quiet = { log: () => {}, for: () => () => {}, flush: () => {} };

const show = (key: string): ScrapedShow => ({
  source: 'mako',
  key,
  title: key,
  catalog: 'iltv_keshet12',
  seasons: [
    {
      key: 's1',
      title: 'עונה 1',
      episodes: [{ key: `${key}-1`, title: '1', numberHint: 1, airDate: '2026-11-01', streams: [] }],
    },
  ],
});

/** A source whose `stopAfter`-th show read starts a stop (as SIGTERM would, mid-run). */
function stoppingAdapter(keys: string[], stop: AbortController, stopAfter: number): SourceAdapter {
  let n = 0;
  return {
    source: 'mako',
    requests: 0,
    async listShows(): Promise<ShowEntry[]> {
      return keys.map((key) => ({ key, title: key }));
    },
    async fetchShow(entry) {
      if (++n === stopAfter) stop.abort();
      return show(entry.key);
    },
  };
}

test('a full run stopped for a restart finishes the show it is reading and is recorded as stopped, not failed', async () => {
  const store = Store.open(':memory:');
  store.setState(retryKey('mako'), { runId: 0, pending: [], recovered: [], attempts: 0, others: 0 });
  const stop = new AbortController();
  const r = await runFull(store, stoppingAdapter(['/a', '/b', '/c'], stop, 2), {
    minShareOfPrevious: 0.8,
    signal: stop.signal,
  });
  expect(r.status).toBe('stopped');
  expect(r.showsOk).toBe(2); // the show being read when the stop came is saved, the next is not started
  expect(store.findSeriesId('mako', '/c')).toBeUndefined();
  const run = store.lastRun('full', 'mako');
  expect(run).toMatchObject({ status: 'stopped', showsOk: 2 });
  expect(run?.error).toMatch(/^stopped for restart after 2 of 3 shows/);
  // A partial read decides nothing about what is listed, empty or retried.
  expect(store.getState(emptyShowsKey('mako'))).toBeUndefined();
  expect(store.getState(retryKey('mako'))).toMatchObject({ runId: 0 });
});

test('the daemon stops at a safe point: running work finishes, nothing new starts', async () => {
  const store = Store.open(':memory:');
  const d = new Daemon(parseConfig({}), store, EventStore.open(':memory:'), quiet);
  let id = 0;
  d.enqueue('work', async () => {
    id = store.startRun('airing', 'mako');
    await new Promise((resolve) => setTimeout(resolve, 30));
    store.finishRun(id, { status: 'ok' });
  });
  let ranAfter = false;
  d.enqueue('later', async () => {
    ranAfter = true;
  });
  const r = await d.shutdown(5_000);
  expect(r).toEqual({ clean: true, closed: 0 });
  expect(store.lastRun('airing', 'mako')?.status).toBe('ok');
  expect(ranAfter).toBe(false);
  expect(d.enqueue('again', async () => {})).toEqual({ queued: false, position: 0 });
  expect(d.state()).toMatchObject({ stopping: true });
  expect(store.getState(SHUTDOWN_KEY)).toMatchObject({ pid: process.pid });
});

test('work that reaches no safe point in time is closed as stopped (not failed), and a cut full run is resumable', async () => {
  const store = Store.open(':memory:');
  const d = new Daemon(parseConfig({}), store, EventStore.open(':memory:'), quiet);
  store.setState(FULL_PENDING_KEY, { sources: ['reshet'] });
  d.enqueue('stuck', async () => {
    store.startRun('full', 'reshet');
    await new Promise(() => {}); // never ends
  });
  const r = await d.shutdown(20);
  expect(r).toEqual({ clean: false, closed: 1 });
  const run = store.lastRun('full', 'reshet');
  expect(run?.status).toBe('stopped');
  expect(run?.error).toMatch(/stopped for restart \(no safe point within/);
  expect(store.getState(FULL_PENDING_KEY)).toEqual({ sources: ['reshet'], stopped: true });
});

const fx = (n: string) =>
  readFileSync(new URL(`../../../packages/kan/test/fixtures/${n}.html`, import.meta.url), 'utf8');
const kanRoutes: Record<string, string> = {
  '/lobby/kan11/': 'lobby-kan11',
  '/lobby-kids/kids-teens': 'lobby-kids-teens',
  '/lobby-kids/tiny/': 'lobby-kids-tiny',
  '/lobby/series/': 'lobby-series',
  '/content/kan/kan-11/p-1006421/': 'show-p-1006421',
};

test('a Kan slice stopped for a restart ends between pages, keeps its progress, backs off nothing', async () => {
  const store = Store.open(':memory:');
  const stop = new AbortController();
  const urls: string[] = [];
  const loader: PageLoader = {
    async load(url: string) {
      urls.push(url);
      // SIGTERM during the pause after the first page.
      if (urls.length === 1) setTimeout(() => stop.abort(), 50);
      const name = kanRoutes[new URL(url).pathname];
      return name
        ? { status: 200, html: fx(name), challenged: false }
        : { status: 404, html: '', challenged: false };
    },
    async close() {},
  };
  const opts = {
    browser: { type: 'chrome' as const, headed: true },
    pagesPerRun: 10,
    pageIntervalMs: 60_000, // the pause before the second page is cut short by the stop
    airingWindowDays: 14,
    loader,
    guide: false,
  };
  const t0 = Date.now();
  const r = await crawlKan(store, { ...opts, signal: stop.signal });
  expect(Date.now() - t0).toBeLessThan(5_000);
  expect(r).toMatchObject({ pages: 1, halted: true });
  expect(r.failed).toBeUndefined();
  const run = store.lastRun('crawl', 'kan');
  expect(run?.status).toBe('stopped');
  expect(run?.error).toMatch(/^stopped for restart after 1 page \+/);
  const state = store.getState<{ backoffUntil?: string; shows: Record<string, unknown> }>('kan:crawl');
  expect(state?.backoffUntil).toBeUndefined();
  expect(Object.keys(state?.shows ?? {}).length).toBeGreaterThan(0); // what the lobby listed is kept
  // The next slice goes on (no back-off).
  const next = await crawlKan(store, { ...opts, pageIntervalMs: 0, pagesPerRun: 3 });
  expect(next.pages).toBeGreaterThan(0);
});

test('/status and the run history ignore runs stopped for a restart', () => {
  const store = Store.open(':memory:');
  const id = store.seriesIdFor('mako', '/a');
  store.saveShow(id, show('/a'), assignNumbers(show('/a'), store.assignments(id)).added, '2026-11-01');
  const ok = store.startRun('full', 'mako');
  store.finishRun(ok, { status: 'ok', showsOk: 1 });
  const cut = store.startRun('full', 'mako');
  store.finishRun(cut, { status: 'stopped', error: 'stopped for restart after 0 of 1 shows' });
  const pub = store.startRun('publish', 'local');
  store.finishRun(pub, { status: 'stopped', error: 'stopped for restart' });
  const s = buildStatus(store, ['mako']);
  expect(s.sources[0]?.health).toBe('ok');
  expect(s.sources[0]?.lastFullRun?.status).toBe('ok');
  expect(s.sources[0]?.notes.join(' ')).not.toMatch(/fail|stopped/);
  expect(s.publish).toBeUndefined();
  expect(s.health).toBe('ok');
  // A failure before the stop still shows: a stop never hides it.
  const bad = store.startRun('full', 'mako');
  store.finishRun(bad, { status: 'failed', error: 'index failed: boom' });
  const cut2 = store.startRun('full', 'mako');
  store.finishRun(cut2, { status: 'stopped', error: 'stopped for restart' });
  expect(buildStatus(store, ['mako']).sources[0]?.health).toBe('error');
  // History: a day of only stopped runs is "no runs", not red or amber.
  const k = store.startRun('crawl', 'kan');
  store.finishRun(k, { status: 'stopped', error: 'stopped for restart' });
  expect(runHistory(store, ['kan'], 'UTC').sources.kan?.at(-1)).toBeNull();
  expect(
    store.finishedRunsSince('2000-01-01', ['crawl', 'full', 'publish']).map((r) => r.status),
  ).not.toContain('stopped');
});

test('a Kan slice whose browser closes under it during a restart is stopped, not a Kan outage', async () => {
  // Live 2026-11-07: "page.waitForTimeout: Target page, context or browser has been closed" made the slice failed
  // and backed Kan off 45 minutes.
  const store = Store.open(':memory:');
  const stop = new AbortController();
  const loader: PageLoader = {
    async load() {
      stop.abort();
      throw new Error('page.waitForTimeout: Target page, context or browser has been closed');
    },
    async close() {},
  };
  await crawlKan(store, {
    browser: { type: 'chrome', headed: true },
    pagesPerRun: 10,
    pageIntervalMs: 0,
    airingWindowDays: 14,
    loader,
    guide: false,
    signal: stop.signal,
  });
  expect(store.lastRun('crawl', 'kan')?.status).toBe('stopped');
  expect(store.getState<{ backoffUntil?: string }>('kan:crawl')?.backoffUntil).toBeUndefined();
});
