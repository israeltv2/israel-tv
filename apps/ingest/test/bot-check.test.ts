// Mako's Radware bot check: a block delays a show, never drops it, and never fails a run by itself.
import { readFileSync } from 'node:fs';
import type { ScrapedShow } from '@israel-tv/core';
import { BlockedError, createFetcher, type Transport } from '@israel-tv/net';
import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import { buildStatus } from '../src/publish.ts';
import { retryKey, runAiring, runBlockedRetry, runFull } from '../src/runner.ts';
import { makoAdapter, type SourceAdapter } from '../src/sources.ts';

const opts = { minShareOfPrevious: 0.8 };

// Recorded pages: Mako's captioned main newscast (show page and its featured video) and Radware's block page.
const MAKO_FX = new URL('../../../packages/mako/test/fixtures/', import.meta.url);
const RADWARE = readFileSync(
  new URL('../../../packages/net/test/fixtures/radware-block-page.html', import.meta.url),
  'utf8',
);
const NEWSCAST = {
  key: '/mako-vod-channel2-news/main_newscast_captions',
  title: 'המהדורה המרכזית מונגש ללקויי שמיעה',
};
const PAGES: Record<string, string> = {
  [NEWSCAST.key]: 'show-main-newscast-captions.json',
  '/mako-vod-channel2-news/main_newscast_captions-2026/34a47f20b4271a10/VOD-ee23b3fcbeaa1a1027.htm':
    'vod-main-newscast-captions.json',
};

/** The real Mako adapter over recorded pages; the show page answers with Radware's page `blocks` times first. */
function recordedMako(blocks: number): SourceAdapter {
  let left = blocks;
  const transport: Transport = async ({ url }) => {
    const path = new URL(url).pathname;
    if (path === NEWSCAST.key && left > 0) {
      left--;
      return { status: 200, body: RADWARE, url: 'https://validate.perfdrive.com/?ssa=x' };
    }
    const file = PAGES[path];
    if (!file) return { status: 404, body: '<html>not found</html>', url };
    return { status: 200, body: readFileSync(new URL(file, MAKO_FX), 'utf8'), url };
  };
  const a = makoAdapter(createFetcher({ delayMs: 0, transport, sleep: async () => {} }));
  return Object.assign(Object.create(a) as SourceAdapter, { listShows: async () => [NEWSCAST] });
}

const episodeKeys = (s: ScrapedShow | undefined) =>
  s?.seasons.flatMap((x) => x.episodes).map((e) => e.key) ?? [];

test("a Radware page then the data: the show is read on the fetcher's quick retry and the run is ok", async () => {
  const store = Store.open(':memory:');
  const a = recordedMako(1);
  const r = await runFull(store, a, opts);
  expect(r).toMatchObject({ status: 'ok', showsOk: 1, showsFailed: 0 });
  expect(r.blocked).toBeUndefined();
  expect(a.blocks).toEqual({ pages: 1, cleared: 1, refused: 0 });
  const id = store.findSeriesId('mako', NEWSCAST.key) as string;
  expect(episodeKeys(store.getShow(id)?.show)).toEqual(['ee23b3fcbeaa1a10VgnVCM100000700a10acRCRD']);
  expect(store.getState(retryKey('mako'))).toBeNull();
});

test('Radware through every retry: the show is delayed with its last good data, the run stays ok, and it is said', async () => {
  const store = Store.open(':memory:');
  const t0 = Date.parse('2026-11-07T01:00:00Z');
  await runFull(store, recordedMako(0), { ...opts, now: t0 });
  const id = store.findSeriesId('mako', NEWSCAST.key) as string;
  const before = store.getShow(id)?.show;
  // Refused on the first read and on all three of the fetcher's quick retries.
  const blocked = recordedMako(4);
  const r = await runFull(store, blocked, { ...opts, now: t0 });
  expect(r).toMatchObject({ status: 'ok', showsOk: 0, showsFailed: 0, blocked: [{ key: NEWSCAST.key }] });
  expect(blocked.blocks).toEqual({ pages: 4, cleared: 0, refused: 1 });
  expect(store.lastRun('full', 'mako')?.status).toBe('ok');
  // Last good data kept, the show not marked failing, and a labelled note.
  expect(store.getShow(id)?.show).toEqual(before);
  expect(store.getShow(id)?.lastError).toBeFalsy();
  expect(store.recentWarnings(10)).toContainEqual(
    expect.objectContaining({
      code: 'bot-check',
      message: `Mako's bot check delayed 1 show; retried at 01:30 UTC (last good data kept): ${NEWSCAST.title}`,
    }),
  );
  expect(store.getState(retryKey('mako'))).toMatchObject({
    pending: [{ key: NEWSCAST.key }],
    attempts: 0,
    nextAt: '2026-11-07T01:30:00.000Z',
  });
  const status = buildStatus(store, ['mako'], Date.now()).sources[0];
  expect(status?.health).toBe('ok');
  const notes = status?.notes.join(' ');
  expect(notes).toMatch(/1 show refused by the site's bot protection, retry 1 of 3 at 01:30 UTC/);
  expect(notes).toMatch(
    /the site's bot check answered 4 of \d+ requests today \(\d+\.\d%\); 0 read on a quick retry, 1 show delayed/,
  );
  // The retry later that night reads it.
  await runBlockedRetry(store, recordedMako(0), { ...opts, now: t0 + 31 * 60_000 });
  expect(store.getState(retryKey('mako'))).toMatchObject({ pending: [], recovered: [NEWSCAST.title] });
});

test('an airing read refused by the bot check puts the show on the retry list; refused on every retry, it is marked', async () => {
  const store = Store.open(':memory:');
  const today = new Date().toISOString().slice(0, 10);
  const t0 = Date.now();
  const good: ScrapedShow = {
    source: 'mako',
    key: '/a',
    title: '/a',
    catalog: 'iltv_keshet12',
    seasons: [
      {
        key: 's1',
        title: 'עונה 1',
        episodes: [1, 2, 3].map((n) => ({ key: `e${n}`, title: `${n}`, airDate: today, streams: [] })),
      },
    ],
  };
  const fake = (answer: ScrapedShow | Error): SourceAdapter => ({
    source: 'mako',
    requests: 0,
    listShows: async () => [{ key: '/a', title: '/a' }],
    fetchShow: async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
  await runFull(store, fake(good), { ...opts, now: t0 });
  const refused = () => fake(new BlockedError('https://www.mako.co.il/a', 200, 'page matches /radware/i'));
  const r = await runAiring(store, refused(), 14, { ...opts, now: t0 });
  expect(r).toMatchObject({ status: 'ok', blocked: [{ key: '/a' }] });
  expect(store.getState(retryKey('mako'))).toMatchObject({
    runId: store.lastRun('full', 'mako')?.id,
    pending: [{ key: '/a' }],
    attempts: 0,
  });
  expect(buildStatus(store, ['mako'], t0).sources[0]?.health).toBe('ok');
  for (let i = 0; i < 3; i++)
    await runBlockedRetry(store, refused(), { ...opts, now: t0 + (i + 1) * 4 * 3_600_000 });
  const row = store.getShow('iltv_mako_1');
  expect(row?.lastError).toMatch(/kept last good data: refused by the site's bot check on 3 retries/);
  expect(row?.show.seasons[0]?.episodes).toHaveLength(3);
  expect(buildStatus(store, ['mako'], t0).sources[0]?.health).toBe('warn');
});
