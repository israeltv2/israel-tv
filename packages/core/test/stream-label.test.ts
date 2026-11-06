import { expect, test } from 'vitest';
import { streamName, streamQuality } from '../src/stream-label.ts';

test('stream names say the source and, when known, the best quality', () => {
  const kaltura =
    'https://cdnapisec.kaltura.com/p/2748741/sp/274874100/playManifest/entryId/1_x/format/applehttp/a.m3u8';
  expect(streamName('reshet', kaltura)).toBe('\u200Fרשת 13 · 720p');
  const kan =
    'https://r.il.cdn-redge.media/webcache/gorigin/hls/oil/kancdn/vod/1_q/LIBCODER_SMOOTH_1080_KAN/Manifest.ism/playlist.m3u8';
  expect(streamName('kan', kan)).toBe('\u200Fכאן · 1080p');
  expect(streamQuality('kan', 'https://other.example/a.m3u8')).toBeUndefined();
  expect(streamName('mako')).toBe('\u200Fקשת 12');
});
