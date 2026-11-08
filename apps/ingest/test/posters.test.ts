// Series posters: every series row is shaped "poster", every poster we publish is portrait, and no poster address
// is one that is refused outside Israel.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assignNumbers, ConfigSchema, type ScrapedShow } from '@israel-tv/core';
import { Store } from '@israel-tv/store';
import jpeg from 'jpeg-js';
import { expect, test } from 'vitest';
import {
  imageSize,
  isPortrait,
  measurePosters,
  POSTER_H,
  POSTER_W,
  portraitPoster,
  reachableAbroad,
} from '../src/posters.ts';
import { renderFromStore } from '../src/publish.ts';

/** A real JPEG of the given size (a gradient, so resampling has something to do). */
function photo(w: number, h: number): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data.set([(x * 255) / w, (y * 255) / h, 120, 255], (y * w + x) * 4);
  return jpeg.encode({ width: w, height: h, data }, 80).data;
}

test('image sizes are read from the header', () => {
  expect(imageSize(photo(490, 272))).toEqual({ w: 490, h: 272 });
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  png.set([0, 0, 4, 56, 0, 0, 7, 128], 16);
  expect(imageSize(png)).toEqual({ w: 1080, h: 1920 });
  expect(imageSize(new Uint8Array(4000).fill(7))).toBeUndefined();
});

test('a landscape image becomes a 2:3 portrait poster', () => {
  const out = portraitPoster(photo(490, 272));
  expect(imageSize(out)).toEqual({ w: POSTER_W, h: POSTER_H });
  const px = jpeg.decode(out, { useTArray: true });
  expect(px.width).toBe(POSTER_W);
  // The fill above the fitted image is not blank.
  expect(px.data[(20 * POSTER_W + 200) * 4 + 2]).toBeGreaterThan(10);
});

test('remote posters are measured once; only those reachable abroad are fetched', async () => {
  const store = Store.open(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'posters-'));
  const fetched: string[] = [];
  const fake = (async (u: string) => {
    fetched.push(u);
    return new Response(u.includes('wide') ? photo(640, 360) : photo(420, 600));
  }) as unknown as typeof fetch;
  const urls = [
    'https://img.example/tall.jpg',
    'https://img.example/wide.jpg',
    'https://www.kan.org.il/x.jpg',
  ];
  expect(await measurePosters(store, dir, urls, { fetch: fake })).toBe(2);
  expect(await measurePosters(store, dir, urls, { fetch: fake })).toBe(0);
  expect(fetched).toEqual(['https://img.example/tall.jpg', 'https://img.example/wide.jpg']);
  expect(reachableAbroad('https://www.kan.org.il/x.jpg')).toBe(false);
});

function show(source: ScrapedShow['source'], key: string, catalog: string, poster?: string): ScrapedShow {
  return {
    source,
    key,
    title: key,
    catalog,
    ...(poster ? { poster, background: poster } : {}),
    seasons: [
      {
        key: `${key}|s1`,
        title: '',
        episodes: [
          {
            key: `${key}|e1`,
            title: 'e1',
            airDate: '2026-11-05',
            streams: [],
            ...(poster ? { thumbnail: poster } : {}),
          },
        ],
      },
    ],
  };
}

