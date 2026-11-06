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
    expect(s.streams[0].url).toMatch(
      /^http:\/\/home\.lan:7001\/play\/mako\/iltv_mako_1%3A2%3A3.m3u8\?p=[\w-]+$/,
    );

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
    expect(s.streams.map((x: { url: string }) => x.url.split('?')[0])).toEqual([
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
  const app = createResolverApp({
    episode,
    fetch: makoNet([]),
    geoFetch,
    log: (component) => (msg, fields) => lines.push(`${component}: ${msg} ${JSON.stringify(fields)}`),
  });
  const s = await (await app.request('http://h/stream/series/iltv_reshet_1:1:1.json')).json();
  const r = await app.request(new URL(s.streams[0].url).pathname);
  expect(r.status).toBe(502);
  expect(await r.text()).toMatch(/geo proxy failed: /);
  const line = lines.find((l) => l.includes('relay through the geo proxy failed'));
  expect(line).toMatch(/^geo-relay: /);
  expect(line).toContain('cdnapisec.kaltura.com');
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
  expect(ok.streams[0].url.split('?')[0]).toBe('http://h/play/mako/iltv_mako_1%3A2%3A3.m3u8');
  const named = await (await app.request('http://h/stream/series/tt0385411:101:1.json')).json();
  expect(named.streams).toEqual([]);
});

test('a play is recorded: stream request, ticket and failure share one playId, each from its module', async () => {
  const events: {
    kind: string;
    component: string;
    playId?: string;
    outcome: string;
    status?: number;
    detail?: Record<string, unknown>;
    episodeId?: string;
  }[] = [];
  const app = createResolverApp({
    episode: () => ({ key: 'k', title: 't', streams: [], play: { vcmid: 'v', channelId: 'c' } }),
    onEvent: (e) => events.push(e),
    fetch: async (url) => {
      if (url.includes('playlist'))
        return Response.json({ media: [{ url: 'https://x.akamaized.net/m.m3u8', cdn: 'AKAMAI' }] });
      if (url.includes('entitlement')) return Response.json({ tickets: [{ ticket: 'hdnea%3Dx' }] });
      return new Response('#EXTM3U\nv.m3u8\n', { status: 403 });
    },
  });
  const s = await (await app.request('http://h/stream/series/iltv_mako_1:2:3.json')).json();
  const play = new URL(s.streams[0].url);
  const r = await app.request(`${play.pathname}${play.search}`);
  expect(r.status).toBe(403);
  const playId = play.searchParams.get('p');
  expect(events.map((e) => `${e.component}/${e.kind}`)).toEqual([
    'resolver/stream_request',
    'mako-auth/ticket_fetch',
    'mako-auth/failure',
  ]);
  expect(events.every((e) => e.playId === playId)).toBe(true);
  const f = events[2];
  expect(f).toMatchObject({ outcome: 'error', status: 403, episodeId: 'iltv_mako_1:2:3' });
  expect(String(f?.detail?.upstream)).toContain('ticket 200');
});

test('a Reshet episode is relayed only when its direct stream is refused from here (probed once per show)', async () => {
  let status = 200;
  let probes = 0;
  const app = createResolverApp({
    episode: () => ({
      key: 'k',
      title: 't',
      streams: [{ url: 'https://cdnapisec.kaltura.com/p/1/x.m3u8', kind: 'direct' }],
    }),
    geoFetch: (async () => new Response('')) as never,
    fetch: async () => {
      probes++;
      return new Response('', { status });
    },
  });
  const ask = async (id: string) =>
    (await (await app.request(`http://h/stream/series/${id}.json`)).json()).streams as { url: string }[];
  expect(await ask('iltv_reshet_1:1:1')).toEqual([]);
  expect(await ask('iltv_reshet_1:1:2')).toEqual([]);
  expect(probes).toBe(1);
  status = 403;
  const relayed = await ask('iltv_reshet_2:1:1');
  expect(relayed).toHaveLength(1);
  expect(relayed[0]?.url).toContain('/relay/');
});

