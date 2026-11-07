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

test('a relay session that delivered nothing is a failure, not a play', () => {
  const db = EventStore.open(':memory:');
  db.record(
    ev({
      kind: 'relay_session',
      component: 'geo-relay',
      outcome: 'error',
      client: 'a',
      source: 'reshet',
      showId: 'iltv_reshet_1',
      detail: { segments: 0 },
    }),
  );
  db.record(
    ev({
      kind: 'relay_session',
      component: 'geo-relay',
      outcome: 'ok',
      client: 'a',
      source: 'reshet',
      showId: 'iltv_reshet_1',
      detail: { segments: 4, durationMs: 60_000 },
    }),
  );
  expect(db.homeDay(day).find((r) => r.source === '' && r.showId === '')).toMatchObject({ plays: 1 });
});

test('every event time is stored as an ISO UTC string, whatever the writer handed in (seconds, ms, Date)', async () => {
  const { eventTime } = await import('../src/index.ts');
  const iso = '2026-11-07T01:02:03.000Z';
  const ms = Date.parse(iso);
  expect(eventTime(iso)).toBe(iso);
  expect(eventTime(ms)).toBe(iso);
  expect(eventTime(ms / 1000)).toBe(iso);
  expect(eventTime(String(ms / 1000))).toBe(iso);
  expect(eventTime(new Date(ms))).toBe(iso);
  expect(eventTime('nonsense', ms)).toBe(iso);
  const s = EventStore.open(':memory:');
  s.record(ev({ ts: (ms / 1000) as never }));
  expect(s.events()[0]?.ts).toBe(iso);
});

test('internal traffic (canary-, probe- play ids) stays out of rollups and failure groups, but is queryable', () => {
  const s = EventStore.open(':memory:');
  s.record(ev({ kind: 'failure', outcome: 'error', playId: 'probe-direct-1', detail: { reason: 'x' } }));
  s.record(ev({ kind: 'play_start', playId: 'canary-abc' }));
  s.record(ev({ kind: 'play_start', playId: 'viewer1', client: 'c1' }));
  const total = s.homeDay(day).find((r) => r.source === '' && r.showId === '');
  expect(total).toMatchObject({ plays: 1, failures: 0 });
  expect(s.failuresByReason(`${day}T00:00:00Z`)).toEqual([]);
  expect(s.events({ viewersOnly: true }).map((e) => e.playId)).toEqual(['viewer1']);
  expect(s.events({ playId: 'probe-direct-1' })).toHaveLength(1);
});

test('once, old failures for ids that are not episode ids at all are retagged as probes', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const path = join(mkdtempSync(join(tmpdir(), 'iltv-events-')), 'events.sqlite');
  const a = EventStore.open(path);
  a.record(ev({ kind: 'failure', outcome: 'error', playId: 'direct-mw5axju9', episodeId: 'x' }));
  a.record(ev({ kind: 'failure', outcome: 'error', playId: 'p2', episodeId: 'iltv_mako_15:9:46' }));
  a.db.$client.exec("delete from meta where key = 'fix:probe-ids'");
  a.close();
  const b = EventStore.open(path);
  expect(
    b
      .events({ kind: 'failure' })
      .map((e) => e.playId)
      .sort(),
  ).toEqual(['p2', 'probe-direct-mw5axju9']);
  b.close();
});

