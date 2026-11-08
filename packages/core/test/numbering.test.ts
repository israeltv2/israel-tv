import { describe, expect, test } from 'vitest';
import type { ScrapedEpisode, ScrapedSeason, ScrapedShow } from '../src/model.ts';
import {
  type Assignments,
  assignNumbers,
  datesTellOrder,
  hintsRunBackwards,
  parseEpisodeHint,
  parseSeasonTitle,
  printedStartsOver,
  startOverOrder,
} from '../src/numbering.ts';

const EMPTY: Assignments = { seasons: [], episodes: [] };

function ep(key: string, numberHint?: number, airDate?: string): ScrapedEpisode {
  return {
    key,
    title: key,
    streams: [],
    ...(numberHint ? { numberHint } : {}),
    ...(airDate ? { airDate } : {}),
  };
}
/** A season with one episode by default (a season gets a number only once it has episodes). */
function season(key: string, title: string, episodes: ScrapedEpisode[] = [ep(`${key}-e`)]): ScrapedSeason {
  return { key, title, episodes };
}
function show(seasons: ScrapedSeason[]): ScrapedShow {
  return { source: 'mako', key: 'show', title: 'show', catalog: 'iltv_keshet12', seasons };
}
const num = (r: Assignments, key: string) => r.episodes.find((e) => e.key === key);

describe('parseSeasonTitle', () => {
  test.each([
    ['עונה 12', { kind: 'numbered', number: 12 }],
    ['עונה 2025', { kind: 'year', number: 2025 }],
    ['2025', { kind: 'year', number: 2025 }],
    ['עונת 2023', { kind: 'year', number: 2023 }],
    ['VIP 5', { kind: 'named' }],
    ['נבחרת החלומות 2', { kind: 'named' }],
    ['', { kind: 'single' }],
  ])('%s', (title, expected) => expect(parseSeasonTitle(title)).toEqual(expected));
});

test('parseEpisodeHint reads Mako extraInfo and titles', () => {
  expect(parseEpisodeHint('פרק 5@05.11.26')).toBe(5);
  expect(parseEpisodeHint('פרק 12 - הגמר')).toBe(12);
  expect(parseEpisodeHint('05.11.26')).toBeUndefined();
  expect(parseEpisodeHint(undefined)).toBeUndefined();
});

test('parseEpisodeHint: "מתוך פרק 1" (a song from episode 1) is not this item\'s number', () => {
  // Kan's "הסדרתיים - כל השירים", 2026-11-07: two songs "מתוך פרק 1" collided as episode 1.
  expect(parseEpisodeHint('שנה לפנתיאון - מתוך פרק 1')).toBeUndefined();
  expect(parseEpisodeHint('הילדה החדשה- מתוך פרק 1')).toBeUndefined();
  expect(parseEpisodeHint('פרק 3 - שיר מתוך פרק 1')).toBe(3);
});

test('mixed numbered and named seasons: named take the lowest free numbers, in list order (Masterchef shape)', () => {
  const r = assignNumbers(
    show([
      season('vip_2022', 'VIP 2022'),
      season('s11', 'עונה 11'),
      season('dream_team', 'נבחרת החלומות'),
      season('s12', 'עונה 12'),
      season('dream_team_2', 'נבחרת החלומות 2'),
    ]),
    EMPTY,
  );
  expect(r.seasons.map((s) => [s.key, s.number, s.kind])).toEqual([
    ['vip_2022', 1, 'named'],
    ['s11', 11, 'numbered'],
    ['dream_team', 2, 'named'],
    ['s12', 12, 'numbered'],
    ['dream_team_2', 3, 'named'],
  ]);
});

test('year seasons are numbered by position, oldest = 1, by the year in the title (not the page url)', () => {
  // Listed newest first, and with misleading page urls (the Uvda shape).
  const r = assignNumbers(
    show([season('uvda-2024', 'עונה 2025'), season('uvda-swords_of_iron', 'עונה 2024')]),
    EMPTY,
  );
  expect(r.seasons.map((s) => [s.key, s.number, s.kind])).toEqual([
    ['uvda-2024', 2, 'year'],
    ['uvda-swords_of_iron', 1, 'year'],
  ]);
});

