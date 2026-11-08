import { type GuideFile, LIVE_CHANNELS, sitePaths } from '@israel-tv/core';
import { describe, expect, test } from 'vitest';
import { type AiringsFile, broadcastDay, CHANNEL_EN, channelName, guideDays } from '../src/guide-html.ts';
import { type RenderInput, type RenderShow, renderSite } from '../src/render.ts';

const show = (id: string, catalog: string, source: 'mako' | 'reshet' | 'kan', title: string): RenderShow => ({
  seriesId: id,
  catalog,
  title,
  latestAirDate: '2026-11-01',
  latestEpisodeSeenAt: null,
  state: 'listed',
  tmdbId: null,
  imdbId: null,
  show: {
    source,
    key: `/${id}`,
    title,
    catalog,
    description: 'תיאור התוכנית.',
    seasons: [
      {
        key: 's1',
        title: 'עונה 1',
        episodes: [{ key: `${id}-1`, title: 'פרק 1', airDate: '2026-11-01', streams: [] }],
      },
    ],
  },
  seasons: [{ key: 's1', number: 1, kind: 'numbered' }],
  episodes: [{ key: `${id}-1`, season: 1, episode: 1 }],
});

const H = 3_600_000;
// Sunday 8 November 2026, 12:00 in Israel (UTC+2).
const NOON = Date.parse('2026-11-08T10:00:00Z');
const guide: GuideFile = {
  iltv_live_reshet13: [
    [NOON - H, NOON, 'חדשות'],
    [NOON + 9 * H, NOON + 10 * H, 'הישרדות - עונה 8 - ש.ח'],
    [NOON + 33 * H, NOON + 34 * H, 'הישרדות - עונה 8'],
  ],
  iltv_live_ch14: [[NOON + 9 * H, NOON + 10 * H, 'הישרדות']],
};

const input = (g: GuideFile, now = NOON): RenderInput => ({
  version: '1.0.0',
  now,
  shows: [
    show('iltv_reshet_58', 'iltv_reshet13', 'reshet', 'הישרדות'),
    show('iltv_reshet_1', 'iltv_reshet13', 'reshet', 'אחרת'),
  ],
  live: [
    { id: 'iltv_live_reshet13', name: 'רשת 13', streams: [{ url: 'https://x.example/a.m3u8' }] },
    { id: 'iltv_live_ch14', name: 'עכשיו 14', streams: [{ url: 'https://x.example/b.m3u8' }] },
    { id: 'iltv_live_ynet', name: 'ynet', streams: [{ url: 'https://x.example/c.m3u8' }] },
  ],
  guide: g,
  status: { generatedAt: '2026-11-08T10:00:00Z', health: 'ok', sources: [], failingShows: [], warnings: [] },
  registry: {},
  catalogWarnings: {},
  sources: ['reshet', 'live'],
});

test('a broadcast day runs from 05:00 to 05:00 Israel time', () => {
  expect(broadcastDay(Date.parse('2026-11-08T02:59:00Z'))).toBe('2026-11-07'); // 04:59 in Israel
  expect(broadcastDay(Date.parse('2026-11-08T03:00:00Z'))).toBe('2026-11-08'); // 05:00
  expect(broadcastDay(Date.parse('2026-11-08T22:30:00Z'))).toBe('2026-11-08'); // 00:30 the next night
  expect(guideDays(guide, ['iltv_live_reshet13'])).toEqual(['2026-11-08', '2026-11-09']);
});

