// FROZEN numbering rules (owner decision, 2026-11-06; named seasons changed the same day by the recorded
// migration named-seasons-lowest-free-2026-11-06, before going public). Apps keep watch progress by series:season:episode, so the
// numbers these inputs get must never change. If this test fails, a rule change would number episodes
// differently: do not edit the expectations. A change that must move existing episodes needs a recorded one-time
// migration (apps/ingest/src/renumber.ts, with a backup) and the owner's approval; the publisher's numbering guard
// (apps/ingest/src/numbering-guard.ts) refuses any other move.
import { expect, test } from 'vitest';
import type { ScrapedShow } from '../src/model.ts';
import { assignNumbers } from '../src/numbering.ts';

type Ep = ScrapedShow['seasons'][number]['episodes'][number];
const ep = (key: string, title: string, airDate?: string, numberHint?: number): Ep => ({
  key,
  title,
  streams: [],
  ...(airDate ? { airDate } : {}),
  ...(numberHint ? { numberHint } : {}),
});
const show = (seasons: ScrapedShow['seasons']): ScrapedShow => ({
  source: 'mako',
  key: '/s',
  title: 's',
  catalog: 'iltv_keshet12',
  seasons,
});
const run = (s: ScrapedShow) => {
  const r = assignNumbers(s, { seasons: [], episodes: [] });
  return {
    seasons: Object.fromEntries(r.seasons.map((x) => [x.key, `${x.kind}:${x.number}`])),
    episodes: Object.fromEntries(r.episodes.map((x) => [x.key, `${x.season}:${x.episode}`])),
  };
};

const CASES: [string, ScrapedShow, ReturnType<typeof run>][] = [
  [
    'numbered seasons, printed numbers, an ad-free gap',
    show([
      {
        key: 's12',
        title: 'עונה 12',
        episodes: [ep('a', 'פרק 1', '2026-01-01', 1), ep('b', 'פרק 3', '2026-01-08', 3)],
      },
    ]),
    { seasons: { s12: 'numbered:12' }, episodes: { a: '12:1', b: '12:3' } },
  ],
  [
    'year seasons by position, oldest = 1, after real numbers; named take the lowest free number',
    show([
      { key: 'y26', title: '2026', episodes: [ep('c', 'x', '2026-02-01')] },
      { key: 's1', title: 'עונה 1', episodes: [ep('a', 'x', '2019-01-01')] },
      { key: 'y24', title: 'עונה 2024', episodes: [ep('b', 'x', '2024-02-01')] },
      { key: 'vip', title: 'VIP 5', episodes: [ep('d', 'x', '2025-01-01')] },
    ]),
    {
      seasons: { y26: 'year:3', s1: 'numbered:1', y24: 'year:2', vip: 'named:4' },
      episodes: { c: '3:1', a: '1:1', b: '2:1', d: '4:1' },
    },
  ],
  [
    'a single untitled season is season 1; a daily show listed newest first is numbered oldest = 1',
    show([
      {
        key: 'm',
        title: '',
        episodes: [ep('d3', 'x', '2026-11-05'), ep('d2', 'x', '2026-11-04'), ep('d1', 'x', '2026-11-03')],
      },
    ]),
    { seasons: { m: 'single:1' }, episodes: { d1: '1:1', d2: '1:2', d3: '1:3' } },
  ],
  [
    'printed numbers that run against the air dates are positions: numbered by date',
    show([
      {
        key: 's',
        title: 'עונה 1',
        episodes: [
          ep('n', 'x', '2026-03-01', 1),
          ep('m', 'x', '2026-02-01', 2),
          ep('o', 'x', '2026-01-01', 3),
        ],
      },
    ]),
    { seasons: { s: 'numbered:1' }, episodes: { o: '1:1', m: '1:2', n: '1:3' } },
  ],
  [
    'Kan: its own numbers first; a clash and unnumbered pages after, in order; never two the same',
    show([
      {
        key: 'k',
        title: 'עונה 1',
        episodes: [
          ep('t', 'הטריילר'),
          ep('p4', 'פרק 4', undefined, 4),
          ep('p1', 'פרק 1', undefined, 1),
          ep('p1b', 'פרק 1 מלא', undefined, 1),
        ],
      },
    ]),
    { seasons: { k: 'numbered:1' }, episodes: { p4: '1:4', p1: '1:1', t: '1:5', p1b: '1:6' } },
  ],
  [
    'named seasons fill the lowest free numbers in list order; empty seasons get none; "עונת 2023" is a year',
    show([
      { key: 'vip', title: 'VIP 2022', episodes: [ep('v', 'x', '2022-01-01')] },
      { key: 's11', title: 'עונה 11', episodes: [ep('a', 'x', '2023-01-01')] },
      { key: 'dup', title: 'עונה 11', episodes: [] },
      { key: 'dream', title: 'נבחרת החלומות', episodes: [ep('b', 'x', '2024-01-01')] },
      { key: 'y23', title: 'עונת 2023', episodes: [ep('c', 'x', '2023-06-01')] },
    ]),
    {
      seasons: { vip: 'named:1', s11: 'numbered:11', dream: 'named:2', y23: 'year:12' },
      episodes: { v: '1:1', a: '11:1', b: '2:1', c: '12:1' },
    },
  ],
];

for (const [name, input, expected] of CASES)
  test(`frozen: ${name}`, () => {
    expect(run(input), 'numbering rules are frozen: see the comment at the top of this file').toEqual(
      expected,
    );
  });