test('a new year season takes the next number; stored numbers never move', () => {
  const first = assignNumbers(show([season('y24', '2024'), season('y26', '2026')]), EMPTY);
  const later = assignNumbers(
    show([season('y24', '2024'), season('y25', '2025'), season('y26', '2026')]),
    first,
  );
  expect(later.seasons.map((s) => [s.key, s.number])).toEqual([
    ['y24', 1],
    ['y26', 2],
    ['y25', 3],
  ]);
});

test('year seasons come after real season numbers; a named season takes the lowest free number', () => {
  const r = assignNumbers(
    show([season('s1', 'עונה 1'), season('s2', 'עונה 2'), season('y', '2020'), season('vip', 'VIP')]),
    EMPTY,
  );
  expect(r.seasons.map((s) => s.number)).toEqual([1, 2, 3, 4]);
});

test('single-season show without a title is season 1', () => {
  const r = assignNumbers(show([season('main', '', [ep('a', 1)])]), EMPTY);
  expect(r.seasons[0]).toEqual({ key: 'main', number: 1, kind: 'single' });
});

test('printed episode numbers are used; ad slots never count (only vod items reach here)', () => {
  const r = assignNumbers(show([season('s12', 'עונה 12', [ep('e1', 1), ep('e2', 2), ep('e3', 3)])]), EMPTY);
  expect(r.episodes.map((e) => [e.key, e.season, e.episode])).toEqual([
    ['e1', 12, 1],
    ['e2', 12, 2],
    ['e3', 12, 3],
  ]);
});

test('daily show listed newest first is numbered oldest = 1 by air date', () => {
  const r = assignNumbers(
    show([
      season('main', '', [
        ep('d3', undefined, '2026-11-05'),
        ep('d2', undefined, '2026-11-04'),
        ep('d1', undefined, '2026-11-03'),
      ]),
    ]),
    EMPTY,
  );
  expect([num(r, 'd1')?.episode, num(r, 'd2')?.episode, num(r, 'd3')?.episode]).toEqual([1, 2, 3]);
});

test('stored numbers never change; new daily episodes continue after the highest', () => {
  const first = assignNumbers(
    show([season('main', '', [ep('d2', undefined, '2026-11-04'), ep('d1', undefined, '2026-11-03')])]),
    EMPTY,
  );
  // Next day: the oldest rolled off the source list, a new one appeared.
  const second = assignNumbers(
    show([season('main', '', [ep('d3', undefined, '2026-11-05'), ep('d2', undefined, '2026-11-04')])]),
    first,
  );
  expect(num(second, 'd1')?.episode).toBe(1);
  expect(num(second, 'd2')?.episode).toBe(2);
  expect(num(second, 'd3')?.episode).toBe(3);
  expect(second.added.episodes.map((e) => e.key)).toEqual(['d3']);
});

test('a source renumbering is reported, not applied', () => {
  const first = assignNumbers(show([season('s1', 'עונה 1', [ep('a', 1), ep('b', 2)])]), EMPTY);
  const second = assignNumbers(show([season('s1', 'עונה 1', [ep('a', 2), ep('b', 3)])]), first);
  expect(num(second, 'a')?.episode).toBe(1);
  expect(num(second, 'b')?.episode).toBe(2);
  expect(second.warnings.map((w) => w.code)).toEqual(['source-renumbered', 'source-renumbered']);
});

test('duplicate printed numbers: first keeps it, the other gets the next free one with a warning', () => {
  const r = assignNumbers(show([season('s1', 'עונה 1', [ep('a', 5), ep('b', 5), ep('c', 6)])]), EMPTY);
  expect([num(r, 'a')?.episode, num(r, 'c')?.episode, num(r, 'b')?.episode]).toEqual([5, 6, 7]);
  expect(r.warnings.map((w) => w.code)).toEqual(['episode-number-taken']);
});

test('a new season whose number is taken becomes named instead of merging', () => {
  const first = assignNumbers(show([season('a', 'עונה 1')]), EMPTY);
  const r = assignNumbers(show([season('a', 'עונה 1'), season('b', 'עונה 1')]), first);
  expect(r.seasons.find((s) => s.key === 'b')).toEqual({ key: 'b', number: 2, kind: 'named' });
  expect(r.warnings[0]?.code).toBe('season-number-taken');
});