test('every series row is shaped "poster", every poster is portrait and reachable from abroad', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-'));
  const store = Store.open(join(dir, 'israel-tv.sqlite'));
  const shows = [
    show('mako', 'mako-tall', 'iltv_keshet12', 'https://img.example/tall.jpg'),
    show('reshet', 'reshet-wide', 'iltv_reshet13', 'https://img.example/wide.jpg'),
    show('kan', 'kan-wide-copy', 'iltv_kan11', 'https://www.kan.org.il/wide.jpg'),
    show('kan', 'kan-tall-copy', 'iltv_kankids', 'https://www.kan.org.il/tall.jpg'),
    show('kan', 'kan-no-copy', 'iltv_kan11', 'https://www.kan.org.il/none.jpg'),
  ];
  for (const s of shows) {
    const id = store.seriesIdFor(s.source, s.key);
    store.saveShow(id, s, assignNumbers(s, store.assignments(id)).added, '2026-11-05', true);
  }
  // Our copies of two Kan images, as the Kan crawl keeps them: one landscape, one portrait.
  const art = join(dir, 'artwork');
  mkdirSync(art);
  writeFileSync(join(art, 'wide.jpg'), photo(490, 272));
  writeFileSync(join(art, 'tall.jpg'), photo(300, 450));
  const copy = (file: string) => ({
    origin: 'o',
    catalog: 'c',
    pending: [],
    failed: [],
    art: { from: 'x', file },
  });
  store.setState('kan:crawl', {
    shows: { 'kan-wide-copy': copy('wide.jpg'), 'kan-tall-copy': copy('tall.jpg') },
  });
  const fake = (async (u: string) =>
    new Response(u.includes('wide') ? photo(640, 360) : photo(420, 600))) as unknown as typeof fetch;
  await measurePosters(
    store,
    join(dir, 'posters'),
    shows.map((s) => s.poster ?? ''),
    { fetch: fake },
  );
  const config = ConfigSchema.parse({
    store: { path: join(dir, 'israel-tv.sqlite') },
    publisher: { type: 'local' },
  });
  const files = renderFromStore(store, config);

  const remoteSize = (u: string) => (u.includes('wide') ? { w: 640, h: 360 } : { w: 420, h: 600 });
  let checked = 0;
  for (const catalog of ['iltv_keshet12', 'iltv_reshet13', 'iltv_kan11', 'iltv_kankids']) {
    const metas = JSON.parse(String(files.get(`catalog/series/${catalog}.json`))).metas as {
      id: string;
      poster: string;
      posterShape: string;
    }[];
    for (const m of metas) {
      const full = JSON.parse(String(files.get(`meta/series/${m.id}.json`))).meta;
      for (const p of [m, full]) {
        expect(p.posterShape, m.id).toBe('poster');
        expect(reachableAbroad(p.poster), `${m.id} ${p.poster}`).toBe(true);
        const ours = p.poster.startsWith('{{israel-tv-origin}}/')
          ? files.get(p.poster.replace('{{israel-tv-origin}}/', ''))
          : undefined;
        const size = ours instanceof Uint8Array ? imageSize(ours) : remoteSize(p.poster);
        expect(size && isPortrait(size), `${m.id} poster ${p.poster} is not portrait`).toBe(true);
      }
      // Background and thumbnails are never addresses refused abroad either.
      expect(!full.background || reachableAbroad(full.background)).toBe(true);
      for (const v of full.videos) expect(!v.thumbnail || reachableAbroad(v.thumbnail)).toBe(true);
      checked++;
    }
  }
  expect(checked).toBe(5);
  // The publisher's own audit agrees, and says so on /status.
  const audit = JSON.parse(String(files.get('status.json'))).audit;
  expect(audit).toMatchObject({ metas: 5, problems: [] });
  expect(String(files.get('status.html'))).toContain('Catalog check');
  expect(String(files.get('he/status.html'))).toContain('בדיקת הקטלוג');
  // The no-copy Kan show shows the placeholder; the landscape ones got their own portrait poster.
  const id = (key: string) =>
    store.findSeriesId(shows.find((s) => s.key === key)?.source ?? 'kan', key) ?? '';
  const meta = (key: string) => JSON.parse(String(files.get(`meta/series/${id(key)}.json`))).meta;
  expect(meta('kan-no-copy').poster).toBe('{{israel-tv-origin}}/art/placeholder-poster.jpg');
  expect(files.get('art/placeholder-poster.jpg')).toBeInstanceOf(Uint8Array);
  expect(meta('kan-wide-copy').poster).toBe(`{{israel-tv-origin}}/art/${id('kan-wide-copy')}-poster.jpg`);
  expect(meta('kan-wide-copy').background).toBe(`{{israel-tv-origin}}/art/${id('kan-wide-copy')}.jpg`);
  expect(meta('kan-tall-copy').poster).toBe(`{{israel-tv-origin}}/art/${id('kan-tall-copy')}.jpg`);
  expect(meta('reshet-wide').poster).toBe(`{{israel-tv-origin}}/art/${id('reshet-wide')}-poster.jpg`);
  expect(meta('reshet-wide').background).toBe('https://img.example/wide.jpg');
  expect(meta('mako-tall').poster).toBe('https://img.example/tall.jpg');
});

