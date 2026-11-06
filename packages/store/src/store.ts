// SQLite store (node:sqlite + Drizzle). The single writer is the ingest daemon; the resolver opens the same
// file read-only.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  type Assignments,
  seriesId as makeSeriesId,
  type ScrapedShow,
  ScrapedShow as ScrapedShowSchema,
  type Source,
} from '@israel-tv/core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import * as t from './schema.ts';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const now = () => new Date().toISOString();

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface ShowRow {
  seriesId: string;
  source: Source;
  catalog: string;
  title: string;
  show: ScrapedShow;
  latestAirDate: string | null;
  latestEpisodeSeenAt: string | null;
  lastOkAt: string;
  lastCheckedAt: string;
  lastError: string | null;
  state: 'listed' | 'delisted';
  tmdbId: number | null;
  imdbId: string | null;
}

export type RunKind = (typeof t.runs.$inferSelect)['kind'];
export type RunStatus = (typeof t.runs.$inferSelect)['status'];
export type RunRow = typeof t.runs.$inferSelect;
export type WarningRow = typeof t.warnings.$inferSelect;

export class Store {
  readonly db;
  readonly path: string;

  private constructor(path: string, readOnly: boolean) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const client = new DatabaseSync(path, { readOnly });
    client.exec('PRAGMA busy_timeout = 5000');
    if (!readOnly) {
      client.exec('PRAGMA journal_mode = WAL');
      client.exec('PRAGMA foreign_keys = ON');
    }
    this.db = drizzle({ client });
  }

  /** Open (creating if needed) and bring the schema up to date. */
  static open(path: string): Store {
    const s = new Store(path, false);
    migrate(s.db, { migrationsFolder: MIGRATIONS });
    return s;
  }

  static openReadOnly(path: string): Store {
    return new Store(path, true);
  }

  close(): void {
    this.db.$client.close();
  }

  private tx<T>(fn: () => T): T {
    const c = this.db.$client;
    c.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      c.exec('COMMIT');
      return r;
    } catch (err) {
      c.exec('ROLLBACK');
      throw err;
    }
  }

  // ---- registry -------------------------------------------------------------------------------------

  findSeriesId(source: Source, key: string): string | undefined {
    return this.db
      .select({ id: t.series.id })
      .from(t.series)
      .where(and(eq(t.series.source, source), eq(t.series.key, key)))
      .get()?.id;
  }

  /** The permanent public id for a source show, allocating the next number on first sight. */
  seriesIdFor(source: Source, key: string): string {
    const existing = this.findSeriesId(source, key);
    if (existing) return existing;
    return this.tx(() => {
      const row = this.db.select().from(t.counters).where(eq(t.counters.source, source)).get();
      const n = row?.next ?? 1;
      const id = makeSeriesId(source, n);
      this.db
        .insert(t.counters)
        .values({ source, next: n + 1 })
        .onConflictDoUpdate({ target: t.counters.source, set: { next: n + 1 } })
        .run();
      this.db.insert(t.series).values({ id, source, key, createdAt: now() }).run();
      return id;
    });
  }

  assignments(seriesId: string): Assignments {
    const seasons = this.db
      .select({ key: t.seasons.key, number: t.seasons.number, kind: t.seasons.kind })
      .from(t.seasons)
      .where(eq(t.seasons.seriesId, seriesId))
      .all();
    const episodes = this.db
      .select({ key: t.episodes.key, season: t.episodes.season, episode: t.episodes.episode })
      .from(t.episodes)
      .where(eq(t.episodes.seriesId, seriesId))
      .all();
    return { seasons, episodes };
  }

  /** Whole registry, for the public backup file. */
  registry(): { series: (typeof t.series.$inferSelect)[]; seasons: unknown[]; episodes: unknown[] } {
    return {
      series: this.db.select().from(t.series).all(),
      seasons: this.db.select().from(t.seasons).all(),
      episodes: this.db.select().from(t.episodes).all(),
    };
  }

  // ---- shows ----------------------------------------------------------------------------------------

  /**
   * Save a good scrape: new numbers (never changes stored ones) and the show data, atomically.
   * Returns how many episodes were new.
   */
  saveShow(
    seriesId: string,
    show: ScrapedShow,
    added: Assignments,
    latestAirDate: string | undefined,
  ): number {
    const ts = now();
    return this.tx(() => {
      for (const s of added.seasons) {
        this.db
          .insert(t.seasons)
          .values({ seriesId, ...s, createdAt: ts })
          .run();
      }
      for (const e of added.episodes) {
        this.db
          .insert(t.episodes)
          .values({ seriesId, ...e, createdAt: ts })
          .run();
      }
      const prev = this.db
        .select({ latestEpisodeSeenAt: t.shows.latestEpisodeSeenAt })
        .from(t.shows)
        .where(eq(t.shows.seriesId, seriesId))
        .get();
      const latestEpisodeSeenAt =
        added.episodes.length > 0
          ? ts
          : (prev?.latestEpisodeSeenAt ?? (latestAirDate ? `${latestAirDate}T00:00:00.000Z` : null));
      const values = {
        seriesId,
        source: show.source,
        catalog: show.catalog,
        title: show.title,
        data: JSON.stringify(show),
        latestAirDate: latestAirDate ?? null,
        latestEpisodeSeenAt,
        lastOkAt: ts,
        lastCheckedAt: ts,
        lastError: null,
        state: 'listed' as const,
      };
      this.db
        .insert(t.shows)
        .values(values)
        .onConflictDoUpdate({ target: t.shows.seriesId, set: values })
        .run();
      return added.episodes.length;
    });
  }

  /** Record a failed check; the last good data stays as it is. */
  markShowFailed(seriesId: string, error: string): void {
    this.db
      .update(t.shows)
      .set({ lastCheckedAt: now(), lastError: error.slice(0, 500) })
      .where(eq(t.shows.seriesId, seriesId))
      .run();
  }

  /** Mark shows of a source that are no longer in its index as delisted (and listed ones as listed). */
  syncListed(source: Source, listedIds: string[]): number {
    return this.tx(() => {
      const all = this.db
        .select({ id: t.shows.seriesId, state: t.shows.state })
        .from(t.shows)
        .where(eq(t.shows.source, source))
        .all();
      const listed = new Set(listedIds);
      let delisted = 0;
      for (const r of all) {
        const state = listed.has(r.id) ? 'listed' : 'delisted';
        if (state !== r.state) this.db.update(t.shows).set({ state }).where(eq(t.shows.seriesId, r.id)).run();
        if (state === 'delisted') delisted++;
      }
      return delisted;
    });
  }

  setExternalIds(seriesId: string, ids: { tmdbId: number | null; imdbId: string | null }): void {
    this.db
      .update(t.shows)
      .set({ ...ids, tmdbCheckedAt: now() })
      .where(eq(t.shows.seriesId, seriesId))
      .run();
  }

  /** Listed shows never looked up on TMDB, or looked up (without a match) before `before`. */
  showsToMatch(before: string): ShowRow[] {
    return this.db
      .select()
      .from(t.shows)
      .where(
        and(
          eq(t.shows.state, 'listed'),
          sql`${t.shows.tmdbId} is null and (${t.shows.tmdbCheckedAt} is null or ${t.shows.tmdbCheckedAt} < ${before})`,
        ),
      )
      .all()
      .map((r) => this.toShowRow(r));
  }

  private toShowRow(r: typeof t.shows.$inferSelect): ShowRow {
    return {
      seriesId: r.seriesId,
      source: r.source as Source,
      catalog: r.catalog,
      title: r.title,
      show: ScrapedShowSchema.parse(JSON.parse(r.data)),
      latestAirDate: r.latestAirDate,
      latestEpisodeSeenAt: r.latestEpisodeSeenAt,
      lastOkAt: r.lastOkAt,
      lastCheckedAt: r.lastCheckedAt,
      lastError: r.lastError,
      state: r.state,
      tmdbId: r.tmdbId,
      imdbId: r.imdbId,
    };
  }

  getShow(seriesId: string): ShowRow | undefined {
    const r = this.db.select().from(t.shows).where(eq(t.shows.seriesId, seriesId)).get();
    return r ? this.toShowRow(r) : undefined;
  }

  listShows(filter: { source?: Source; state?: 'listed' | 'delisted'; ids?: string[] } = {}): ShowRow[] {
    const conds = [];
    if (filter.source) conds.push(eq(t.shows.source, filter.source));
    if (filter.state) conds.push(eq(t.shows.state, filter.state));
    if (filter.ids) conds.push(inArray(t.shows.seriesId, filter.ids));
    return this.db
      .select()
      .from(t.shows)
      .where(conds.length ? and(...conds) : undefined)
      .all()
      .map((r) => this.toShowRow(r));
  }

  /** Shows of a source with an episode aired since `sinceDate` (yyyy-mm-dd). */
  airingShows(source: Source, sinceDate: string): ShowRow[] {
    return this.db
      .select()
      .from(t.shows)
      .where(
        and(
          eq(t.shows.source, source),
          eq(t.shows.state, 'listed'),
          sql`${t.shows.latestAirDate} >= ${sinceDate}`,
        ),
      )
      .all()
      .map((r) => this.toShowRow(r));
  }

  /** Source key of the episode published as season/episode of a series. */
  episodeKey(seriesId: string, season: number, episode: number): string | undefined {
    return this.db
      .select({ key: t.episodes.key })
      .from(t.episodes)
      .where(
        and(
          eq(t.episodes.seriesId, seriesId),
          eq(t.episodes.season, season),
          eq(t.episodes.episode, episode),
        ),
      )
      .get()?.key;
  }

  getState<T>(key: string): T | undefined {
    const r = this.db.select().from(t.kv).where(eq(t.kv.key, key)).get();
    return r ? (JSON.parse(r.value) as T) : undefined;
  }

  setState(key: string, value: unknown): void {
    const row = { key, value: JSON.stringify(value), updatedAt: now() };
    this.db.insert(t.kv).values(row).onConflictDoUpdate({ target: t.kv.key, set: row }).run();
  }

  // ---- runs and warnings ----------------------------------------------------------------------------

  startRun(kind: RunKind, scope: string): number {
    const r = this.db
      .insert(t.runs)
      .values({ kind, scope, startedAt: now(), status: 'running', pid: process.pid })
      .returning({ id: t.runs.id })
      .get();
    return r.id;
  }

  finishRun(
    id: number,
    result: {
      status: RunStatus;
      requests?: number;
      showsOk?: number;
      showsFailed?: number;
      newEpisodes?: number;
      error?: string;
    },
  ): void {
    this.db
      .update(t.runs)
      .set({ ...result, error: result.error?.slice(0, 1000) ?? null, finishedAt: now() })
      .where(eq(t.runs.id, id))
      .run();
  }

  recentRuns(limit = 20): RunRow[] {
    return this.db.select().from(t.runs).orderBy(desc(t.runs.id)).limit(limit).all();
  }

  lastRun(kind: RunKind, scope?: string): RunRow | undefined {
    return this.db
      .select()
      .from(t.runs)
      .where(scope ? and(eq(t.runs.kind, kind), eq(t.runs.scope, scope)) : eq(t.runs.kind, kind))
      .orderBy(desc(t.runs.id))
      .limit(1)
      .get();
  }

  /** Mark runs left `running` by a process that no longer exists as failed. */
  closeStaleRuns(isAlive: (pid: number) => boolean = processAlive): number {
    const running = this.db
      .select({ id: t.runs.id, pid: t.runs.pid })
      .from(t.runs)
      .where(eq(t.runs.status, 'running'))
      .all();
    let closed = 0;
    for (const r of running) {
      if (r.pid !== null && isAlive(r.pid)) continue;
      this.db
        .update(t.runs)
        .set({ status: 'failed', error: 'interrupted (process stopped)', finishedAt: now() })
        .where(eq(t.runs.id, r.id))
        .run();
      closed++;
    }
    return closed;
  }

  addWarnings(
    runId: number | null,
    seriesId: string | null,
    list: readonly { code: string; message: string }[],
  ): void {
    const ts = now();
    for (const w of list) {
      this.db
        .insert(t.warnings)
        .values({ runId, seriesId, code: w.code, message: w.message, createdAt: ts })
        .run();
    }
  }

  recentWarnings(limit = 50): WarningRow[] {
    return this.db.select().from(t.warnings).orderBy(desc(t.warnings.id)).limit(limit).all();
  }
}
