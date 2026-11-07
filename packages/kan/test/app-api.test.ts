import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { appProgramUrl, parseAppCategory, parseAppProgram, redgeUrl } from '../src/app-api.ts';

const json = (n: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));

test('a show list from the app API: page ids, seasons, titles, dates and the Redge stream of each Kaltura entry', () => {
  const p = parseAppProgram(json('app-program-729641'));
  expect(p.title).toBe('אינתיפאדה');
  expect(p.full).toBe(false);
  expect(p.items.map((i) => i.id)).toEqual(['729643', '729658', '729659', '945437', '934022']);
  expect(p.items[0]).toMatchObject({
    id: '729643',
    title: 'פרק 1 - בלו הול',
    seasonNumber: 1,
    published: '2024-03-27',
    pageUrl: 'https://www.kan.org.il/content/kan/kan-11/p-729641/s1/729643/',
    // The stored (web page) stream of this episode, exactly.
    stream: { kind: 'redge', url: redgeUrl('1_mfyi68r9') },
  });
  expect(redgeUrl('1_mfyi68r9')).toBe(
    'https://r.il.cdn-redge.media/webcache/gorigin/hls/oil/kancdn/vod/1_mfyi68r9/LIBCODER_SMOOTH_1080_KAN/Manifest.ism/playlist.m3u8?fmp4',
  );
  // An entry with an empty Kaltura id is no video.
  expect(p.items.find((i) => i.id === '934022')?.stream).toEqual({ kind: 'none' });
});

test('app items the app plays from YouTube, or without a stream, are left to the web page', () => {
  const p = parseAppProgram(json('app-program-1006421'));
  expect(p.items).toHaveLength(9);
  // The web pages of this show play numeric Redge assets: nothing here may name a stream for them.
  expect(p.items.some((i) => i.stream.kind === 'redge')).toBe(false);
  expect(p.items.filter((i) => i.stream.kind === 'other')).toHaveLength(7); // YouTube ids
});

test("a category's shows map web addresses (kankids slugs too) to app ids", () => {
  const { shows } = parseAppCategory(json('app-category-4453'));
  expect(shows.get('https://www.kankids.org.il/content/kids/hinuchit-main/malon_hotel/')).toBe('441467');
  expect(shows.get('https://www.kankids.org.il/content/kids/hinuchit-main/the_serials/')).toBe('822823');
  expect(appProgramUrl('441467', 201)).toBe(
    'https://mobapi.kan.org.il/api/mobile/program?id=441467&from=201',
  );
});

test("an item with Kan's rights-ended note is left to its page, even with a Kaltura entry", () => {
  const p = parseAppProgram({
    entry: [
      {
        id: '447786',
        title: 'פרק 1 - ארה"ב',
        description: 'בשל הסכמי זכויות שידור, פרק זה כבר לא זמין לצפייה.',
        content: {
          type: 'video/hls',
          src: 'https://cdnapisec.kaltura.com/p/1/sp/1/playManifest/entryId/1_4lkoqix7/format/applehttp/x.m3u8',
        },
      },
    ],
  });
  expect(p.items[0]?.stream).toEqual({ kind: 'other' });
});
