import { readFileSync } from 'node:fs';
import { assignNumbers } from '@israel-tv/core';
import type { Fetcher } from '@israel-tv/net';
import { expect, test } from 'vitest';
import { fetchShow } from '../src/client.ts';
import { blockedEntries } from '../src/kaltura.ts';
import { parseAllShows, parseSeasonPage, parseShowPage, playManifestUrl } from '../src/parse.ts';

const html = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8');

function pages(routes: Record<string, string>): Fetcher & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    requests: 0,
    async text(url: string) {
      urls.push(url);
      const name = routes[new URL(url).pathname];
      if (!name) return { status: 404, body: '' };
      return { status: 200, body: html(name) };
    },
    async json() {
      throw new Error('not used');
    },
  };
}

/** Fake Kaltura: every entry on profile 3387861, which blocks. */
const kaltura = async (body: unknown) => {
  const req = (body as Record<string, { action: string; filter?: { idIn: string } }>)['2'];
  if (req?.action === 'list') {
    return [
      { ks: 'x' },
      { objects: (req.filter?.idIn ?? '').split(',').map((id) => ({ id, accessControlId: 3387861 })) },
    ];
  }
  return [{ ks: 'x' }, { actions: [{ objectType: 'KalturaAccessControlBlockAction' }] }];
};

test('all-shows list', () => {
  const shows = parseAllShows(html('all-shows'));
  expect(shows.length).toBeGreaterThanOrEqual(260);
  expect(shows[0]).toMatchObject({ key: '/all-shows/13-in-the-afternoon/', title: '13 בצוהריים' });
});

test('newer template: seasons map with Kaltura entries', () => {
  const p = parseShowPage(html('show-the-voice'));
  expect(p.template).toBe('vod-playlist');
  expect(p.seasons.map((s) => [s.title, s.episodes?.length])).toEqual([['עונה 6', 26]]);
  const last = p.seasons[0]?.episodes?.find((e) => e.key === '1_6yz66w7i');
  expect(last).toMatchObject({
    numberHint: 26,
    airDate: '2026-09-06',
    title: 'הגמר הגדול!',
    durationSec: 5768,
  });
  expect(last?.streams[0]?.url).toBe(playManifestUrl('1_6yz66w7i'));
});

test('older template: season list, current season inline, others on season pages', () => {
  const p = parseShowPage(html('show-kitchen-nightmares'));
  expect(p.template).toBe('program');
  expect(p.seriesId).toBe('150');
  expect(p.seasons.map((s) => [s.title, s.position, s.episodes?.length])).toEqual([
    ['עונה 1', 1, 5],
    ['עונה 2', 2, undefined],
    ['עונה 3', 3, undefined],
    ['עונה 4', 4, undefined],
  ]);
  const s2 = parseSeasonPage(html('kitchen-nightmares-season-2'));
  expect(s2.length).toBe(9);
  expect(s2[0]).toMatchObject({ key: '1_c4y2ye4k', numberHint: 1, title: 'סערה בקפה' });
});

test('fetchShow reads other seasons, marks blocked entries, numbers by season title', async () => {
  const f = pages({
    '/all-shows/kitchen-nightmares-902985891/': 'show-kitchen-nightmares',
    '/allshows/series/150/season/2/': 'kitchen-nightmares-season-2',
  });
  const show = await fetchShow(
    f,
    { key: '/all-shows/kitchen-nightmares-902985891/', title: 'מהפכה במטבח' },
    { kaltura },
  ).catch((e) => e as Error);
  // Seasons 3 and 4 are not recorded: the fake site answers 404, so they are skipped with a note.
  if (show instanceof Error) throw show;
  expect(show.notes?.length).toBe(2);
  expect(show.seasons.map((s) => s.episodes.length)).toEqual([5, 9, 0, 0]);

  const g = pages({
    '/all-shows/kitchen-nightmares-902985891/': 'show-kitchen-nightmares',
    '/allshows/series/150/season/2/': 'kitchen-nightmares-season-2',
    '/allshows/series/150/season/3/': 'kitchen-nightmares-season-2',
    '/allshows/series/150/season/4/': 'kitchen-nightmares-season-2',
  });
  const ok = await fetchShow(
    g,
    { key: '/all-shows/kitchen-nightmares-902985891/', title: 'מהפכה במטבח' },
    { kaltura },
  );
  if (ok instanceof Error) throw ok;
  expect(g.urls.length).toBe(4);
  expect(ok.seasons[0]?.episodes.every((e) => e.availableAbroad === false)).toBe(true);
  expect(ok.seasons[0]?.key).toBe('/all-shows/kitchen-nightmares-902985891/|עונה 1');
  const r = assignNumbers({ ...ok, seasons: ok.seasons.slice(0, 2) }, { seasons: [], episodes: [] });
  expect(r.seasons.map((s) => s.number)).toEqual([1, 2]);
});

test('airing check reads only the show page', async () => {
  const f = pages({ '/all-shows/kitchen-nightmares-902985891/': 'show-kitchen-nightmares' });
  const show = await fetchShow(
    f,
    { key: '/all-shows/kitchen-nightmares-902985891/', title: 'x' },
    { kaltura, currentSeasonOnly: true },
  );
  expect(f.urls.length).toBe(1);
  expect(show.seasons.map((s) => s.episodes.length)).toEqual([5, 0, 0, 0]);
});

test('each Kaltura access profile is checked once', async () => {
  let contexts = 0;
  const post = async (body: unknown) => {
    const req = (body as Record<string, { action: string; filter?: { idIn: string } }>)['2'];
    if (req?.action === 'list') {
      return [
        {},
        {
          objects: (req.filter?.idIn ?? '')
            .split(',')
            .map((id, i) => ({ id, accessControlId: i % 2 ? 1 : 2 })),
        },
      ];
    }
    contexts++;
    return [{}, { actions: contexts === 1 ? [] : [{ objectType: 'KalturaAccessControlBlockAction' }] }];
  };
  const profiles = new Map<number, boolean>();
  const r = await blockedEntries(['a', 'b', 'c', 'd'], profiles, post);
  expect(contexts).toBe(2);
  expect([...r.values()]).toEqual([false, true, false, true]);
  await blockedEntries(['e'], profiles, post);
  expect(contexts).toBe(2);
});

test('a show page without VOD (empty article grid) reads as no seasons, not an error', () => {
  expect(parseShowPage(html('show-empty-show-time'))).toEqual({ template: 'no-vod', seasons: [] });
});
