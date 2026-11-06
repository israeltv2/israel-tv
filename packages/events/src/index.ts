// The usage and diagnostics database (events.sqlite): append-only events, written in batches; nightly daily
// rollups; pruning, a weekly VACUUM and a size cap. Kept apart from the catalog database.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  EVENT_RETENTION_DAYS,
  NOT_INTERNAL_SQL,
  ROLLUP_RETENTION_DAYS,
  type UsageEvent,
} from '@israel-tv/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import * as t from './schema.ts';

export * as eventsSchema from './schema.ts';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const DAY_MS = 86_400_000;

export type EventRow = typeof t.events.$inferSelect;
export type DailyRow = typeof t.dailyUsage.$inferSelect;

export interface EventFilter {
  playId?: string;
  kind?: string;
  outcome?: 'ok' | 'error';
  since?: string;
  showId?: string;
  limit?: number;
  /** Leave out the project's own traffic (canary, probes): viewers' events only. */
  viewersOnly?: boolean;
}

/** Kinds that count as a play. */
const PLAY_KINDS = ['play_start', 'relay_session'] as const;

export class EventStore {
  readonly db;
  readonly path: string;
  private readonly buffer: UsageEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  private constructor(path: string, readOnly: boolean) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const client = new DatabaseSync(path, { readOnly });
    if (!readOnly) ownerOnly(path);
    if (!readOnly) {
      client.exec('PRAGMA journal_mode = WAL');
      client.exec('PRAGMA synchronous = NORMAL');
    }
    client.exec('PRAGMA busy_timeout = 5000');
    this.db = drizzle({ client });
  }

  static open(path: string): EventStore {
    const s = new EventStore(path, false);
    migrate(s.db, { migrationsFolder: MIGRATIONS });
    s.retagProbes();
    return s;
  }

  /**
   * Once: failures recorded for "episode ids" that are not episode ids at all (security probes, typos, before
   * the resolver refused those without recording) are internal traffic, not viewers' failures.
   */
  private retagProbes(): void {
    if (this.getMeta('fix:probe-ids')) return;
    this.db.run(sql`update ${t.events} set play_id = 'probe-' || coalesce(play_id, '')
      where kind = 'failure' and episode_id is not null and episode_id not glob '*?:*[0-9]:*[0-9]'
        and ${sql.raw(NOT_INTERNAL_SQL)}`);
    this.setMeta('fix:probe-ids', new Date().toISOString());
  }

  static openReadOnly(path: string): EventStore {
    return new EventStore(path, true);
  }

  close(): void {
    this.flush();
    this.db.$client.close();
  }

  // ---- writing --------------------------------------------------------------------------------------

  /** Queue an event; written with others in one transaction (within ~2 s, or at 200 queued). */
  record(e: UsageEvent): void {
    this.buffer.push(e);
    if (this.buffer.length >= 200) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), 2000);
    this.timer?.unref?.();
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.buffer.length === 0) return;
    const rows = this.buffer.splice(0).map((e) => ({
      ts: eventTime(e.ts),
      kind: e.kind,
      component: e.component,
      outcome: e.outcome,
      playId: e.playId ?? null,
      source: e.source ?? null,
      showId: e.showId ?? null,
      episodeId: e.episodeId ?? null,
      client: e.client ?? null,
      status: e.status ?? null,
      latencyMs: e.latencyMs === undefined ? null : Math.round(e.latencyMs),
      detail: e.detail ? JSON.stringify(e.detail).slice(0, 2000) : null,
    }));
    this.db.transaction((tx) => {
      for (let i = 0; i < rows.length; i += 200)
        tx.insert(t.events)
          .values(rows.slice(i, i + 200))
          .run();
    });
  }

  // ---- reading --------------------------------------------------------------------------------------

  /** Events, newest first. */
  events(f: EventFilter = {}): EventRow[] {
    this.flush();
    const where = [
      f.playId ? eq(t.events.playId, f.playId) : undefined,
      f.kind ? eq(t.events.kind, f.kind) : undefined,
      f.outcome ? eq(t.events.outcome, f.outcome) : undefined,
      f.showId ? eq(t.events.showId, f.showId) : undefined,
      f.since ? sql`${t.events.ts} >= ${f.since}` : undefined,
      f.viewersOnly ? sql.raw(NOT_INTERNAL_SQL) : undefined,
    ].filter((x) => x !== undefined);
    return this.db
      .select()
      .from(t.events)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(t.events.ts), desc(t.events.id))
      .limit(Math.min(f.limit ?? 100, 1000))
      .all();
  }

  /** Daily rollup rows from `since` (yyyy-mm-dd). */
  daily(since: string, origin?: 'home' | 'public'): DailyRow[] {
    return this.db
      .select()
      .from(t.dailyUsage)
      .where(and(sql`${t.dailyUsage.day} >= ${since}`, origin ? eq(t.dailyUsage.origin, origin) : undefined))
      .all();
  }

  /** The home rollup for one day computed from raw events (also used for "today" on the dashboard). */
  homeDay(day: string): DailyRow[] {
    this.flush();
    const from = `${day}T00:00:00.000Z`;
    const to = `${day}T99`;
    // Per show, per source (show '') and overall (source '' and show ''): each counts its own distinct clients.
    // Each level only takes the events that belong to it, so a level's rows never share a key with another's
    // (an event without a show cannot pose as a source total, one without a source as the overall total).
    const levels = [
      {
        cols: sql`source, show_id`,
        only: sql`and source is not null and source <> '' and show_id is not null and show_id <> ''`,
        group: sql`group by source, show_id`,
      },
      {
        cols: sql`source, '' as show_id`,
        only: sql`and source is not null and source <> ''`,
        group: sql`group by source`,
      },
      { cols: sql`'' as source, '' as show_id`, only: sql``, group: sql`` },
    ];
    const out: DailyRow[] = [];
    for (const l of levels) {
      const rows = this.db.all<{
        source: string | null;
        show_id: string | null;
        plays: number | null;
        clients: number | null;
        failures: number | null;
        minutes: number | null;
      }>(sql`select ${l.cols},
            sum(case when kind = 'play_start' or (kind = 'relay_session' and outcome = 'ok') then 1 else 0 end) as plays,
            count(distinct case when kind in ('stream_request', 'play_start', 'relay_session') then client end) as clients,
            sum(case when kind = 'failure' then 1 else 0 end) as failures,
            coalesce(sum(case when kind = 'relay_session' then json_extract(detail, '$.durationMs') end), 0) / 60000.0 as minutes
          from ${t.events}
          where ts >= ${from} and ts < ${to} and kind not in ('run', 'canary')
            and ${sql.raw(NOT_INTERNAL_SQL)} ${l.only} ${l.group}`);
      for (const r of rows) {
        if ((r.plays ?? 0) + (r.clients ?? 0) + (r.failures ?? 0) === 0) continue;
        out.push({
          day,
          origin: 'home',
          source: r.source ?? '',
          showId: r.show_id ?? '',
          plays: r.plays ?? 0,
          uniqueClients: r.clients ?? 0,
          failures: r.failures ?? 0,
          minutesWatched: Math.round((r.minutes ?? 0) * 10) / 10,
        });
      }
    }
    // A show-level row with an empty show id (events without one) would collide with the source total.
    return out.filter(
      (r, i, all) => all.findIndex((x) => x.source === r.source && x.showId === r.showId) === i,
    );
  }

  /** Failures grouped by stage, status and reason, most frequent first. */
  failuresByReason(
    since: string,
    limit = 20,
  ): { stage: string; status: number | null; reason: string; n: number; last: string }[] {
    this.flush();
    return this.db.all(sql`select coalesce(json_extract(detail, '$.stage'), kind) as stage, status,
        substr(coalesce(json_extract(detail, '$.reason'), ''), 1, 120) as reason, count(*) as n, max(ts) as last
      from ${t.events} where kind = 'failure' and ts >= ${since} and ${sql.raw(NOT_INTERNAL_SQL)}
      group by stage, status, reason order by n desc limit ${limit}`);
  }

  /** Raw events per day (for the "events per day" figure). */
  perDay(since: string): { day: string; n: number }[] {
    this.flush();
    return this.db.all(sql`select substr(ts, 1, 10) as day, count(*) as n from ${t.events}
      where ts >= ${since} group by day order by day`);
  }

  // ---- maintenance ----------------------------------------------------------------------------------

  /** Write (or rewrite) daily rollup rows. */
  putDaily(rows: DailyRow[]): void {
    if (rows.length === 0) return;
    this.db.transaction((tx) => {
      for (const r of rows)
        tx.insert(t.dailyUsage)
          .values(r)
          .onConflictDoUpdate({
            target: [t.dailyUsage.day, t.dailyUsage.origin, t.dailyUsage.source, t.dailyUsage.showId],
            set: {
              plays: r.plays,
              uniqueClients: r.uniqueClients,
              failures: r.failures,
              minutesWatched: r.minutesWatched,
            },
          })
          .run();
    });
  }

  /**
   * Nightly: roll up every finished day not rolled up yet (from the oldest raw event), prune old raw events
   * and rollups, VACUUM once a week, and enforce the size cap. Returns what it did.
   */
  maintain(
    nowMs = Date.now(),
    maxBytes = 200 * 1024 * 1024,
  ): { rolledUp: string[]; vacuumed: boolean; overCap: boolean } {
    this.flush();
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const last = this.getMeta('rollup:last');
    const oldest = this.db
      .get<{ ts: string | null }>(sql`select min(ts) as ts from ${t.events}`)
      ?.ts?.slice(0, 10);
    const rolledUp: string[] = [];
    let day = last ? nextDay(last) : oldest;
    while (day && day < today) {
      this.putDaily(this.homeDay(day));
      this.setMeta('rollup:last', day);
      rolledUp.push(day);
      day = nextDay(day);
    }
    const rawBefore = new Date(nowMs - EVENT_RETENTION_DAYS * DAY_MS).toISOString();
    this.db.delete(t.events).where(sql`${t.events.ts} < ${rawBefore}`).run();
    const rollupBefore = new Date(nowMs - ROLLUP_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10);
    this.db.delete(t.dailyUsage).where(sql`${t.dailyUsage.day} < ${rollupBefore}`).run();
    let overCap = this.sizeBytes() > maxBytes;
    if (overCap) {
      // Over the cap: keep only the last week of raw events (the rollups keep the history).
      const weekAgo = new Date(nowMs - 7 * DAY_MS).toISOString();
      this.db.delete(t.events).where(sql`${t.events.ts} < ${weekAgo}`).run();
    }
    const lastVacuum = this.getMeta('vacuum:last');
    const vacuumed = overCap || !lastVacuum || nowMs - Date.parse(lastVacuum) > 7 * DAY_MS;
    if (vacuumed) {
      this.db.$client.exec('VACUUM');
      // VACUUM in WAL mode writes the whole database into the WAL: fold it back so the file stays small.
      this.db.$client.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      this.setMeta('vacuum:last', new Date(nowMs).toISOString());
      overCap = this.sizeBytes() > maxBytes;
    }
    this.setMeta('size:overCap', overCap ? '1' : '0');
    this.setMeta(`size:${today}`, String(this.sizeBytes()));
    return { rolledUp, vacuumed, overCap };
  }

  /** Size of the database file (and its WAL), in bytes. */
  /** Size of the database's content, in bytes (its pages; not the transient WAL file). */
  sizeBytes(): number {
    const r = this.db.get<{ n: number }>(
      sql`select page_count * page_size as n from pragma_page_count(), pragma_page_size()`,
    );
    return r?.n ?? 0;
  }

  /** Whether the last maintenance found the database over its size cap. */
  overCap(): boolean {
    return this.getMeta('size:overCap') === '1';
  }

  /** The secret salt for client hashes (created once, kept here only). */
  clientSalt(): string {
    const have = this.getMeta('client-salt');
    if (have) return have;
    const salt = randomBytes(32).toString('hex');
    this.setMeta('client-salt', salt);
    return salt;
  }

  getMeta(key: string): string | undefined {
    return this.db.select().from(t.meta).where(eq(t.meta.key, key)).get()?.value;
  }

  setMeta(key: string, value: string): void {
    this.db
      .insert(t.meta)
      .values({ key, value })
      .onConflictDoUpdate({ target: t.meta.key, set: { value } })
      .run();
  }
}

