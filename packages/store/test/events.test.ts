import { expect, test } from 'vitest';
import { Store } from '../src/store.ts';

const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

test('events: pulled ones are kept once, runs become ingest events, old ones are pruned', () => {
  const store = Store.open(':memory:');
  const ev = { kind: 'request' as const, origin: 'worker' as const, outcome: 'ok' as const, route: 'meta' };
  store.addEvents([{ ...ev, at: at(0), ext: 'ray1' }]);
  store.addEvents([{ ...ev, at: at(0), ext: 'ray1' }]);
  expect(store.events({ kind: 'request' })).toHaveLength(1);

  const run = store.startRun('full', 'mako');
  store.finishRun(run, { status: 'failed', error: 'HTTP 503' });
  const ingest = store.events({ kind: 'ingest' })[0];
  expect(ingest).toMatchObject({ source: 'mako', route: 'full', outcome: 'error', corr: `run:${run}` });
  expect(ingest?.reason).toContain('HTTP 503');

  store.addEvents([{ ...ev, at: at(31 * 86_400_000) }]);
  store.prune();
  expect(store.events({ kind: 'request' })).toHaveLength(1);
});

test('usage: unique clients per day and origin, plays and failures by source', () => {
  const store = Store.open(':memory:');
  const base = { origin: 'resolver' as const, at: at(0), source: 'mako', series: 'iltv_mako_1' };
  store.addEvents([
    { ...base, kind: 'stream', outcome: 'ok', client: 'a' },
    { ...base, kind: 'play', outcome: 'ok', client: 'a' },
    { ...base, kind: 'play', outcome: 'error', client: 'b', reason: 'Mako master HTTP 403' },
    { kind: 'request', origin: 'worker', outcome: 'ok', at: at(0), route: 'catalog', client: 'x' },
  ]);
  const u = store.usage();
  expect(u.clientsToday).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ origin: 'resolver', n: 2 }),
      expect.objectContaining({ origin: 'worker', n: 1 }),
    ]),
  );
  expect(u.bySource.find((r) => r.source === 'mako')).toMatchObject({ streams: 1, plays: 2, failures: 1 });
  expect(u.failures[0]?.reason).toBe('Mako master HTTP 403');
  expect(u.requests).toEqual([{ route: 'catalog', n: 1, errors: 0 }]);
  expect(store.clientSalt()).toBe(store.clientSalt());
});
