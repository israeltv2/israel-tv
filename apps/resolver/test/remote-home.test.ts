// The tunnel door at home: one installed link that also offers the relayed streams when the request comes from the
// home network's own public address, pointing at the home-network door so video never crosses the tunnel.
import { parseConfig, type ScrapedEpisode } from '@israel-tv/core';
import { describe, expect, test } from 'vitest';
import { createResolverApp } from '../src/app.ts';
import { homeAddress, networkOf } from '../src/home-address.ts';
import { createRemoteResolverApp } from '../src/remote.ts';
import { homeRelayProblem } from '../src/server.ts';

const HOME_IP = '203.0.113.50';
const AWAY_IP = '198.51.100.9';
const LAN = 'http://10.0.0.5:7701';
const token = 'z'.repeat(40);
const secret = Buffer.alloc(32, 7);

const reshetEp: ScrapedEpisode = {
  key: '1_abc',
  title: 'ep',
  availableAbroad: false,
  streams: [
    { url: 'https://cdnapisec.kaltura.com/p/1/sp/100/playManifest/entryId/1_abc/a.m3u8', kind: 'direct' },
  ],
};
const makoEp: ScrapedEpisode = {
  key: 'v1',
  title: 'ep',
  streams: [],
  play: { vcmid: 'v1', channelId: 'c1' },
};
const episode = (series: string) =>
  series.startsWith('iltv_reshet_') ? reshetEp : series.startsWith('iltv_mako_') ? makoEp : undefined;

/** The broadcaster refuses the direct stream from here (it is outside Israel); the trace endpoint names HOME_IP. */
const net = async (url: string) => {
  if (url.includes('/cdn-cgi/trace')) return new Response(`fl=1\nip=${HOME_IP}\nloc=XX\n`);
  if (url.includes('kaltura')) return new Response('', { status: 403 });
  return new Response('nope', { status: 404 });
};

function setup() {
  const logs: string[] = [];
  const events: unknown[] = [];
  const log = (component: string) => (msg: string, fields?: Record<string, unknown>) =>
    logs.push(JSON.stringify({ component, msg, ...fields }));
  const geoCalls: string[] = [];
  const geoFetch = async (url: string) => {
    geoCalls.push(url);
    return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://cfvod.kaltura.com/x/index.m3u8\n', {
      headers: { 'content-type': 'application/vnd.apple.mpegurl' },
    });
  };
  const home = homeAddress({
    fetch: net,
    urls: ['https://1.1.1.1/cdn-cgi/trace'],
    salt: 's',
    log: log('resolver'),
  });
  const remote = createRemoteResolverApp(
    {
      token,
      publicUrl: 'https://tv.example.net',
      playsPerMinute: 30,
      requestsPerMinute: 240,
      home: { isHome: home.isHome, lanUrl: LAN },
    },
    { episode, fetch: net, secret, log, onEvent: (e) => events.push(e), salt: 's' },
  );
  const lan = createResolverApp({ episode, fetch: net, geoFetch, secret });
  const get = (p: string, ip: string) =>
    remote.request(`http://127.0.0.1:7703/${token}${p}`, { headers: { 'cf-connecting-ip': ip } });
  return { logs, events, geoCalls, remote, lan, get };
}

