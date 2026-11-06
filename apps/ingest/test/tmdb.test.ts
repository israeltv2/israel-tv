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
