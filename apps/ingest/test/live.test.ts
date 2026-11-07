import type { LiveChannel } from '@israel-tv/core';
import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import { checkLive, israelOnly, LIVE_CHECK_KEY, type LiveCheck, liveRender } from '../src/live.ts';

const PLAYLIST = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720\nv.m3u8\n';
const MEDIA = '#EXTM3U\n#EXTINF:6,\ns.ts\n';

/** A fake network: hosts that play, hosts that refuse (403), anything else fails; and a home helper. */
function net(refused: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const u = new URL(String(input));
    if (u.host === 'helper.test') {
      const ch = /\/stream\/tv\/(.+)\.json$/.exec(u.pathname)?.[1];
      return Response.json({ streams: [{ url: `https://plays.test/play/mako-live/${ch}/0.m3u8` }] });
    }
    if (refused.includes(u.host)) return new Response('', { status: 403 });
    if (u.host !== 'plays.test') return new Response('', { status: 502 });
    if (u.pathname.endsWith('/v.m3u8')) return new Response(MEDIA);
    if (u.pathname.endsWith('.ts')) return new Response('x', { status: 206 });
    return new Response(PLAYLIST);
  }) as typeof fetch;
}

const channels: LiveChannel[] = [
  {
    id: 'iltv_live_a',
    name: 'א',
    description: '',
    direct: [
      { title: 'א', url: 'https://plays.test/a.m3u8' },
      { title: 'א · גיבוי', url: 'https://dead.test/a.m3u8' },
    ],
  },
  {
    id: 'iltv_live_b',
    name: 'ב',
    description: '',
    direct: [{ title: 'ב', url: 'https://geo.test/b.m3u8' }],
    geo: true,
  },
  { id: 'iltv_live_c', name: 'ג', description: '', direct: [], mako: [{ title: 'ג', path: '/c.m3u8' }] },
];

test('every stream is played; a dead backup is named, a refusal abroad is a label, Mako plays through the helper', async () => {
  const store = Store.open(':memory:');
  const r = await checkLive(store, {
    channels,
    abroad: true,
    resolverBase: 'https://helper.test',
    fetchImpl: net(['geo.test']),
    retryDelayMs: 0,
  });
  expect(r.ok).toBe(3);
  expect(r.failed).toEqual([]);
  expect(r.streamsFailed).toEqual(['א · א · גיבוי (master HTTP 502)']);
  expect(store.lastRun('full', 'live')?.status).toBe('partial');
  const check = store.getState<LiveCheck>(LIVE_CHECK_KEY);
  expect(check?.channels.iltv_live_c?.[0]).toMatchObject({ via: 'helper', outcome: 'ok' });
  expect(check?.channels.iltv_live_b?.[0]?.outcome).toBe('refused');
});

const KAN11 =
  'https://r.il.cdn-redge.media/livehls/oil/kancdn-live/live/kan11/live.livx/playlist.m3u8?dvr=21600000';
const KAN11_SUBS =
  'https://r.il.cdn-redge.media/livehls/oil/kancdn-live/live/kan11_subs/live.livx/playlist.m3u8?dvr=21600000';
const CH13 = 'https://d18b0e6mopany4.cloudfront.net/out/v1/2f2bc414a3db4698a8e94b89eaf2da2a/index.m3u8';

test('labels: Kan (blocks some programmes abroad) says "sometimes"; "Israel only" only when never played abroad', () => {
  const stream = (url: string, outcome: 'ok' | 'refused', recent?: string) => ({
    title: 't',
    via: 'direct' as const,
    url,
    outcome,
    statuses: outcome === 'ok' ? [200, 200, 206] : [403],
    ...(recent ? { recent } : {}),
  });
  const check: LiveCheck = {
    at: '2026-11-07T00:00:00Z',
    abroad: true,
    channels: {
      // Measured 2026-11-06: Kan Educational refused 06:00–06:22 UTC, playing before and after.
      iltv_live_kan11: [stream(KAN11, 'refused', 'oooooor'), stream(KAN11_SUBS, 'refused', 'rrr')],
      // Channel 13 is not geo-limited: one refusal after many plays is "sometimes", never "Israel only".
      iltv_live_reshet13: [stream(CH13, 'refused', 'ooor')],
    },
  };
  const titles = (id: string, c?: LiveCheck) =>
    liveRender(new Set(), c)
      .find((x) => x.id === id)
      ?.streams.map((s) => s.title);
  expect(titles('iltv_live_kan11', check)?.[0]).toMatch(/לפעמים זמין רק בישראל/);
  expect(titles('iltv_live_kan11', check)?.[1]).toMatch(/· זמין לצפייה רק בישראל$/);
  expect(titles('iltv_live_reshet13', check)?.[0]).toMatch(/לפעמים זמין רק בישראל/);
  // Kan's channels say "sometimes" even while they play (they are known to block some programmes abroad) …
  expect(titles('iltv_live_kanedu', check)?.[0]).toMatch(/לפעמים זמין רק בישראל/);
  // … and, without any check, the same (an instance in Israel cannot measure it).
  expect(titles('iltv_live_kanedu')?.[0]).toMatch(/לפעמים זמין רק בישראל/);
  // A channel that played every time says nothing.
  expect(israelOnly({}, stream(CH13, 'ok', 'oooo'), true)).toBeUndefined();
  // DASH backups are handed to the app's streaming server where the app cannot play them itself.
  const dash = liveRender()
    .find((x) => x.id === 'iltv_live_kan11')
    ?.streams.find((s) => s.url.includes('livedash'));
  expect(dash?.behaviorHints).toEqual({ notWebReady: true });
});

