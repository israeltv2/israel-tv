import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScrapedShow } from '@israel-tv/core';
import { Store } from '@israel-tv/store';
import { expect, test, vi } from 'vitest';
import { cleanStaleWarnings, STALE_WARNINGS } from '../src/cleanup.ts';

test('stale-warnings: each kind removed only where it is shown stale; true notes stay; runs once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cleanup-'));
  const store = Store.open(join(dir, 'israel-tv.sqlite'));
  const ep = (key: string) => ({ key, title: key, streams: [] });
  // Reshet lists its seasons twice, the copy empty: the copy "wanted" 2 at the first run.
  const reshet: ScrapedShow = {
    source: 'reshet',
    key: '/all-shows/under-investigation/',
    title: 'שקשוקה',
    catalog: 'iltv_reshet13',
    seasons: [
      { key: 'r|s2', title: 'עונה 2', episodes: [ep('1_a')] },
      { key: 'r|עונה 2', title: 'עונה 2', episodes: [] },
    ],
  };
  const rid = store.seriesIdFor('reshet', reshet.key);
  store.saveShow(
    rid,
    reshet,
    {
      seasons: [{ key: 'r|s2', number: 2, kind: 'numbered' }],
      episodes: [{ key: '1_a', season: 2, episode: 1 }],
    },
    undefined,
  );
  const kan: ScrapedShow = {
    source: 'kan',
    key: 'https://www.kan.org.il/content/kan/kan-11/p-1/',
    title: 'כאן',
    catalog: 'iltv_kan11',
    seasons: [{ key: 'k|s1', title: 'עונה 1', episodes: [ep('kan:22')] }],
  };
  const kid = store.seriesIdFor('kan', kan.key);
  store.saveShow(
    kid,
    kan,
    {
      seasons: [{ key: 'k|s1', number: 1, kind: 'numbered' }],
      episodes: [{ key: 'kan:22', season: 1, episode: 1 }],
    },
    undefined,
  );
  store.setState('kan:crawl', {
    shows: { [kan.key]: { removed: ['https://www.kan.org.il/content/kan/kan-11/p-1/33/'] } },
  });
  const w = (seriesId: string | null, code: string, message: string) =>
    store.addWarnings(null, seriesId, [{ code, message }]);
  w(rid, 'season-number-taken', 'season "עונה 2" (r|עונה 2) wants 2, already used; numbered as named');
  w(rid, 'season-number-taken', 'season "עונה 9" (r|s9) wants 9, already used; numbered as named'); // not shown stale
  w(
    null,
    'source-note',
    'Kan https://www.kan.org.il/content/kan/kan-11/p-1/: could not copy its image (HTTP 403)',
  );
  w(null, 'source-note', 'שקשוקה | באדיבות כאן חינוכית: listed, but its page has no episodes');
  w(null, 'source-note', 'ויטרינה: no episode list on the show page (only Base, PaginationArray)');
  w(
    kid,
    'source-note',
    'Kan episode https://www.kan.org.il/content/kan/kan-11/p-1/22/: no player (try 1 of 3)',
  );
  w(
    kid,
    'source-note',
    'Kan episode https://www.kan.org.il/content/kan/kan-11/p-1/33/: no player (try 1 of 3)',
  );
  w(
    kid,
    'source-note',
    'Kan episode https://www.kan.org.il/content/kan/kan-11/p-1/44/: no player (try 1 of 3)',
  );
  w(rid, 'tmdb-duplicate', 'שקשוקה: TMDB 1 already matched to iltv_mako_1; not assigned');
  // Later notes (createdAt is per call): the newer ones are the latest for their show or page.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 60_000);
  w(null, 'source-note', 'ויטרינה: its page lists no videos');
  w(
    kid,
    'source-note',
    'Kan episode https://www.kan.org.il/content/kan/kan-11/p-1/44/: no player (try 2 of 3)',
  );

  const dry = cleanStaleWarnings(store, dir, { dryRun: true });
  expect(dry?.backup).toBeUndefined();
  expect(store.recentWarnings(50)).toHaveLength(11);
  const r = cleanStaleWarnings(store, dir);
  expect(r?.backup && existsSync(r.backup)).toBe(true);
  expect(r?.tmdbRecheck).toEqual([rid]);
  const left = store
    .recentWarnings(50)
    .map((x) => x.message)
    .sort();
  expect(left).toEqual([
    'Kan episode https://www.kan.org.il/content/kan/kan-11/p-1/44/: no player (try 2 of 3)',
    'season "עונה 9" (r|s9) wants 9, already used; numbered as named',
    'ויטרינה: its page lists no videos',
  ]);
  expect(store.getState<string[]>('numbering:migrations')).toContain(STALE_WARNINGS);
  expect(cleanStaleWarnings(store, dir)).toBeUndefined();
  vi.useRealTimers();
});
