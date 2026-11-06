import { readFileSync } from 'node:fs';
import { assignNumbers } from '@israel-tv/core';
import type { Fetcher } from '@israel-tv/net';
import { describe, expect, test } from 'vitest';
import { fetchIndex, fetchPlaylist, fetchShow } from '../src/client.ts';
import { episodesFromPage, parseIndex, parseShowPage, showArtwork } from '../src/parse.ts';

const fx = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

/** Serves recorded responses by URL path; fails on anything not recorded. */
function fixtureFetcher(routes: Record<string, string>): Fetcher & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    requests: 0,
    async text() {
      throw new Error('not used');
    },
    async json<T>(url: string) {
      urls.push(url);
      const u = new URL(url);
      const name = routes[u.pathname];
      if (!name) throw new Error(`no fixture for ${u.pathname}`);
      return fx(name) as T;
    },
  };
}

test('index: 663 shows with unique keys', () => {
  const idx = parseIndex(fx('index'));
  expect(idx.length).toBe(663);
  expect(new Set(idx.map((e) => e.key)).size).toBe(idx.length);
  expect(idx[0]).toMatchObject({ key: '/mako-vod-channel2-news/main-newscast', title: 'המהדורה המרכזית' });
});

test('season page: the ad slot is dropped and numbers come from extraInfo', () => {
  const eps = episodesFromPage(parseShowPage(fx('season-masterchef-s12')));
  expect(eps.length).toBe(34);
  expect(eps[0]).toMatchObject({
    title: 'פרק הבכורה',
    numberHint: 1,
    airDate: '2025-08-25',
    availableAbroad: true,
  });
  expect(eps[0]?.play).toEqual({
    vcmid: '104ae678fefd8910VgnVCM200000650a10acRCRD',
    channelId: '8d62263f127c8910VgnVCM100000700a10acRCRD',
    galleryChannelId: '104ae678fefd8910VgnVCM200000650a10acRCRD',
  });
});

test('daily news: no printed numbers, dates come from the title', () => {
  const eps = episodesFromPage(parseShowPage(fx('show-main-newscast')));
  expect(eps.length).toBe(132); // 133 slots, one is an ad
  expect(eps.every((e) => e.numberHint === undefined && e.airDate)).toBe(true);
});