describe('the programme guide on the website', () => {
  const files = renderSite(input(guide));
  const page = String(files.get(sitePaths.guidePage));
  const en = String(files.get(sitePaths.guidePageEn));

  test('a page in each language, linked to each other, in the sitemap with both languages', () => {
    expect(page).toContain('<html lang="he" dir="rtl">');
    expect(en).toContain('<html lang="en" dir="ltr">');
    expect(page).toContain('hreflang="en" href="{{israel-tv-origin}}/en/live/guide/"');
    expect(en).toContain('hreflang="he" href="{{israel-tv-origin}}/live/guide/"');
    const sitemap = String(files.get(sitePaths.sitemap));
    expect(sitemap).toContain(
      '<loc>{{israel-tv-origin}}/live/guide/</loc><xhtml:link rel="alternate" hreflang="en"',
    );
    expect(sitemap).toContain('<loc>{{israel-tv-origin}}/en/live/guide/</loc>');
  });

  test('a day per tab, a channel row per channel, programmes that are shows linked to them', () => {
    expect(page).toContain('href="#d-2026-11-08"');
    expect(page).toContain('href="#d-2026-11-09"');
    expect(page).toContain(
      '<a class="pt" href="/show/iltv_reshet_58/" dir="auto">הישרדות - עונה 8 - ש.ח</a>',
    );
    // Channel 14's programme of the same name is not Reshet's show.
    expect(page).toMatch(/data-ch="iltv_live_ch14"[\s\S]*<span class="pt" dir="auto">הישרדות<\/span>/);
    // A channel without a guide says so, by name.
    expect(page).toMatch(/class="gnone"[\s\S]*ynet/);
    // 21:00 is 16 hours into the day that starts at 05:00.
    expect(page).toContain('style="--s:960;--d:60"');
  });

  test('the page does not depend on the moment it is rendered', () => {
    expect(String(renderSite(input(guide, NOON + 5 * H)).get(sitePaths.guidePage))).toBe(page);
  });

  test('airings.json: channels, programmes in minutes, the show when there is one', () => {
    const a = JSON.parse(String(files.get(sitePaths.airings))) as AiringsFile;
    expect(a.ch).toEqual([
      ['iltv_live_reshet13', 'רשת 13'],
      ['iltv_live_ch14', 'עכשיו 14'],
    ]);
    expect(a.r).toContainEqual([
      0,
      (NOON + 9 * H) / 60_000,
      (NOON + 10 * H) / 60_000,
      'הישרדות - עונה 8 - ש.ח',
      'iltv_reshet_58',
    ]);
    expect(a.r).toContainEqual([1, (NOON + 9 * H) / 60_000, (NOON + 10 * H) / 60_000, 'הישרדות']);
  });

  test('show pages stay the same when the guide changes (their airings are read in the browser)', () => {
    const other = renderSite(
      input({ ...guide, iltv_live_reshet13: [[NOON + 2 * H, NOON + 3 * H, 'הישרדות']] }),
    );
    const path = sitePaths.showPage('iltv_reshet_58');
    expect(String(other.get(path))).toBe(String(files.get(path)));
    expect(String(files.get(path))).toContain('id="airs" data-show="iltv_reshet_58"');
    expect(String(files.get(path))).toContain("fetch('/airings.json')");
  });

  test('the apps’ show page says the next airing first, in absolute terms; catalog rows do not change', () => {
    const meta = JSON.parse(String(files.get(sitePaths.meta('series', 'iltv_reshet_58'))));
    expect(meta.meta.description).toBe('‫בשידור הבא: יום ראשון 8.11 בשעה 21:00 · רשת 13\n\nתיאור התוכנית.‬');
    const row = JSON.parse(String(files.get(sitePaths.catalog('series', 'iltv_reshet13'))));
    expect(row.metas.find((m: { id: string }) => m.id === 'iltv_reshet_58').description).not.toContain(
      'בשידור',
    );
    // A show with no airing keeps its own description.
    const plain = JSON.parse(String(files.get(sitePaths.meta('series', 'iltv_reshet_1'))));
    expect(plain.meta.description).not.toContain('בשידור');
    // After the last airing, nothing is said.
    const later = renderSite(input(guide, NOON + 40 * H));
    expect(
      JSON.parse(String(later.get(sitePaths.meta('series', 'iltv_reshet_58')))).meta.description,
    ).not.toContain('בשידור');
  });

  test('no guide: no guide pages, no airings file, no airings block', () => {
    const none = renderSite(input({}));
    expect(none.has(sitePaths.guidePage)).toBe(false);
    expect(none.has(sitePaths.airings)).toBe(false);
    expect(String(none.get(sitePaths.showPage('iltv_reshet_58')))).not.toContain('id="airs"');
    expect(String(none.get(sitePaths.sitemap))).not.toContain('live/guide');
  });
});

test('every live channel has an English name on the English guide (none falls back to its Hebrew one)', () => {
  const missing = LIVE_CHANNELS.filter((c) => !CHANNEL_EN[c.id]).map((c) => c.id);
  expect(missing).toEqual([]);
  for (const c of LIVE_CHANNELS) expect(channelName(c, 'en'), c.id).not.toMatch(/[\u0590-\u05FF]/);
  expect(channelName({ id: 'iltv_live_i24he', name: 'i24 עברית' }, 'en')).toBe('i24NEWS Hebrew');
});
