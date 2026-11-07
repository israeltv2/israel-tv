// The owner's admin API and dashboard: every answer fits its schema (packages/admin-contract), and the gate holds
// (token, CSRF on changes, no token in the address on the API, cross-site and odd origins refused).
import {
  DeploysSchema,
  FailuresSchema,
  HealthSchema,
  LiveSchema,
  OverviewSchema,
  PlaysSchema,
  SessionSchema,
  SourcesSchema,
  SystemSchema,
  TraceSchema,
} from '@israel-tv/admin-contract';
import { parseConfig } from '@israel-tv/core';
import { EventStore } from '@israel-tv/events';
import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import { adminApp, csrfFor, Daemon } from '../src/daemon.ts';

const quiet = { log: () => {}, for: () => () => {}, flush: () => {} };
const TOKEN = 'the-admin-token-for-tests';
const env = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const host = { host: '127.0.0.1:7702' };
const bearer = { ...host, authorization: `Bearer ${TOKEN}` };

function setup() {
  const events = EventStore.open(':memory:');
  const now = new Date().toISOString();
  events.record({
    ts: now,
    kind: 'play_start',
    component: 'mako-auth',
    outcome: 'ok',
    playId: 'p1',
    source: 'mako',
    showId: 'iltv_mako_1',
    episodeId: 'iltv_mako_1:1:2',
    latencyMs: 420,
  });
  events.record({
    ts: now,
    kind: 'failure',
    component: 'geo-relay',
    outcome: 'error',
    playId: 'p2',
    source: 'reshet',
    status: 403,
    detail: { stage: 'relay', reason: 'refused' },
  });
  events.flush();
  const store = Store.open(':memory:');
  store.setState('cloudflare:quota', {
    day: now.slice(0, 10),
    at: now,
    requests: 3293,
    byScript: [{ script: 'israel-tv', requests: 2049 }],
    aeWrites: 95,
    limits: { requests: 100000, aeWrites: 100000 },
  });
  const d = new Daemon(parseConfig({}), store, events, quiet);
  return { d, app: adminApp(d, TOKEN) };
}

test('every admin API answer fits its schema', async () => {
  const { app } = setup();
  const get = async (path: string) => {
    const r = await app.request(`/api/v1${path}`, { headers: bearer }, env);
    expect(r.status, path).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    return r.json();
  };
  SessionSchema.parse(await get('/session'));
  const h = HealthSchema.parse(await get('/health'));
  expect(h.problems.some((p) => p.section === 'failures')).toBe(true);
  const o = OverviewSchema.parse(await get('/overview'));
  expect(o.home.perDay).toHaveLength(30);
  SourcesSchema.parse(await get('/sources'));
  const p = PlaysSchema.parse(await get('/plays'));
  expect(p.firstPlaylistMs.n).toBe(1);
  const f = FailuresSchema.parse(await get('/failures'));
  expect(f.groups[0]).toMatchObject({
    source: 'reshet',
    stage: 'relay',
    status: 403,
    n: 1,
    lastPlayId: 'p2',
  });
  const t = TraceSchema.parse(await get('/trace/p2'));
  expect(t.events[0]?.kind).toBe('failure');
  LiveSchema.parse(await get('/live'));
  DeploysSchema.parse(await get('/deploys'));
  const s = SystemSchema.parse(await get('/system'));
  expect(s.eventsPerDay).toHaveLength(30);
  expect(s.quota?.requests).toBe(3293);
});

test('the gate: token, CSRF on changes, no token in the address on the API, odd origins refused', async () => {
  const { app } = setup();
  expect((await app.request('/api/v1/session', { headers: host }, env)).status).toBe(404);
  expect((await app.request(`/api/v1/session?token=${TOKEN}`, { headers: host }, env)).status).toBe(404);
  const cookie = { ...host, cookie: `iltv_admin=${TOKEN}` };
  expect((await app.request('/api/v1/actions/canary', { method: 'POST', headers: cookie }, env)).status).toBe(
    403,
  );
  const wrongCsrf = { ...cookie, 'x-israel-tv-csrf': 'nope' };
  expect(
    (await app.request('/api/v1/actions/refresh/iltv_mako_1', { method: 'POST', headers: wrongCsrf }, env))
      .status,
  ).toBe(403);
  const withCsrf = { ...cookie, 'x-israel-tv-csrf': csrfFor(TOKEN) };
  const refresh = await app.request(
    '/api/v1/actions/refresh/iltv_mako_999',
    { method: 'POST', headers: withCsrf },
    env,
  );
  expect(refresh.status).toBe(404); // unknown show: refused with a reason, not run
  expect(await refresh.json()).toMatchObject({ accepted: false });
  // Scripts with the bearer token need no CSRF value.
  expect(
    (await app.request('/api/v1/actions/refresh/iltv_mako_999', { method: 'POST', headers: bearer }, env))
      .status,
  ).toBe(404);
  expect((await app.request('/api/v1/session', { headers: { ...bearer, origin: 'null' } }, env)).status).toBe(
    403,
  );
  expect(
    (await app.request('/api/v1/session', { headers: { ...bearer, origin: 'http://evil.example' } }, env))
      .status,
  ).toBe(403);
  expect((await app.request('/events.json?limit=99999', { headers: bearer }, env)).status).toBe(400);
  expect((await app.request('/events.json?sql=1', { headers: bearer }, env)).status).toBe(400);
  expect((await app.request('/api/v1/trace/..%2F..', { headers: bearer }, env)).status).toBe(400);
});