describe('fetchShow + numbering on recorded shows', () => {
  test('Masterchef: named seasons take the lowest free numbers in list order, numbered keep theirs', async () => {
    const f = fixtureFetcher({
      '/mako-vod-keshet/masterchef': 'show-masterchef',
      '/mako-vod-keshet/masterchef-s12': 'season-masterchef-s12',
      // Older seasons not recorded: serve the s12 page shape to keep the test offline.
      '/mako-vod-keshet/masterchef-vip_2022': 'season-masterchef-s12',
      '/mako-vod-keshet/masterchef-s11': 'season-masterchef-s12',
      '/mako-vod-keshet/masterchef-dream_team': 'season-masterchef-s12',
    });
    const show = await fetchShow(f, { key: '/mako-vod-keshet/masterchef', title: 'מאסטר שף' });
    expect(f.urls.length).toBe(5); // show page (= current season) + 4 older seasons
    const r = assignNumbers(show, { seasons: [], episodes: [] });
    expect(r.seasons.map((s) => [s.key.split('/').pop(), s.number])).toEqual([
      ['masterchef-vip_2022', 1],
      ['masterchef-s11', 11],
      ['masterchef-dream_team', 2],
      ['masterchef-s12', 12],
      ['masterchef-dream_team_2', 3],
    ]);
    expect(show.description).toContain('נבחרת החלומות');
  });

  test('airing check fetches only the show page', async () => {
    const f = fixtureFetcher({ '/mako-vod-keshet/mkr_israel': 'show-mkr_israel' });
    const show = await fetchShow(
      f,
      { key: '/mako-vod-keshet/mkr_israel', title: 'x' },
      { currentSeasonOnly: true },
    );
    expect(f.urls.length).toBe(1);
    const current = show.seasons.find((s) => s.episodes.length > 0);
    expect(current?.key).toBe('/mako-vod-keshet/mkr_israel-vip5');
    // An airing check reads only shows already stored (first reads are full): the older seasons keep their numbers
    // and the current one keeps its own. Listed newest first at the source; numbers still come from "פרק N".
    const stored = {
      seasons: show.seasons
        .filter((s) => s.key !== current?.key)
        .map((s, i) => ({ key: s.key, number: i + 1, kind: 'named' as const })),
      episodes: [],
    };
    const r = assignNumbers(show, stored);
    expect(r.seasons.find((s) => s.key === current?.key)?.number).toBe(5);
    expect(
      r.episodes
        .filter((e) => e.season === 5)
        .map((e) => e.episode)
        .sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('Uvda: year seasons from titles', async () => {
    const page = parseShowPage(fx('show-uvda'));
    const f = fixtureFetcher({ '/mako-vod-keshet/uvda': 'show-uvda' });
    const show = await fetchShow(
      f,
      { key: '/mako-vod-keshet/uvda', title: 'עובדה' },
      { currentSeasonOnly: true },
    );
    // As a full read sees it (every season with episodes; this fixture has only the current season's).
    const full = {
      ...show,
      seasons: show.seasons.map((s) =>
        s.episodes.length ? s : { ...s, episodes: [{ key: `${s.key}-e`, title: 'e', streams: [] }] },
      ),
    };
    const r = assignNumbers(full, { seasons: [], episodes: [] });
    expect(page.seasons?.length).toBe(20);
    // Year seasons are numbered by position, oldest = 1 (by the year in the title, not the page url).
    const s2025 = r.seasons.find((s) => s.key.endsWith('uvda-2024'))?.number ?? 0;
    const s2024 = r.seasons.find((s) => s.key.endsWith('uvda-swords_of_iron'))?.number ?? 0;
    expect(s2025).toBe(s2024 + 1);
    const years = r.seasons.filter((s) => s.kind === 'year').map((s) => s.number);
    expect([...years].sort((a, b) => a - b)).toEqual(years.map((_, i) => i + 1));
    expect(Math.max(...r.seasons.map((s) => s.number))).toBeLessThan(1900);
  });
});

test('playlist: Akamai and CloudFront HLS urls', async () => {
  const f = fixtureFetcher({ '/AjaxPage': 'playlist-masterchef-s12-e1' });
  const media = await fetchPlaylist(f, { vcmid: 'v', channelId: 'c' });
  expect(media.map((m) => m.cdn)).toEqual(['AKAMAI', 'AWS']);
  expect(media[0]?.url).toMatch(/^https:\/\/mako-vod\.akamaized\.net\/.*master\.m3u8$/);
  expect(f.urls[0]).toContain('jspName=playlist.jsp');
});

test('index fetch goes to the responsive endpoint', async () => {
  const f = fixtureFetcher({ '/mako-vod-index': 'index' });
  expect((await fetchIndex(f)).length).toBe(663);
  expect(f.urls[0]).toBe('https://www.mako.co.il/mako-vod-index?platform=responsive');
});

test('a dead season link is skipped with a note instead of failing the show', async () => {
  const f = fixtureFetcher({ '/mako-vod-keshet/masterchef': 'show-masterchef' });
  const g = {
    ...f,
    async json<T>(url: string): Promise<T> {
      if (new URL(url).pathname === '/mako-vod-keshet/masterchef') return f.json<T>(url);
      const { HttpError } = await import('@israel-tv/net');
      throw new HttpError(url, 404);
    },
  };
  const show = await fetchShow(g, { key: '/mako-vod-keshet/masterchef', title: 'מאסטר שף' });
  expect(show.notes?.length).toBe(4);
  expect(show.seasons.find((s) => s.episodes.length > 0)?.key).toBe(
    '/mako-vod-keshet/masterchef-dream_team_2',
  );
});

test('daily-show seasons with a bare date in extraInfo are dated and numbered oldest first', () => {
  const eps = episodesFromPage(parseShowPage(fx('season-morning-news-2026')));
  expect(eps.length).toBe(212);
  expect(eps.every((e) => e.airDate)).toBe(true);
  expect(eps[0]).toMatchObject({ airDate: '2026-11-05' });
  const r = assignNumbers(
    {
      source: 'mako',
      key: '/m',
      title: 'm',
      catalog: 'iltv_keshet12',
      seasons: [{ key: 's', title: 'עונה 2026', episodes: eps }],
    },
    { seasons: [], episodes: [] },
  );
  const first = r.episodes.find((e) => e.key === eps.at(-1)?.key);
  const latest = r.episodes.find((e) => e.key === eps[0]?.key);
  expect(first?.episode).toBe(1); // "פותחים את שנת 2026", 01.01.26
  expect(latest?.episode).toBe(212);
});

test('genres come from the show page schema, cleaned of repeats', () => {
  expect(showArtwork(parseShowPage(fx('show-masterchef'))).genres).toEqual(['בישול', 'ריאליטי']);
  expect(showArtwork(parseShowPage(fx('show-main-newscast'))).genres).toEqual(['אקטואליה', 'חדשות']);
});
