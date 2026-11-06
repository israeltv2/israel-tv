import type { StatusFile } from '@israel-tv/core';
import { expect, test } from 'vitest';
import { type RenderShow, renderSite } from '../src/render.ts';

const status: StatusFile = { generatedAt: 'now', health: 'ok', sources: [], failingShows: [], warnings: [] };

function show(id: string, latestAirDate: string, extra: Partial<RenderShow> = {}): RenderShow {
  return {
    seriesId: id,
    catalog: 'iltv_keshet12',
    title: `show ${id}`,
    latestAirDate,
    latestEpisodeSeenAt: null,
    state: 'listed',
    tmdbId: null,
    imdbId: null,
    show: {
      source: 'mako',
      key: `/${id}`,
      title: `show ${id}`,
      catalog: 'iltv_keshet12',
      seasons: [
        {
          key: 'vip',
          title: 'VIP 5',
          episodes: [{ key: `${id}-a`, title: 'גמר', airDate: latestAirDate, streams: [] }],
        },
        {
          key: 's2',
          title: 'עונה 2',
          episodes: [
            {
              key: `${id}-b`,
              title: 'פתיחה',
              streams: [{ url: 'https://cdn.example/b.m3u8', kind: 'direct' }],
            },
            {
              key: `${id}-c`,
              title: 'רק דרך הרזולבר',
              streams: [{ url: 'https://x.example/c', kind: 'resolver' }],
            },
          ],
        },
      ],
    },
    seasons: [
      { key: 'vip', number: 101, kind: 'named' },
      { key: 's2', number: 2, kind: 'numbered' },
    ],
    episodes: [
      { key: `${id}-a`, season: 101, episode: 1 },
      { key: `${id}-b`, season: 2, episode: 1 },
      { key: `${id}-c`, season: 2, episode: 2 },
    ],
    ...extra,
  };
}

const base = { version: '1.0.0', live: [], status, registry: {}, catalogWarnings: {} };
const read = (files: Map<string, string>, p: string) => JSON.parse(files.get(p) ?? 'null');

test('catalog is newest first and paged by 100', () => {
  const shows = Array.from({ length: 150 }, (_, i) =>
    show(`iltv_mako_${i + 1}`, `2026-01-${String((i % 28) + 1).padStart(2, '0')}`),
  );
  const files = renderSite({ ...base, shows });
  const page1 = read(files, 'catalog/series/iltv_keshet12.json').metas;
  const page2 = read(files, 'catalog/series/iltv_keshet12/skip-100.json').metas;
  expect(page1.length).toBe(100);
  expect(page2.length).toBe(50);
  expect(page1[0].releaseInfo).toBe('2026');
  expect(page1[0].id).not.toBe(page2[0].id);
  expect(read(files, 'manifest.json').catalogs.map((c: { id: string }) => c.id)).toEqual(['iltv_keshet12']);
});

test('meta: named seasons are labelled, ids are series:season:episode', () => {
  const files = renderSite({ ...base, shows: [show('iltv_mako_1', '2026-11-05')] });
  const meta = read(files, 'meta/series/iltv_mako_1.json').meta;
  expect(meta.videos.map((v: { id: string; title: string }) => [v.id, v.title])).toEqual([
    ['iltv_mako_1:2:1', 'פתיחה'],
    ['iltv_mako_1:2:2', 'רק דרך הרזולבר'],
    ['iltv_mako_1:101:1', 'VIP 5 · גמר'],
  ]);
});

test('only direct streams are published, one file per season', () => {
  const files = renderSite({ ...base, shows: [show('iltv_mako_1', '2026-11-05')] });
  const s2 = read(files, 'streams/iltv_mako_1/2.json');
  expect(Object.keys(s2)).toEqual(['1']);
  expect(s2['1'][0].url).toBe('https://cdn.example/b.m3u8');
  expect(files.has('streams/iltv_mako_1/101.json')).toBe(false);
});

test('external ids map only numbered seasons', () => {
  const files = renderSite({
    ...base,
    shows: [show('iltv_reshet_1', '2026-11-05', { imdbId: 'tt123', tmdbId: 9 })],
  });
  expect(read(files, 'ext-ids.json')).toEqual({
    tt123: { id: 'iltv_reshet_1', seasons: [2] },
    'tmdb:9': { id: 'iltv_reshet_1', seasons: [2] },
  });
});

test('delisted shows keep their meta but leave catalogs and search', () => {
  const files = renderSite({ ...base, shows: [show('iltv_mako_1', '2026-11-05', { state: 'delisted' })] });
  expect(files.has('meta/series/iltv_mako_1.json')).toBe(true);
  expect(read(files, 'search.json')).toEqual([]);
});

test('a catalog warning is the first, labelled item of its row', () => {
  const files = renderSite({
    ...base,
    shows: [show('iltv_mako_1', '2026-11-05')],
    catalogWarnings: { iltv_keshet12: 'Mako: last full run failed' },
  });
  const metas = read(files, 'catalog/series/iltv_keshet12.json').metas;
  expect(metas[0]).toMatchObject({ id: 'iltv_status_iltv_keshet12', name: '⚠ Mako: last full run failed' });
  expect(files.has('meta/series/iltv_status_iltv_keshet12.json')).toBe(true);
});
