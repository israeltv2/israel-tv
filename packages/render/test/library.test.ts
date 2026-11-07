import { type GuideFile, type StatusFile, sitePaths } from '@israel-tv/core';
import { describe, expect, test } from 'vitest';
import { channelGuide, EPISODES_PER_SEASON, plain, renderLibrary } from '../src/library-html.ts';
import { sized } from '../src/page.ts';
import { type RenderInput, type RenderShow, renderSite } from '../src/render.ts';

function show(
  id: string,
  catalog: string,
  source: 'mako' | 'reshet' | 'kan',
  episodes: number,
  extra: Partial<RenderShow['show']> = {},
): RenderShow {
  const eps = Array.from({ length: episodes }, (_, i) => ({
    key: `${id}-${i}`,
    title: `פרק ${i + 1}`,
    airDate: `2026-${String(1 + (i % 9)).padStart(2, '0')}-01`,
    streams: [],
  }));
  return {
    seriesId: id,
    catalog,
    title: `תוכנית ${id}`,
    latestAirDate: '2026-11-01',
    latestEpisodeSeenAt: null,
    state: 'listed',
    tmdbId: null,
    imdbId: null,
    show: {
      source,
      key: `/${id}`,
      title: id,
      catalog,
      seasons: [{ key: 's1', title: 'עונה 1', episodes: eps }],
      ...extra,
    },
    seasons: [{ key: 's1', number: 1, kind: 'numbered' }],
    episodes: eps.map((e, i) => ({ key: e.key, season: 1, episode: i + 1 })),
  };
}

const status: StatusFile = {
  generatedAt: '2026-11-07T06:00:00Z',
  health: 'ok',
  sources: [],
  failingShows: [],
  warnings: [],
};

const H = 3_600_000;
const T0 = Date.parse('2026-11-07T04:00:00Z');
const guide: GuideFile = {
  iltv_live_kan11: [
    [T0, T0 + H, 'חדשות הבוקר'],
    [T0 + H, T0 + 2 * H, 'סדרה <טובה>'],
    [T0 + 60 * H, T0 + 61 * H, 'בעוד יומיים'],
  ],
};

const input = (now: number): RenderInput => ({
  version: '1.0.0',
  now,
  shows: [
    show('iltv_mako_1', 'iltv_keshet12', 'mako', 3, {
      description: 'תוכנית על <משהו>',
      pageUrl: 'https://www.mako.co.il/show-1',
      poster: 'https://img.mako.co.il/p1.jpg',
      genres: ['ריאליטי'],
    }),
    show('iltv_reshet_1', 'iltv_reshet13', 'reshet', EPISODES_PER_SEASON + 20, {
      poster: 'https://media3.reshet.tv/image/upload/v1/uploads/p.jpg',
    }),
  ],
  live: [
    { id: 'iltv_live_kan11', name: 'כאן 11', streams: [{ url: 'https://x.example/a.m3u8' }] },
    { id: 'iltv_live_keshet12', name: 'קשת 12', streams: [] },
  ],
  guide,
  status,
  registry: {},
  catalogWarnings: {},
  sources: ['mako', 'reshet', 'live'],
  publicUrl: 'https://addon.example.dev',
});

