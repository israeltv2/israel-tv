import { ORIGIN_TOKEN, type StatusFile } from '@israel-tv/core';
import { describe, expect, test } from 'vitest';
import { renderLandingHtml } from '../src/landing-html.ts';
import { publicStatus, publicText } from '../src/public-text.ts';
import { type RenderShow, renderSite } from '../src/render.ts';
import { robotsTxt, sitemapXml, webManifest } from '../src/site-meta.ts';
import { overall, renderStatusHtml } from '../src/status-html.ts';
import { LANDING, SITE_STATUS } from './fixtures/site.ts';

const text = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ');

function show(id: string, catalog: string, source: 'mako' | 'reshet' | 'kan', episodes: number): RenderShow {
  const eps = Array.from({ length: episodes }, (_, i) => ({
    key: `${id}-${i}`,
    title: `פרק ${i + 1}`,
    airDate: '2026-11-01',
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

describe('renderSite: the public pages', () => {
  const files = renderSite({
    version: '1.0.0',
    shows: [
      show('iltv_mako_1', 'iltv_keshet12', 'mako', 3),
      show('iltv_mako_2', 'iltv_keshet12', 'mako', 4),
      show('iltv_reshet_1', 'iltv_reshet13', 'reshet', 5),
    ],
    live: [
      { id: 'iltv_live_kan11', name: 'כאן 11', streams: [{ url: 'https://x.example/a.m3u8' }] },
      { id: 'iltv_live_keshet12', name: 'קשת <12>', streams: [] },
    ],
    status,
    registry: {},
    catalogWarnings: {},
    sources: ['mako', 'reshet', 'live'],
    publicUrl: 'https://addon.example.dev',
  });
  const landing = String(files.get('index.html'));
  const he = String(files.get('he/index.html'));

  test('the real numbers are written into the landing page (no script fills them in)', () => {
    const words = text(landing).replace(/\s+/g, ' ');
    expect(words).toContain('3 shows');
    expect(words).toContain('12 episodes');
    expect(words).toMatch(/2 live channels/);
    expect(words).toContain('7 episodes');
    expect(landing).toContain('lang="en" dir="ltr"');
    expect(he).toContain('lang="he" dir="rtl"');
    expect(text(he)).toContain('תוכניות');
  });

  test('the install links are written in when the public address is known', () => {
    expect(landing).toContain('href="stremio://addon.example.dev/manifest.json"');
    expect(landing).toContain(encodeURIComponent('https://addon.example.dev/manifest.json'));
  });

  test('names are escaped and isolated', () => {
    expect(landing).toContain('<bdi dir="auto">קשת &#60;12&#62;</bdi>');
    expect(landing).not.toContain('קשת <12>');
  });

  test('canonical, alternate languages, share card and structured data', () => {
    expect(landing).toContain(`<link rel="canonical" href="${ORIGIN_TOKEN}/">`);
    expect(landing).toContain(`hreflang="he" href="${ORIGIN_TOKEN}/he/"`);
    expect(he).toContain(`<link rel="canonical" href="${ORIGIN_TOKEN}/he/">`);
    expect(landing).toContain(`<meta property="og:image" content="${ORIGIN_TOKEN}/og.jpg">`);
    expect(landing).toContain('twitter:card');
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(landing)?.[1] ?? '{}');
    expect(ld['@type']).toBe('SoftwareApplication');
    expect(ld.offers.price).toBe('0');
    expect(landing).not.toMatch(/noindex/);
  });

  test('status.json carries the rows as published', () => {
    const s = JSON.parse(String(files.get('status.json'))) as StatusFile;
    expect(s.catalogs?.map((c) => [c.id, c.shows, c.episodes])).toEqual([
      ['iltv_keshet12', 2, 7],
      ['iltv_reshet13', 1, 5],
      ['iltv_live', 2, 0],
    ]);
  });

  test('robots.txt, sitemap and web manifest', () => {
    expect(files.get('robots.txt')).toBe(robotsTxt());
    expect(robotsTxt()).toContain('Disallow: /catalog/');
    expect(robotsTxt()).toContain(`Sitemap: ${ORIGIN_TOKEN}/sitemap.xml`);
    expect(robotsTxt()).not.toMatch(/Disallow: \/\s*$/m);
    expect(sitemapXml()).toContain(`<loc>${ORIGIN_TOKEN}/status</loc>`);
    expect(JSON.parse(webManifest()).icons.length).toBeGreaterThan(2);
    expect(files.get('site.webmanifest')).toBe(webManifest());
  });
});

describe('the status page', () => {
  const html = renderStatusHtml(SITE_STATUS);
  const main = html.slice(0, html.indexOf('id="details-h"'));

  test('one plain headline on top', () => {
    expect(overall(SITE_STATUS)).toMatchObject({ level: 'warn', title: 'Mostly working' });
    expect(main).toContain('One live channel is not playing right now.');
  });

  test('no ids, codes or ISO timestamps in the viewer part', () => {
    const words = text(main);
    expect(words).not.toMatch(/iltv_/);
    expect(words).not.toMatch(/\d{4}-\d\d-\d\dT\d\d:\d\d/);
    expect(words).toMatch(/7 Nov, \d\d:\d\d Israel time/);
    expect(main).toContain('<time datetime="2026-11-07T06:48:28.210Z">');
  });

  test('the counts, the history and the live channels are there', () => {
    expect(text(main)).toContain('24,301');
    expect(main.match(/class="d /g)?.length).toBe(30 * 6);
    expect(main).toContain('Not playing');
    expect(main).toContain('home helper');
  });

  test('titles and messages are escaped', () => {
    const page = renderStatusHtml({
      ...SITE_STATUS,
      failingShows: [{ id: 'x', title: '<img src=x onerror=alert(1)>', error: '"><script>', lastOkAt: '' }],
    });
    expect(page).not.toContain('<img src=x');
    expect(page).not.toContain('"><script>');
    expect(page).toContain('&#60;img src=x onerror=alert(1)&#62;');
  });

  test('an older status file (no rows) still renders, one card per source', () => {
    const page = renderStatusHtml({ ...status, sources: SITE_STATUS.sources });
    expect(page).toContain('Keshet 12');
    expect(overall({ ...status, sources: [] }).title).toBe('Everything is working');
  });

  test('a failing source and a failed publish say what that means for watching', () => {
    const failing = {
      ...SITE_STATUS,
      sources: SITE_STATUS.sources.map((s) => (s.source === 'mako' ? { ...s, health: 'error' as const } : s)),
    };
    expect(overall(failing)).toMatchObject({ level: 'error', title: 'Keshet 12 is not being refreshed' });
    expect(overall({ ...SITE_STATUS, publish: 'last publish failed' }).title).toBe(
      'The catalog is not being updated right now',
    );
    const { live: _live, ...filling } = SITE_STATUS;
    expect(overall(filling)).toMatchObject({ level: 'info', title: 'Kan shows are still being added' });
  });
});

describe('nothing private is published', () => {
  test('addresses, host names and paths become placeholders; the broadcasters’ addresses stay', () => {
    const out = publicText(
      'fetch http://192.168.1.20:7701/stream/x failed; helper https://my-tunnel.example.net/x; proxy 10.0.0.5:8080; ' +
        'mac.local:7700 and nas.lan; file /Users/someone/israel-tv/data/catalog.db and C:\\Users\\x\\a.db; ' +
        'page https://www.kan.org.il/content/kan/kan-11/p-1/2/ ok; [fd00::1]:80',
    );
    expect(out).not.toMatch(/192\.168|my-tunnel|10\.0\.0\.5|mac\.local|nas\.lan|\/Users\/|C:\\Users|fd00/);
    expect(out).toContain('https://www.kan.org.il/content/kan/kan-11/p-1/2/');
    expect(out).toContain('[private address]');
    expect(out).toContain('[path]');
  });

  test('credentials written without a web address are hidden too', () => {
    const out = publicText(
      'proxy user:secret@proxy.example.net:1080 refused; Authorization: Bearer sk_live_abcdefgh12345; ' +
        'GET /x?token=abc123&ok=1 password=hunter22 socks5://u:p@h.example.org:1080 ' +
        'https://user:pw@www.mako.co.il/x?ticket=SECRET',
    );
    expect(out).not.toMatch(/secret|sk_live|abc123|hunter22|u:p|user:pw|SECRET|proxy\.example|h\.example/);
    expect(out).toContain('https://www.mako.co.il/x');
  });

  test('times, ids and episode keys are left alone', () => {
    const s = 'at 2026-11-07T06:48:28.210Z iltv_mako_535:1:1 kan:830066 21:30:00 S1E4';
    expect(publicText(s)).toBe(s);
  });

  test('every string of the status, on the page and in status.json', () => {
    const leaky: StatusFile = {
      ...status,
      health: 'error',
      sources: [
        {
          source: 'mako',
          health: 'error',
          shows: 1,
          episodes: 1,
          lastFullRun: {
            at: '2026-11-07T01:30:00Z',
            status: 'failed',
            error: 'connect ECONNREFUSED 192.168.7.7:7701',
          },
          notes: ['resolver at http://media-box.local:7701 did not answer'],
        },
      ],
    };
    const json = JSON.stringify(publicStatus(leaky));
    expect(json).not.toMatch(/192\.168|media-box/);
    const page = renderStatusHtml(leaky);
    expect(page).not.toMatch(/192\.168|media-box/);
    // The Hebrew page too, with the same strings as codes and values (notes, warnings, the publish note).
    const coded: StatusFile = {
      ...leaky,
      publish: 'last publish failed: connect ECONNREFUSED 10.1.2.3:443',
      publishNote: {
        code: 'publish-failed',
        params: { at: '2026-11-07T01:30:00Z', inRow: 2, error: 'connect ECONNREFUSED 10.1.2.3:443' },
      },
      tmdbNote: {
        code: 'tmdb-failed',
        params: { at: '2026-11-07T01:30:00Z', error: 'GET /home/me/key failed' },
      },
      sources: leaky.sources.map((s) => ({
        ...s,
        noteCodes: [{ code: 'some-new-note' }],
        notes: ['helper http://media-box.local:7701 refused'],
      })),
      failingShows: [{ id: 'x', title: 'x', error: 'ECONNREFUSED 10.9.8.7:7701', lastOkAt: '' }],
      warnings: [
        {
          at: '2026-11-07T01:30:00Z',
          code: 'source-note',
          message: 'x: http://media-box.local/x',
          params: { kan: 'show', url: 'http://media-box.local/x', detail: 'proxy 10.9.8.7:8080 refused' },
        },
      ],
    };
    const he = renderStatusHtml(coded, {}, 'he');
    expect(he).not.toMatch(/192\.168|media-box|10\.1\.2\.3|10\.9\.8\.7|\/home\/me/);
    expect(he).toContain('[private address]');
    const files = renderSite({
      version: '1',
      shows: [],
      live: [],
      status: leaky,
      registry: {},
      catalogWarnings: {},
    });
    expect(String(files.get('status.json'))).not.toMatch(/192\.168|media-box/);
    expect(String(files.get('he/status.html'))).not.toMatch(/192\.168|media-box/);
  });
});

describe('the status page in Hebrew', () => {
  const he = renderStatusHtml(SITE_STATUS, {}, 'he');
  const main = he.slice(0, he.indexOf('id="details-h"'));

  test('right to left, with its own address and the English page as its other language', () => {
    expect(he).toContain('<html lang="he" dir="rtl">');
    expect(he).toContain(`<link rel="canonical" href="${ORIGIN_TOKEN}/he/status">`);
    expect(he).toContain(`hreflang="en" href="${ORIGIN_TOKEN}/status"`);
    expect(he).toContain(`hreflang="he" href="${ORIGIN_TOKEN}/he/status"`);
    expect(he).toContain('<a href="/status" class="opt" hreflang="en" lang="en">English</a>');
    expect(he).toContain('<meta property="og:locale" content="he_IL">');
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(he)?.[1] ?? '{}');
    expect(ld).toMatchObject({ '@type': 'WebPage', inLanguage: 'he', url: `${ORIGIN_TOKEN}/he/status` });
    // The English page links here, and the Hebrew header and footer link to this page, not the English one.
    expect(renderStatusHtml(SITE_STATUS)).toContain(
      '<a href="/he/status" class="opt" hreflang="he" lang="he">עברית</a>',
    );
    expect(he).toContain('<a href="/he/status" aria-current="page">מצב</a>');
    expect(he).toContain('<a href="/he/status">מצב השירות</a>');
  });

  test('the viewer part reads in Hebrew: no English words but names, times in Hebrew', () => {
    expect(overall(SITE_STATUS, 'he')).toMatchObject({ level: 'warn', title: 'כמעט הכול עובד' });
    const words = text(main)
      .replace(/Israel TV|Stremio|Nuvio|GitHub|English|Français|ynet/g, '')
      .replace(/\(נפתח בכרטיסייה חדשה\)/g, '');
    expect(words).not.toMatch(/[A-Za-z]{3,}/);
    expect(words).toMatch(/7 בנוב׳, \d\d:\d\d שעון ישראל/);
    expect(main).toContain('ערוץ אחד בשידור חי לא מתנגן כרגע.');
    expect(main).toContain('14 פרקים כבר לא זמינים באתר של כאן');
    expect(main).toContain('השורה מתחילה להתמלא: 171 תוכניות יגיעו בימים הקרובים.');
  });

  test('notes and warnings are worded from their codes; one without values stays English, marked so', () => {
    expect(he).toContain('2 תוכניות ממתינות לקריאה חוזרת של דף פרק שלא נטען');
    expect(he).toContain('הפרק "פרק 1" (<bdi dir="ltr" lang="en">kan:830066</bdi>) התנגש בפרק אחר בעונה 1');
    expect(he).toContain('<span dir="ltr" lang="en" class="en-text">Kan https://www.kan.org.il/');
    expect(text(he)).not.toContain('collides');
    const failing = {
      ...SITE_STATUS,
      sources: SITE_STATUS.sources.map((s) => ({ ...s, health: 'error' as const })),
    };
    expect(overall(failing, 'he').title).toBe('העדכונים של קשת 12, רשת 13 וכאן נעצרו');
  });

  test("the catalog check's gaps in Hebrew too", () => {
    const audit = {
      at: '2026-11-07T06:48:29Z',
      metas: 10,
      problems: [],
      gaps: [{ source: 'reshet', shows: 10, noGenre: 3, noDescription: 2, noYear: 1 }],
    };
    const page = renderStatusHtml({ ...SITE_STATUS, audit }, {}, 'he');
    expect(page).toContain('<h3>פרטים על תוכניות שהמקורות לא נותנים</h3>');
    expect(page).toContain('<th>בלי ז׳אנרים</th>');
    expect(page).toContain('<td>רשת 13</td>');
    expect(renderStatusHtml({ ...SITE_STATUS, audit })).toContain('<th>No genres</th>');
  });

  test('both pages are in the sitemap, each with the other as its alternate', () => {
    const map = sitemapXml();
    expect(map).toContain(
      `<loc>${ORIGIN_TOKEN}/he/status</loc><xhtml:link rel="alternate" hreflang="en" href="${ORIGIN_TOKEN}/status"/>`,
    );
    expect(map).toContain(
      `<loc>${ORIGIN_TOKEN}/status</loc><xhtml:link rel="alternate" hreflang="en" href="${ORIGIN_TOKEN}/status"/><xhtml:link rel="alternate" hreflang="he" href="${ORIGIN_TOKEN}/he/status"/>`,
    );
  });
});

test("Kan's bot check and a browser that did not start read plainly", () => {
  const kan = (error: string): StatusFile => ({
    ...SITE_STATUS,
    catalogs: (SITE_STATUS.catalogs ?? []).map(({ filling: _f, ...c }) => c),
    sources: SITE_STATUS.sources.map((s) =>
      s.source === 'kan'
        ? { ...s, health: 'warn', lastFullRun: { at: s.lastFullRun?.at ?? '', status: 'failed', error } }
        : s,
    ),
  });
  for (const error of [
    "blocked by Kan's bot check (Cloudflare)",
    'browser did not start: Executable not found at /Users/someone/Library/Caches/ms-playwright/chrome',
  ]) {
    const page = renderStatusHtml(kan(error));
    const main = page.slice(0, page.indexOf('id="details-h"'));
    expect(main).toContain('>Paused<');
    expect(main).toContain('Reading Kan’s site is paused for now');
    expect(main).toContain('Kan’s bot check stopped 3 of 412 page loads today');
    expect(main).toContain('14 Kan episodes are no longer offered (the broadcast rights ended)');
    expect(text(main)).not.toContain('iltv_');
    // The details are worded from the fields too: no run text with ids.
    expect(text(page)).not.toContain('first fill of iltv_');
    expect(page).not.toContain('someone');
  }
});

test('the landing page without a known address: the script fills in the install links', () => {
  const html = renderLandingHtml(LANDING, 'en');
  expect(html).toContain(`<code id="manifest-url" data-origin>${ORIGIN_TOKEN}/manifest.json</code>`);
  expect(html).toContain('href="/manifest.json" data-stremio');
  expect(html).not.toMatch(/donat|sponsor|patreon|ko-fi|buymeacoffee|google-analytics|gtag/i);
});

test("Kan's full lists on the status page: progress, shows the app does not list, YouTube-only items", async () => {
  const { noteText } = await import('../src/status-words.ts');
  const say = (code: string, params: Record<string, number>, lang: 'he' | 'en') =>
    String(noteText({ code, params }, undefined, lang));
  expect(say('kan-full-lists', { done: 120, shows: 361, pages: 1442 }, 'he')).toBe(
    'קוראים את רשימות הפרקים המלאות של כאן: 120 מתוך 361 תוכניות נקראו, ועוד 1,442 פרקים ישנים שנמצאו בהן ממתינים לקריאה.',
  );
  expect(say('kan-full-lists', { done: 361, shows: 361, pages: 0 }, 'en')).toBe(
    'Reading Kan’s full episode lists: 361 of 361 shows done.',
  );
  expect(say('kan-pages-only', { count: 1 }, 'he')).toBe(
    'תוכנית אחת לא מופיעה באפליקציה של כאן, ולכן נקראים רק הפרקים שהדף שלה מקשר אליהם (ייתכן שחסרים פרקים ישנים).',
  );
  expect(say('kan-no-web-page', { count: 35 }, 'he')).toBe(
    '35 פריטים ברשימות של כאן מנוגנים מיוטיוב ואין להם דף באתר, ולכן הם לא בקטלוג.',
  );
});
