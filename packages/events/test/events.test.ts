import type { UsageEvent } from '@israel-tv/core';
import { expect, test } from 'vitest';
import { EventStore } from '../src/index.ts';

const day = '2026-11-05';
const ev = (e: Partial<UsageEvent>): UsageEvent => ({
  ts: `${day}T10:00:00.000Z`,
  kind: 'play_start',
  component: 'mako-auth',
  outcome: 'ok',
  source: 'mako',
  showId: 'iltv_mako_1',
  ...e,
});

test('events are batched, queried, rolled up per day, pruned and capped', () => {
  const db = EventStore.open(':memory:');
  db.record(ev({ client: 'a' }));
  db.record(ev({ client: 'b', playId: 'p1' }));
  db.record(ev({ kind: 'stream_request', client: 'c' }));
  db.record(ev({ kind: 'failure', outcome: 'error', client: 'a', status: 403 }));
  db.record(
    ev({
      kind: 'relay_session',
      component: 'geo-relay',
      source: 'reshet',
      showId: 'iltv_reshet_2',
      client: 'a',
      detail: { durationMs: 120_000 },
    }),
  );
  db.record(ev({ kind: 'run', component: 'ingest' }));
  expect(db.events({ playId: 'p1' })).toHaveLength(1);
  expect(db.events({ outcome: 'error' })[0]?.status).toBe(403);

  const now = Date.parse('2026-11-06T03:00:00Z');
  const r = db.maintain(now);
  expect(r.rolledUp).toEqual([day]);
  const rows = db.daily(day, 'home');
  const total = rows.find((x) => x.source === '' && x.showId === '');
  expect(total).toMatchObject({ plays: 3, uniqueClients: 3, failures: 1, minutesWatched: 2 });
  expect(rows.find((x) => x.source === 'mako' && x.showId === 'iltv_mako_1')).toMatchObject({
    plays: 2,
    uniqueClients: 3,
    failures: 1,
  });
  expect(rows.find((x) => x.source === 'reshet' && x.showId === '')).toMatchObject({
    plays: 1,
    minutesWatched: 2,
  });
  // Not rolled up twice; old raw events go after 30 days, rollups stay.
  expect(db.maintain(now).rolledUp).toEqual([]);
  db.maintain(now + 40 * 86_400_000);
  expect(db.events({})).toHaveLength(0);
  expect(db.daily(day, 'home').length).toBeGreaterThan(0);
  // Over the size cap it is flagged.
  db.record(ev({}));
  expect(db.maintain(now + 41 * 86_400_000, 1).overCap).toBe(true);
  expect(db.overCap()).toBe(true);
  expect(db.clientSalt()).toBe(db.clientSalt());
});

test('totals are not displaced by events without a source or show, and the canary is not usage', () => {
  const db = EventStore.open(':memory:');
  db.record(ev({ client: 'c1' }));
  db.record(ev({ client: 'c1', playId: 'p2' }));
  // An unmapped IMDb lookup: no source, no show.
  db.record({
    ts: `${day}T11:00:00.000Z`,
    kind: 'stream_request',
    component: 'resolver',
    outcome: 'error',
    client: 'c2',
    episodeId: 'tt1:1:1',
  });
  // The canary's own play.
  db.record(ev({ client: 'local', playId: 'canary-x' }));
  const rows = db.homeDay(day);
  expect(rows.find((r) => r.source === '' && r.showId === '')).toMatchObject({ plays: 2, uniqueClients: 2 });
  expect(rows.find((r) => r.source === 'mako' && r.showId === '')).toMatchObject({
    plays: 2,
    uniqueClients: 1,
  });
  expect(rows.filter((r) => r.source === '' && r.showId === '')).toHaveLength(1);
});
