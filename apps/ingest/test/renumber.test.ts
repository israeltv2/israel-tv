import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Assignments, parseConfig, type ScrapedShow } from '@israel-tv/core';
import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import { checkNumbering } from '../src/numbering-guard.ts';
import { publishSite } from '../src/publish.ts';
import { renumberKanReshet } from '../src/renumber.ts';

const ep = (key: string, title: string, airDate?: string) => ({
  key,
  title,
  streams: [],
  ...(airDate ? { airDate } : {}),
});
const numbers = (a: Assignments) =>
  Object.fromEntries(a.episodes.map((e) => [e.key, `${e.season}:${e.episode}`]));

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'renumber-'));
  const store = Store.open(join(dir, 'israel-tv.sqlite'));
  // Kan, as numbered before: page order (פרק 4 first), a trailer first, two pages that both say "פרק 2".
  const kan: ScrapedShow = {
    source: 'kan',
    key: 'https://www.kan.org.il/content/kan/kan-11/p-1/',
    title: 'מתי נתאהב?',
    catalog: 'iltv_kan11',
    seasons: [
      {
        key: 'k|s1',
        title: 'עונה 1',
        episodes: [
          ep('kan:10', 'הטריילר'),
          ep('kan:11', 'פרק 4 - אהבה פרק ב׳'),
          ep('kan:12', 'פרק 1 - אהבה און ליין'),
          ep('kan:13', 'פרק 2 - שני'),
          ep('kan:14', 'פרק 2 - שני (גרסה מלאה)'),
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
      episodes: ['kan:10', 'kan:11', 'kan:12', 'kan:13', 'kan:14'].map((key, i) => ({
        key,
        season: 1,
        episode: i + 1,
      })),
    },
    undefined,
  );
  // Reshet daily show: one untitled season with episodes over two years, one empty untitled season (101, 102).
  const reshet: ScrapedShow = {
    source: 'reshet',
    key: '/daily',
    title: 'עושים שישי',
    catalog: 'iltv_reshet13',
    seasons: [
      {
        key: '/daily|s1',
        title: '',
        episodes: [ep('r3', 'ג', '2026-01-02'), ep('r1', 'א', '2025-03-01'), ep('r2', 'ב', '2025-12-31')],
      },
      { key: '/daily|s2', title: '', episodes: [] },
    ],
  };
  const reshetId = store.seriesIdFor('reshet', reshet.key);
  store.saveShow(
    reshetId,
    reshet,
    {
      seasons: [
        { key: '/daily|s1', number: 101, kind: 'named' },
        { key: '/daily|s2', number: 102, kind: 'named' },
      ],
      episodes: [
        { key: 'r1', season: 101, episode: 1 },
        { key: 'r2', season: 101, episode: 2 },
        { key: 'r3', season: 101, episode: 3 },
      ],
    },
    '2026-01-02',
  );
  checkNumbering(store); // the history as published so far
  return { dir, store, kanId, reshetId };
}

test('one-time renumber: Kan by its own numbers, Reshet daily seasons by year; once, backed up, guard re-taken', () => {
  const { dir, store, kanId, reshetId } = setup();
  const r = renumberKanReshet(store, join(dir, 'backups'));
  expect(r?.backup && existsSync(r.backup)).toBe(true);
  // Kan: titles' numbers; the duplicate "פרק 2" and the trailer go after, by order; never two the same.
  expect(numbers(store.assignments(kanId))).toEqual({
    'kan:11': '1:4',
    'kan:12': '1:1',
    'kan:13': '1:2',
    'kan:10': '1:5',
    'kan:14': '1:6',
  });
  expect(r?.conflicts).toBe(1);
  expect(store.recentWarnings(10).some((w) => w.code === 'episode-number-taken')).toBe(true);
  // Reshet: 2025 → season 1, 2026 → season 2, episodes by air date.
  const a = store.assignments(reshetId);
  expect(a.seasons.map((s) => [s.key, s.number, s.kind]).sort()).toEqual([
    ['/daily|s1|2025', 1, 'year'],
    ['/daily|s1|2026', 2, 'year'],
  ]);
  expect(numbers(a)).toEqual({ r1: '1:1', r2: '1:2', r3: '2:1' });
  expect(store.getShow(reshetId)?.show.seasons.map((s) => s.title)).toEqual(['2025', '2026']);
  // Once only; and the guard accepts the moves it recorded.
  expect(renumberKanReshet(store, join(dir, 'backups'))).toBeUndefined();
  expect(checkNumbering(store).ok).toBe(true);
});

test('the numbering guard stops a publish that would move a published episode', async () => {
  const { store, kanId } = setup();
  const a = store.assignments(kanId);
  store.replaceAssignments(kanId, {
    seasons: a.seasons,
    episodes: a.episodes.map((e) => (e.key === 'kan:11' ? { ...e, episode: 9 } : e)),
  });
  const g = checkNumbering(store);
  expect(g.ok).toBe(false);
  if (!g.ok) expect(g.examples[0]).toMatch(/kan:11: 1:2 → 1:9/);
  const lines: string[] = [];
  const config = parseConfig({
    publisher: { type: 'local', dir: join(mkdtempSync(join(tmpdir(), 'site-')), 'site') },
  });
  expect(await publishSite(store, config, (l) => lines.push(l))).toBe(false);
  expect(lines.join('\n')).toMatch(/numbering guard: 1 published episode numbers would move/);
  expect(store.lastRun('publish', 'local')?.status).toBe('failed');
});

test('named seasons move below 101 (lowest free, list order), episodes keep their numbers; empty ones unnumbered', async () => {
  const { renumberNamedSeasons } = await import('../src/renumber.ts');
  const dir = mkdtempSync(join(tmpdir(), 'named-'));
  const store = Store.open(join(dir, 'israel-tv.sqlite'));
  const s = (key: string, title: string, eps: string[]) => ({
    key,
    title,
    episodes: eps.map((k) => ep(k, k, '2024-01-01')),
  });
  // Masterchef shape: named seasons listed around 11 and 12.
  const mc: ScrapedShow = {
    source: 'mako',
    key: '/mc',
    title: 'מאסטר שף',
    catalog: 'iltv_keshet12',
    seasons: [
      s('vip', 'VIP 2022', ['v1', 'v2']),
      s('s11', 'עונה 11', ['a']),
      s('dream', 'נבחרת החלומות', ['d1']),
      s('s12', 'עונה 12', ['b']),
    ],
  };
  const mcId = store.seriesIdFor('mako', mc.key);
  store.saveShow(
    mcId,
    mc,
    {
      seasons: [
        { key: 'vip', number: 101, kind: 'named' },
        { key: 's11', number: 11, kind: 'numbered' },
        { key: 'dream', number: 102, kind: 'named' },
        { key: 's12', number: 12, kind: 'numbered' },
      ],
      episodes: [
        { key: 'v1', season: 101, episode: 3 },
        { key: 'v2', season: 101, episode: 7 },
        { key: 'a', season: 11, episode: 1 },
        { key: 'd1', season: 102, episode: 1 },
        { key: 'b', season: 12, episode: 1 },
      ],
    },
    undefined,
  );
  // Reshet: an empty duplicate "עונה 1" (101) and "עונת 2023/2024" seasons that were named.
  const rs: ScrapedShow = {
    source: 'reshet',
    key: '/rs',
    title: 'x',
    catalog: 'iltv_reshet13',
    seasons: [
      s('r1', 'עונה 1', ['e1']),
      s('dup', 'עונה 1', []),
      s('y23', 'עונת 2023', ['f1']),
      s('y24', 'עונת 2024', ['g1']),
    ],
  };
  const rsId = store.seriesIdFor('reshet', rs.key);
  store.saveShow(
    rsId,
    rs,
    {
      seasons: [
        { key: 'r1', number: 1, kind: 'numbered' },
        { key: 'dup', number: 101, kind: 'named' },
        { key: 'y23', number: 102, kind: 'named' },
        { key: 'y24', number: 103, kind: 'named' },
      ],
      episodes: [
        { key: 'e1', season: 1, episode: 1 },
        { key: 'f1', season: 102, episode: 1 },
        { key: 'g1', season: 103, episode: 2 },
      ],
    },
    undefined,
  );
  checkNumbering(store);
  const r = renumberNamedSeasons(store, join(dir, 'backups'));
  expect(r).toMatchObject({ shows: 2, seasons: 4, episodes: 5, emptyDropped: 1 });
  expect(r?.backup && existsSync(r.backup)).toBe(true);
  const mcA = store.assignments(mcId);
  expect(Object.fromEntries(mcA.seasons.map((x) => [x.key, x.number]))).toEqual({
    vip: 1,
    s11: 11,
    dream: 2,
    s12: 12,
  });
  expect(numbers(mcA)).toEqual({ v1: '1:3', v2: '1:7', a: '11:1', d1: '2:1', b: '12:1' });
  const rsA = store.assignments(rsId);
  expect(Object.fromEntries(rsA.seasons.map((x) => [x.key, `${x.kind}:${x.number}`]))).toEqual({
    r1: 'numbered:1',
    y23: 'year:2',
    y24: 'year:3',
  });
  expect(numbers(rsA)).toEqual({ e1: '1:1', f1: '2:1', g1: '3:2' });
  expect(renumberNamedSeasons(store, join(dir, 'backups'))).toBeUndefined();
  expect(checkNumbering(store).ok).toBe(true);
});
