import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '@israel-tv/core';
import { EventStore } from '@israel-tv/events';
import { createLogger, scrub } from '@israel-tv/runtime';
import { expect, test } from 'vitest';
import { pullPublicUsage } from '../src/public-usage.ts';
import { workerConfig, workerFingerprint } from '../src/publish.ts';
import { buildDashboard, renderUsagePage } from '../src/usage-page.ts';

const cf = () => ConfigSchema.parse({ publisher: { type: 'cloudflare', workerName: 'w', dir: '/tmp/site' } });
const env = { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ACCOUNT_ID: 'acc' };

test('public usage: Analytics Engine when readable, else Workers Logs, into the daily rollups', async () => {
  const events = EventStore.open(':memory:');
  const calls: string[] = [];
  const agg = (groups: Record<string, string>, plays: number, clients: number) => ({
    groups: Object.entries(groups).map(([key, value]) => ({ key, value })),
    value: plays,
    clients,
  });
  const fakeFetch = (async (url: string, init: { body: string }) => {
    calls.push(url);
    if (url.endsWith('/analytics_engine/sql')) return new Response('Authorization error', { status: 403 });
    const q = JSON.parse(init.body) as {
      parameters: { groupBys: { value: string }[]; filters: { key: string }[] };
    };
    const keys = q.parameters.groupBys.map((g) => g.value).join(',');
    const errorsOnly = q.parameters.filters.some((f) => f.key === 'outcome');
    const n = errorsOnly ? 1 : 5;
    const rows =
      keys === 'source,series'
        ? [agg({ source: 'mako', series: 'iltv_mako_1' }, n, 2)]
        : keys === 'source'
          ? [agg({ source: 'mako' }, n, 2)]
          : [agg({}, n, 2)];
    return Response.json({
      success: true,
      result: {
        calculations: [
          { alias: 'plays', aggregates: rows.map((r) => ({ groups: r.groups, value: r.value })) },
          { alias: 'clients', aggregates: rows.map((r) => ({ groups: r.groups, value: r.clients })) },
        ],
      },
    });
  }) as unknown as typeof fetch;
  const r = await pullPublicUsage(events, cf(), '2026-11-05', env, fakeFetch);
  expect(r).toMatchObject({ via: 'workers-logs', rows: 3 });
  expect(r?.note).toContain('Account Analytics: Read');
  const rows = events.daily('2026-11-05', 'public');
  expect(rows.find((x) => x.showId === 'iltv_mako_1')).toMatchObject({
    plays: 5,
    uniqueClients: 2,
    failures: 1,
  });
  expect(rows.find((x) => x.source === '' && x.showId === '')).toMatchObject({
    plays: 5,
    uniqueClients: 2,
    failures: 1,
  });
  expect(calls[0]).toContain('/analytics_engine/sql');
  // Local publisher, or no credentials: nothing to read.
  expect(await pullPublicUsage(events, ConfigSchema.parse({}), '2026-11-05', env, fakeFetch)).toBeUndefined();
  expect(await pullPublicUsage(events, cf(), '2026-11-05', {}, fakeFetch)).toBeUndefined();
});

test('the Worker runs only for rows and files with image URLs, counts streams in Analytics Engine, keeps no invocation logs', () => {
  const dir = new URL('../../catalog', import.meta.url).pathname;
  const c = workerConfig(cf().publisher as never, dir) as {
    assets: Record<string, unknown>;
    observability: unknown;
    analytics_engine_datasets: unknown;
    main: string;
  };
  expect(c.assets.run_worker_first).toEqual(['/manifest.json', '/catalog/*', '/meta/*']);
  expect(c.observability).toEqual({
    enabled: true,
    head_sampling_rate: 1,
    logs: { enabled: true, invocation_logs: false },
  });
  expect(c.analytics_engine_datasets).toEqual([{ binding: 'USAGE', dataset: 'israel_tv_usage' }]);
  expect(c.main.endsWith('/catalog/src/worker.ts')).toBe(true);
  expect(workerFingerprint(cf().publisher as never)).toBe(workerFingerprint(cf().publisher as never));
});