test('when Akamai refuses a Mako master, the next CDN Mako lists is tried', async () => {
  const events: { kind: string; detail?: Record<string, unknown> }[] = [];
  const app = createResolverApp({
    episode: () => ({ key: 'k', title: 't', streams: [], play: { vcmid: 'v', channelId: 'c' } }),
    onEvent: (e) => events.push(e),
    fetch: async (url) => {
      if (url.includes('playlist.jsp'))
        return Response.json({
          media: [
            { url: 'https://live.akamaized.net/k12/index.m3u8', cdn: 'AKAMAI' },
            { url: 'https://d1.cloudfront.net/k12/master.m3u8?b-in-range=0-800', cdn: 'AWS' },
          ],
        });
      if (url.includes('entitlement')) return Response.json({ tickets: [{ ticket: 'hdnea%3Dx', url: '' }] });
      if (url.includes('akamaized')) return new Response('', { status: 403 });
      if (url.includes('cloudfront') && !url.includes('?b-in-range=0-800&hdnea=x'))
        return new Response('', { status: 400 });
      return new Response('#EXTM3U\nv.m3u8\n', { status: 200 });
    },
  });
  const r = await app.request('/play/mako/iltv_mako_1%3A2%3A3.m3u8');
  expect(r.status).toBe(200);
  expect(await r.text()).toContain('https://d1.cloudfront.net/k12/v.m3u8');
  const play = events.find((e) => e.kind === 'play_start');
  expect(String(play?.detail?.upstream)).toMatch(
    /cdn AKAMAI, ticket 200, master 403, cdn AWS, ticket 200, master 200/,
  );
});

test('the remote resolver: Mako only, behind its token, nothing else, limited per client', async () => {
  const { createRemoteResolverApp } = await import('../src/remote.ts');
  const token = 'x'.repeat(40);
  let t = 0;
  const app = createRemoteResolverApp(
    { token, publicUrl: 'https://away.example.net', playsPerMinute: 2, requestsPerMinute: 100 },
    {
      episode: () => ({
        key: 'k',
        title: 't',
        streams: [{ url: 'https://cdnapisec.kaltura.com/p/1/x.m3u8', kind: 'direct' }],
        play: { vcmid: 'v', channelId: 'c' },
      }),
      fetch: async (url) => {
        if (url.includes('playlist.jsp'))
          return Response.json({ media: [{ url: 'https://x.akamaized.net/m.m3u8', cdn: 'AKAMAI' }] });
        if (url.includes('entitlement')) return Response.json({ tickets: [{ ticket: 'hdnea%3Dx' }] });
        return new Response('#EXTM3U\nv.m3u8\n');
      },
    },
    () => t,
  );
  const get = (p: string, ip = '203.0.113.7') =>
    app.request(`http://127.0.0.1:7703${p}`, { headers: { 'cf-connecting-ip': ip } });
  // Wrong or missing token, unknown paths, other methods: a bare 404.
  for (const p of [
    '/manifest.json',
    `/${'y'.repeat(40)}/manifest.json`,
    `/${token}/relay/a/b.ts`,
    `/${token}/stream/series/iltv_reshet_1:1:1.json`,
    `/${token}/status`,
    `/${token}`,
  ]) {
    const r = await get(p);
    expect(r.status, p).toBe(404);
    expect(await r.text(), p).toBe('');
  }
  const m = await (await get(`/${token}/manifest.json`)).json();
  expect(m.name).toBe('Israel TV · Mako (away from home)');
  expect(m.resources[0].idPrefixes).not.toContain('iltv_reshet_');
  // Stream URLs point back through the public address with the token, and never at a relay.
  const s = await (await get(`/${token}/stream/series/iltv_mako_1:2:3.json`)).json();
  expect(s.streams).toHaveLength(1);
  expect(s.streams[0].url).toMatch(new RegExp(`^https://away\\.example\\.net/${token}/play/mako/`));
  const play = new URL(s.streams[0].url);
  expect((await get(`${play.pathname}${play.search}`)).status).toBe(200);
  expect((await get(`${play.pathname}${play.search}`)).status).toBe(200);
  expect((await get(`${play.pathname}${play.search}`)).status).toBe(429);
  expect((await get(`${play.pathname}${play.search}`, '198.51.100.9')).status).toBe(200);
  t = 60_000;
  expect((await get(`${play.pathname}${play.search}`)).status).toBe(200);
  expect(() =>
    createRemoteResolverApp(
      { token: 'short', publicUrl: 'https://a', playsPerMinute: 1, requestsPerMinute: 1 },
      { episode: () => undefined, fetch: async () => new Response('') },
    ),
  ).toThrow(/32 characters/);
});

