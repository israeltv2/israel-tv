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
const text = (files: Map<string, string | Uint8Array>, p: string) => String(files.get(p) ?? 'null');
const read = (files: Map<string, string | Uint8Array>, p: string) => JSON.parse(text(files, p));

test('catalog is newest first and paged by 100', () => {
  const shows = Array.from({ length: 150 }, (_, i) =>
    show(`iltv_mako_${i + 1}`, `2026-01-${String((i % 28) + 1).padStart(2, '0')}`),
  );
  const files = renderSite({ ...base, sources: ['mako'], shows });
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

test('external ids map numbered seasons, not named ones', () => {
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

test('an external id held by two series is published for neither', () => {
  const files = renderSite({
    ...base,
    shows: [
      show('iltv_mako_1', '2026-11-05', { imdbId: 'tt42' }),
      show('iltv_reshet_1', '2026-11-05', { imdbId: 'tt42' }),
    ],
  });
  expect(read(files, 'ext-ids.json')).toEqual({});
});

test('a running source whose row has no shows yet is listed, saying it is loading', () => {
  const files = renderSite({ ...base, sources: ['mako', 'kan'], shows: [show('iltv_mako_1', '2026-11-05')] });
  const manifest = read(files, 'manifest.json');
  expect(manifest.catalogs.map((c: { id: string }) => c.id)).toEqual([
    'iltv_keshet12',
    'iltv_kan11',
    'iltv_kankids',
  ]);
  const row = read(files, 'catalog/series/iltv_kankids.json');
  expect(row.metas[0].name).toMatch(/^⏳/);
});

test('logo and background are in the manifest only when their images are there, as origin-relative URLs', () => {
  const none = read(renderSite({ ...base, shows: [] }), 'manifest.json');
  expect(none.logo).toBeUndefined();
  const png = new Uint8Array([137, 80, 78, 71]);
  const files = renderSite({
    ...base,
    shows: [],
    assets: new Map([
      ['logo.png', png],
      ['background.jpg', png],
    ]),
  });
  const m = read(files, 'manifest.json');
  expect(m.logo).toBe('{{israel-tv-origin}}/logo.png');
  expect(m.background).toBe('{{israel-tv-origin}}/background.jpg');
  expect(files.get('logo.png')).toBe(png);
});

test('play files carry what a resolver needs per episode', () => {
  const s = show('iltv_mako_1', '2026-11-05');
  const mako = s.show.seasons[0]?.episodes[0];
  if (mako) mako.play = { vcmid: 'v', channelId: 'c' };
  const files = renderSite({ ...base, shows: [s] });
  const season = s.seasons[0]?.number ?? 1;
  const play = read(files, `play/iltv_mako_1/${season}.json`);
  expect(Object.values(play)[0]).toMatchObject({ mako: { vcmid: 'v', channelId: 'c' } });
});

test('contract: what the catalog publishes for resolvers fits the versioned contract', async () => {
  const { CONTRACT, ContractSchema, SeasonPlaySchema, ExtIdsSchema } = await import('@israel-tv/core');
  const s = show('iltv_mako_1', '2026-11-05');
  const mako = s.show.seasons[0]?.episodes[0];
  if (mako) mako.play = { vcmid: 'v', channelId: 'c', galleryChannelId: 'g' };
  const files = renderSite({ ...base, shows: [s] });
  expect(ContractSchema.parse(read(files, 'resolver-contract.json'))).toEqual(CONTRACT);
  for (const [path] of files) if (path.startsWith('play/')) SeasonPlaySchema.parse(read(files, path));
  ExtIdsSchema.parse(read(files, 'ext-ids.json'));
});

test('contract: fields added within a version are ignored by a resolver, not refused', async () => {
  const { SeasonPlaySchema, ExtIdsSchema } = await import('@israel-tv/core');
  expect(
    SeasonPlaySchema.safeParse({ '1': { mako: { vcmid: 'v', channelId: 'c', extra: 1 }, subtitles: 'x' } })
      .success,
  ).toBe(true);
  expect(ExtIdsSchema.safeParse({ tt1: { id: 'iltv_mako_1', seasons: [1], title: 'x' } }).success).toBe(true);
});

/** A show with one year season per given year, numbered by position (as numbering does), episodes on those dates. */
function yearShow(dates: string[], extra: Partial<RenderShow> = {}): RenderShow {
  const years = [...new Set(dates.map((d) => d.slice(0, 4)))].sort();
  return show('iltv_mako_54', dates.at(-1) ?? '', {
    show: {
      source: 'mako',
      key: '/babyboom',
      title: 'בייבי בום',
      catalog: 'iltv_keshet12',
      genres: ['תעודה'],
      seasons: years.map((y) => ({
        key: `y${y}`,
        title: `עונה ${y}`,
        episodes: dates
          .filter((d) => d.startsWith(y))
          .map((d, i) => ({ key: `${d}-${i}`, title: 'הלידה הדרמטית', airDate: d, streams: [] })),
      })),
    },
    seasons: years.map((y, i) => ({ key: `y${y}`, number: i + 1, kind: 'year' as const })),
    episodes: years.flatMap((y, i) =>
      dates
        .filter((d) => d.startsWith(y))
        .map((d, j) => ({ key: `${d}-${j}`, season: i + 1, episode: j + 1 })),
    ),
    ...extra,
  });
}

test('year seasons: numbers 1, 2 in ids, no year in episode titles, mapped for other addons', () => {
  const files = renderSite({
    ...base,
    shows: [yearShow(['2024-03-01', '2026-01-10'], { imdbId: 'tt5', tmdbId: 7 })],
  });
  const meta = read(files, 'meta/series/iltv_mako_54.json').meta;
  expect(meta.videos.map((v: { id: string; title: string }) => [v.id, v.title])).toEqual([
    ['iltv_mako_54:1:1', 'הלידה הדרמטית'],
    ['iltv_mako_54:2:1', 'הלידה הדרמטית'],
  ]);
  expect(read(files, 'ext-ids.json').tt5).toEqual({ id: 'iltv_mako_54', seasons: [1, 2] });
});

test('releaseInfo is first to last episode year, or one year; never open-ended', () => {
  const info = (dates: string[]) =>
    read(renderSite({ ...base, shows: [yearShow(dates)] }), 'catalog/series/iltv_keshet12.json').metas[0]
      .releaseInfo;
  expect(info(['2024-03-01', '2026-10-20'])).toBe('2024–2026');
  expect(info(['2023-03-01', '2023-05-01'])).toBe('2023');
  expect(info(['2026-09-01'])).toBe('2026');
  expect(info(['2024-03-01', '2026-10-20'])).not.toMatch(/–$/);
});

test('genres and the IMDb id are published; each row offers its genres as a filter', () => {
  const files = renderSite({ ...base, shows: [yearShow(['2024-03-01'], { imdbId: 'tt5' })] });
  const preview = read(files, 'catalog/series/iltv_keshet12.json').metas[0];
  expect(preview).toMatchObject({ genres: ['תעודה'], imdb_id: 'tt5', posterShape: 'poster' });
  expect(read(files, 'meta/series/iltv_mako_54.json').meta).toMatchObject({
    genres: ['תעודה'],
    imdb_id: 'tt5',
  });
  // One show of a genre makes no filter; two do.
  const row = read(files, 'manifest.json').catalogs.find((c: { id: string }) => c.id === 'iltv_keshet12');
  expect(row.extra.some((e: { name: string }) => e.name === 'genre')).toBe(false);
  const two = renderSite({
    ...base,
    shows: [yearShow(['2024-03-01']), { ...yearShow(['2025-03-01']), seriesId: 'iltv_mako_55' }],
  });
  const row2 = read(two, 'manifest.json').catalogs.find((c: { id: string }) => c.id === 'iltv_keshet12');
  expect(row2.extra).toContainEqual({ name: 'genre', options: ['תעודה'] });
  expect(read(files, 'search.json')[0][6]).toEqual(['תעודה']);
});

test('the manifest carries the version it is given and a short description in plain words', () => {
  const files = renderSite({
    ...base,
    version: '0.2.0',
    sources: ['mako', 'reshet', 'kan', 'live'],
    shows: [],
  });
  const m = read(files, 'manifest.json');
  expect(m.version).toBe('0.2.0');
  expect(m.description).toBe(
    'Israeli TV shows and live channels from Keshet 12, Reshet 13 and Kan. Keshet 12 needs your own home helper; some shows play only in Israel.',
  );
  expect(m.description.length).toBeLessThan(160);
});

test('live channels: the logo is the logo, the backdrop is a real background picture', () => {
  const assets = new Map([['background.jpg', new Uint8Array([1])]]);
  const live = [
    {
      id: 'iltv_live_kan11',
      name: 'כאן 11',
      logo: '{{israel-tv-origin}}/logos/iltv_live_kan11.png',
      streams: [],
    },
  ];
  const meta = read(renderSite({ ...base, assets, live, shows: [] }), 'meta/tv/iltv_live_kan11.json').meta;
  expect(meta.logo).toBe('{{israel-tv-origin}}/logos/iltv_live_kan11.png');
  expect(meta.background).toBe('{{israel-tv-origin}}/background.jpg');
});

test('search finds a show by its other names (English from TMDB) too, and still shows its own name', () => {
  const files = renderSite({
    ...base,
    shows: [show('iltv_mako_2', '2026-11-05', { aliases: ['MasterChef Israel'] })],
  });
  const row = read(files, 'search.json')[0];
  expect(row[3]).toBe('show iltv_mako_2');
  expect(row[4]).toContain('masterchef');
});

test('an untitled named season adds nothing to episode titles; titles and texts are tidied', () => {
  const base2 = show('iltv_reshet_183', '2026-11-05');
  const files = renderSite({
    ...base,
    shows: [
      {
        ...base2,
        title: 'עושים שישי',
        show: {
          ...base2.show,
          title: 'עושים שישי',
          description: 'תכנית אקטואליה שבועית&amp;nbsp;',
          seasons: [
            {
              key: 'u',
              title: '',
              episodes: [
                { key: 'x', title: 'עושים שישי 06.11.26 - התכנית המלאה', airDate: '2026-11-06', streams: [] },
              ],
            },
          ],
        },
        seasons: [{ key: 'u', number: 101, kind: 'named' }],
        episodes: [{ key: 'x', season: 101, episode: 1 }],
      },
    ],
  });
  const meta = read(files, 'meta/series/iltv_reshet_183.json').meta;
  expect(meta.videos[0].title).toBe('06.11.26');
  expect(meta.description).toBe('תכנית אקטואליה שבועית');
});