test('once, the canary plays from before its plays were tagged are retagged, and their days rolled up again', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const path = join(mkdtempSync(join(tmpdir(), 'iltv-events-')), 'events.sqlite');
  const a = EventStore.open(path);
  const ep = 'iltv_mako_15:9:46';
  const at = (s: string) => `${day}T12:${s}Z`;
  const live = { source: 'live', showId: 'iltv_live_reshet13' };
  const failed = { kind: 'failure', outcome: 'error' } as const;
  const canary = { kind: 'canary', component: 'canary' } as const;
  // The canary's own plays (untagged then): asked, one failed, reported a few seconds later.
  a.record(ev({ ts: at('09:31.730'), kind: 'stream_request', playId: 'c1', episodeId: ep, client: 'k' }));
  a.record(ev({ ts: at('09:32.972'), ...failed, playId: 'c1', episodeId: ep, client: 'k' }));
  a.record(ev({ ts: at('09:36.916'), kind: 'stream_request', playId: 'c2', ...live, client: 'k' }));
  a.record(ev({ ts: at('09:37.470'), ...canary, outcome: 'error', episodeId: ep }));
  a.record(ev({ ts: at('09:37.471'), ...canary, ...live }));
  // A viewer on the same channel at the same moment as the canary: not the canary's (another client).
  a.record(ev({ ts: at('09:20.000'), kind: 'stream_request', playId: 'v0', ...live, client: 'v' }));
  a.record(ev({ ts: at('09:21.000'), ...failed, playId: 'v0', ...live, client: 'v' }));
  // Someone else's play of the same title, minutes later: not the canary's.
  a.record(ev({ ts: at('12:22.191'), kind: 'stream_request', playId: 'v1', episodeId: ep, client: 'v' }));
  a.record(ev({ ts: at('12:22.833'), ...failed, playId: 'v1', episodeId: ep, client: 'v' }));
  a.record(ev({ ts: at('13:29.974'), ...canary, episodeId: ep }));
  // From here on the canary tags its plays itself.
  a.record(
    ev({ ts: at('35:38.964'), kind: 'stream_request', playId: 'canary-x', episodeId: ep, client: 'k' }),
  );
  a.maintain(Date.parse('2026-11-06T03:00:00Z'));
  const total = (s: EventStore) => s.daily(day, 'home').find((r) => r.source === '' && r.showId === '');
  expect(total(a)?.failures).toBe(3);
  a.db.$client.exec("delete from meta where key = 'fix:canary-plays'");
  a.close();
  const b = EventStore.open(path);
  expect([...new Set(b.events({ kind: 'stream_request' }).map((e) => e.playId))].sort()).toEqual([
    'canary-c1',
    'canary-c2',
    'canary-x',
    'v0',
    'v1',
  ]);
  expect(b.events({ kind: 'failure', viewersOnly: true }).map((e) => e.playId)).toEqual(['v1', 'v0']);
  expect(total(b)?.failures).toBe(2);
  expect(JSON.parse(b.getMeta('fix:canary-plays') ?? '{}')).toMatchObject({ plays: 2 });
  b.close();
});

test('counting starts on the first event (home) or the first daily total (public), not before', () => {
  const s = EventStore.open(':memory:');
  expect(s.countedSince('home')).toBeUndefined();
  expect(s.countedSince('public')).toBeUndefined();
  s.record(ev({ ts: '2026-11-04T23:30:00.000Z', kind: 'run', component: 'ingest' }));
  const zero = { source: '', showId: '', plays: 0, uniqueClients: 0, failures: 0, minutesWatched: 0 };
  s.putDaily([
    // Read before counting was switched on: a total of zero.
    { ...zero, day: '2026-11-05', origin: 'public' },
    {
      day: '2026-11-06',
      origin: 'public',
      source: '',
      showId: '',
      plays: 380,
      uniqueClients: 40,
      failures: 0,
      minutesWatched: 0,
    },
  ]);
  expect(s.countedSince('home')).toBe('2026-11-04');
  expect(s.countedSince('public')).toBe('2026-11-06');
  // In the store's time zone: 23:30 UTC is already the next day in Israel.
  const il = EventStore.open(':memory:', { timeZone: 'Asia/Jerusalem' });
  il.record(ev({ ts: '2026-11-04T23:30:00.000Z', kind: 'run', component: 'ingest' }));
  expect(il.countedSince('home')).toBe('2026-11-05');
});

test('the canary retag leaves a day alone whose raw events may be partly pruned already', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const path = join(mkdtempSync(join(tmpdir(), 'iltv-events-')), 'events.sqlite');
  const a = EventStore.open(path);
  // The oldest day kept began before the retention cutoff: its first hours may be gone.
  const t0 = Date.now() - 30 * 86_400_000 + 30_000;
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  const old = a.dayOf(t0);
  const ep = 'iltv_mako_15:9:46';
  a.record(ev({ ts: at(0), kind: 'stream_request', playId: 'c1', episodeId: ep, client: 'k' }));
  a.record(ev({ ts: at(1), kind: 'failure', outcome: 'error', playId: 'c1', episodeId: ep, client: 'k' }));
  a.record(ev({ ts: at(6), kind: 'canary', component: 'canary', outcome: 'error', episodeId: ep }));
  a.record(ev({ ts: at(600), kind: 'stream_request', playId: 'canary-x', episodeId: ep, client: 'k' }));
  const kept = { source: '', showId: '', plays: 40, uniqueClients: 3, failures: 9, minutesWatched: 0 };
  a.putDaily([{ ...kept, day: old, origin: 'home' }]);
  a.setMeta('rollup:last', old);
  a.db.$client.exec("delete from meta where key = 'fix:canary-plays'");
  a.close();
  const b = EventStore.open(path);
  // The play is retagged, but the day's total is not rebuilt from what is left of it.
  expect(b.events({ playId: 'canary-c1' })).toHaveLength(2);
  expect(b.daily(old, 'home').find((r) => r.source === '' && r.showId === '')).toMatchObject(kept);
  b.close();
});
