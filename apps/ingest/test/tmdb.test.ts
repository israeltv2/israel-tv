import type { ScrapedShow } from '@israel-tv/core';
import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import { matchShows, pickMatch, type TmdbResult } from '../src/tmdb.ts';

const r = (id: number, name: string, country = 'IL', original_name = name): TmdbResult => ({
  id,
  name,
  original_name,
  origin_country: [country],
});

test('only one exact Israeli match is accepted', () => {
  expect(pickMatch('פאודה', [r(1, 'פאודה'), r(2, 'פאודה 2')])?.id).toBe(1);
  expect(pickMatch('פאודה', [r(1, 'Fauda', 'IL', 'פאודה')])?.id).toBe(1);
  expect(pickMatch('הישרדות', [r(1, 'Survivor', 'US', 'Survivor')])).toBeUndefined();
  expect(pickMatch('חדשות', [r(1, 'חדשות'), r(2, 'חדשות')])).toBeUndefined();
});

test('matches are stored with the IMDb id; misses are not searched again', async () => {
  const store = Store.open(':memory:');
  const show = (key: string, title: string): ScrapedShow => ({
    source: 'reshet',
    key,
    title,
    catalog: 'iltv_reshet13',
    seasons: [{ key: 's', title: 'עונה 1', episodes: [{ key: `${key}e`, title: 'e', streams: [] }] }],
  });
  for (const [k, t] of [
    ['/a', 'פאודה'],
    ['/b', 'משהו אחר'],
  ] as const) {
    const id = store.seriesIdFor('reshet', k);
    store.saveShow(
      id,
      show(k, t),
      {
        seasons: [{ key: 's', number: 1, kind: 'numbered' }],
        episodes: [{ key: `${k}e`, season: 1, episode: 1 }],
      },
      undefined,
    );
  }
  const calls: string[] = [];
  const get = async (url: string) => {
    calls.push(url);
    if (url.includes('/external_ids')) return { imdb_id: 'tt4565380' };
    if (url.includes('/tv/61186?'))
      return {
        name: 'Fauda',
        original_name: 'פאודה',
        alternative_titles: { results: [{ title: 'Fauda' }, { title: 'Chaos' }] },
      };
    return {
      results:
        url.includes(encodeURIComponent('פאודה')) || url.includes('%D7%A4%D7%90%D7%95%D7%93%D7%94')
          ? [r(61186, 'פאודה')]
          : [],
    };
  };
  expect(await matchShows(store, 'k', { get, delayMs: 0 })).toEqual({ checked: 2, matched: 1 });
  expect(store.getShow('iltv_reshet_1')).toMatchObject({ tmdbId: 61186, imdbId: 'tt4565380' });
  // Its other names, for search: English and alternative titles, not its own Hebrew name again.
  expect(store.getState('tmdb:aliases')).toEqual({ iltv_reshet_1: ['Fauda', 'Chaos'] });
  calls.length = 0;
  expect(await matchShows(store, 'k', { get, delayMs: 0 })).toEqual({ checked: 0, matched: 0 });
  expect(calls).toEqual([]);
});

test("a matched show's Hebrew details: genres, a Hebrew overview only, first and last air year", async () => {
  const { parseDetails } = await import('../src/tmdb.ts');
  expect(
    parseDetails({
      genres: [{ name: 'דרמה' }, { name: 'מלחמה ופוליטיקה' }],
      overview: 'יחידת מסתערבים בשטחים.',
      first_air_date: '2015-02-15',
      last_air_date: '2023-01-20',
    }),
  ).toEqual({
    genres: ['דרמה', 'מלחמה ופוליטיקה'],
    overview: 'יחידת מסתערבים בשטחים.',
    firstYear: '2015',
    lastYear: '2023',
  });
  // No Hebrew overview (TMDB answers "" or another language), no dates: nothing invented.
  expect(parseDetails({ genres: [], overview: '', first_air_date: '' })).toEqual({});
  expect(parseDetails({ overview: 'An English overview only.', first_air_date: '2020-01-01' })).toEqual({
    firstYear: '2020',
    lastYear: '2020',
  });
});

