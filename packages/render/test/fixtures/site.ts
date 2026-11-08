// A realistic status file for the public pages (shape and numbers as published on 2026-11-07, with a made-up
// history), used by the renderer tests and by `pnpm shots:site` (screenshots, Lighthouse).
import { LIVE_CHANNELS, type StatusFile } from '@israel-tv/core';
import type { LandingInput } from '../../src/landing-html.ts';
import type { LibraryInput } from '../../src/library-html.ts';
import { overall } from '../../src/status-html.ts';

export const NOW = Date.parse('2026-11-07T07:00:00Z');

const days = Array.from({ length: 30 }, (_, i) => new Date(NOW - (29 - i) * 86_400_000).toISOString().slice(0, 10));
const pattern = (bad: Record<number, 'warn' | 'error'>, from = 0) =>
  days.map((_, i) => (i < from ? null : (bad[i] ?? 'ok')));

export const SITE_STATUS: StatusFile = {
  generatedAt: '2026-11-07T06:48:28.210Z',
  health: 'warn',
  sources: [
    {
      source: 'mako',
      health: 'ok',
      shows: 661,
      episodes: 24301,
      lastFullRun: { at: '2026-11-07T01:30:00.010Z', status: 'ok' },
      lastAiringRun: { at: '2026-11-07T06:05:00.075Z', status: 'ok' },
      notes: ['2 shows listed by the site with nothing to watch (not in the catalog)'],
      noteCodes: [{ code: 'empty-shows', params: { count: 2 } }],
      emptyShows: ["אופירה וברקוביץ'", 'חדשות האוכל'],
    },
    {
      source: 'reshet',
      health: 'ok',
      shows: 225,
      episodes: 12381,
      lastFullRun: { at: '2026-11-07T01:54:34.466Z', status: 'ok' },
      lastAiringRun: { at: '2026-11-07T06:06:02.480Z', status: 'ok' },
      notes: ['3 shows listed by the site with nothing to watch (not in the catalog)'],
      noteCodes: [{ code: 'empty-shows', params: { count: 3 } }],
      emptyShows: ['The X Factor ישראל', 'אגדת דשא', 'פרפר נחמד | באדיבות כאן חינוכית'],
    },
    {
      source: 'kan',
      health: 'warn',
      shows: 111,
      episodes: 302,
      lastFullRun: { at: '2026-11-07T06:47:58.843Z', status: 'running' },
      notes: [
        'first fill of iltv_kan11 (כאן 11) in progress: 91 of 118 shows in the catalog, 608 episode pages to read',
        'first fill of iltv_kankids (כאן חינוכית: ילדים ונוער) in progress: 21 of 61 shows in the catalog, 1546 episode pages to read',
        '14 Kan episodes are no longer offered by Kan (their broadcast rights ended), so they are not in the catalog',
        "Kan's bot check stopped 3 of 412 page loads today; the crawl waits and tries again",
        "2 Kan shows wait to read an episode page again that failed to load (tried up to 3 times, 6 hours apart; the show's later episodes follow it)",
      ],
      noteCodes: [
        { code: 'first-fill', params: { catalog: 'iltv_kan11', inCatalog: 91, known: 118, pagesToRead: 608 } },
        { code: 'first-fill', params: { catalog: 'iltv_kankids', inCatalog: 21, known: 61, pagesToRead: 1546 } },
        { code: 'kan-no-longer-offered', params: { count: 14 } },
        { code: 'kan-bot-check', params: { challenged: 3, pages: 412 } },
        { code: 'kan-waiting-retry', params: { count: 2, tries: 3, hours: 6 } },
      ],
      skipped: { noLongerOffered: 14, notVideo: 2 },
      botCheck: { challenged: 3, pages: 412 },
    },
    {
      source: 'live',
      health: 'ok',
      shows: 24,
      episodes: 0,
      lastFullRun: { at: '2026-11-07T06:47:58.826Z', status: 'ok' },
      notes: ['23 channels answering (every stream played daily; Mako channels through the home helper)'],
      noteCodes: [{ code: 'live-answering', params: { count: 23 } }],
    },
  ],
  failingShows: [
    {
      id: 'iltv_reshet_77',
      title: 'חתונה ממבט ראשון',
      error: 'HTTP 503 from the site (tried 3 times)',
      lastOkAt: '2026-11-06T01:58:12.000Z',
    },
  ],
  warnings: [
    {
      at: '2026-11-07T06:35:29.874Z',
      code: 'episode-number-taken',
      message: 'episode kan:830066 "פרק 1" collides in season 1; numbered 2',
      id: 'iltv_kan_118',
      params: { key: 'kan:830066', hint: 1, season: 1, number: 2 },
    },
    {
      at: '2026-11-07T05:55:28.711Z',
      code: 'source-renumbered',
      message: 'episode kan:721263 is now "פרק 2" at the source; kept S1E4',
      id: 'iltv_kan_8',
      params: { key: 'kan:721263', hint: 2, season: 1, episode: 4 },
    },
    {
      at: '2026-11-07T05:35:29.656Z',
      code: 'source-note',
      message:
        'Kan episode https://www.kan.org.il/content/kan/kan-11/p-445792/447786/: no video player config on the page (layout changed?) (try 2 of 3; the show waits for it)',
      params: {
        kan: 'episode',
        url: 'https://www.kan.org.il/content/kan/kan-11/p-445792/447786/',
        detail: 'no video player config on the page (layout changed?)',
        tries: 2,
        of: 3,
        gaveUp: 0,
      },
    },
    {
      at: '2026-11-07T02:15:25.690Z',
      code: 'source-note',
      message: 'Kan https://www.kan.org.il/content/archive1/vod/p-670875/: could not copy its image (HTTP 403)',
    },
  ],
  audit: {
    at: '2026-11-07T06:48:29.476Z',
    metas: 996,
    problems: [
      {
        check: 'site text in an episode title',
        count: 34,
        examples: ['iltv_mako_535:1:1', 'iltv_mako_536:1:1', 'iltv_mako_539:1:1'],
      },
    ],
  },
  catalogs: [
    { id: 'iltv_keshet12', name: 'קשת 12', source: 'mako', shows: 661, episodes: 24301 },
    { id: 'iltv_reshet13', name: 'רשת 13', source: 'reshet', shows: 225, episodes: 12381 },
    {
      id: 'iltv_kan11',
      name: 'כאן 11',
      source: 'kan',
      shows: 91,
      episodes: 254,
      filling: { inCatalog: 91, known: 118, pagesToRead: 608 },
    },
    {
      id: 'iltv_kankids',
      name: 'כאן חינוכית: ילדים ונוער',
      source: 'kan',
      shows: 21,
      episodes: 48,
      filling: { inCatalog: 21, known: 61, pagesToRead: 1546 },
    },
    {
      id: 'iltv_kanarchive',
      name: 'כאן ארכיון',
      source: 'kan',
      shows: 0,
      episodes: 0,
      filling: { inCatalog: 0, known: 171 },
    },
    { id: 'iltv_live', name: 'שידור חי', source: 'live', shows: 24, episodes: 0 },
  ],
  history: {
    days,
    sources: {
      mako: pattern({ 11: 'warn', 19: 'error' }),
      reshet: pattern({ 4: 'warn' }),
      kan: pattern({ 27: 'warn' }, 25),
      live: pattern({ 8: 'warn', 22: 'warn' }, 6),
    },
  },
  live: {
    at: '2026-11-07T03:51:12.000Z',
    abroad: false,
    channels: LIVE_CHANNELS.map((c) => ({
      id: c.id,
      name: c.name,
      state: c.id === 'iltv_live_i24fr' ? 'down' : 'up',
      helper: c.direct.length === 0,
    })),
  },
  schedule: {
    timezone: 'Asia/Jerusalem',
    fullRunTime: '03:30',
    nextFullRun: '2026-11-08T01:30:00.000Z',
    airingChecksPerDay: 30,
    nextAiringCheck: '2026-11-07T07:05:00.000Z',
  },
};

