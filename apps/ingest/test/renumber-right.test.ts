import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Assignments, assignNumbers, type ScrapedShow } from '@israel-tv/core';
import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import { checkNumbering } from '../src/numbering-guard.ts';
import { evidenceOrder, NUMBERING_RIGHT, renumberRight, seasonTargets } from '../src/renumber.ts';

type Ep = ScrapedShow['seasons'][number]['episodes'][number];
const ep = (key: string, title: string, numberHint?: number, airDate?: string): Ep => ({
  key,
  title,
  streams: [],
  ...(numberHint ? { numberHint } : {}),
  ...(airDate ? { airDate } : {}),
});
const season = (episodes: Ep[]) => ({ key: 's', title: 'עונה 1', episodes });
/** Stored rows in season 1, in the order given: [key, episode]. */
const rows = (pairs: [string, number][]) => pairs.map(([key, episode]) => ({ key, season: 1, episode }));
const targets = (s: ReturnType<typeof season>, r: ReturnType<typeof rows>) => {
  const t = seasonTargets(s, 1, r);
  return { rule: t.rule, numbers: Object.fromEntries(t.numbers) };
};
const day = (n: number) => `2025-01-${String(n).padStart(2, '0')}`;

test("printed numbers, an archive's bulk dates: Kaltura's numbers win (הישרדות 7's premiere was E34)", () => {
  const s = season([
    ep('vote', 'הישרדות, עונה 7: וילת המושבעים', undefined, '2015-11-03'),
    ep('e3', 'x', 3, '2015-11-03'),
    ep('final', 'אירוע הגמר', 4, '2015-11-03'),
    ep('pre', 'פרק הבכורה!', 1, '2017-03-28'),
    ep('e2', 'פרק הדחה מיוחד!', 2, '2017-03-28'),
  ]);
  expect(
    targets(
      s,
      rows([
        ['vote', 1],
        ['e3', 2],
        ['final', 3],
        ['pre', 4],
        ['e2', 5],
      ]),
    ),
  ).toEqual({ rule: 'printed', numbers: { pre: 1, e2: 2, e3: 3, final: 4, vote: 5 } });
});

test('printed numbers: an unnumbered episode keeps a number no printed one claims; the bumped take the lowest free above the printed', () => {
  // שכונת חיים / תראו אותי: "פרק 1" sat at E3 behind two clips.
  const s = season([
    ep('clip1', 'אלה לוקחת אתכם לסיור'),
    ep('clip2', 'ברוכים הבאים'),
    ep('p1', 'פרק 1 - כמו פעם', 1),
    ep('p2', 'פרק 2', 2),
    ep('p3', 'פרק 3', 3),
    ep('song', 'שיר הנושא'),
  ]);
  expect(
    targets(
      s,
      rows([
        ['clip1', 1],
        ['clip2', 2],
        ['p1', 3],
        ['p2', 4],
        ['p3', 5],
        ['song', 6],
      ]),
    ),
  ).toEqual({ rule: 'printed', numbers: { p1: 1, p2: 2, p3: 3, clip1: 4, clip2: 5, song: 6 } });
});

test('a number printed twice: the first by air date keeps it, the other keeps its own number after the others (ארץ נהדרת 12)', () => {
  const s = season([
    ep('a', 'קרב התיקים', 10, '2015-03-23'),
    ep('b', 'סדר פסח חגיגי', 10, '2015-03-30'),
    ep('c', 'x', 9, '2015-03-16'),
    ep('d', 'x', 11, '2015-04-06'),
  ]);
  expect(
    targets(
      s,
      rows([
        ['c', 9],
        ['a', 10],
        ['d', 11],
        ['b', 23],
      ]),
    ).numbers,
  ).toEqual({ c: 9, a: 10, d: 11, b: 23 });
});

test('printed numbers that start over: 1..n by air date (זמן אמת)', () => {
  const s = season([
    ep('a9', 'פרק 9', 9, '2023-04-22'),
    ep('b1', 'פרק 1', 1, '2024-03-06'),
    ep('b2', 'פרק 2', 2, '2024-03-13'),
    ep('b3', 'פרק 3', 3, '2024-03-20'),
    ep('c1', 'פרק 1', 1, '2025-04-17'),
    ep('c2', 'פרק 2', 2, '2025-04-17'),
    ep('c3', 'פרק 3', 3, '2025-04-17'),
  ]);
  expect(
    targets(
      s,
      rows([
        ['b1', 1],
        ['b2', 2],
        ['b3', 3],
        ['a9', 9],
        ['c1', 4],
        ['c2', 5],
        ['c3', 6],
      ]),
    ),
  ).toEqual({ rule: 'starts-over', numbers: { a9: 1, b1: 2, b2: 3, b3: 4, c1: 5, c2: 6, c3: 7 } });
});