test('what the image audit found: stock posters, missing backdrops, square tiles stretched, blank row notices', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-'));
  const store = Store.open(join(dir, 'israel-tv.sqlite'));
  const still = (s: ScrapedShow, day: string, thumbnail: string): ScrapedShow => ({
    ...s,
    seasons: [
      {
        key: `${s.key}|s1`,
        title: '',
        episodes: [
          ...(s.seasons[0]?.episodes ?? []),
          { key: `${s.key}|${day}`, title: day, airDate: day, streams: [], thumbnail },
        ],
      },
    ],
  });
  const noBackdrop = ({ background: _, ...s }: ScrapedShow): ScrapedShow => s;
  const shows = [
    // Reshet's own "default poster" stand-in, and no backdrop: the newest episode's still is the backdrop.
    still(
      noBackdrop(
        show(
          'reshet',
          'reshet-stock',
          'iltv_reshet13',
          'https://media.reshet.tv/x/Deafult_poster_image_black.jpg',
        ),
      ),
      '2026-11-06',
      'https://img.example/newest.jpg',
    ),
    // A Kan show whose copy is a small square tile (its own image refused abroad).
    show('kan', 'kan-square', 'iltv_kankids', 'https://www.kan.org.il/sq.jpg'),
  ];
  for (const s of shows) {
    const id = store.seriesIdFor(s.source, s.key);
    store.saveShow(id, s, assignNumbers(s, store.assignments(id)).added, '2026-11-05', true);
  }
  mkdirSync(join(dir, 'artwork'));
  writeFileSync(join(dir, 'artwork', 'sq.jpg'), photo(200, 200));
  store.setState('kan:crawl', {
    shows: {
      'kan-square': {
        origin: 'o',
        catalog: 'c',
        pending: [],
        failed: [],
        art: { from: 'x', file: 'sq.jpg' },
      },
    },
  });
  const config = ConfigSchema.parse({
    store: { path: join(dir, 'israel-tv.sqlite') },
    publisher: { type: 'local' },
  });
  const files = renderFromStore(store, config);
  const id = (s: ScrapedShow) => store.findSeriesId(s.source, s.key) ?? '';
  const meta = (s: ScrapedShow) => JSON.parse(String(files.get(`meta/series/${id(s)}.json`))).meta;
  const [stock, square] = shows as [ScrapedShow, ScrapedShow];
  expect(meta(stock).poster).toBe('{{israel-tv-origin}}/art/placeholder-poster.jpg');
  expect(meta(stock).background).toBe('https://img.example/newest.jpg');
  expect(meta(stock).videos.map((v: { thumbnail?: string }) => v.thumbnail)).not.toContain(
    'https://media.reshet.tv/x/Deafult_poster_image_black.jpg',
  );
  // The square copy is its poster's source, never its backdrop or every episode's still.
  expect(meta(square).background).toBeUndefined();
  expect(meta(square).videos.every((v: { thumbnail?: string }) => !v.thumbnail)).toBe(true);
  // A row's notice (Kan kids still filling, here) is a tile with the generic poster, never a blank one.
  for (const [path, body] of files) {
    if (!path.startsWith('catalog/') || typeof body !== 'string') continue;
    for (const m of JSON.parse(body).metas as { id: string; poster?: string }[])
      expect(m.poster, `${path} ${m.id}`).toBeTruthy();
  }
});

test('the local publisher serves our posters and the placeholder', async () => {
  const { localAddonApp } = await import('../src/local-server.ts');
  const dir = mkdtempSync(join(tmpdir(), 'local-'));
  mkdirSync(join(dir, 'art'));
  for (const f of ['iltv_kan_1-poster.jpg', 'placeholder-poster.jpg'])
    writeFileSync(join(dir, 'art', f), photo(4, 6));
  const app = localAddonApp(dir);
  for (const f of ['iltv_kan_1-poster.jpg', 'placeholder-poster.jpg'])
    expect((await app.request(`/art/${f}`)).headers.get('content-type'), f).toBe('image/jpeg');
});