test('a stream that does not play is played once more before it counts; each check adds to its history', async () => {
  const store = Store.open(':memory:');
  let calls = 0;
  // Fails on the first try only (a blip), then plays.
  const flaky = (async (input: string | URL | Request) => {
    const u = new URL(String(input));
    if (u.pathname === '/a.m3u8' && calls++ === 0) return new Response('', { status: 502 });
    if (u.pathname.endsWith('/v.m3u8')) return new Response(MEDIA);
    if (u.pathname.endsWith('.ts')) return new Response('x', { status: 206 });
    return new Response(PLAYLIST);
  }) as typeof fetch;
  const one: LiveChannel[] = [
    {
      id: 'iltv_live_a',
      name: 'א',
      description: '',
      direct: [{ title: 'א', url: 'https://plays.test/a.m3u8' }],
    },
  ];
  const r = await checkLive(store, { channels: one, abroad: true, fetchImpl: flaky, retryDelayMs: 0 });
  expect(r).toEqual({ ok: 1, failed: [], streamsFailed: [] });
  let s = store.getState<LiveCheck>(LIVE_CHECK_KEY)?.channels.iltv_live_a?.[0];
  expect(s).toMatchObject({ outcome: 'ok', retried: true, recent: 'o' });
  expect(store.lastRun('full', 'live')?.status).toBe('ok');
  // The next check is refused abroad: not tried again (a programme's block lasts), history "or", label
  // "sometimes" — and the run is still ok from abroad.
  let asked = 0;
  const refuse = net(['plays.test']);
  const counting = (async (input: string | URL | Request) => {
    asked++;
    return refuse(input);
  }) as typeof fetch;
  await checkLive(store, { channels: one, abroad: true, fetchImpl: counting, retryDelayMs: 0 });
  expect(asked).toBe(1);
  s = store.getState<LiveCheck>(LIVE_CHECK_KEY)?.channels.iltv_live_a?.[0];
  expect(s).toMatchObject({ outcome: 'refused', recent: 'or' });
  expect(s?.retried).toBeUndefined();
  expect(israelOnly({}, s, true)).toBe('sometimes');
  expect(store.lastRun('full', 'live')?.status).toBe('ok');
});

test('a DASH backup counts as playing when its manifest answers', async () => {
  const { playCheck } = await import('../src/canary.ts');
  const dash = (async () =>
    new Response('<?xml version="1.0"?>\n<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic"></MPD>', {
      headers: { 'content-type': 'application/dash+xml' },
    })) as unknown as typeof fetch;
  expect(await playCheck('https://cdn.test/live.livx?dvr=1', dash)).toEqual({ statuses: [200] });
});

test('a media playlist (no variants) plays when its first segment answers', async () => {
  const { playCheck } = await import('../src/canary.ts');
  const media = (async (input: string | URL | Request) =>
    String(input).endsWith('.ts')
      ? new Response('x', { status: 206 })
      : new Response('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg1.ts\n')) as unknown as typeof fetch;
  expect(await playCheck('https://cdn.test/live/streamPlaylist.m3u8', media)).toEqual({
    statuses: [200, 206],
  });
});

test("Channel 14's address is a media playlist (real copy, 2026-11-07): its first segment is played, not taken for a variant", async () => {
  const { readFileSync } = await import('node:fs');
  const { playCheck } = await import('../src/canary.ts');
  const body = readFileSync(new URL('./fixtures/live/ch14-media-playlist.m3u8', import.meta.url), 'utf8');
  const seen: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const u = String(input);
    seen.push(u);
    return u.includes('fragment.ts') ? new Response('G', { status: 206 }) : new Response(body);
  }) as typeof fetch;
  const url =
    'https://r.il.cdn-redge.media/livehls/oil/ch14/live/ch14/live.livx/playlist.m3u8?dvr=21600000&bitrate=5692000&audioId=1&videoId=0';
  expect(await playCheck(url, f)).toEqual({ statuses: [200, 206] });
  expect(seen[1]).toMatch(/\/fragment\.ts\?bitrate=5692000.*startTime=815728496020$/);
});