describe('the library pages', () => {
  const files = renderSite(input(Date.parse('2026-11-07T09:00:00Z')));
  const page = (p: string) => String(files.get(p));

  test('a front page, a page per row with shows, a page per show, live and search', () => {
    for (const p of [
      sitePaths.library,
      sitePaths.libraryRow('keshet12'),
      sitePaths.libraryRow('reshet13'),
      sitePaths.showPage('iltv_mako_1'),
      sitePaths.showPage('iltv_reshet_1'),
      sitePaths.livePage,
      sitePaths.searchPage,
    ])
      expect(files.has(p), p).toBe(true);
    // A row with nothing in it has no page.
    expect([...files.keys()].some((p) => p.startsWith('library/kan'))).toBe(false);
  });

  test('everything that navigates is a real link: the channel and genre chips, the genre filters, whole episode rows', () => {
    const showPage = page(sitePaths.showPage('iltv_mako_1'));
    // The channel chip links to its row; no navigation hangs on a script.
    expect(showPage).toMatch(/<ul class="facts"><li dir="auto"><a href="\/library\/keshet12\/">/);
    expect(showPage).not.toMatch(/onclick=|href="#"|href="javascript:/);
    // Each episode title's link covers its whole row (still included).
    expect(showPage).toContain('.ep h3 a::after{content:"";position:absolute;inset:0');
    const two = input(Date.parse('2026-11-07T09:00:00Z'));
    two.shows.push(show('iltv_mako_2', 'iltv_keshet12', 'mako', 2, { genres: ['ריאליטי'] }));
    const row = String(renderSite(two).get(sitePaths.libraryRow('keshet12')));
    expect(row).not.toContain('<button class="chip"');
    expect(row).toMatch(/<a class="chip" href="\/library\/keshet12\/\?g=[^"]+" data-g=/);
  });

  test('icons and arrows read right to left: chevrons drawn with physical borders, directional icons mirrored', () => {
    const html = page(sitePaths.showPage('iltv_mako_1'));
    // A mirrored character ("‹") would draw the other way in Hebrew; the separator is drawn and rotated per direction.
    expect(html).not.toContain('content:"‹"');
    expect(html).toContain('[dir=rtl] .crumbs li+li::before{transform:rotate(135deg)}');
    // The disclosure arrow uses physical borders, so the RTL rotation is not applied on top of a flipped shape.
    expect(html).toMatch(/details>summary::before\{content:"";width:8px;height:8px;border-right:2px/);
    expect(html).toContain('[dir=rtl] .flip{transform:scaleX(-1)}');
  });

  test('pages are Hebrew, right to left, with the show’s own title, description and canonical address', () => {
    const html = page(sitePaths.showPage('iltv_mako_1'));
    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain('<title>תוכנית iltv_mako_1: לצפייה בכל הפרקים | Israel TV</title>');
    expect(html).toContain('<link rel="canonical" href="{{israel-tv-origin}}/show/iltv_mako_1/">');
    expect(html).toContain('תוכנית על &#60;משהו&#62;');
    expect(html).not.toContain('<משהו>');
    // The app-only note about the home helper is not repeated as the description.
    expect(html).not.toContain('איך מתקינים: github.com');
  });

  test('a show page links to the app, to the episode, and to the broadcaster’s own page', () => {
    const html = page(sitePaths.showPage('iltv_mako_1'));
    expect(html).toContain('href="stremio:///detail/series/iltv_mako_1"');
    expect(html).toContain('href="stremio:///detail/series/iltv_mako_1/iltv_mako_1%3A1%3A1"');
    expect(html).toContain('href="https://www.mako.co.il/show-1"');
    expect(html).toContain('לצפייה באתר של קשת 12');
    expect(html).toContain('העוזר הביתי');
  });

  test('structured data: TVSeries with its seasons, and the breadcrumb', () => {
    const html = page(sitePaths.showPage('iltv_mako_1'));
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)?.[1] ?? '{}');
    const series = ld['@graph'][0];
    expect(series['@type']).toBe('TVSeries');
    expect(series.numberOfEpisodes).toBe(3);
    expect(series.genre).toEqual(['ריאליטי']);
    expect(series.containsSeason[0].episode[0]['@type']).toBe('TVEpisode');
    expect(ld['@graph'][1]['@type']).toBe('BreadcrumbList');
  });

  test('a long season lists its newest episodes and says how many more the app has', () => {
    const html = page(sitePaths.showPage('iltv_reshet_1'));
    expect(html.match(/<li class="ep">/g)?.length).toBe(EPISODES_PER_SEASON);
    expect(html).toContain('ועוד 20 פרקים באפליקציה');
    // Reshet's images are asked for at the size shown.
    expect(html).toContain('/image/upload/w_520,c_limit,f_auto,q_auto/v1/uploads/p.jpg');
  });

  test('the live page: every channel, its guide for the script, and BroadcastService data', () => {
    const html = page(sitePaths.livePage);
    expect(html).toContain(`data-s="${T0}" data-e="${T0 + H}"`);
    expect(html).toContain('סדרה &#60;טובה&#62;');
    // Only the guide's first day and a half.
    expect(html).not.toContain('בעוד יומיים');
    expect(html).toContain('"@type":"BroadcastService"');
    expect(html).toContain('href="stremio:///detail/tv/iltv_live_kan11"');
    expect(html).toContain('עוזר ביתי');
  });

  test('the pages do not depend on the moment they are rendered (unchanged files are not uploaded again)', () => {
    const later = renderSite(input(Date.parse('2026-11-07T21:00:00Z')));
    for (const p of [
      sitePaths.library,
      sitePaths.livePage,
      sitePaths.showPage('iltv_mako_1'),
      sitePaths.landing,
      sitePaths.landingHe,
    ])
      expect(later.get(p), p).toBe(files.get(p));
  });

  test('the sitemap lists every library page; the landing page has the on-air strip', () => {
    const map = page(sitePaths.sitemap);
    expect(map).toContain('<loc>{{israel-tv-origin}}/show/iltv_reshet_1/</loc>');
    expect(map).toContain('<loc>{{israel-tv-origin}}/library/keshet12/</loc>');
    expect(map).toContain('<loc>{{israel-tv-origin}}/live/</loc>');
    const landing = page(sitePaths.landing);
    expect(landing).toContain('class="lower"');
    // Two posters are too few for a wall: none is drawn.
    expect(landing).not.toContain('class="wall"');
    expect(landing).toContain('href="/library/"');
  });
});