test('hidden shows and sources leave everything published, without touching their ids', async () => {
  const store = Store.open(':memory:');
  for (const s of [
    show('mako', 'm1', 'iltv_keshet12'),
    show('mako', 'm2', 'iltv_keshet12'),
    show('reshet', 'r1', 'iltv_reshet13'),
  ]) {
    const id = store.seriesIdFor(s.source, s.key);
    store.saveShow(id, s, assignNumbers(s, store.assignments(id)).added, '2026-11-05', true);
  }
  const config = ConfigSchema.parse({
    publisher: { type: 'local' },
    sources: { kan: false },
    hide: { shows: ['iltv_mako_2'], sources: ['reshet', 'live'] },
  });
  const files = renderFromStore(store, config);
  const all = [...files.keys()];
  expect(files.has('meta/series/iltv_mako_1.json')).toBe(true);
  expect(
    all.filter((p) => p.includes('iltv_mako_2') || p.includes('iltv_reshet_') || p.includes('iltv_live_')),
  ).toEqual([]);
  expect(String(files.get('search.json'))).not.toContain('iltv_mako_2');
  const catalogs = JSON.parse(String(files.get('manifest.json'))).catalogs.map((c: { id: string }) => c.id);
  expect(catalogs).toEqual(['iltv_keshet12']);
  expect(store.findSeriesId('mako', 'm2')).toBe('iltv_mako_2'); // still known: the same id if it comes back
});

test('the catalog audit flags what a viewer should never see', async () => {
  const { auditSite } = await import('../src/catalog-audit.ts');
  const meta = {
    id: 'iltv_mako_9',
    type: 'series',
    name: 'שם - פרקים מלאים לצפייה ישירה',
    poster: 'https://www.kan.org.il/p.jpg',
    posterShape: 'landscape',
    description: '%%excerpt%% טקסט',
    releaseInfo: '2024–',
    videos: [
      { id: 'iltv_mako_9:101:1', title: 'א', season: 101, episode: 1 },
      { id: 'iltv_mako_9:101:1', title: 'ב &amp; ג', season: 101, episode: 1 },
    ],
  };
  const files = new Map<string, string | Uint8Array>([
    ['manifest.json', '{}'],
    [
      'catalog/series/iltv_keshet12.json',
      JSON.stringify({ metas: [{ ...meta, name: 'אחר', videos: undefined }] }),
    ],
    ['meta/series/iltv_mako_9.json', JSON.stringify({ meta })],
  ]);
  const checks = auditSite(files, Store.open(':memory:')).problems.map((p) => p.check);
  for (const c of [
    'series shown with a non-poster shape',
    'poster refused outside Israel',
    'season numbered 101 or more',
    'two episodes with one number',
    'site text in an episode title',
    'empty name or site text in a name',
    'site text in a description',
    'year line not "2024", "2021–2024" or "2024–present"',
    'row item differs from its show page',
  ])
    expect(checks, c).toContain(c);
});

test('the catalog audit flags page-title boilerplate left on a show name', async () => {
  const { auditSite } = await import('../src/catalog-audit.ts');
  const files = (name: string) =>
    new Map<string, string | Uint8Array>([
      ['manifest.json', '{}'],
      [
        'meta/series/iltv_kan_9.json',
        JSON.stringify({ meta: { id: 'iltv_kan_9', name, posterShape: 'poster' } }),
      ],
    ]);
  const checks = (name: string) =>
    auditSite(files(name), Store.open(':memory:')).problems.map((p) => p.check);
  expect(checks('מבט שני | כתבות מלאות')).toContain('page-title boilerplate in a name');
  expect(checks('ארץ זרה | סרטו התיעודי של העיתונאי שלומי אלדר')).not.toContain(
    'page-title boilerplate in a name',
  );
});

test('the catalog audit counts, per source, shows without genres, a description of their own or a year line', async () => {
  const { auditSite } = await import('../src/catalog-audit.ts');
  const { MAKO_HELPER_NOTE } = await import('@israel-tv/render');
  const meta = (id: string, m: Record<string, unknown>) => [
    `meta/series/${id}.json`,
    JSON.stringify({ meta: { id, name: 'שם', posterShape: 'poster', ...m } }),
  ];
  const files = new Map<string, string | Uint8Array>([
    ['manifest.json', '{}'],
    meta('iltv_mako_1', { description: `‫${MAKO_HELPER_NOTE}‬`, releaseInfo: '2024' }),
    meta('iltv_mako_2', { description: `סדרה על משהו.\n\n${MAKO_HELPER_NOTE}`, genres: ['דרמה'] }),
    meta('iltv_kan_1', { description: 'תכנית על משהו', genres: ['ילדים'], releaseInfo: '2020–2022' }),
  ] as [string, string][]);
  expect(auditSite(files, Store.open(':memory:')).gaps).toEqual([
    { source: 'kan', shows: 1, noGenre: 0, noDescription: 0, noYear: 0 },
    { source: 'mako', shows: 2, noGenre: 1, noDescription: 1, noYear: 1 },
  ]);
});
