import { readFileSync } from 'node:fs';
import { assignNumbers } from '@israel-tv/core';
import type { Fetcher } from '@israel-tv/net';
import { expect, test } from 'vitest';
import { fetchShow } from '../src/client.ts';
import { blockedEntries } from '../src/kaltura.ts';
import {
  episodeThumb,
  parseAllShows,
  parseSeasonPage,
  parseShowPage,
  playManifestUrl,
} from '../src/parse.ts';

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
  expect(ok.seasons[0]?.key).toBe('/all-shows/kitchen-nightmares-902985891/|s1');
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
  expect(parseShowPage(html('show-empty-show-time'))).toMatchObject({ template: 'no-vod', seasons: [] });
});

test('a promotional page with no video on it is a show without VOD', () => {
  expect(parseShowPage(html('show-promo-free-hour'))).toMatchObject({
    template: 'no-vod',
    seasons: [],
    note: expect.stringMatching(/no episode list/),
  });
});

test('older template: air dates from the titles, numbers by date when the source counts newest = 1', async () => {
  const { assignNumbers } = await import('@israel-tv/core');
  const p = parseShowPage(html('show-13-in-the-afternoon'));
  const eps = p.seasons[0]?.episodes ?? [];
  expect(eps.length).toBe(36);
  expect(eps[0]?.airDate).toBe('2024-04-21');
  expect(eps.at(-1)?.airDate).toBe('2024-03-03');
  const r = assignNumbers(
    {
      source: 'reshet',
      key: '/x',
      title: 'x',
      catalog: 'iltv_reshet13',
      seasons: [{ key: 's', title: '', episodes: eps }],
    },
    { seasons: [], episodes: [] },
  );
  expect(r.episodes.find((e) => e.key === eps.at(-1)?.key)?.episode).toBe(1); // 03.03.24, the oldest
  expect(r.episodes.find((e) => e.key === eps[0]?.key)?.episode).toBe(36);
  expect(r.warnings.map((w) => w.code)).toContain('numbers-reversed');
});

test('the Israel-only access profile is labelled even when the check passes (ingest inside Israel)', async () => {
  const post = async (body: unknown) => {
    const req = (body as Record<string, { action: string; filter?: { idIn: string } }>)['2'];
    if (req?.action === 'list')
      return [
        {},
        {
          objects: [
            { id: 'a', accessControlId: 3387861 },
            { id: 'b', accessControlId: 7 },
          ],
        },
      ];
    return [{}, { actions: [] }];
  };
  const r = await blockedEntries(['a', 'b'], new Map(), post);
  expect([...r]).toEqual([
    ['a', true],
    ['b', false],
  ]);
});

test('genres come from the episodes’ Kaltura tags (older template)', () => {
  expect(parseShowPage(html('show-kitchen-nightmares')).genres).toEqual(['בישול']); // "אוכל" on Reshet, one name with Keshet's
  expect(parseShowPage(html('show-the-voice')).genres).toBeUndefined();
});

test('a show has its own blurb from the page', () => {
  expect(parseShowPage(html('show-kitchen-nightmares')).description).toMatch(/^השף אסף גרניט/);
  expect(parseShowPage(html('show-kitchen-nightmares')).description).not.toMatch(/&quot;|&amp;/);
});

test('untitled seasons among several become one season per air year, episodes by date, no printed numbers', async () => {
  const { untitledSeasonsByYear } = await import('../src/parse.ts');
  const e = (key: string, airDate: string) => ({ key, title: key, airDate, numberHint: 3, streams: [] });
  const show = {
    source: 'reshet' as const,
    key: '/d',
    title: 'd',
    catalog: 'iltv_reshet13',
    seasons: [
      { key: 'a', title: 'עונה 2', episodes: [e('t1', '2023-01-01')] },
      {
        key: 'b',
        title: '',
        episodes: [e('x2', '2025-05-01'), e('x1', '2024-02-01'), e('x0', '2024-01-01')],
      },
      { key: 'c', title: '', episodes: [] },
    ],
  };
  const out = untitledSeasonsByYear(show);
  expect(out.seasons.map((s) => [s.key, s.title, s.episodes.map((x) => x.key)])).toEqual([
    ['a', 'עונה 2', ['t1']],
    ['b|2024', '2024', ['x0', 'x1']],
    ['b|2025', '2025', ['x2']],
  ]);
  expect(out.seasons[1]?.episodes[0]?.numberHint).toBeUndefined();
  expect(out.seasons[0]?.episodes[0]?.numberHint).toBe(3);
  // A show whose only season is untitled stays one season.
  const single = { ...show, seasons: [show.seasons[1] as (typeof show.seasons)[number]] };
  expect(untitledSeasonsByYear(single)).toBe(single);
});

