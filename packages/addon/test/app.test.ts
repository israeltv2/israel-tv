import { expect, test } from 'vitest';
import { createAddonApp } from '../src/app.ts';

const files: Record<string, unknown> = {
  'manifest.json': { id: 'io.github.israeltv2.israel-tv' },
  'catalog/series/iltv_keshet12.json': { metas: [{ id: 'iltv_mako_1' }] },
  'meta/series/iltv_mako_1.json': { meta: { id: 'iltv_mako_1' } },
  'catalog/series/iltv_reshet13.json': {
    metas: Array.from({ length: 100 }, (_, i) => ({ id: `iltv_reshet_${i + 1}` })),
  },
  'catalog/series/iltv_reshet13/skip-100.json': { metas: [{ id: 'iltv_reshet_101' }] },
  'index.html': '<!doctype html><title>Israel TV</title>',
  'search.json': [
    [
      'iltv_mako_1',
      'series',
      'iltv_keshet12',
      'מאסטר שף',
      'מאסטר שפ',
      'https://img/p.jpg',
      ['בישול', 'ריאליטי'],
    ],
    ['iltv_mako_2', 'series', 'iltv_keshet12', 'עובדה', 'עובדה', '', ['תעודה']],
    ['iltv_mako_3', 'series', 'iltv_keshet12', 'משחקי השף', 'משחקי השפ', ''],
    ['iltv_reshet_1', 'series', 'iltv_reshet13', 'מאסטר שף ילדים', 'מאסטר שפ ילדימ', ''],
  ],
  'streams/iltv_reshet_1/2.json': { '5': [{ url: 'https://cdn/x.m3u8' }] },
  'ext-ids.json': { tt42: { id: 'iltv_reshet_1', seasons: [2] } },
  'streams/iltv_live_kan11.json': { streams: [{ url: 'https://live/kan11.m3u8' }] },
};
const app = createAddonApp({
  read: async (p) => {
    const f = files[p];
    return f === undefined ? undefined : typeof f === 'string' ? f : JSON.stringify(f);
  },
});
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
  expect(r).toMatchObject({ status: 200, cors: '*', body: { id: 'io.github.israeltv2.israel-tv' } });
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
        posterShape: 'poster',
        genres: ['בישול', 'ריאליטי'],
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
test('a row that has not been updated for too long says so first, even with the home machine down', async () => {
  const { createAddonApp } = await import('../src/app.ts');
  const old = new Date(Date.now() - 40 * 3_600_000).toISOString();
  const files: Record<string, string> = {
    'catalog/series/iltv_keshet12.json': JSON.stringify({
      metas: [{ id: 'iltv_mako_1', type: 'series', name: 'x' }],
    }),
    'freshness.json': JSON.stringify({ publishedAt: old, sources: {}, catalogs: { iltv_keshet12: 'mako' } }),
  };
  const app = createAddonApp({ read: async (p) => files[p] });
  const row = await (await app.request('/catalog/series/iltv_keshet12.json')).json();
  expect(row.metas[0].id).toBe('iltv_stale_iltv_keshet12');
  expect(row.metas[0].name).toMatch(/^[\u200F\u202B]?⚠ הקטלוג לא עודכן מאז/);
  expect(row.metas[1].id).toBe('iltv_mako_1');
  const meta = await (await app.request('/meta/series/iltv_stale_iltv_keshet12.json')).json();
  expect(meta.meta.name).toMatch(/^[\u200F\u202B]?⚠/);
  // Fresh catalog, but the row's source has had no good read in two days: that row warns.
  files['freshness.json'] = JSON.stringify({
    publishedAt: new Date().toISOString(),
    sources: { mako: { lastGoodAt: new Date(Date.now() - 50 * 3_600_000).toISOString(), cadenceHours: 24 } },
    catalogs: { iltv_keshet12: 'mako' },
  });
  const app2 = createAddonApp({ read: async (p) => files[p] });
  expect((await (await app2.request('/catalog/series/iltv_keshet12.json')).json()).metas[0].id).toMatch(
    /^iltv_stale_/,
  );
  // Up to date: nothing added.
  files['freshness.json'] = JSON.stringify({
    publishedAt: new Date().toISOString(),
    sources: { mako: { lastGoodAt: new Date().toISOString(), cadenceHours: 24 } },
    catalogs: { iltv_keshet12: 'mako' },
  });
  const app3 = createAddonApp({ read: async (p) => files[p] });
  expect((await (await app3.request('/catalog/series/iltv_keshet12.json')).json()).metas).toHaveLength(1);
});