test('few printed numbers with real dates: air-date order around them (אהרוני מבשל לחברים started at E35)', () => {
  const s = season([
    ep('p4', 'פרק 4', 4, day(20)),
    ...[1, 2, 3, 5, 6].map((d) => ep(`d${d}`, 'x', undefined, day(d * 4))),
  ]);
  expect(
    targets(
      s,
      rows([
        ['p4', 4],
        ['d1', 5],
        ['d2', 6],
        ['d3', 7],
        ['d5', 8],
        ['d6', 9],
      ]),
    ),
  ).toEqual({ rule: 'sparse', numbers: { d1: 1, d2: 2, d3: 3, p4: 4, d5: 5, d6: 6 } });
});

test('few printed numbers in list order when the dates cannot tell (טקסי דרייבר: "פרק הבכורה" was E14)', () => {
  const s = season([
    ep('pre', 'פרק הבכורה'),
    ep('x2', 'אלישע מקבל את הזדמנות חייו', undefined, '2021-01-10'),
    ep('p3', 'טקסי דרייבר, עונה 1, פרק 3', 3, '2021-01-10'),
    ep('x4', 'כדורגל חופים', undefined, '2021-01-10'),
    ep('x5', 'חרא מסתבך', undefined, '2021-01-10'),
    ep('p6', 'טקסי דרייבר, עונה 1, פרק 6', 6, '2015-11-10'),
    ep('x7', 'יגאל ופאני', undefined, '2021-01-10'),
  ]);
  expect(evidenceOrder(s)?.map((e) => e.key)).toEqual(['pre', 'x2', 'p3', 'x4', 'x5', 'p6', 'x7']);
  const t = targets(
    s,
    rows([
      ['p6', 1],
      ['pre', 2],
      ['x2', 3],
      ['p3', 4],
      ['x4', 5],
      ['x5', 6],
      ['x7', 7],
    ]),
  );
  expect(t).toEqual({ rule: 'sparse', numbers: { pre: 1, x2: 2, p3: 3, x4: 4, x5: 5, p6: 6, x7: 7 } });
});

test("a list whose printed numbers are not its places gives no order (המקור's older seasons stay)", () => {
  const s = season([...'abcdefgh'.split('').map((k) => ep(k, k)), ep('p5', 'q', 5), ep('p6', 'r', 6)]);
  expect(evidenceOrder(s)).toBeUndefined();
});

test('unnumbered episodes that aired before "פרק 2" take the numbers below it (טעם של חו"ל: "פריז" was E9)', () => {
  const s = season([
    ep('paris', 'פריז', undefined, '2025-05-29'),
    ep('rome', 'רומא', 2, '2025-06-05'),
    ep('ams', 'אמסטרדם', 3, '2025-06-12'),
    ep('ath', 'אתונה', 4, '2025-06-26'),
  ]);
  expect(
    targets(
      s,
      rows([
        ['rome', 2],
        ['ams', 3],
        ['ath', 4],
        ['paris', 9],
      ]),
    ).numbers,
  ).toEqual({ paris: 1, rome: 2, ams: 3, ath: 4 });
  // A Kan trailer ahead of "פרק 1" has no number below it: it goes after the printed ones.
  const kan = season([
    ep('soon', 'פרק בקרוב', undefined, '2026-01-04'),
    ep('k1', 'פרק 1', 1, '2026-01-07'),
    ep('k2', 'פרק 2', 2, '2026-01-07'),
    ep('k3', 'פרק 3', 3, '2026-01-11'),
  ]);
  expect(
    targets(
      kan,
      rows([
        ['soon', 1],
        ['k1', 2],
        ['k2', 3],
        ['k3', 4],
      ]),
    ).numbers,
  ).toEqual({ k1: 1, k2: 2, k3: 3, soon: 4 });
});

test('printed numbers counted newest = 1 against real dates: air-date order, on the numbers held (אח לילה)', () => {
  const s = season([ep('n', 'x', 1, day(20)), ep('m', 'x', 2, day(13)), ep('o', 'x', 3, day(6))]);
  expect(
    targets(
      s,
      rows([
        ['o', 1],
        ['m', 2],
        ['n', 3],
      ]),
    ),
  ).toEqual({ rule: 'by-date', numbers: { o: 1, m: 2, n: 3 } });
});

test('an episode no longer listed keeps its number unless a listed one now has it', () => {
  const s = season([ep('k1', 'פרק 1', 1), ep('k2', 'פרק 2', 2)]);
  expect(
    targets(
      s,
      rows([
        ['k1', 1],
        ['gone', 2],
        ['k2', 3],
        ['gone2', 7],
      ]),
    ).numbers,
  ).toEqual({ k1: 1, k2: 2, gone: 8, gone2: 7 });
});

const numbers = (a: Assignments) => Object.fromEntries(a.episodes.map((e) => [e.key, e.episode]));

