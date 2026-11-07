import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Assignments, assignNumbers, type ScrapedShow } from '@israel-tv/core';
import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import { checkNumbering } from '../src/numbering-guard.ts';
import {
  afterFullRun,
  KAN_PRINTED,
  printedSeason,
  RESHET_PRINTED,
  renumberPrinted,
} from '../src/renumber.ts';

const ep = (key: string, title: string, numberHint?: number, airDate?: string) => ({
  key,
  title,
  streams: [],
  ...(numberHint ? { numberHint } : {}),
  ...(airDate ? { airDate } : {}),
});
const numbers = (a: Assignments) => Object.fromEntries(a.episodes.map((e) => [e.key, e.episode]));
const rows = (pairs: [string, number][], season = 2) =>
  pairs.map(([key, episode]) => ({ key, season, episode }));

test('a season numbered in list order moves to the printed numbers (שבוע סוף season 2)', () => {
  const season = {
    key: 's2',
    title: 'עונה 2',
    episodes: [ep('a', 'פרק 3', 3), ep('b', 'פרק 1', 1), ep('c', 'פרק 2', 2)],
  };
  const m = printedSeason(
    season,
    2,
    rows([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]),
  );
  expect(Object.fromEntries(m ?? [])).toEqual({ a: 3, b: 1, c: 2 });
});

test('an unnumbered episode keeps its number unless a printed one claims it, then goes after the highest', () => {
  // טלוויזיה מהעתיד season 2: the special held 8, which "פרק 8" claims.
  const season = {
    key: 's2',
    title: 'עונה 2',
    episodes: [ep('special', 'ספיישל'), ep('e1', 'פרק 1', 1), ep('e8', 'פרק 8', 8), ep('x', 'בונוס')],
  };
  const m = printedSeason(
    season,
    2,
    rows([
      ['special', 8],
      ['e1', 9],
      ['e8', 1],
      ['x', 5],
    ]),
  );
  expect(Object.fromEntries(m ?? [])).toEqual({ e1: 1, e8: 8, special: 9 });
});

test('a withdrawn episode (no longer listed) yields its number to the printed one', () => {
  // השופטים: the page Kan withdrew held 2; "פרק 2", re-published under a new page, became 4.
  const season = {
    key: 's1',
    title: 'עונה 1',
    episodes: [ep('k1', 'פרק 1', 1), ep('k2', 'פרק 2', 2), ep('k3', 'פרק 3', 3), ep('k4', 'פרק 4', 4)],
  };
  const m = printedSeason(
    season,
    1,
    rows(
      [
        ['k1', 1],
        ['gone', 2],
        ['k3', 3],
        ['k2', 4],
        ['k4', 5],
      ],
      1,
    ),
  );
  expect(Object.fromEntries(m ?? [])).toEqual({ k2: 2, k4: 4, gone: 5 });
});

test('agreeing, colliding or backwards printed numbers move nothing', () => {
  const agree = { key: 's', title: '', episodes: [ep('a', 'פרק 1', 1), ep('b', 'פרק 2', 2)] };
  expect(
    printedSeason(
      agree,
      2,
      rows([
        ['a', 1],
        ['b', 2],
      ]),
    ),
  ).toBeUndefined();
  // Two episodes claim 3: neither is moved to it (and nothing else changes).
  const dup = { key: 's', title: '', episodes: [ep('a', 'x', 3), ep('b', 'y', 3)] };
  expect(
    printedSeason(
      dup,
      2,
      rows([
        ['a', 1],
        ['b', 2],
      ]),
    ),
  ).toBeUndefined();
  // Printed numbers that count newest = 1 (they run against the air dates): the rules number by date.
  const back = {
    key: 's',
    title: '',
    episodes: [
      ep('a', 'x', 1, '2025-09-13'),
      ep('b', 'y', 2, '2025-09-06'),
      ep('c', 'z', 3, '2025-08-30'),
      ep('d', 'w', 4, '2025-08-23'),
    ],
  };
  expect(
    printedSeason(
      back,
      2,
      rows([
        ['d', 1],
        ['c', 2],
        ['b', 3],
        ['a', 4],
      ]),
    ),
  ).toBeUndefined();
});

function kanStore() {
  const dir = mkdtempSync(join(tmpdir(), 'printed-'));
  const store = Store.open(join(dir, 'israel-tv.sqlite'));
  const show: ScrapedShow = {
    source: 'kan',
    key: 'https://www.kan.org.il/content/kan/kan-11/p-1041110/',
    title: 'מלכת השכונה',
    catalog: 'iltv_kan11',
    seasons: [
      {
        key: 'k|s1',
        title: 'עונה 1',
        episodes: [
          ep('kan:1', 'פרק 1 - אלירן', 1),
          ep('kan:2', 'מה לא עובד?'),
          ep('kan:3', 'פרק 2 - תקווה חדשה', 2),
          ep('kan:4', 'פרק 3 - קבוצה', 3),
          // A song "from episode 1", stored with a hint by an older reader.
          ep('kan:5', 'שיר - מתוך פרק 1', 1),
        ],
      },
    ],
  };
  const id = store.seriesIdFor('kan', show.key);
  store.saveShow(
    id,
    show,
    {
      seasons: [{ key: 'k|s1', number: 1, kind: 'numbered' }],
      episodes: [
        { key: 'kan:1', season: 1, episode: 1 },
        { key: 'kan:2', season: 1, episode: 2 },
        { key: 'kan:3', season: 1, episode: 5 },
        { key: 'kan:4', season: 1, episode: 3 },
        { key: 'kan:5', season: 1, episode: 4 },
      ],
    },
    undefined,
  );
  checkNumbering(store); // the guard's history: what was published
  return { dir, store, id };
}

