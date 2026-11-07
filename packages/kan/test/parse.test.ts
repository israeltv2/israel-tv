import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { isChallenge, KAN_ORIGIN, parseEpisodePage, parseLobby, parseShowPage } from '../src/parse.ts';

const html = (n: string) => readFileSync(new URL(`./fixtures/${n}.html`, import.meta.url), 'utf8');

test('lobby lists Kan 11 show pages', () => {
  const shows = parseLobby(html('lobby-kan11'), KAN_ORIGIN, 'kan/kan-11');
  expect(shows.length).toBeGreaterThan(40);
  expect(shows).toContain('/content/kan/kan-11/p-1006421/');
  expect(shows.every((p) => /^\/content\/kan\/kan-11\/p-\d+\/$/.test(p))).toBe(true);
});

test('kids lobby: slug show paths, episode links excluded', () => {
  const shows = parseLobby(html('lobby-kids-teens'), 'https://www.kankids.org.il', 'kids/hinuchit-main');
  expect(shows).toContain('/content/kids/hinuchit-main/cramel_main/');
  expect(shows.some((p) => /\/s\d+\//.test(p))).toBe(false);
});

test('show page lists its episodes oldest first', () => {
  const p = parseShowPage(html('show-p-1006421'), '/content/kan/kan-11/p-1006421/');
  expect(p.title).toContain('אירוויזיון');
  expect(p.description).toContain('משדר חגיגי');
  expect(p.episodes.length).toBe(9);
  expect(p.episodes[0]).toEqual({ path: '/content/kan/kan-11/p-1006421/s1/1006639/', id: 1006639 });
});

test('episode page: player config with an untokened Redge HLS URL', () => {
  const e = parseEpisodePage(html('episode-1006639'));
  expect(e).toMatchObject({
    id: '1006639',
    seasonNumber: 1,
    seriesName: 'אירוויזיון 2026 - השיר של ישראל',
    hls: 'https://r.il.cdn-redge.media/webcache/gorigin/hls/oil/kancdn/vod/2173543/LIBCODER_SMOOTH_1080_KAN/Manifest.ism/playlist.m3u8?fmp4',
  });
  expect(e?.title).toContain('קופה ראשית');
});

test('a show with one episode lists its episode page', () => {
  const p = parseShowPage(html('show-p-1003359-single'), '/content/kan/kan-11/p-1003359/');
  expect(p.episodes.map((e) => e.id)).toEqual([1003373]);
});

test('challenge pages are recognized', () => {
  expect(isChallenge('<html><head><title>רק רגע...</title>')).toBe(true);
  expect(isChallenge(html('episode-1006639'))).toBe(false);
});

test('kids episode links with a Hebrew season segment are found', () => {
  const html = `<a href="/content/kids/hinuchit-main/malon_hotel/עונה-3/1037174/">x</a><a href="https://www.kankids.org.il/content/kids/hinuchit-main/malon_hotel/s2/1000001/">y</a>`;
  const p = parseShowPage(html, '/content/kids/hinuchit-main/malon_hotel/');
  expect(p.episodes.map((e) => e.id)).toEqual([1000001, 1037174]);
});

test('lobby posters: the portrait poster on each show card, by show path', async () => {
  const { parseLobbyPosters } = await import('../src/parse.ts');
  const kan11 = parseLobbyPosters(html('lobby-kan11'));
  expect(kan11.size).toBe(42);
  expect(kan11.get('/content/kan/kan-11/p-1088672/')).toMatch(
    /^\/media\/vbgnuad5\/.*width=300&height=450&v=/,
  );
  const kids = parseLobbyPosters(html('lobby-kids-teens'));
  expect(kids.get('/content/kids/hinuchit-main/p-863865/')).toMatch(/poster_239_360/);
  // No portrait poster on the card: its first picture.
  expect(kids.get('/content/kids/ktantanim-main/p-1010382/')).toMatch(/200x200_character/);
});

test('show page image: a picture the page shows, not the share image Kan refuses', async () => {
  const { parseShowPage } = await import('../src/parse.ts');
  const page = parseShowPage(html('show-p-1006421'), '/content/kan/kan-11/p-1006421/');
  expect(page.image).toMatch(/^\/media\/[^?]+\.jpg\?width=490&height=272&v=/);
});

test('browsers tried for Kan: the configured one only; else Chrome, Edge, then a Linux Chromium', async () => {
  const { browserCandidates } = await import('../src/browser.ts');
  expect(browserCandidates('/opt/chrome')).toEqual([{ executablePath: '/opt/chrome' }]);
  expect(browserCandidates(undefined, 'win32', () => true)).toEqual([
    { channel: 'chrome' },
    { channel: 'msedge' },
  ]);
  expect(browserCandidates(undefined, 'linux', (p) => p === '/usr/bin/chromium')).toEqual([
    { channel: 'chrome' },
    { channel: 'msedge' },
    { executablePath: '/usr/bin/chromium' },
  ]);
});

test('an episode page gives its publication day', () => {
  const html = readFileSync(new URL('./fixtures/episode-1006639.html', import.meta.url), 'utf8');
  expect(parseEpisodePage(html)?.published).toBe('2026-03-04');
});

test('show names lose what Kan page titles add around them (the live cases)', async () => {
  const { cleanKanTitle } = await import('../src/parse.ts');
  const cases: [string, string][] = [
    ['סיפורים מהכורסה - פרקים מלאים לצפייה ישירה', 'סיפורים מהכורסה'],
    ['רב הנסתר - פרקים מלאים', 'רב הנסתר'],
    ['שב"ס - פרקים מלאים לצפייה ישירה', 'שב"ס'],
    ['הפרטיזן האחרון - הסרט המלא לצפייה ישירה', 'הפרטיזן האחרון'],
    ['כאן חינוכית | שכונת חיים - פרקים מלאים לצפייה ישירה', 'שכונת חיים'],
    ['כאן חינוכית | סטודיו אמציה - רק אנימציה', 'סטודיו אמציה - רק אנימציה'],
    ['מדרסה | סדרה ישראלית מבית היוצר של כאן חינוכית', 'מדרסה'],
    ['מאה אחוז | مئة في المئة - על פסגת ההר לא מוותרים על אף ילד', 'מאה אחוז'],
    ['אירוויזיון 2025 | כאן', 'אירוויזיון 2025'],
    ['עושים לביתנו |', 'עושים לביתנו'],
    ['הפלנטונים - סדרת אנימציה לילדים', 'הפלנטונים'],
    // Names that already are names stay as they are.
    ['100 שושנים - מחווה לשושנה דמארי', '100 שושנים - מחווה לשושנה דמארי'],
    ['שלום חנוך ומתי כספי: העיקר זה השירים', 'שלום חנוך ומתי כספי: העיקר זה השירים'],
    ['נטע, כפרה עליה', 'נטע, כפרה עליה'],
  ];
  for (const [raw, clean] of cases) expect(cleanKanTitle(raw), raw).toBe(clean);
});

test('an episode page with subtitles in its player config says so (kept as given, to learn the shape)', () => {
  const page = readFileSync(new URL('./fixtures/episode-1006639.html', import.meta.url), 'utf8');
  expect(parseEpisodePage(page)?.subtitles).toBeUndefined(); // "subtitles":null
  const withSubs = page.replace('"subtitles":null', '"subtitles":[{"src":"/x.vtt","lang":"he"}]');
  expect(parseEpisodePage(withSubs)?.subtitles).toEqual([{ src: '/x.vtt', lang: 'he' }]);
});

test('episode pages are told apart: a video, the bot check, rights expired, or not a video (measured pages)', async () => {
  const { classifyEpisodePage } = await import('../src/parse.ts');
  expect(classifyEpisodePage(html('episode-1006639')).kind).toBe('episode');
  // Cloudflare's Turnstile interstitial, as the crawler got it instead of an episode page.
  expect(classifyEpisodePage(html('challenge-turnstile')).kind).toBe('challenge');
  // "בשל הסכמי זכויות שידור, פרק זה כבר לא זמין לצפייה": still has a contentUrl, but the video is gone.
  expect(
    classifyEpisodePage(
      html('episode-447786-rights-expired'),
      KAN_ORIGIN,
      `${KAN_ORIGIN}/content/kan/kan-11/p-445792/447786/`,
    ).kind,
  ).toBe('removed');
  // An interview article linked among the episodes: a VideoObject with an empty contentUrl.
  expect(classifyEpisodePage(html('episode-128487-no-video')).kind).toBe('not-video');
  expect(classifyEpisodePage('<html><title>x</title></html>').kind).toBe('unknown');
});

test('a page without a player config but with a Redge VideoObject still gives its episode', async () => {
  const { classifyEpisodePage } = await import('../src/parse.ts');
  const page = html('episode-447786-rights-expired').replace(/class="rights-expired"/g, 'class="x"');
  const r = classifyEpisodePage(page, KAN_ORIGIN, `${KAN_ORIGIN}/content/kan/kan-11/p-445792/s2/447786/`);
  expect(r.kind).toBe('episode');
  if (r.kind !== 'episode') return;
  expect(r.episode).toMatchObject({
    id: '447786',
    title: 'פרק 1 - ארה"ב',
    seriesName: 'טייקונים',
    seasonNumber: 2,
    published: '2023-07-18',
  });
  expect(r.episode.hls).toMatch(/^https:\/\/r\.il\.cdn-redge\.media\/.+playlist\.m3u8\?fmp4$/);
});

test('normal Kan pages carry a bot-scoring script but are not challenges', () => {
  for (const n of ['episode-447786-rights-expired', 'episode-128487-no-video', 'lobby-series'])
    expect(isChallenge(html(n)), n).toBe(false);
  expect(isChallenge(html('challenge-turnstile'))).toBe(true);
});
