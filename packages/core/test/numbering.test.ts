import { describe, expect, test } from 'vitest';
import type { ScrapedEpisode, ScrapedSeason, ScrapedShow } from '../src/model.ts';
import { type Assignments, assignNumbers, parseEpisodeHint, parseSeasonTitle } from '../src/numbering.ts';

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
function season(key: string, title: string, episodes: ScrapedEpisode[] = []): ScrapedSeason {
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

test('mixed numbered and named seasons never collapse into season 1 (Masterchef shape)', () => {
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
    ['vip_2022', 101, 'named'],
    ['s11', 11, 'numbered'],
    ['dream_team', 102, 'named'],
    ['s12', 12, 'numbered'],
    ['dream_team_2', 103, 'named'],
  ]);
});

test('year seasons use the year from the title, not the page url (Uvda shape)', () => {
  const r = assignNumbers(
    show([season('uvda-swords_of_iron', 'עונה 2024'), season('uvda-2024', 'עונה 2025')]),
    EMPTY,
  );
  expect(r.seasons.map((s) => s.number)).toEqual([2024, 2025]);
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
  expect(r.seasons.find((s) => s.key === 'b')).toEqual({ key: 'b', number: 101, kind: 'named' });
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