test('the dashboard labels both views, says what each cannot see, and escapes what it shows', () => {
  const events = EventStore.open(':memory:');
  events.record({
    ts: new Date().toISOString(),
    kind: 'play_start',
    component: 'mako-auth',
    outcome: 'ok',
    source: 'mako',
    showId: 'iltv_mako_1',
    client: 'a',
  });
  const d = buildDashboard(events, { active: [], title: () => '<script>x</script>', ingest: [], canary: [] });
  expect(d.home.today).toMatchObject({ plays: 1, uniqueAvg: 1 });
  const html = renderUsagePage(d);
  expect(html).toContain('This home (resolver)');
  expect(html).toContain('Public addon (all users, anonymous)');
  expect(html).toContain("cannot see other people's resolvers");
  expect(html).toContain('cannot see catalog browsing');
  expect(html).not.toContain('<script>x');
});

test('a secret never reaches a log line, wherever it appears', async () => {
  const secret = 'S3cr3t-T0ken-value-123';
  expect(scrub({ url: `https://h/p/${secret}/manifest.json`, nested: { a: [secret] } }, [secret])).toEqual({
    url: 'https://h/p/[redacted]/manifest.json',
    nested: { a: ['[redacted]'] },
  });
  const dir = mkdtempSync(join(tmpdir(), 'log-'));
  const logger = createLogger(
    { file: join(dir, 'israel-tv.log'), maxMB: 1, keep: 2, level: 'info' },
    { MY_REMOTE_TOKEN: secret },
  );
  const log = logger.for('mako-auth');
  log(`request for /${secret}/manifest.json`, {
    path: `/${secret}/stream`,
    token: 'abc-def-ghi',
    error: new Error(`bad ${secret}`),
  });
  logger.flush();
  let text = '';
  for (let i = 0; i < 50 && !text.includes('manifest'); i++) {
    await new Promise((r) => setTimeout(r, 50));
    text = readdirSync(dir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('');
  }
  expect(text).toContain('"component":"mako-auth"');
  expect(text).toContain('[redacted]');
  expect(text).not.toContain(secret);
  expect(text).not.toContain('abc-def-ghi');
});

test('account ids count as secrets too', async () => {
  const { secretValues } = await import('@israel-tv/runtime');
  expect(secretValues({ CLOUDFLARE_ACCOUNT_ID: 'a2b3c4d5e6f7', HOME: '/Users/x' })).toEqual(['a2b3c4d5e6f7']);
});

test('the Worker deploys without Analytics Engine when the account has not enabled it', async () => {
  const dir = new URL('../../catalog', import.meta.url).pathname;
  const on = workerConfig(cf().publisher as never, dir, true) as Record<string, unknown>;
  const off = workerConfig(cf().publisher as never, dir, false) as Record<string, unknown>;
  expect(on.analytics_engine_datasets).toBeDefined();
  expect(off.analytics_engine_datasets).toBeUndefined();
  expect(workerFingerprint(cf().publisher as never, true)).not.toBe(
    workerFingerprint(cf().publisher as never, false),
  );
  const { Store } = await import('@israel-tv/store');
  const { analyticsWanted, ANALYTICS_OFF } = await import('../src/publish.ts');
  const store = Store.open(':memory:');
  expect(analyticsWanted(store)).toBe(true);
  store.setState(ANALYTICS_OFF, { at: new Date().toISOString() });
  expect(analyticsWanted(store)).toBe(false);
  expect(analyticsWanted(store, Date.now() + 8 * 86_400_000)).toBe(true);
});

test('a failed deploy never puts the account id (or any secret) into the published status', async () => {
  const { publishError, buildStatus } = await import('../src/publish.ts');
  const { Store } = await import('@israel-tv/store');
  const id = '0123456789abcdef0123456789abcdef';
  const env = { CLOUDFLARE_ACCOUNT_ID: id, CLOUDFLARE_API_TOKEN: 'tok-tok-tok-123' };
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const err = publishError(
      `✘ [ERROR] A request to the Cloudflare API (/accounts/${id}/workers/scripts/israel-tv/versions) failed.\nAuthentication error [code: 10000] tok-tok-tok-123\n`,
      1,
      { apiTokenEnv: 'CLOUDFLARE_API_TOKEN', accountIdEnv: 'CLOUDFLARE_ACCOUNT_ID' },
    );
    expect(err.message).not.toContain(id);
    expect(err.message).not.toContain('tok-tok-tok-123');
    const store = Store.open(':memory:');
    const run = store.startRun('publish', 'cloudflare');
    // An error stored before this fix (raw) must not reach the status either.
    store.finishRun(run, {
      status: 'failed',
      error: `Cloudflare deploy failed: (/accounts/${id}/workers) x`,
    });
    const status = JSON.stringify(buildStatus(store, ['mako']));
    expect(status).toContain('last publish failed');
    expect(status).not.toContain(id);
  } finally {
    process.env = saved;
  }
});