test("matching keeps each matched show's details (in Hebrew); dropped with the match", async () => {
  const store = Store.open(':memory:');
  const id = store.seriesIdFor('reshet', '/a');
  store.saveShow(
    id,
    {
      source: 'reshet',
      key: '/a',
      title: 'פאודה',
      catalog: 'iltv_reshet13',
      seasons: [{ key: 's', title: 'עונה 1', episodes: [{ key: 'e', title: 'e', streams: [] }] }],
    },
    { seasons: [{ key: 's', number: 1, kind: 'numbered' }], episodes: [{ key: 'e', season: 1, episode: 1 }] },
    undefined,
  );
  const calls: string[] = [];
  const get = async (url: string) => {
    calls.push(url);
    if (url.includes('/external_ids')) return { imdb_id: null };
    if (url.includes('/tv/61186?') && url.includes('language=he-IL'))
      return { genres: [{ name: 'דרמה' }], overview: 'יחידת מסתערבים.', first_air_date: '2015-02-15' };
    if (url.includes('/tv/61186?')) return { name: 'Fauda' };
    return { results: [r(61186, 'פאודה')] };
  };
  await matchShows(store, 'k', { get, delayMs: 0 });
  expect(store.getState('tmdb:details')).toEqual({
    [id]: {
      genres: ['דרמה'],
      overview: 'יחידת מסתערבים.',
      firstYear: '2015',
      lastYear: '2015',
      tmdbId: 61186,
      at: expect.any(String),
    },
  });
  // Read once: the next run asks nothing.
  calls.length = 0;
  await matchShows(store, 'k', { get, delayMs: 0 });
  expect(calls).toEqual([]);
  // A show no longer matched keeps no details.
  store.setExternalIds(id, { tmdbId: null, imdbId: null });
  await matchShows(store, 'k', { get: async () => ({ results: [] }), delayMs: 0, recheckDays: -1 });
  expect(store.getState('tmdb:details')).toEqual({});
});

test('two of our shows with one name: the TMDB match goes to the one whose years fit (לאהוב את אנה)', async () => {
  const { nearerShow } = await import('../src/tmdb.ts');
  expect(nearerShow(2008, 2008, 2018)).toBe('a');
  expect(nearerShow(2008, 2018, 2008)).toBe('b');
  expect(nearerShow(2008, 2009, 2008)).toBeUndefined();
  expect(nearerShow(undefined, 2008, 2018)).toBeUndefined();

  const store = Store.open(':memory:');
  const save = (source: 'mako' | 'reshet', key: string, airDate: string) => {
    const id = store.seriesIdFor(source, key);
    store.saveShow(
      id,
      {
        source,
        key,
        title: 'לאהוב את אנה',
        catalog: source === 'mako' ? 'iltv_keshet12' : 'iltv_reshet13',
        seasons: [
          { key: 's', title: 'עונה 1', episodes: [{ key: `${key}e`, title: 'e', airDate, streams: [] }] },
        ],
      },
      {
        seasons: [{ key: 's', number: 1, kind: 'numbered' }],
        episodes: [{ key: `${key}e`, season: 1, episode: 1 }],
      },
      undefined,
    );
    return id;
  };
  const keshet = save('mako', '/to-love-anna', '2018-11-11');
  const get = async (url: string) => {
    if (url.includes('/external_ids')) return { imdb_id: 'tt2314713' };
    if (url.includes('/tv/105361?')) return { name: 'לאהוב את אנה', original_name: 'לאהוב את אנה' };
    return { results: [{ ...r(105361, 'לאהוב את אנה'), first_air_date: '2008-07-01' }] };
  };
  await matchShows(store, 'k', { get, delayMs: 0 });
  expect(store.getShow(keshet)?.tmdbId).toBe(105361); // alone, it is taken
  // Reshet's 2008 drama is read: it is the show TMDB means; Keshet's 2018 show loses the match, nobody is warned.
  const reshet = save('reshet', '/all-shows/loving-anna/', '2008-07-01');
  await matchShows(store, 'k', { get, delayMs: 0 });
  expect(store.getShow(reshet)?.tmdbId).toBe(105361);
  expect(store.getShow(keshet)?.tmdbId).toBeNull();
  expect(store.recentWarnings(10).filter((w) => w.code === 'tmdb-duplicate')).toEqual([]);
  // Keshet's show looked up again later: the years say it is not this one; still no warning.
  store.forgetTmdbCheck(keshet);
  await matchShows(store, 'k', { get, delayMs: 0 });
  expect(store.getShow(keshet)?.tmdbId).toBeNull();
  expect(store.getShow(reshet)?.tmdbId).toBe(105361);
  expect(store.recentWarnings(10).filter((w) => w.code === 'tmdb-duplicate')).toEqual([]);
});
