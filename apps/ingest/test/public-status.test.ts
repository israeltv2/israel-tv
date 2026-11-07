import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIVE_CHANNELS, parseConfig } from '@israel-tv/core';
import { publicStatus, publicText, renderStatusHtml } from '@israel-tv/render';
import { Store } from '@israel-tv/store';
import { describe, expect, test } from 'vitest';
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

describe('nothing private reaches status.json or /status', () => {
  const LEAKS: [string, RegExp][] = [
    ['getaddrinfo ENOTFOUND tv-helper.example-owner.com', /tv-helper|example-owner/],
    ['connect ECONNREFUSED proxy.example.net:3128', /proxy\.example|3128/],
    [
      'fetch failed: https://israel-tv-api.someone.workers.dev/admin?token=abc',
      /someone|workers\.dev|token|abc/,
    ],
    ['deploy: https://dash.cloudflare.com/0123abcd/workers/x', /cloudflare|0123abcd/],
    ['play https://user:secret@www.mako.co.il/x?ticket=SECRET#frag', /user|secret|SECRET|ticket|frag/],
    ['resolver mac-mini:7703 did not answer', /mac-mini|7703/],
    ['wrote /Library/Application Support/israel-tv/x.db', /\/Library\/|Application Support/],
    ['wrote /Users/someone/israel-tv/data/catalog.db', /someone/],
    ['wrote C:/Users/someone/israel-tv/catalog.db', /someone/],
    ['wrote C:\\Users\\someone\\catalog.db', /someone/],
    ['connect ECONNREFUSED 192.168.4.20:7701', /192\.168/],
    ['connect ECONNREFUSED [fd00::12]:7701', /fd00/],
    ['helper http://media-box.local:7701/stream', /media-box/],
    ['localhost:7700 refused', /localhost/],
    [
      'browser did not start: proxy at http://127.0.0.1:3128 refused (see /home/someone/.cache/ms-playwright)',
      /127\.0|someone/,
    ],
  ];
  test.each(LEAKS)('%s', (text, leak) => {
    const status = {
      generatedAt: '2026-11-07T06:00:00Z',
      health: 'error' as const,
      publish: `last publish failed: ${text}`,
      sources: [
        {
          source: 'mako',
          health: 'error' as const,
          shows: 1,
          episodes: 1,
          lastFullRun: { at: '2026-11-07T01:30:00Z', status: 'failed', error: text },
          notes: [text],
        },
      ],
      failingShows: [{ id: 'iltv_mako_1', title: 'x', error: text, lastOkAt: '2026-11-06T01:30:00Z' }],
      warnings: [{ at: '2026-11-07T01:30:00Z', code: 'source-note', message: text }],
    };
    expect(JSON.stringify(publicStatus(status))).not.toMatch(leak);
    expect(renderStatusHtml(status)).not.toMatch(leak);
  });

  test('public addresses stay (origin and path only), and so do ids, keys and times', () => {
    expect(
      publicText('net::ERR_PROXY_CONNECTION_FAILED at https://www.kan.org.il/content/kan/kan-11/p-1/2/?x=1'),
    ).toBe('net::ERR_PROXY_CONNECTION_FAILED at https://www.kan.org.il/content/kan/kan-11/p-1/2/');
    expect(publicText('browser did not start: Chrome exited (code 1)')).toBe(
      'browser did not start: Chrome exited (code 1)',
    );
    const ours =
      'kan:72126 iltv_mako_535:1:1 S1E4 21:30:00 2026-11-07T06:48:28.210Z status.json Node.js www.mako.co.il';
    expect(publicText(ours)).toBe(ours);
    // The public addon's own origin, and only it.
    const own = 'https://israel-tv.example-host.dev';
    expect(publicText(`see ${own}/status and https://other.example-host.dev/x`, { origins: [own] })).toBe(
      `see ${own}/status and [private address]`,
    );
  });
});