test('with the public address known, image URLs are absolute and only catalog rows run the Worker', async () => {
  const { renderFromStore, workerConfig } = await import('../src/publish.ts');
  const { Store } = await import('@israel-tv/store');
  const dir = new URL('../../catalog', import.meta.url).pathname;
  const known = workerConfig(cf().publisher as never, dir, true, true) as { assets: Record<string, unknown> };
  expect(known.assets.run_worker_first).toEqual(['/catalog/*']);
  const config = ConfigSchema.parse({
    publisher: {
      type: 'cloudflare',
      workerName: 'w',
      dir: '/tmp/site',
      publicUrl: 'https://tv.example.net/',
    },
    sources: { mako: false, reshet: false, kan: false, live: true },
  });
  const files = renderFromStore(Store.open(':memory:'), config);
  const manifest = String(files.get('manifest.json'));
  expect(manifest).toContain('"logo":"https://tv.example.net/logo.png"');
  for (const [path, content] of files)
    if (typeof content === 'string') expect(content, path).not.toContain('{{israel-tv-origin}}');
});

test('each role says plainly what it needs and what does not belong', async () => {
  const { checkRole } = await import('@israel-tv/runtime');
  const parse = (o: object) => ConfigSchema.parse(o);
  expect(() => checkRole(parse({ role: 'resolver-only' }))).toThrow(/resolver\.catalogUrl/);
  expect(() =>
    checkRole(
      parse({
        role: 'resolver-only',
        resolver: { catalogUrl: 'https://a.example/manifest.json' },
        publisher: { type: 'cloudflare' },
      }),
    ),
  ).toThrow(/remove publisher/);
  expect(() =>
    checkRole(parse({ role: 'resolver-only', resolver: { catalogUrl: 'https://a.example/manifest.json' } })),
  ).not.toThrow();
  expect(() => checkRole(parse({ role: 'local-only', publisher: { type: 'cloudflare' } }))).toThrow(/local/);
  expect(() => checkRole(parse({}))).not.toThrow(); // no role: local publisher means local-only
  expect(() => checkRole(parse({ role: 'host' }))).toThrow(/publishes to Cloudflare/);
  expect(() => checkRole(parse({ resolver: { catalogUrl: 'https://a.example/' } }))).toThrow(
    /only for role "resolver-only"/,
  );
  const { roleOf } = await import('@israel-tv/core');
  expect(roleOf(parse({ publisher: { type: 'cloudflare' } }))).toBe('host');
  expect(roleOf(parse({}))).toBe('local-only');
  // A resolver-only config needs no Cloudflare or TMDB secret.
  const { secretOwners } = await import('@israel-tv/core');
  expect(
    secretOwners(parse({ role: 'resolver-only', resolver: { catalogUrl: 'https://a.example/' } })),
  ).toEqual([]);
});
