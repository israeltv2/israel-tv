import { expect, test } from 'vitest';
import { parseSeriesId, parseVideoId, seriesId, videoId } from '../src/ids.ts';

test('series and video ids round-trip', () => {
  const s = seriesId('mako', 42);
  expect(s).toBe('iltv_mako_42');
  expect(parseSeriesId(s)).toEqual({ source: 'mako', n: 42 });
  expect(parseVideoId(videoId(s, 2025, 7))).toEqual({ series: s, season: 2025, episode: 7 });
});

test('rejects foreign and malformed ids', () => {
  expect(parseSeriesId('il_mako_112')).toBeUndefined();
  expect(parseSeriesId('tt0944947')).toBeUndefined();
  expect(parseVideoId('iltv_mako_1:x:2')).toBeUndefined();
  expect(() => seriesId('mako', 0)).toThrow();
});
