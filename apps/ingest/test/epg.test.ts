import { readFileSync } from 'node:fs';
import { type GuideRow, guideLine, guideVideos, liveChannelOf, nowNext } from '@israel-tv/core';
import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import {
  GUIDE_KEY,
  guideFile,
  parseCh14Guide,
  parseKanGuide,
  parseKnessetGuide,
  parseMakoGuide,
  parseReshetGuide,
  refreshGuides,
  storeGuide,
  toRows,
} from '../src/epg.ts';

const fx = (name: string) => readFileSync(new URL(`./fixtures/epg/${name}`, import.meta.url), 'utf8');
const iso = (ms: number) => new Date(ms).toISOString();

/** Every guide: programmes in order, each ending after it starts and no later than the next one starts. */
function wellFormed(rows: GuideRow[]) {
  expect(rows.length).toBeGreaterThan(10);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as GuideRow;
    expect(r[1], r[2]).toBeGreaterThan(r[0]);
    expect(r[2].length).toBeGreaterThan(0);
    if (i > 0) expect(r[0]).toBeGreaterThan((rows[i - 1] as GuideRow)[0]);
  }
}

test('Keshet 12 (recorded 2026-11-07): UTC starts and durations', () => {
  const rows = parseMakoGuide(JSON.parse(fx('keshet12.json')));
  wellFormed(rows);
  // "06/11/2026 06:00" Israel time is 04:00 UTC (winter time).
  expect(iso(rows[0]?.[0] ?? 0)).toBe('2026-11-06T04:00:00.000Z');
  expect(rows.every((r) => !r[4] || !/placeHolder/i.test(r[4]))).toBe(true);
});

test('Reshet 13 (recorded 2026-11-07): a broadcast day runs past midnight', () => {
  const rows = parseReshetGuide(fx('reshet13.html'));
  wellFormed(rows);
  // The guide's first row: "05:27" on 2026-11-06, Israel time.
  expect(iso(rows[0]?.[0] ?? 0)).toBe('2026-11-06T03:27:00.000Z');
});

test('Channel 14 (recorded 2026-11-07): starts and ends in Israel time, ends after midnight on the next day', () => {
  const rows = parseCh14Guide(JSON.parse(fx('ch14.json')));
  wellFormed(rows);
  const shabbat = rows.find((r) => r[2] === 'הגל השקט' && iso(r[0]).startsWith('2026-11-07'));
  expect(shabbat && [iso(shabbat[0]), iso(shabbat[1])]).toEqual([
    '2026-11-07T04:00:00.000Z',
    '2026-11-07T15:30:00.000Z',
  ]);
});

test('Knesset (recorded 2026-11-07, two days kept): one table per day, Israel time', () => {
  const rows = parseKnessetGuide(fx('knesset.html'));
  expect(rows.length).toBeGreaterThan(3);
  expect(rows.find((r) => r[2] === 'ועדת מעקב')?.[0]).toBe(Date.parse('2026-10-31T16:00:00Z'));
});

test('Kan Educational (recorded 2026-11-07): UTC starts, ends from the next start', () => {
  const rows = parseKanGuide(fx('kanedu.html'));
  wellFormed(rows);
  expect(rows.some((r) => r[4]?.startsWith('https://www.kan.org.il/'))).toBe(true);
});

test('ends come from the next start; the last programme gets an hour', () => {
  expect(
    toRows([
      { start: 2_000, title: 'b' },
      { start: 1_000, title: 'a' },
    ]),
  ).toEqual([
    [1_000, 2_000, 'a'],
    [2_000, 2_000 + 3_600_000, 'b'],
  ]);
});

test('now / next, guide entries, and channel ids from guide entries', () => {
  const t = Date.parse('2026-11-07T18:30:00Z');
  const rows: GuideRow[] = [
    [Date.parse('2026-11-07T18:00:00Z'), Date.parse('2026-11-07T19:00:00Z'), 'חדשות'],
    [Date.parse('2026-11-07T19:00:00Z'), Date.parse('2026-11-07T20:00:00Z'), 'הישרדות', 'פרק 5'],
  ];
  expect(nowNext(rows, t).now?.[2]).toBe('חדשות');
  expect(guideLine(rows, t)).toBe('עכשיו: חדשות (עד 21:00) · אחר כך 21:00: הישרדות');
  expect(guideLine([], t)).toBeUndefined();
  const v = guideVideos(
    'iltv_live_keshet12',
    rows,
    Date.parse('2026-11-07T19:30:00Z'),
    Date.parse('2026-11-08T00:00:00Z'),
  );
  expect(v).toEqual([
    {
      id: 'iltv_live_keshet12:epg:2026-11-07T19:00:00.000Z',
      title: 'הישרדות',
      released: '2026-11-07T19:00:00.000Z',
      startTime: '2026-11-07T19:00:00.000Z',
      endTime: '2026-11-07T20:00:00.000Z',
      runtime: '60 min',
      overview: 'פרק 5',
    },
  ]);
  expect(liveChannelOf('iltv_live_kan11:epg:2026-11-07T19:00:00.000Z')).toBe('iltv_live_kan11');
  expect(liveChannelOf('iltv_live_kan11')).toBe('iltv_live_kan11');
  expect(liveChannelOf('iltv_kan_1:1:1')).toBeUndefined();
});

test('refresh: due guides are read, a failure keeps the last good programmes and says why', async () => {
  const store = Store.open(':memory:');
  const now = Date.parse('2026-11-07T12:00:00Z');
  const good: GuideRow[] = [[now, now + 3_600_000, 'א']];
  let fail = false;
  const sources = {
    test: {
      channels: ['iltv_live_ch14'],
      everyMs: 6 * 3_600_000,
      needs: 'live' as const,
      read: async () => {
        if (fail) throw new Error('HTTP 503');
        return good;
      },
    },
  };
  const config = {
    sources: { live: true, mako: true, reshet: true, kan: true },
    scraping: { delayMs: 0 },
  } as never;
  expect((await refreshGuides(store, config, { now, sources })).read).toEqual(['test']);
  // Not due again for 6 hours.
  expect((await refreshGuides(store, config, { now: now + 3_600_000, sources })).read).toEqual([]);
  fail = true;
  const r = await refreshGuides(store, config, { now: now + 7 * 3_600_000, sources });
  expect(r.failed).toEqual(['test: HTTP 503']);
  expect(
    store.getState<Record<string, { rows: GuideRow[]; error?: string }>>(GUIDE_KEY)?.iltv_live_ch14,
  ).toMatchObject({
    rows: good,
    error: 'HTTP 503',
  });
  expect(guideFile(store, now).iltv_live_ch14).toEqual(good);
});

test('a guide read for one day replaces only that span', () => {
  const store = Store.open(':memory:');
  const h = 3_600_000;
  const now = Date.parse('2026-11-07T00:00:00Z');
  storeGuide(
    store,
    'iltv_live_kan11',
    [
      [now, now + h, 'old today'],
      [now + 24 * h, now + 25 * h, 'tomorrow'],
    ],
    now,
  );
  storeGuide(store, 'iltv_live_kan11', [[now, now + 2 * h, 'new today']], now);
  expect(guideFile(store, now).iltv_live_kan11?.map((r) => r[2])).toEqual(['new today', 'tomorrow']);
});