test('printed numbers that run against the dates are ignored (numbered by date)', () => {
  const r = assignNumbers(
    show([
      season('s', 'עונה 1', [ep('c', 1, '2026-03-03'), ep('b', 2, '2026-03-02'), ep('a', 3, '2026-03-01')]),
    ]),
    EMPTY,
  );
  expect([num(r, 'a')?.episode, num(r, 'b')?.episode, num(r, 'c')?.episode]).toEqual([1, 2, 3]);
  expect(r.warnings[0]?.code).toBe('numbers-reversed');
});

test('two dated episodes counted newest = 1 are numbered by date too', () => {
  const r = assignNumbers(
    show([season('s', 'עונה 1', [ep('new', 1, '2026-11-05'), ep('old', 2, '2026-11-04')])]),
    EMPTY,
  );
  expect([num(r, 'old')?.episode, num(r, 'new')?.episode]).toEqual([1, 2]);
});

test('a season gets a number only once it has episodes (sources list empty duplicates)', () => {
  const r = assignNumbers(
    show([season('s1', 'עונה 1'), season('dup', 'עונה 1', []), season('vip', 'VIP')]),
    EMPTY,
  );
  expect(r.seasons.map((x) => [x.key, x.number])).toEqual([
    ['s1', 1],
    ['vip', 2],
  ]);
});