/**
 * Every event time is stored the same way: an ISO 8601 UTC string with milliseconds (`2026-11-07T01:02:03.456Z`),
 * so text comparison is time order and `substr(ts, 1, 10)` is the UTC day. Numbers are taken as epoch seconds
 * (below 1e12) or milliseconds; anything unreadable is the time of writing.
 */
export function eventTime(ts: string | number | Date | undefined, now = Date.now()): string {
  const ms =
    ts instanceof Date
      ? ts.getTime()
      : typeof ts === 'number'
        ? ts < 1e12
          ? ts * 1000
          : ts
        : typeof ts === 'string' && /^\d+(\.\d+)?$/.test(ts)
          ? Number(ts) < 1e12
            ? Number(ts) * 1000
            : Number(ts)
          : typeof ts === 'string'
            ? Date.parse(ts)
            : Number.NaN;
  return new Date(Number.isFinite(ms) ? ms : now).toISOString();
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

export { PLAY_KINDS };

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/**
 * Events by filter, newest first — shared by `/events.json` and `israel-tv events`. `since` is an ISO time or
 * a span like `30m`, `2h`, `7d`.
 */
export function queryEvents(events: EventStore, q: Record<string, string | undefined>): EventRow[] {
  const span = q.since ? /^(\d+)([mhd])$/.exec(q.since) : null;
  const since = span
    ? new Date(Date.now() - Number(span[1]) * UNIT_MS[span[2] as 'm' | 'h' | 'd']).toISOString()
    : q.since;
  return events.events({
    ...(q.playId ? { playId: q.playId } : {}),
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.outcome === 'ok' || q.outcome === 'error' ? { outcome: q.outcome } : {}),
    ...(q.show ? { showId: q.show } : {}),
    ...(since ? { since } : {}),
    limit: Math.min(Number(q.limit) || 100, 1000),
  });
}

/** The database and its journal files readable by their owner only (they hold ids, and the usage salt). */
function ownerOnly(path: string): void {
  if (process.platform === 'win32' || path === ':memory:') return;
  for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);
}
