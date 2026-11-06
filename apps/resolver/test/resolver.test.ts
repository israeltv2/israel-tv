import type { ScrapedEpisode } from '@israel-tv/core';
import { describe, expect, test } from 'vitest';
import { absolutize, createResolverApp } from '../src/app.ts';

const makoEp: ScrapedEpisode = {
  key: 'v1',
  title: 'ep',
  streams: [],
  play: { vcmid: 'v1', channelId: 'c1', galleryChannelId: 'v1' },
};
const reshetEp: ScrapedEpisode = {
  key: '1_abc',
  title: 'ep',
  availableAbroad: false,
  streams: [
    {
      url: 'https://cdnapisec.kaltura.com/p/2748741/sp/274874100/playManifest/entryId/1_abc/a.m3u8',
      kind: 'direct',
    },
  ],
};

type Call = { url: string; headers: Record<string, string> };

function makoNet(calls: Call[]) {
  return async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers ?? {} });
    if (url.startsWith('https://www.mako.co.il/AjaxPage')) {
      return Response.json({
        media: [{ url: 'https://mako-vod.akamaized.net/i/x/master.m3u8', cdn: 'AKAMAI' }],
      });
    }
    if (url.startsWith('https://mass.mako.co.il/')) {
      const lp = new URL(url).searchParams.get('lp');
      return Response.json({ tickets: [{ ticket: 'hdnea%3Dst%3D1', url: lp }] });
    }
    if (url.includes('master.m3u8?hdnea=st=1') || url.includes('index.m3u8?hdnea=st=1')) {
      const r = new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n../550/hdntl=x/index_550.m3u8\n', {
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      });
      Object.defineProperty(r, 'url', { value: url.split('?')[0] });
      return r;
    }
    return new Response('nope', { status: 404 });
  };
}

const episode = (series: string) =>
  series === 'iltv_mako_1' ? makoEp : series === 'iltv_reshet_1' ? reshetEp : undefined;

describe('Mako', () => {
  test('stream points at the resolver; play builds a fresh master with the player User-Agent', async () => {
    const calls: Call[] = [];
    const app = createResolverApp({ episode, fetch: makoNet(calls) });
    const s = await (await app.request('http://home.lan:7001/stream/series/iltv_mako_1:2:3.json')).json();
    expect(s.streams[0].url).toBe('http://home.lan:7001/play/mako/iltv_mako_1%3A2%3A3.m3u8');

    const r = await app.request('/play/mako/iltv_mako_1%3A2%3A3.m3u8', {
      headers: { 'user-agent': 'NuvioTV/1 ExoPlayer' },
    });
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain('https://mako-vod.akamaized.net/i/550/hdntl=x/index_550.m3u8');
    const master = calls.find((c) => c.url.includes('master.m3u8?hdnea=st=1'));
    expect(master?.headers['user-agent']).toBe('NuvioTV/1 ExoPlayer');
    expect(calls.find((c) => c.url.startsWith('https://mass.mako.co.il/'))?.url).toContain('&rv=AKAMAI');
  });

  test('a fresh ticket per open (never cached)', async () => {
    const calls: Call[] = [];
    const app = createResolverApp({ episode, fetch: makoNet(calls) });
    await app.request('/play/mako/iltv_mako_1%3A2%3A3.m3u8');
    await app.request('/play/mako/iltv_mako_1%3A2%3A3.m3u8');
    expect(calls.filter((c) => c.url.startsWith('https://mass.mako.co.il/')).length).toBe(2);
  });

  test('live Mako channel', async () => {
    const calls: Call[] = [];
    const app = createResolverApp({
      episode,
      fetch: makoNet(calls),
      channels: [
        {
          id: 'iltv_live_keshet12',
          name: 'k',
          description: '',
          direct: [],
          mako: [{ title: 'k', path: '/s/index.m3u8' }],
        },
      ],
    });
    const s = await (await app.request('http://h/stream/tv/iltv_live_keshet12.json')).json();
    expect(s.streams.map((x: { url: string }) => x.url)).toEqual([
      'http://h/play/mako-live/iltv_live_keshet12/0.m3u8',
    ]);
    const r = await app.request('/play/mako-live/iltv_live_keshet12/0.m3u8');
    expect(r.status).toBe(200);
    expect(
      calls.some((c) => c.url.includes('lp=https%3A%2F%2Fmako-streaming.akamaized.net%2Fs%2Findex.m3u8')),
    ).toBe(true);
  });

  test('unknown episode is a 404, not a crash', async () => {
    const app = createResolverApp({ episode, fetch: makoNet([]) });
    expect((await app.request('/play/mako/iltv_mako_9%3A1%3A1.m3u8')).status).toBe(404);
  });
});

