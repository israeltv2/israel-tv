import { expect, test } from 'vitest';
import { createAddonApp } from '../src/app.ts';

const files: Record<string, unknown> = {
  'manifest.json': { id: 'community.israel-tv' },
  'catalog/series/iltv_keshet12.json': { metas: [{ id: 'iltv_mako_1' }] },
  'meta/series/iltv_mako_1.json': { meta: { id: 'iltv_mako_1' } },
  'catalog/series/iltv_reshet13/skip-100.json': { metas: [{ id: 'iltv_reshet_101' }] },
  'search.json': [
    ['iltv_mako_1', 'series', 'iltv_keshet12', 'מאסטר שף', 'מאסטר שפ', 'https://img/p.jpg'],
    ['iltv_reshet_1', 'series', 'iltv_reshet13', 'מאסטר שף ילדים', 'מאסטר שפ ילדימ', ''],
  ],
  'streams/iltv_reshet_1/2.json': { '5': [{ url: 'https://cdn/x.m3u8' }] },
  'ext-ids.json': { tt42: { id: 'iltv_reshet_1', seasons: [2] } },
  'streams/iltv_live_kan11.json': { streams: [{ url: 'https://live/kan11.m3u8' }] },
};
const app = createAddonApp({ read: async (p) => (p in files ? JSON.stringify(files[p]) : undefined) });
const get = async (path: string) => {
  const r = await app.request(path);
  return {
    status: r.status,
    cors: r.headers.get('access-control-allow-origin'),
    body: (await r.json()) as never,
  };
};

test('plain files with CORS', async () => {
  const r = await get('/manifest.json');
  expect(r).toMatchObject({ status: 200, cors: '*', body: { id: 'community.israel-tv' } });
  expect((await get('/meta/series/iltv_mako_1.json')).body).toEqual({ meta: { id: 'iltv_mako_1' } });
});

test('search is per catalog and Hebrew-normalized (final letters)', async () => {
  const r = await get(`/catalog/series/iltv_keshet12/search=${encodeURIComponent('מאסטר שף')}.json`);
  expect(r.body).toEqual({
    metas: [
      {
        id: 'iltv_mako_1',
        type: 'series',
        name: 'מאסטר שף',
        poster: 'https://img/p.jpg',
        posterShape: 'landscape',
      },
    ],
  });
});

test("Stremio's skip=N URL reads the stored skip-N page", async () => {
  expect((await get('/catalog/series/iltv_reshet13/skip=100.json')).body).toEqual({
    metas: [{ id: 'iltv_reshet_101' }],
  });
});

test('paging past the end returns an empty list', async () => {
  expect((await get('/catalog/series/iltv_keshet12/skip=100.json')).body).toEqual({ metas: [] });
});

test('streams by our id, by IMDb id (numbered seasons only) and live', async () => {
  expect((await get('/stream/series/iltv_reshet_1:2:5.json')).body).toEqual({
    streams: [{ url: 'https://cdn/x.m3u8' }],
  });
  expect((await get('/stream/series/tt42:2:5.json')).body).toEqual({
    streams: [{ url: 'https://cdn/x.m3u8' }],
  });
  expect((await get('/stream/series/tt42:101:5.json')).body).toEqual({ streams: [] });
  expect((await get('/stream/series/tt999:1:1.json')).body).toEqual({ streams: [] });
  expect((await get('/stream/tv/iltv_live_kan11.json')).body).toEqual({
    streams: [{ url: 'https://live/kan11.m3u8' }],
  });
});
