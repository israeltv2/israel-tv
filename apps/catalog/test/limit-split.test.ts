import { expect, test } from 'vitest';
import api from '../src/api.ts';
import { route } from '../src/router.ts';

test('through the router, one client is refused after its limit', async () => {
  const site: Record<string, string> = {
    'search.json': '[]',
    'freshness.json': '{"publishedAt":"2026-11-06T00:00:00Z","sources":{},"catalogs":{}}',
  };
  const ASSETS = {
    fetch: async (r: Request) => {
      const p = new URL(r.url).pathname.slice(1);
      return p in site ? new Response(site[p]) : new Response('', { status: 404 });
    },
  } as unknown as Fetcher;
  const ctx = { waitUntil() {} } as unknown as ExecutionContext;
  const API = {
    fetch: (i: string, init: RequestInit) =>
      api.fetch(new Request(i, init), { CLIENT_SALT: 's' } as never, ctx),
  } as unknown as Fetcher;
  const codes: number[] = [];
  for (let i = 0; i < 70; i++)
    codes.push(
      (
        await route(
          new Request(`https://h/catalog/series/iltv_keshet12/search=q${i}.json`, {
            headers: { 'cf-connecting-ip': '198.51.100.9' },
          }),
          { ASSETS, API },
        )
      ).status,
    );
  expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
});
