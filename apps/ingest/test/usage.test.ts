import { ConfigSchema } from '@israel-tv/core';
import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import { workerConfig } from '../src/publish.ts';
import { renderUsagePage } from '../src/usage-page.ts';
import { pullWorkerEvents, toUsageEvent } from '../src/worker-events.ts';

const cf = (requestLogs = true) =>
  ConfigSchema.parse({ publisher: { type: 'cloudflare', workerName: 'w', dir: '/tmp/site', requestLogs } });

test('Workers Logs events: only our own request lines are taken, recorded once', async () => {
  const store = Store.open(':memory:');
  const now = Date.parse('2026-11-06T12:00:00Z');
  const ours = {
    ev: 'iltv',
    kind: 'request',
    route: 'meta',
    series: 'iltv_mako_1',
    status: 200,
    outcome: 'ok',
    ms: 4,
    corr: 'ray1',
    client: 'abc',
  };
  const events = [
    { timestamp: now - 60_000, source: ours },
    { timestamp: now - 50_000, source: { level: 'info', message: 'GET /' } },
  ];
  const calls: unknown[] = [];
  const fakeFetch = (async (_url: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body));
    return Response.json({ success: true, result: { events: { events } } });
  }) as unknown as typeof fetch;
  const env = { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' };
  expect(await pullWorkerEvents(store, cf(), env, fakeFetch, now)).toBe(2);
  await pullWorkerEvents(store, cf(), env, fakeFetch, now + 600_000);
  const got = store.events({ kind: 'request' });
  expect(got).toHaveLength(1);
  expect(got[0]).toMatchObject({
    origin: 'worker',
    route: 'meta',
    series: 'iltv_mako_1',
    client: 'abc',
    status: 200,
  });
  expect(calls[0]).toMatchObject({ parameters: { filters: [{ key: '$metadata.service', value: 'w' }] } });
  expect(toUsageEvent({ timestamp: 1, source: { ev: 'other' } })).toBeUndefined();
  // Off when request logs are off, or without credentials.
  expect(await pullWorkerEvents(store, cf(false), env, fakeFetch, now)).toBe(0);
  expect(await pullWorkerEvents(store, cf(), {}, fakeFetch, now)).toBe(0);
});

test('the deployed Worker runs first only with request logs on, and never keeps invocation logs', () => {
  const dir = new URL('../../catalog', import.meta.url).pathname;
  const on = workerConfig(cf().publisher as never, dir) as {
    assets: Record<string, unknown>;
    observability: unknown;
    main: string;
  };
  expect(on.assets.run_worker_first).toBe(true);
  expect(on.assets.directory).toBe('/tmp/site');
  expect(on.observability).toEqual({ enabled: true, logs: { enabled: true, invocation_logs: false } });
  expect(on.main.endsWith('/catalog/src/worker.ts')).toBe(true);
  const off = workerConfig(cf(false).publisher as never, dir) as { assets: Record<string, unknown> };
  expect(off.assets.run_worker_first).toBeUndefined();
});

test('the usage page escapes everything it shows', () => {
  const html = renderUsagePage(
    {
      clientsToday: [],
      clientsByDay: [],
      bySource: [],
      byShow: [{ source: 'mako', series: 'iltv_mako_1', title: null, streams: 1, plays: 1, failures: 0 }],
      requests: [],
      failures: [],
    },
    [],
    () => '<script>alert(1)</script>',
  );
  expect(html).not.toContain('<script>');
  expect(html).toContain('&#60;script&#62;');
});

test('the Worker fingerprint follows its config', async () => {
  const { workerFingerprint } = await import('../src/publish.ts');
  const a = workerFingerprint(cf().publisher as never);
  expect(workerFingerprint(cf().publisher as never)).toBe(a);
  expect(workerFingerprint(cf(false).publisher as never)).not.toBe(a);
});