describe('the tunnel door at home', () => {
  test('from home: the relayed stream, at the home-network address, and it plays there', async () => {
    const { get, lan, geoCalls } = setup();
    const r = await get('/stream/series/iltv_reshet_1:1:1.json', HOME_IP);
    expect(r.status).toBe(200);
    const { streams } = await r.json();
    expect(streams).toHaveLength(1);
    expect(streams[0].url.startsWith(`${LAN}/relay/`)).toBe(true);
    // The home-network door accepts it (same signing secret) and relays the master.
    const u = new URL(streams[0].url);
    const played = await lan.request(`${u.pathname}${u.search}`);
    expect(played.status).toBe(200);
    expect(await played.text()).toContain('https://cfvod.kaltura.com/x/index.m3u8');
    expect(geoCalls[0]).toContain('cdnapisec.kaltura.com');
  });

  test('from elsewhere: no relayed stream; Mako still plays through the tunnel', async () => {
    const { get } = setup();
    const r = await get('/stream/series/iltv_reshet_1:1:1.json', AWAY_IP);
    expect((await r.json()).streams).toEqual([]);
    const m = await (await get('/stream/series/iltv_mako_1:1:1.json', AWAY_IP)).json();
    expect(m.streams).toHaveLength(1);
    expect(m.streams[0].url).toMatch(new RegExp(`^https://tv\\.example\\.net/${token}/play/mako/`));
    // At home Mako still points through the tunnel (the same link keeps working when the phone leaves).
    const h = await (await get('/stream/series/iltv_mako_1:1:1.json', HOME_IP)).json();
    expect(h.streams[0].url).toMatch(new RegExp(`^https://tv\\.example\\.net/${token}/play/mako/`));
  });

  test('the tunnel door has no relay route, even from home and with a valid relay URL', async () => {
    const { get } = setup();
    const { streams } = await (await get('/stream/series/iltv_reshet_1:1:1.json', HOME_IP)).json();
    const u = new URL(streams[0].url);
    const r = await get(`${u.pathname}${u.search}`, HOME_IP);
    expect(r.status).toBe(404);
    expect(await r.text()).toBe('');
  });

  test('the manifest asks for Reshet and Kan too; neither address is ever logged or recorded', async () => {
    const { get, logs, events } = setup();
    const m = await (await get('/manifest.json', AWAY_IP)).json();
    expect(m.name).toBe('Israel TV · home helper');
    expect(m.resources[0].idPrefixes).toEqual(
      expect.arrayContaining(['iltv_reshet_', 'iltv_kan_', 'iltv_mako_']),
    );
    await get('/stream/series/iltv_reshet_1:1:1.json', HOME_IP);
    await get('/stream/series/iltv_reshet_1:1:1.json', AWAY_IP);
    const all = JSON.stringify({ logs, events });
    expect(logs.some((l) => l.includes('home address learned'))).toBe(true);
    expect(all).not.toContain(HOME_IP);
    expect(all).not.toContain(AWAY_IP);
  });

  test('without the home option, Reshet requests are a bare 404 as before', async () => {
    const app = createRemoteResolverApp(
      { token, publicUrl: 'https://tv.example.net', playsPerMinute: 30, requestsPerMinute: 240 },
      { episode, fetch: net },
    );
    const r = await app.request(`/${token}/stream/series/iltv_reshet_1:1:1.json`, {
      headers: { 'cf-connecting-ip': HOME_IP },
    });
    expect(r.status).toBe(404);
  });
});

describe('the home address', () => {
  test('IPv4 exact, IPv6 by its /64 network', () => {
    expect(networkOf('203.0.113.50')).toBe('203.0.113.50');
    expect(networkOf('::ffff:203.0.113.50')).toBe('203.0.113.50');
    expect(networkOf('2001:db8:1:2::abcd')).toBe('2001:db8:1:2');
    expect(networkOf('2001:0db8:0001:0002:1111:2222:3333:4444')).toBe('2001:db8:1:2');
    expect(networkOf('unknown')).toBeUndefined();
  });

  test('asked again after the refresh time, and on a mismatch at most once a minute', async () => {
    let t = 0;
    let ip = HOME_IP;
    let asks = 0;
    const h = homeAddress({
      fetch: async () => {
        asks++;
        return new Response(`ip=${ip}\n`);
      },
      urls: ['https://1.1.1.1/cdn-cgi/trace'],
      salt: 's',
      now: () => t,
    });
    expect(await h.isHome(HOME_IP)).toBe(true);
    expect(await h.isHome(AWAY_IP)).toBe(false);
    expect(asks).toBe(1); // a mismatch within the minute does not ask again
    ip = AWAY_IP; // the home address changed
    t = 61_000;
    expect(await h.isHome(AWAY_IP)).toBe(true);
    expect(asks).toBe(2);
    t = 61_000 + 10 * 60_000;
    ip = HOME_IP;
    expect(await h.isHome(HOME_IP)).toBe(true);
    expect(asks).toBe(3);
  });

  test('no answer keeps the last known address', async () => {
    let t = 0;
    let up = true;
    const h = homeAddress({
      fetch: async () => (up ? new Response(`ip=${HOME_IP}\n`) : new Response('', { status: 500 })),
      urls: ['https://1.1.1.1/cdn-cgi/trace'],
      salt: 's',
      now: () => t,
    });
    expect(await h.isHome(HOME_IP)).toBe(true);
    up = false;
    t = 20 * 60_000;
    expect(await h.isHome(HOME_IP)).toBe(true);
  });
});

describe('homeRelayProblem: why the tunnel link would play Mako and live channels only', () => {
  const proxy = { geo: { type: 'http-proxy', urls: ['https://proxy.example.net:89'] } };
  const env = {};
  const cfg = (resolver: Record<string, unknown>) =>
    parseConfig({
      ...proxy,
      resolver: { remote: { enabled: true, publicUrl: 'https://h.example.net' }, ...resolver },
    });

  test('names the missing home-network address', () => {
    expect(homeRelayProblem(cfg({}), env)).toMatch(/resolver\.remote\.home\.lanUrl is not set/);
  });

  test('nothing to report when the home-network address and a geo proxy are set', () => {
    const c = cfg({ remote: { enabled: true, publicUrl: 'https://h.example.net', home: { lanUrl: LAN } } });
    expect(homeRelayProblem(c, env)).toBeUndefined();
  });
});
