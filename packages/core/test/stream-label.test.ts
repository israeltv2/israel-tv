import { expect, test } from 'vitest';
import { streamName, streamQuality } from '../src/stream-label.ts';

test('stream names say the source and, when known, the best quality', () => {
  const kaltura =
    'https://cdnapisec.kaltura.com/p/2748741/sp/274874100/playManifest/entryId/1_x/format/applehttp/a.m3u8';
  expect(streamName('reshet', kaltura)).toBe('\u202Bרשת 13 · 720p\u202C');
  const kan =
    'https://r.il.cdn-redge.media/webcache/gorigin/hls/oil/kancdn/vod/1_q/LIBCODER_SMOOTH_1080_KAN/Manifest.ism/playlist.m3u8';
  expect(streamName('kan', kan)).toBe('\u202Bכאן · 1080p\u202C');
  expect(streamQuality('kan', 'https://other.example/a.m3u8')).toBeUndefined();
  expect(streamName('mako')).toBe('\u202Bקשת 12\u202C');
});