test('renderLibrary alone: no guide, no live page section errors', () => {
  const files = renderLibrary({ rows: [], live: [] });
  expect([...files.keys()].sort()).toEqual([sitePaths.library, sitePaths.searchPage].sort());
});

test('channelGuide cuts by the guide’s own start, not by the clock', () => {
  expect(channelGuide(guide, 'iltv_live_kan11').map((r) => r[2])).toEqual(['חדשות הבוקר', 'סדרה <טובה>']);
  expect(channelGuide(undefined, 'x')).toEqual([]);
});

test('sized: the broadcasters’ image services resize; other images are left as they are', () => {
  expect(sized('https://media3.reshet.tv/image/upload/v1/a.jpg', 300)).toBe(
    'https://media3.reshet.tv/image/upload/w_300,c_limit,f_auto,q_auto/v1/a.jpg',
  );
  expect(sized('https://media3.reshet.tv/image/upload/w_100/v1/a.jpg', 300)).toBe(
    'https://media3.reshet.tv/image/upload/w_100/v1/a.jpg',
  );
  expect(sized('https://www.kan.org.il/media/a.jpg?rmode=pad&width=288&height=162', 400)).toBe(
    'https://www.kan.org.il/media/a.jpg?rmode=max&width=400',
  );
  expect(sized('https://img.mako.co.il/a.jpg', 300)).toBe('https://img.mako.co.il/a.jpg');
});

test('plain drops the direction marks the apps need', () => {
  expect(plain('‫כאן 11‬')).toBe('כאן 11');
});

test('the guide window moves in 12-hour steps, not with every refresh that drops an old programme', () => {
  const later: GuideFile = { iltv_live_kan11: (guide.iltv_live_kan11 ?? []).slice(1) };
  expect(channelGuide(later, 'iltv_live_kan11').map((r) => r[2])).toEqual(['סדרה <טובה>']);
  // Same window start: a programme 30 hours after the first is still in both.
  const g: GuideFile = {
    a: [
      [T0, T0 + H, 'x'],
      [T0 + 30 * H, T0 + 31 * H, 'y'],
    ],
  };
  const g2: GuideFile = {
    a: [
      [T0 + 2 * H, T0 + 3 * H, 'z'],
      [T0 + 30 * H, T0 + 31 * H, 'y'],
    ],
  };
  expect(channelGuide(g, 'a').at(-1)?.[2]).toBe('y');
  expect(channelGuide(g2, 'a').at(-1)?.[2]).toBe('y');
});

test('our own artwork is a same-site path in pages, and a full address in share cards', () => {
  expect(sized('{{israel-tv-origin}}/art/iltv_kan_1-poster.jpg', 300)).toBe('/art/iltv_kan_1-poster.jpg');
  const files = renderLibrary({
    rows: [
      {
        id: 'iltv_kan11',
        source: 'kan',
        shows: [
          {
            source: 'kan',
            meta: {
              id: 'iltv_kan_1',
              type: 'series',
              name: 'x',
              poster: '{{israel-tv-origin}}/art/iltv_kan_1-poster.jpg',
              links: [{ name: 'Source', category: 'Website', url: 'javascript:alert(1)' }],
              videos: [],
            },
          },
        ],
      },
    ],
    live: [],
  });
  const html = String(files.get(sitePaths.showPage('iltv_kan_1')));
  expect(html).toContain('src="/art/iltv_kan_1-poster.jpg"');
  expect(html).toContain(
    '<meta property="og:image" content="{{israel-tv-origin}}/art/iltv_kan_1-poster.jpg">',
  );
  expect(html).not.toContain('javascript:');
});
