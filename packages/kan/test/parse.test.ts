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

test('single-video show: the video is on the show page itself', () => {
  const p = parseShowPage(html('show-p-1003359-single'), '/content/kan/kan-11/p-1003359/');
  expect(p.featured?.hls).toMatch(/kancdn\/vod\/2171294\//);
});

test('challenge pages are recognized', () => {
  expect(isChallenge('<html><head><title>רק רגע...</title>')).toBe(true);
  expect(isChallenge(html('episode-1006639'))).toBe(false);
});
