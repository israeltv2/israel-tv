import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIVE_CHANNELS, parseConfig } from '@israel-tv/core';
import { renderStatusHtml } from '@israel-tv/render';
import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import { liveChannels, refreshSchedule, runHistory } from '../src/public-status.ts';
import { writeSite } from '../src/publish.ts';

const NOW = Date.parse('2026-11-07T07:00:00Z');

test('history: one health per day and source, from the runs', () => {
  const runs = [
    { kind: 'full', scope: 'mako', startedAt: '2026-11-07T01:30:00Z', status: 'ok' },
    { kind: 'airing', scope: 'mako', startedAt: '2026-11-07T05:05:00Z', status: 'failed' },
    { kind: 'full', scope: 'mako', startedAt: '2026-11-06T01:30:00Z', status: 'failed' },
    { kind: 'full', scope: 'mako:limited', startedAt: '2026-11-05T01:30:00Z', status: 'ok' },
    { kind: 'crawl', scope: 'kan', startedAt: '2026-11-07T06:00:00Z', status: 'failed' },
    { kind: 'crawl', scope: 'kan', startedAt: '2026-11-07T06:10:00Z', status: 'ok' },
    { kind: 'crawl', scope: 'kan', startedAt: '2026-11-06T06:10:00Z', status: 'failed' },
  ] as const;
  const store = { finishedRunsSince: () => runs.map((r) => ({ ...r })) };
  const h = runHistory(store, ['mako', 'kan'], 'Asia/Jerusalem', NOW, 5);
  expect(h.days).toEqual(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
  expect(h.sources.mako).toEqual([null, null, null, 'error', 'warn']);
  // Kan's slices back off and retry: a bad day is amber, and one failed slice among good ones is fine.
  expect(h.sources.kan).toEqual([null, null, null, 'warn', 'ok']);
});

test('history reads the runs table', () => {
  const store = Store.open(':memory:');
  const id = store.startRun('full', 'reshet');
  store.finishRun(id, { status: 'ok' });
  const h = runHistory(store, ['reshet'], 'Asia/Jerusalem');
  expect(h.days).toHaveLength(30);
  expect(h.sources.reshet?.at(-1)).toBe('ok');
});

test('live channels: up, down or unchecked, never a stream address', () => {
  const [a, b, c] = LIVE_CHANNELS;
  if (!a || !b || !c) throw new Error('channels');
  const live = liveChannels({
    at: '2026-11-07T03:00:00Z',
    abroad: true,
    channels: {
      [a.id]: [
        { title: 'x', via: 'direct', url: 'https://cdn.example/a.m3u8', outcome: 'refused', statuses: [403] },
      ],
      [b.id]: [
        {
          title: 'y',
          via: 'helper',
          outcome: 'failed',
          statuses: [502],
          detail: 'helper at http://box.local',
        },
      ],
    },
  });
  expect(live?.channels.find((x) => x.id === a.id)).toMatchObject({ state: 'up', israelOnly: true });
  expect(live?.channels.find((x) => x.id === b.id)).toMatchObject({ state: 'down' });
  expect(live?.channels.find((x) => x.id === c.id)).toMatchObject({ state: 'unchecked' });
  expect(JSON.stringify(live)).not.toMatch(/cdn\.example|box\.local|statuses/);
  expect(liveChannels(undefined)).toBeUndefined();
});

test('schedule: the nightly time and the next runs', () => {
  const s = refreshSchedule(parseConfig({}).schedule, NOW);
  expect(s).toMatchObject({
    timezone: 'Asia/Jerusalem',
    fullRunTime: '03:30',
    nextFullRun: '2026-11-08T01:30:00.000Z',
  });
  expect(s.airingChecksPerDay).toBeGreaterThan(24);
  expect(
    refreshSchedule({ ...parseConfig({}).schedule, fullRun: 'not a cron' }, NOW).fullRunTime,
  ).toBeUndefined();
});

test('a quiet run does not rewrite the status page: its times are left out of the comparison', () => {
  const d = join(mkdtempSync(join(tmpdir(), 'iltv-site-')), 'site');
  const page = (at: string) =>
    renderStatusHtml({ generatedAt: at, health: 'ok', sources: [], failingShows: [], warnings: [] });
  writeSite(d, new Map([['status.html', page('2026-11-06T05:00:00.000Z')]]));
  expect(writeSite(d, new Map([['status.html', page('2026-11-06T09:41:00.000Z')]])).changed).toEqual([]);
});
