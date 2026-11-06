// Contract tests for the two-Worker layout: the data Worker's router and the private API Worker, wired together
// in process (the service binding is a function call here), with the catalog as fake static assets.
import { ENVELOPE_PATH, NEED_HEADER, ROUTER_CONTRACT_VERSION } from '@israel-tv/core/router-contract';
import { expect, test } from 'vitest';
import api from '../src/api.ts';
import { route } from '../src/router.ts';

const now = new Date().toISOString();
const site: Record<string, string> = {
  'catalog/series/iltv_keshet12.json': JSON.stringify({
    metas: [
      { id: 'iltv_mako_1', type: 'series', name: 'הצגה', poster: 'https://x.example/art/iltv_mako_1.jpg' },
    ],
  }),
  'freshness.json': JSON.stringify({
    publishedAt: now,
    sources: { mako: { lastGoodAt: now, cadenceHours: 24 } },
    catalogs: { iltv_keshet12: 'mako' },
  }),
  'search.json': JSON.stringify([
    ['iltv_mako_1', 'series', 'iltv_keshet12', 'הצגה', 'הצגה', 'https://x.example/art/iltv_mako_1.jpg'],
  ]),
};

function wire(env: Record<string, unknown> = {}) {
  const assetReads: string[] = [];
  const apiCalls: unknown[] = [];
  const ASSETS = {
    async fetch(req: Request) {
      const path = new URL(req.url).pathname.slice(1);
      assetReads.push(path);
      return path in site ? new Response(site[path]) : new Response('', { status: 404 });
    },
  } as unknown as Fetcher;
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const API = {
    async fetch(input: string, init: RequestInit) {
      const req = new Request(input, init);
      apiCalls.push(JSON.parse(String(init.body)));
      return api.fetch(req, { CLIENT_SALT: 'salt', ...env } as never, ctx);
    },
  } as unknown as Fetcher;
  const get = (path: string, ip = '203.0.113.7') =>
    route(
      new Request(`https://israel-tv.example.workers.dev${path}`, { headers: { 'cf-connecting-ip': ip } }),
      {
        ASSETS,
        API,
      },
    );
  return { get, assetReads, apiCalls };
}

test('router → API: a row is answered with files read from the assets, then from the API’s cache', async () => {
  const w = wire();
  const res = await w.get('/catalog/series/iltv_keshet12.json');
  expect(res.status).toBe(200);
  const body = (await res.json()) as { metas: { id: string }[] };
  expect(body.metas.map((m) => m.id)).toContain('iltv_mako_1');
  expect(w.assetReads).toEqual(
    expect.arrayContaining(['catalog/series/iltv_keshet12.json', 'freshness.json']),
  );
  // Every envelope carried the contract version and the client's address (the API has no public URL).
  for (const e of w.apiCalls as { v: number; client: string }[]) {
    expect(e.v).toBe(ROUTER_CONTRACT_VERSION);
    expect(e.client).toBe('203.0.113.7');
  }
  const rounds = w.apiCalls.length;
  expect(rounds).toBeGreaterThan(1);
  await w.get('/catalog/series/iltv_keshet12.json');
  expect(w.apiCalls.length - rounds).toBe(1); // the files are kept for a minute
});

test('router → API: search works through the same exchange', async () => {
  const w = wire();
  const res = await w.get(`/catalog/series/iltv_keshet12/search=${encodeURIComponent('הצגה')}.json`);
  expect(res.status).toBe(200);
  expect(((await res.json()) as { metas: { id: string }[] }).metas[0]?.id).toBe('iltv_mako_1');
});

test('the API refuses a router contract version it does not speak, plainly (a page on /status)', async () => {
  const ctx = { waitUntil() {} } as unknown as ExecutionContext;
  const send = (envelope: unknown) =>
    api.fetch(
      new Request(`https://api.internal${ENVELOPE_PATH}`, { method: 'POST', body: JSON.stringify(envelope) }),
      {} as never,
      ctx,
    );
  const row = await send({
    v: ROUTER_CONTRACT_VERSION + 1,
    method: 'GET',
    url: 'https://h/catalog/series/x.json',
    headers: {},
    files: {},
  });
  expect(row.status).toBe(500);
  expect(((await row.json()) as { error: string }).error).toMatch(/contract version 2, this API speaks 1/);
  const status = await send({ v: 99, method: 'GET', url: 'https://h/status', headers: {}, files: {} });
  expect(status.status).toBe(500);
  expect(status.headers.get('content-type')).toMatch(/html/);
  expect(await status.text()).toMatch(/contract version 99/);
  // Anything that is not an envelope from a router: nothing.
  const direct = await api.fetch(new Request('https://api.internal/catalog/series/x.json'), {} as never, ctx);
  expect(direct.status).toBe(404);
});

test('the router answers 503 when the API is missing, and gives no file it should not', async () => {
  const ASSETS = { fetch: async () => new Response('secret?') } as unknown as Fetcher;
  const down = await route(new Request('https://h/stream/series/x.json'), {
    ASSETS,
    API: {
      fetch: async () => {
        throw new Error('no such service');
      },
    } as unknown as Fetcher,
  });
  expect(down.status).toBe(503);
  const greedy = await route(new Request('https://h/stream/series/x.json'), {
    ASSETS,
    API: {
      fetch: async () =>
        Response.json({ need: ['../../etc/passwd'] }, { status: 409, headers: { [NEED_HEADER]: '1' } }),
    } as unknown as Fetcher,
  });
  expect(greedy.status).toBe(503);
});

test('a request is rate-limited once, not once per round', async () => {
  let counted = 0;
  const w = wire({
    RATE_STREAM: {
      limit: async () => {
        counted++;
        return { success: true };
      },
    },
  });
  const before = w.apiCalls.length;
  expect((await w.get('/stream/series/iltv_mako_1:1:1.json')).status).toBe(200);
  expect(w.apiCalls.length - before).toBeGreaterThanOrEqual(2); // asked for the season's stream file first
  expect(counted).toBe(1);
});