test('the dashboard page: served with a strict policy and a fresh nonce; its built files load; the live stream starts with a snapshot', async () => {
  const { app } = setup();
  const page = await app.request('/dash/', { headers: bearer }, env);
  expect(page.status).toBe(200);
  const csp = page.headers.get('content-security-policy') ?? '';
  expect(csp).toContain("script-src 'self';");
  expect(csp).toMatch(/style-src 'self' 'nonce-[A-Za-z0-9+/=]{20,}'/);
  expect(csp).toContain("frame-ancestors 'none'");
  const html = await page.text();
  expect(html).not.toContain('__CSP_NONCE__');
  // The built page (CI builds before testing) loads its own hashed files only, cached for good.
  for (const src of [...html.matchAll(/(?:src|href)="\/dash\/(assets\/[^"]+)"/g)].map((m) => m[1])) {
    const r = await app.request(`/dash/${src}`, { headers: bearer }, env);
    expect(r.status, src).toBe(200);
    expect(r.headers.get('cache-control')).toContain('immutable');
  }
  expect((await app.request('/dash/../package.json', { headers: bearer }, env)).status).toBe(404);
  expect((await app.request('/dash/assets/nope.js', { headers: bearer }, env)).status).toBe(404);
  const stream = await app.request('/api/v1/live/stream', { headers: bearer }, env);
  expect(stream.headers.get('content-type')).toMatch(/text\/event-stream/);
  const reader = stream.body?.getReader();
  const first = new TextDecoder().decode((await reader?.read())?.value);
  expect(first).toMatch(/event: live/);
  await reader?.cancel();
});

test("every row's image is the one the catalog publishes: a show's poster, a channel's logo (square), never the placeholder", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { artOf } = await import('../src/admin-api.ts');
  const dir = mkdtempSync(join(tmpdir(), 'iltv-art-'));
  const put = (type: string, id: string, meta: object) => {
    mkdirSync(join(dir, 'meta', type), { recursive: true });
    writeFileSync(join(dir, 'meta', type, `${id}.json`), JSON.stringify({ meta }));
  };
  const site = 'https://addon.example.workers.dev';
  put('series', 'iltv_mako_1', { poster: 'https://img.example/p.jpg' });
  put('series', 'iltv_kan_2', { poster: `${site}/art/iltv_kan_2.jpg` });
  // A Kan show whose image could not be copied yet: the catalog shows its generic placeholder.
  put('series', 'iltv_kan_17', { poster: `${site}/art/placeholder-poster.jpg` });
  put('series', 'iltv_reshet_3', { poster: '{{israel-tv-origin}}/art/iltv_reshet_3-poster.jpg' });
  put('tv', 'iltv_live_keshet12', {
    posterShape: 'square',
    poster: `${site}/logos/iltv_live_keshet12.png`,
    logo: `${site}/logos/iltv_live_keshet12.png`,
  });
  const config = parseConfig({ publisher: { type: 'cloudflare', dir, publicUrl: site } });
  const d = new Daemon(config, Store.open(':memory:'), EventStore.open(':memory:'), quiet);
  expect(artOf(d, 'iltv_mako_1')).toEqual({ poster: 'https://img.example/p.jpg' });
  expect(artOf(d, 'iltv_kan_2')).toEqual({ poster: `${site}/art/iltv_kan_2.jpg` });
  expect(artOf(d, 'iltv_kan_17')).toEqual({});
  expect(artOf(d, 'iltv_reshet_3')).toEqual({ poster: `${site}/art/iltv_reshet_3-poster.jpg` });
  // Live channels are published as `tv`, not `series`: their logo, marked square.
  expect(artOf(d, 'iltv_live_keshet12')).toEqual({
    poster: `${site}/logos/iltv_live_keshet12.png`,
    posterShape: 'square',
  });
  expect(artOf(d, 'iltv_mako_404')).toEqual({});
  expect(artOf(d, '../../etc/passwd')).toEqual({});
  expect(artOf(d, undefined)).toEqual({});
});

test('nothing the admin app answers is indexed', async () => {
  const { app } = setup();
  for (const path of ['/dash/', '/api/v1/session', '/status', '/nope'])
    expect((await app.request(path, { headers: bearer }, env)).headers.get('x-robots-tag'), path).toBe(
      'noindex, nofollow',
    );
  // Its own icons (told apart from the public pages' tab), linked from the page.
  const page = await (await app.request('/dash/', { headers: bearer }, env)).text();
  for (const icon of ['favicon-32.png', 'favicon-192.png', 'apple-touch-icon.png']) {
    expect(page).toContain(`/dash/${icon}`);
    const r = await app.request(`/dash/${icon}`, { headers: bearer }, env);
    expect(r.status, icon).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
  }
  expect(page).toMatch(/<meta name="robots" content="noindex, nofollow"/);
  expect(page).toMatch(/<meta name="theme-color"/);
  // Refused requests too (no token).
  expect((await app.request('/dash/', { headers: host }, env)).headers.get('x-robots-tag')).toBe(
    'noindex, nofollow',
  );
});
