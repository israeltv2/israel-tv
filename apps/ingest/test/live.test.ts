import type { LiveChannel } from '@israel-tv/core';
import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import { checkLive, LIVE_CHECK_KEY, type LiveCheck, liveRender } from '../src/live.ts';

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
  });
  expect(r.ok).toBe(3);
  expect(r.failed).toEqual([]);
  expect(r.streamsFailed).toEqual(['א · א · גיבוי (master HTTP 502)']);
  expect(store.lastRun('full', 'live')?.status).toBe('partial');
  const check = store.getState<LiveCheck>(LIVE_CHECK_KEY);
  expect(check?.channels.iltv_live_c?.[0]).toMatchObject({ via: 'helper', outcome: 'ok' });
  expect(check?.channels.iltv_live_b?.[0]?.outcome).toBe('refused');
});

test('labels: "Israel only" only where the check from abroad was refused; without a check, the geo channels', () => {
  const check: LiveCheck = {
    at: '2026-11-07T00:00:00Z',
    abroad: true,
    channels: {
      iltv_live_kan11: [
        {
          title: 'כאן 11',
          via: 'direct',
          url: 'https://r.il.cdn-redge.media/livehls/oil/kancdn-live/live/kan11/live.livx/playlist.m3u8?dvr=21600000',
          outcome: 'refused',
          statuses: [403],
        },
      ],
      iltv_live_kanedu: [
        {
          title: 'כאן חינוכית',
          via: 'direct',
          url: 'https://r.il.cdn-redge.media/livehls/oil/kancdn-live/live/kan_edu/live.livx/playlist.m3u8?dvr=21600000',
          outcome: 'ok',
          statuses: [200, 200, 206],
        },
      ],
    },
  };
  const titles = (id: string, c?: LiveCheck) =>
    liveRender(new Set(), c)
      .find((x) => x.id === id)
      ?.streams.map((s) => s.title);
  expect(titles('iltv_live_kan11', check)?.[0]).toMatch(/זמין לצפייה רק בישראל/);
  expect(titles('iltv_live_kanedu', check)?.[0]).not.toMatch(/רק בישראל/);
  // Without a check, the channels the broadcaster sometimes geo-blocks say so.
  expect(titles('iltv_live_kanedu')?.[0]).toMatch(/רק בישראל/);
  // DASH backups are handed to the app's streaming server where the app cannot play them itself.
  const dash = liveRender()
    .find((x) => x.id === 'iltv_live_kan11')
    ?.streams.find((s) => s.url.includes('livedash'));
  expect(dash?.behaviorHints).toEqual({ notWebReady: true });
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