test('an episode whose Kaltura entry is gone keeps its place but offers no stream, and says so', async () => {
  const f = pages({ '/all-shows/kitchen-nightmares-902985891/': 'show-kitchen-nightmares' });
  let dropped = '';
  const withOneGone = async (body: unknown) => {
    const req = (body as Record<string, { action: string; filter?: { idIn: string } }>)['2'];
    if (req?.action === 'list') {
      const ids = (req.filter?.idIn ?? '').split(',');
      dropped = ids[0] ?? '';
      return [{ ks: 'x' }, { objects: ids.slice(1).map((id) => ({ id, accessControlId: 3387861 })) }];
    }
    return kaltura(body);
  };
  const show = await fetchShow(
    f,
    { key: '/all-shows/kitchen-nightmares-902985891/', title: 'x' },
    { kaltura: withOneGone, currentSeasonOnly: true },
  );
  const eps = show.seasons.flatMap((s) => s.episodes);
  expect(eps.find((e) => e.key === dropped)?.streams).toEqual([]);
  expect(eps.filter((e) => e.key !== dropped).every((e) => e.streams.length === 1)).toBe(true);
  expect(show.notes?.join(' ')).toMatch(/1 episodes no longer exist/);
});

test('a show split by year before stays split when one read sees a single untitled season', async () => {
  const { splitKeys, untitledSeasonsByYear } = await import('../src/parse.ts');
  const e = (key: string, airDate: string) => ({ key, title: key, airDate, streams: [] });
  const stored = {
    source: 'reshet' as const,
    key: '/d',
    title: 'd',
    catalog: 'iltv_reshet13',
    seasons: [
      { key: '/d|s1|2025', title: '2025', episodes: [e('a', '2025-01-01')] },
      { key: '/d|s1|2026', title: '2026', episodes: [e('b', '2026-01-01')] },
    ],
  };
  const read = {
    ...stored,
    seasons: [
      {
        key: '/d|s1',
        title: '',
        episodes: [e('c', '2026-02-01'), e('b', '2026-01-01'), e('a', '2025-01-01')],
      },
    ],
  };
  expect([...splitKeys(stored)]).toEqual(['/d|s1']);
  expect(untitledSeasonsByYear(read).seasons.map((s) => s.key)).toEqual(['/d|s1']); // unknown: stays single
  const out = untitledSeasonsByYear(read, splitKeys(stored));
  expect(out.seasons.map((s) => [s.key, s.episodes.map((x) => x.key)])).toEqual([
    ['/d|s1|2025', ['a']],
    ['/d|s1|2026', ['b', 'c']],
  ]);
  // Data already holding the split and the folded season merges, without duplicates.
  const folded = {
    ...stored,
    seasons: [
      read.seasons[0] as (typeof read.seasons)[number],
      { ...stored.seasons[0], episodes: [] },
      { ...stored.seasons[1], episodes: [] },
    ],
  };
  expect(
    untitledSeasonsByYear(folded as typeof stored, splitKeys(folded as typeof stored)).seasons.map((s) => [
      s.key,
      s.episodes.length,
    ]),
  ).toEqual([
    ['/d|s1|2025', 1],
    ['/d|s1|2026', 2],
  ]);
});

test('Kaltura episode stills are asked for at 640×360 (the service sends 120×90 otherwise)', () => {
  const bare = 'https://images.frp1.ott.kaltura.com/Service.svc/GetImage/p/5031/entry_id/c66b6e24/version/10';
  expect(episodeThumb(bare)).toBe(`${bare}/width/640/height/360`);
  expect(episodeThumb(`${bare}/width/300/height/200`)).toBe(`${bare}/width/300/height/200`);
  const cloudinary = 'https://media3.reshet.tv/image/upload/t_new_grid_item/v1/uploads/2025/9.jpg';
  expect(episodeThumb(cloudinary)).toBe(cloudinary);
  expect(episodeThumb(undefined)).toBeUndefined();
});

test('a show with an empty page description takes its Kaltura blurb, and its 16x9 picture as the background', () => {
  const p = parseShowPage(html('show-friday'));
  expect(p.description).toBe('תוכנית חדשות ואקטואליה המשודרת בימי שישי בערוץ 13');
  expect(p.background).toMatch(/\/Service\.svc\/GetImage\/.*\/width\/1280\/height\/720$/);
});