test('Kan migration: backup, one pass, every move reported, the guard re-taken, never twice', () => {
  const { dir, store, id } = kanStore();
  store.addWarnings(store.startRun('crawl', 'kan'), id, [
    { code: 'episode-number-taken', message: 'episode kan:3 "פרק 2" collides in season 1; numbered 5' },
  ]);
  const dry = renumberPrinted(store, dir, 'kan', { dryRun: true });
  expect(dry?.moves.map((m) => `${m.key} ${m.from}→${m.to}`)).toEqual(['kan:3 5→2', 'kan:2 2→5']);
  expect(numbers(store.assignments(id))['kan:3']).toBe(5); // a dry run changes nothing

  const r = renumberPrinted(store, dir, 'kan');
  expect(r?.id).toBe(KAN_PRINTED);
  expect(r?.moves).toHaveLength(2);
  expect(r?.backup && existsSync(r.backup)).toBe(true);
  const report = JSON.parse(readFileSync((r?.backup ?? '').replace(/\.sqlite$/, '.moves.json'), 'utf8'));
  expect(report[0]).toMatchObject({ seriesId: id, show: 'מלכת השכונה', season: 1, from: 5, to: 2 });
  expect(numbers(store.assignments(id))).toEqual({
    'kan:1': 1,
    'kan:2': 5,
    'kan:3': 2,
    'kan:4': 3,
    'kan:5': 4,
  });
  // The stale hint is gone from the stored data, so the next read reports nothing.
  const after = store.getShow(id)?.show;
  expect(after?.seasons[0]?.episodes.find((e) => e.key === 'kan:5')?.numberHint).toBeUndefined();
  if (!after) throw new Error('no show');
  expect(assignNumbers(after, store.assignments(id)).warnings).toEqual([]);
  expect(checkNumbering(store).ok).toBe(true);
  expect(store.recentWarnings().filter((w) => w.seriesId === id)).toEqual([]);
  expect(renumberPrinted(store, dir, 'kan')).toBeUndefined();
});

test('Reshet migration runs once, after a full read, on the shows that read read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'printed-'));
  const store = Store.open(join(dir, 'israel-tv.sqlite'));
  const show: ScrapedShow = {
    source: 'reshet',
    key: '/all-shows/shavua-sof/',
    title: 'שבוע סוף',
    catalog: 'iltv_reshet13',
    seasons: [{ key: 'r|s2', title: 'עונה 2', episodes: [ep('1_a', 'פרק 2', 2), ep('1_b', 'פרק 1', 1)] }],
  };
  const id = store.seriesIdFor('reshet', show.key);
  store.saveShow(
    id,
    show,
    {
      seasons: [{ key: 'r|s2', number: 2, kind: 'numbered' }],
      episodes: [
        { key: '1_a', season: 2, episode: 1 },
        { key: '1_b', season: 2, episode: 2 },
      ],
    },
    undefined,
  );
  const later = new Date(Date.now() + 60_000).toISOString();
  // A failed or limited full run does not trigger it; a read that did not reach the show moves nothing.
  expect(afterFullRun(store, dir, 'reshet', { status: 'failed', startedAt: '2000-01-01' })).toBeUndefined();
  expect(afterFullRun(store, dir, 'mako', { status: 'ok', startedAt: '2000-01-01' })).toBeUndefined();
  expect(afterFullRun(store, dir, 'reshet', { status: 'ok', startedAt: later })).toMatch(/0 episodes moved/);
  expect(store.getState<string[]>('numbering:migrations')).toContain(RESHET_PRINTED);
  expect(numbers(store.assignments(id))).toEqual({ '1_a': 1, '1_b': 2 });
});

test('Reshet migration moves a show the full read reached', () => {
  const dir = mkdtempSync(join(tmpdir(), 'printed-'));
  const store = Store.open(join(dir, 'israel-tv.sqlite'));
  const show: ScrapedShow = {
    source: 'reshet',
    key: '/all-shows/shavua-sof/',
    title: 'שבוע סוף',
    catalog: 'iltv_reshet13',
    seasons: [{ key: 'r|s2', title: 'עונה 2', episodes: [ep('1_a', 'פרק 2', 2), ep('1_b', 'פרק 1', 1)] }],
  };
  const id = store.seriesIdFor('reshet', show.key);
  store.saveShow(
    id,
    show,
    {
      seasons: [{ key: 'r|s2', number: 2, kind: 'numbered' }],
      episodes: [
        { key: '1_a', season: 2, episode: 1 },
        { key: '1_b', season: 2, episode: 2 },
      ],
    },
    undefined,
  );
  // An incomplete read (partial, or a show delayed by a bot check) waits for the next full run.
  expect(afterFullRun(store, dir, 'reshet', { status: 'partial', startedAt: '2000-01-01' })).toBeUndefined();
  expect(
    afterFullRun(store, dir, 'reshet', { status: 'ok', startedAt: '2000-01-01', blocked: [{}] }),
  ).toBeUndefined();
  // A season the read did not return (kept from the stored data, old reader's numbers) is left alone.
  expect(
    renumberPrinted(store, dir, 'reshet', { dryRun: true, fetched: { [id]: ['r|other'] } })?.moves,
  ).toEqual([]);
  const line = afterFullRun(store, dir, 'reshet', {
    status: 'ok',
    startedAt: '2000-01-01',
    fetched: { [id]: ['r|s2'] },
  });
  expect(line).toMatch(/2 episodes moved in 1 seasons of 1 shows/);
  expect(numbers(store.assignments(id))).toEqual({ '1_a': 2, '1_b': 1 });
});