// Round 11 (numbering-right-2026-11-08): the rules that numbered seasons wrong, measured on the live catalog.
describe('round 11 numbering rules', () => {
  const t = (key: string, title: string, numberHint?: number, airDate?: string): ScrapedEpisode => ({
    key,
    title,
    streams: [],
    ...(numberHint ? { numberHint } : {}),
    ...(airDate ? { airDate } : {}),
  });

  test('parseEpisodeHint: Kan season finales and premieres', () => {
    expect(parseEpisodeHint('פרק סיום העונה (20) - בוגד')).toBe(20);
    expect(parseEpisodeHint("החניכה החדשה - חלק ב' | פרק סיום העונה (16)")).toBe(16);
    expect(parseEpisodeHint('פרק הבכורה')).toBe(1);
    expect(parseEpisodeHint('המדרשה, עונה 2, פרק הבכורה')).toBe(1);
    expect(parseEpisodeHint('תכנית הבכורה: להסתכל בעיניים')).toBe(1);
    // A preview of the premiere, a premiere inside another sentence, and a plain finale are not numbers.
    expect(parseEpisodeHint('הצצה לפרק הבכורה של עונה 5')).toBeUndefined();
    expect(parseEpisodeHint('חשיפה בפרק הבכורה')).toBeUndefined();
    expect(parseEpisodeHint('פרק סיום העונה')).toBeUndefined();
    expect(parseEpisodeHint('אגם בוחבוט על אלבום הבכורה')).toBeUndefined();
  });

  test('datesTellOrder: an archive uploaded in a day or two cannot order a season', () => {
    const bulk = Array.from({ length: 12 }, (_, i) =>
      t(`e${i}`, 'x', undefined, i < 11 ? '2023-03-27' : '2023-04-03'),
    );
    expect(datesTellOrder(bulk)).toBe(false);
    expect(datesTellOrder([t('a', 'x', 1, '2020-01-01'), t('b', 'x', 2, '2020-01-08')])).toBe(true);
    expect(
      datesTellOrder([
        t('a', 'x', 1, '2017-03-28'),
        t('b', 'x', 2, '2017-03-28'),
        t('c', 'x', 3, '2015-11-03'),
      ]),
    ).toBe(false);
    expect(
      datesTellOrder(
        ['2025-05-24', '2025-05-31', '2025-06-02', '2025-06-07'].map((d, i) => t(`e${i}`, 'x', 4 - i, d)),
      ),
    ).toBe(true);
  });

  test("Reshet's archive seasons: Kaltura's numbers against bulk-upload dates are kept (אהבה חדשה 1)", () => {
    // Listed newest first, all uploaded 2023-03-27 except the premiere (2023-04-03): the dates say nothing.
    const eps = [
      t('final', 'סוף לשמועות', 12, '2023-03-27'),
      ...Array.from({ length: 10 }, (_, i) => t(`m${11 - i}`, 'x', 11 - i, '2023-03-27')),
      t('premiere', 'פרק הבכורה', 1, '2023-04-03'),
    ];
    expect(hintsRunBackwards(eps)).toBe(false);
    const r = assignNumbers(show([season('s1', 'עונה 1', eps)]), EMPTY);
    expect(num(r, 'premiere')?.episode).toBe(1);
    expect(num(r, 'final')?.episode).toBe(12);
    expect(r.warnings).toEqual([]);
  });

  test('printed numbers that start over: several cycles in one season are numbered by air date (זמן אמת)', () => {
    const eps = [
      t('c1e1', 'פרק 1 - קולות צורמים', 1, '2026-04-27'),
      t('a9', 'פרק 9 - אתמול היה טוב', 9, '2023-04-22'),
      t('b1', 'פרק 1 - על העיוורון', 1, '2024-03-06'),
      t('b2', 'פרק 2 - סוכן ביעד אלים', 2, '2024-03-13'),
      t('b3', 'פרק 3', 3, '2024-03-20'),
      t('c1e2', 'פרק 2 - פרשת שופטים', 2, '2026-05-04'),
      t('aEnd', 'תכנית סיום העונה', undefined, '2023-04-22'),
      t('a10', 'פרק 10 - כוח כאילו', 10, '2023-04-22'),
      t('c1e3', 'פרק 3 - תחקיר', 3, '2026-05-18'),
    ];
    expect(printedStartsOver(eps)).toBe(true);
    const r = assignNumbers(show([season('s1', 'עונה 1', eps)]), EMPTY);
    expect(
      ['a9', 'a10', 'aEnd', 'b1', 'b2', 'b3', 'c1e1', 'c1e2', 'c1e3'].map((k) => num(r, k)?.episode),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // Not a renumbering, not a clash: nothing to report on every read.
    expect(r.warnings).toEqual([]);
    expect(assignNumbers(show([season('s1', 'עונה 1', eps)]), r).warnings).toEqual([]);
  });

  test('titles naming two seasons with a repeated number start over too; their order is season, number (הופה היי)', () => {
    const eps = [
      t('s5e6', 'עונה 5 פרק 6 - בעקבות הקמע האבוד חלק א', 6, '2024-03-28'),
      t('s1e6', 'עונה 1 פרק 6 - קריית שמונה', 6, '2024-03-28'),
      t('s2e2', 'עונה 2 פרק 2 - בית שמש', 2, '2024-03-28'),
      t('s1e3', 'פרק 3 - אור עקיבא', 3, '2024-03-24'),
      t('s1e2', 'עונה 1 פרק 2 - חדרה', 2, '2024-03-24'),
    ];
    expect(printedStartsOver(eps)).toBe(true);
    expect(startOverOrder({ key: 's', title: '', episodes: eps }).map((e) => e.key)).toEqual([
      's1e2',
      's1e3',
      's1e6',
      's2e2',
      's5e6',
    ]);
  });

  test('two specials numbered 1 and 2 before a season that starts at 1 are not a new cycle (ארץ נהדרת 18)', () => {
    const eps = [
      t('sp1', 'ספיישל פתיחת השנה', 1, '2020-09-08'),
      t('sp2', 'ספיישל סליחות', 2, '2020-09-22'),
      ...Array.from({ length: 5 }, (_, i) => t(`e${i + 3}`, 'x', i + 3, `2021-01-0${i + 1}`)),
      t('re1', 'ארץ נהדרת פותחת עונה', 1, '2020-12-23'),
      t('re2', 'מסיבת סילבסטר', 2, '2020-12-30'),
    ];
    expect(printedStartsOver(eps)).toBe(false);
  });

  test('a number two episodes print is not reported as a renumbering of the second', () => {
    const eps = [t('a', 'קרב התיקים', 10, '2015-03-23'), t('b', 'סדר פסח חגיגי', 10, '2015-03-30')];
    const prev: Assignments = {
      seasons: [{ key: 's', number: 12, kind: 'numbered' }],
      episodes: [
        { key: 'a', season: 12, episode: 10 },
        { key: 'b', season: 12, episode: 23 },
      ],
    };
    expect(assignNumbers(show([season('s', 'עונה 12', eps)]), prev).warnings).toEqual([]);
  });
});