test('a relayed play the broadcaster refuses is recorded as a failure (only forged URLs are not)', async () => {
  const events: { kind: string; detail?: Record<string, unknown> }[] = [];
  const app = createResolverApp({
    episode: () => ({
      key: 'k',
      title: 't',
      streams: [{ url: 'https://cdnapisec.kaltura.com/p/1/x.m3u8', kind: 'direct' }],
    }),
    onEvent: (e) => events.push(e),
    geoFetch: (async () => new Response('refused', { status: 403 })) as never,
    fetch: async () => new Response('', { status: 403 }),
  });
  const s = await (await app.request('http://h/stream/series/iltv_reshet_1:1:1.json')).json();
  const relay = new URL(s.streams[0].url);
  expect((await app.request(`${relay.pathname}${relay.search}`)).status).toBe(403);
  expect(events.map((e) => e.kind)).toEqual(['stream_request', 'failure']);
  expect(events[1]?.detail?.stage).toBe('relay');
  // A forged relay URL is refused without recording anything.
  const forged = `${relay.pathname.replace(/\/relay\/[^/]+\//, '/relay/forgedsignature000000/')}${relay.search}`;
  expect((await app.request(forged)).status).toBe(403);
  expect(events).toHaveLength(2);
});

test('the daily flush ends only sessions started before today; a play going on stays one session', async () => {
  const { PlaySessions } = await import('../src/sessions.ts');
  const events: { kind: string }[] = [];
  let t = Date.parse('2026-11-06T23:59:30Z');
  const s = new PlaySessions(
    (e) => events.push(e),
    () => t,
  );
  s.relay('old', {}, { playlist: true, ms: 5, status: 200 });
  t = Date.parse('2026-11-07T00:00:30Z');
  s.relay('new', {}, { playlist: true, ms: 5, status: 200 });
  s.relay('old', {}, { playlist: false, ms: 5, status: 200 });
  s.flush(false, Date.parse('2026-11-07T00:00:00Z'));
  expect(events).toHaveLength(1);
  expect(s.active().map((a) => a.playId)).toEqual(['new']);
});

test('resolver-only: episode details come from the published catalog, with no database', async () => {
  const { catalogLookup } = await import('../src/server.ts');
  const calls: string[] = [];
  const files: Record<string, unknown> = {
    'play/iltv_mako_1/2.json': { '3': { mako: { vcmid: 'v', channelId: 'c' } } },
    'play/iltv_reshet_5/1.json': {
      '1': { direct: 'https://cdnapisec.kaltura.com/p/1/x.m3u8', israelOnly: true },
    },
    'ext-ids.json': { tt123: { id: 'iltv_mako_1', seasons: [2] } },
  };
  const fakeFetch = (async (url: string) => {
    calls.push(url);
    const path = url.replace('https://addon.example/', '');
    return path in files ? Response.json(files[path]) : new Response('', { status: 404 });
  }) as unknown as typeof fetch;
  const c = catalogLookup('https://addon.example/manifest.json', fakeFetch);
  expect(await c.episode('iltv_mako_1', 2, 3)).toMatchObject({
    play: { vcmid: 'v', channelId: 'c' },
    streams: [],
  });
  expect(await c.episode('iltv_reshet_5', 1, 1)).toMatchObject({
    streams: [{ url: 'https://cdnapisec.kaltura.com/p/1/x.m3u8', kind: 'direct' }],
    availableAbroad: false,
  });
  expect(await c.episode('iltv_mako_1', 2, 9)).toBeUndefined();
  expect(await c.external('tt123')).toEqual({ series: 'iltv_mako_1', seasons: [2] });
  await c.episode('iltv_mako_1', 2, 3);
  expect(calls.filter((u) => u.includes('play/iltv_mako_1/2.json'))).toHaveLength(1);
  // A resolver built on it plays a Mako episode from the catalog's data alone.
  const app = createResolverApp({
    ...c,
    fetch: async (url) => {
      if (url.includes('playlist.jsp'))
        return Response.json({ media: [{ url: 'https://x.akamaized.net/m.m3u8', cdn: 'AKAMAI' }] });
      if (url.includes('entitlement')) return Response.json({ tickets: [{ ticket: 'hdnea%3Dx' }] });
      return new Response('#EXTM3U\nv.m3u8\n');
    },
  });
  const s = await (await app.request('http://h/stream/series/tt123:2:3.json')).json();
  const play = new URL(s.streams[0].url);
  expect((await app.request(`${play.pathname}${play.search}`)).status).toBe(200);
});