function storeWith() {
  const dir = mkdtempSync(join(tmpdir(), 'right-'));
  const store = Store.open(join(dir, 'israel-tv.sqlite'));
  const kan: ScrapedShow = {
    source: 'kan',
    key: 'https://www.kan.org.il/content/kan/kan-11/p-327417/',
    title: 'מישהו לגור איתו',
    catalog: 'iltv_kan11',
    seasons: [
      {
        key: 'k|s1',
        title: 'עונה 1',
        episodes: [
          ep('kan:1', 'פרק 1', 1, '2023-05-14'),
          ep('kan:3', 'פרק 3 - תום', 3, '2023-05-17'),
          ep('kan:2', 'מישהו לגור איתו | פרק 2', 2, '2023-05-17'),
        ],
      },
    ],
  };
  const reshet: ScrapedShow = {
    source: 'reshet',
    key: '/all-shows/the-big-brother/',
    title: 'האח הגדול',
    catalog: 'iltv_reshet13',
    seasons: [
      {
        key: 'r|s3',
        title: 'עונה 3',
        episodes: [
          { ...ep('1_a', 'שי ושניר נפרדים', 2, '2015-11-10'), durationSec: 5414 },
          { ...ep('1_b', 'אירוע הכניסה', 1, '2015-11-10'), durationSec: 5000 },
          { ...ep('1_c', 'שי ושניר נפרדים', undefined, '2021-01-10'), durationSec: 5414 },
        ],
      },
    ],
  };
  const kanId = store.seriesIdFor('kan', kan.key);
  store.saveShow(
    kanId,
    kan,
    {
      seasons: [{ key: 'k|s1', number: 1, kind: 'numbered' }],
      episodes: [
        { key: 'kan:1', season: 1, episode: 1 },
        { key: 'gone', season: 1, episode: 2 },
        { key: 'kan:3', season: 1, episode: 3 },
        { key: 'kan:2', season: 1, episode: 9 },
      ],
    },
    undefined,
  );
  const reshetId = store.seriesIdFor('reshet', reshet.key);
  store.saveShow(
    reshetId,
    reshet,
    {
      seasons: [{ key: 'r|s3', number: 3, kind: 'numbered' }],
      episodes: [
        { key: '1_a', season: 3, episode: 2 },
        { key: '1_b', season: 3, episode: 1 },
        { key: '1_c', season: 3, episode: 3 },
      ],
    },
    undefined,
  );
  checkNumbering(store);
  return { dir, store, kanId, reshetId };
}

test('numbering-right: dry run first, then backup, one pass, every move listed, warnings re-derived, never twice', () => {
  const { dir, store, kanId, reshetId } = storeWith();
  const run = store.startRun('crawl', 'kan');
  store.addWarnings(run, kanId, [
    { code: 'episode-number-taken', message: 'episode kan:365663 "פרק 2" collides in season 1; numbered 9' },
    { code: 'source-renumbered', message: 'episode kan:2 is now "פרק 2" at the source; kept S1E9' },
  ]);
  store.addWarnings(run, kanId, [{ code: 'source-note', message: 'unrelated history' }]);

  const dry = renumberRight(store, dir, { dryRun: true });
  expect(dry?.moves.map((m) => `${m.key} ${m.from}→${m.to}`)).toEqual(['gone 2→4', 'kan:2 9→2']);
  expect(dry?.counts).toEqual({ kan: { printed: { seasons: 1, episodes: 2 } } });
  expect(dry?.repeats).toEqual([{ seriesId: reshetId, key: '1_c', title: 'שי ושניר נפרדים' }]);
  expect(dry?.backup).toBeUndefined();
  expect(numbers(store.assignments(kanId))['kan:2']).toBe(9);

  const r = renumberRight(store, dir);
  expect(r?.id).toBe(NUMBERING_RIGHT);
  expect(r?.backup && existsSync(r.backup)).toBe(true);
  const moves = JSON.parse(readFileSync((r?.backup ?? '').replace(/\.sqlite$/, '.moves.json'), 'utf8'));
  expect(moves).toHaveLength(2);
  expect(moves[1]).toMatchObject({ seriesId: kanId, source: 'kan', rule: 'printed', from: 9, to: 2 });
  expect(numbers(store.assignments(kanId))).toEqual({ 'kan:1': 1, 'kan:2': 2, 'kan:3': 3, gone: 4 });
  // The repeated listing is left out of the stored data; its number stays reserved.
  expect(store.getShow(reshetId)?.show.seasons[0]?.episodes.map((e) => e.key)).toEqual(['1_a', '1_b']);
  expect(numbers(store.assignments(reshetId))['1_c']).toBe(3);
  // Numbering notes gone, other history kept; the next read says nothing; the guard holds.
  const left = store.recentWarnings().filter((w) => w.seriesId === kanId);
  expect(left.map((w) => w.code)).toEqual(['source-note']);
  expect(r?.warningsCleared).toBe(2);
  expect(r?.warningsLeft).toBe(0);
  const after = store.getShow(kanId)?.show;
  if (!after) throw new Error('no show');
  expect(assignNumbers(after, store.assignments(kanId)).warnings).toEqual([]);
  expect(checkNumbering(store).ok).toBe(true);
  expect(store.getState<{ moved: number }>(`numbering:migrations:${NUMBERING_RIGHT}`)?.moved).toBe(2);
  expect(renumberRight(store, dir)).toBeUndefined();
});