describe('geo relay', () => {
  const geoCalls: string[] = [];
  const geoFetch = async (url: string) => {
    geoCalls.push(url);
    const r = new Response(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://cfvod.kaltura.com/x/index.m3u8?Policy=p\n',
      { headers: { 'content-type': 'application/vnd.apple.mpegurl' } },
    );
    Object.defineProperty(r, 'url', { value: url });
    return r;
  };

  test('no relay streams without a geo proxy', async () => {
    const app = createResolverApp({ episode, fetch: makoNet([]) });
    const s = await (await app.request('http://h/stream/series/iltv_reshet_1:1:1.json')).json();
    expect(s.streams).toEqual([]);
  });

  test('blocked Reshet episode gets a signed relay; the master comes through the proxy, video stays direct', async () => {
    const app = createResolverApp({ episode, fetch: makoNet([]), geoFetch });
    const s = await (await app.request('http://h/stream/series/iltv_reshet_1:1:1.json')).json();
    expect(s.streams).toHaveLength(1);
    const path = new URL(s.streams[0].url).pathname;
    const r = await app.request(path);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('https://cfvod.kaltura.com/x/index.m3u8?Policy=p');
    expect(geoCalls[0]).toContain('cdnapisec.kaltura.com');
  });

  test('tampered or foreign relay URLs are refused', async () => {
    const app = createResolverApp({ episode, fetch: makoNet([]), geoFetch, secret: Buffer.alloc(32, 1) });
    const s = await (await app.request('http://h/stream/series/iltv_reshet_1:1:1.json')).json();
    const [, , sig] = new URL(s.streams[0].url).pathname.split('/');
    const evil = Buffer.from('https://evil.example/x.m3u8').toString('base64url');
    expect((await app.request(`/relay/${sig}/${evil}.m3u8`)).status).toBe(403);
    const other = createResolverApp({ episode, fetch: makoNet([]), geoFetch, secret: Buffer.alloc(32, 1) });
    // Correctly signed but not an allowed host.
    const { createHmac } = await import('node:crypto');
    const goodSig = createHmac('sha256', Buffer.alloc(32, 1)).update(evil).digest('base64url').slice(0, 22);
    expect((await other.request(`/relay/${goodSig}/${evil}.m3u8`)).status).toBe(403);
  });
});

test('absolutize keeps tags, resolves URIs, rewrites key URIs', () => {
  const out = absolutize(
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k.key"\nseg1.ts\n',
    'https://cdn/a/b/index.m3u8',
  );
  expect(out).toBe(
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://cdn/a/b/k.key"\nhttps://cdn/a/b/seg1.ts\n',
  );
});

describe('hardening', () => {
  test('relay hops to a non-gated host go back to the player as a redirect', async () => {
    const geoCalls: string[] = [];
    const geoFetch = async (url: string) => {
      geoCalls.push(url);
      return new Response(null, { status: 302, headers: { location: 'https://cfvod.kaltura.com/x/a.m3u8' } });
    };
    const app = createResolverApp({ episode, fetch: makoNet([]), geoFetch });
    const s = await (await app.request('http://h/stream/series/iltv_reshet_1:1:1.json')).json();
    const r = await app.request(new URL(s.streams[0].url).pathname);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://cfvod.kaltura.com/x/a.m3u8');
    expect(geoCalls).toHaveLength(1);
  });

  test('a Mako ticket pointing at another host is refused', async () => {
    const net = async (url: string) => {
      if (url.startsWith('https://www.mako.co.il/AjaxPage')) {
        return Response.json({
          media: [{ url: 'https://mako-vod.akamaized.net/i/x/master.m3u8', cdn: 'AKAMAI' }],
        });
      }
      if (url.startsWith('https://mass.mako.co.il/')) {
        return Response.json({ tickets: [{ ticket: 'a', url: 'http://192.168.1.1/admin' }] });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const app = createResolverApp({ episode, fetch: net });
    const r = await app.request('/play/mako/iltv_mako_1%3A2%3A3.m3u8');
    expect(r.status).toBe(502);
    expect(await r.text()).toMatch(/unexpected Mako media host/);
  });
});

test('a failing geo proxy gives a 502 that says so, and one log line', async () => {
  const lines: string[] = [];
  const geoFetch = async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  };
  const app = createResolverApp({ episode, fetch: makoNet([]), geoFetch, log: (l) => lines.push(l) });
  const s = await (await app.request('http://h/stream/series/iltv_reshet_1:1:1.json')).json();
  const r = await app.request(new URL(s.streams[0].url).pathname);
  expect(r.status).toBe(502);
  expect(await r.text()).toMatch(/geo proxy failed: /);
  expect(lines[0]).toMatch(/relay through the geo proxy failed for cdnapisec\.kaltura\.com/);
});

test('an upstream refusal through the proxy is reported as a failed relay', async () => {
  const outcomes: { ok: boolean; error?: string }[] = [];
  const geoFetch = async () => new Response('denied', { status: 403 });
  const app = createResolverApp({ episode, fetch: makoNet([]), geoFetch, onRelay: (r) => outcomes.push(r) });
  const s = await (await app.request('http://h/stream/series/iltv_reshet_1:1:1.json')).json();
  await app.request(new URL(s.streams[0].url).pathname);
  expect(outcomes[0]).toMatchObject({ ok: false, error: expect.stringMatching(/HTTP 403/) });
});

test('a Mako show opened from Cinemeta (IMDb id) plays through the resolver, numbered seasons only', async () => {
  const app = createResolverApp({
    episode,
    fetch: makoNet([]),
    external: (id) => (id === 'tt0385411' ? { series: 'iltv_mako_1', seasons: [2] } : undefined),
  });
  const ok = await (await app.request('http://h/stream/series/tt0385411:2:3.json')).json();
  expect(ok.streams[0].url).toBe('http://h/play/mako/iltv_mako_1%3A2%3A3.m3u8');
  const named = await (await app.request('http://h/stream/series/tt0385411:101:1.json')).json();
  expect(named.streams).toEqual([]);
});