test('a genre filter lists the shows of that genre in the row, in order, a page at a time', async () => {
  expect((await get(`/catalog/series/iltv_keshet12/genre=${encodeURIComponent('תעודה')}.json`)).body).toEqual(
    {
      metas: [{ id: 'iltv_mako_2', type: 'series', name: 'עובדה', posterShape: 'poster', genres: ['תעודה'] }],
    },
  );
  const both = await get(`/catalog/series/iltv_keshet12/genre=${encodeURIComponent('בישול')}&skip=100.json`);
  expect(both.body).toEqual({ metas: [] });
  expect((await get(`/catalog/series/iltv_reshet13/genre=${encodeURIComponent('בישול')}.json`)).body).toEqual(
    {
      metas: [],
    },
  );
});

test('search matches whole words from their start', async () => {
  const q = async (term: string) =>
    (
      (await get(`/catalog/series/iltv_keshet12/search=${encodeURIComponent(term)}.json`)).body as {
        metas: unknown[];
      }
    ).metas.length;
  expect(await q('מאסטר')).toBe(1);
  expect(await q('שפ')).toBe(2); // "שף" is a word of its own, also after a prefix ("השף")
  expect(await q('סטר')).toBe(0); // the middle of a word
});

test('any skip works, not only multiples of the page size', async () => {
  const ids = async (path: string) =>
    ((await get(path)).body as { metas: { id: string }[] }).metas.map((m) => m.id);
  expect(await ids('/catalog/series/iltv_reshet13/skip=50.json')).toEqual([
    ...Array.from({ length: 50 }, (_, i) => `iltv_reshet_${i + 51}`),
    'iltv_reshet_101',
  ]);
  expect(await ids('/catalog/series/iltv_reshet13/skip=99.json')).toEqual([
    'iltv_reshet_100',
    'iltv_reshet_101',
  ]);
  expect(await ids('/catalog/series/iltv_reshet13/skip=1.json')).toHaveLength(100);
  expect(await ids('/catalog/series/iltv_keshet12/skip=20.json')).toEqual([]);
});

test('search finds words with a Hebrew prefix letter', async () => {
  const r = await get(`/catalog/series/iltv_keshet12/search=${encodeURIComponent('שף')}.json`);
  expect((r.body as { metas: { id: string }[] }).metas.map((m) => m.id)).toEqual([
    'iltv_mako_1',
    'iltv_mako_3',
  ]);
});

test('streams only for the declared types', async () => {
  expect((await get('/stream/movie/iltv_reshet_1:2:5.json')).body).toEqual({ streams: [] });
  expect((await get('/stream/tv/iltv_reshet_1:2:5.json')).body).toEqual({ streams: [] });
  expect((await get('/stream/series/iltv_live_kan11.json')).body).toEqual({ streams: [] });
});

test('read-only: other methods get 405 with Allow', async () => {
  const r = await app.request('/manifest.json', { method: 'POST' });
  expect(r.status).toBe(405);
  expect(r.headers.get('allow')).toBe('GET, HEAD');
  expect(await r.text()).toMatch(/read-only/);
});

test('the address itself shows a short page', async () => {
  const r = await app.request('/');
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toMatch(/text\/html/);
});