export const LANDING: LandingInput = {
  name: 'Israel TV',
  description:
    'Israeli TV shows and live channels from Keshet 12, Reshet 13 and Kan. Keshet 12 needs your own home helper; some shows play only in Israel.',
  catalogs: SITE_STATUS.catalogs ?? [],
  live: LIVE_CHANNELS.map((c) => ({ id: c.id, name: c.name, logo: true, helper: c.direct.length === 0 })),
  status: overall(SITE_STATUS),
};

const H = 3_600_000;
const episodes = (n: number, title: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => ({
    id: `iltv_reshet_1:1:${i + 1}`,
    title: title(i + 1),
    season: 1,
    episode: i + 1,
    released: `2026-10-${String(1 + i).padStart(2, '0')}T00:00:00.000Z`,
    overview: 'פרק שבו קורים דברים, ואחריו עוד פרק.',
  }));

/** The library pages' fixture: two rows, three shows without pictures, two live channels with a guide around NOW. */
export const LIBRARY: LibraryInput = {
  rows: [
    {
      id: 'iltv_keshet12',
      source: 'mako',
      shows: [
        {
          source: 'mako',
          meta: {
            id: 'iltv_mako_1',
            type: 'series',
            name: 'הכוכב הבא',
            genres: ['ריאליטי', 'מוזיקה'],
            releaseInfo: '2015–2026',
            description: 'תחרות שירה.',
            videos: [],
          },
        },
      ],
    },
    {
      id: 'iltv_reshet13',
      source: 'reshet',
      shows: [
        {
          source: 'reshet',
          meta: {
            id: 'iltv_reshet_1',
            type: 'series',
            name: 'חתונה ממבט ראשון',
            genres: ['ריאליטי'],
            releaseInfo: '2017–2026',
            status: 'Returning Series',
            description: 'זוגות שנפגשים לראשונה מתחת לחופה.',
            links: [{ name: 'Source', category: 'Website', url: 'https://13tv.co.il/item/reality/example/' }],
            videos: episodes(12, (i) => `פרק ${i}`),
          },
        },
        {
          source: 'reshet',
          meta: { id: 'iltv_reshet_2', type: 'series', name: 'הישרדות', genres: ['ריאליטי'], videos: [] },
        },
      ],
    },
  ],
  live: LANDING.live,
  guide: {
    [LIVE_CHANNELS[0]?.id ?? 'iltv_live_kan11']: [
      [NOW - H, NOW + H, 'חדשות הערב'],
      [NOW + H, NOW + 2 * H, 'סרט תעודה'],
    ],
  },
};
