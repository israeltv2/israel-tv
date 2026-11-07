// SQLite store (node:sqlite + Drizzle): the catalog database. Only ingest (and its commands) open it; the
// resolver never does (it reads the published contract files).
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  type Assignments,
  seriesId as makeSeriesId,
  NAMED_SEASON_BASE,
  parseSeriesId,
  type ScrapedShow,
  ScrapedShow as ScrapedShowSchema,
  type Source,
} from '@israel-tv/core';
import { and, desc, eq, gte, inArray, like, ne, notInArray, or, sql } from 'drizzle-orm';
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
  lastError: string | null;
  state: 'listed' | 'delisted';
  tmdbId: number | null;
  imdbId: string | null;
}

export type RunKind = (typeof t.runs.$inferSelect)['kind'];
export type RunStatus = (typeof t.runs.$inferSelect)['status'];
export type RunRow = typeof t.runs.$inferSelect;
export type WarningRow = typeof t.warnings.$inferSelect;
/** kv key of the last deliberate stop (`noteShutdown`): which process began stopping, and when. */
export const SHUTDOWN_KEY = 'shutdown:last';
/** Error text of a run cut short by a deliberate stop (status `stopped`). */
export const STOPPED_FOR_RESTART = 'stopped for restart';
/** Error text of a run left open by a process that ended without a deliberate stop (a crash, a kill, a power cut). */
export const INTERRUPTED = 'interrupted: the process ended without a clean stop (crash, kill or power cut)';

/** kv key of the numbering guard's history (see apps/ingest/src/numbering-guard.ts). */
export const NUMBERING_HISTORY = 'numbering:history';

export class Store {
  readonly db;
  /** Called when a run finishes (the daemon records it as a usage/diagnostics event). */
  onRunFinished?: (run: RunRow) => void;
  readonly path: string;

  private constructor(path: string, readOnly: boolean) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const client = new DatabaseSync(path, { readOnly });
    if (!readOnly) ownerOnly(path);
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
    s.renumbered = s.renumberYearSeasons();
    return s;
  }

  /** Year seasons moved to position numbers when this database was opened (see renumberYearSeasons). */
  renumbered = 0;

  /**
   * Year-titled seasons ("2024") were once numbered with the year itself. They are numbered by position now,
   * oldest = 1, after the show's real season numbers; this moves any still stored the old way (once, or again
   * after restoring older data), with their episodes. Returns how many seasons moved.
   */
  renumberYearSeasons(): number {
    const c = this.db.$client;
    const old = c
      .prepare(
        "SELECT seriesId, key, number FROM seasons WHERE kind = 'year' AND number >= 1900 ORDER BY seriesId, number",
      )
      .all() as { seriesId: string; key: string; number: number }[];
    if (old.length === 0) return 0;
    const top = c.prepare(
      "SELECT COALESCE(MAX(number), 0) AS n FROM seasons WHERE seriesId = ? AND number < ? AND NOT (kind = 'year' AND number >= 1900)",
    );
    const moveSeason = c.prepare('UPDATE seasons SET number = ? WHERE seriesId = ? AND key = ?');
    const moveEpisodes = c.prepare('UPDATE episodes SET season = ? WHERE seriesId = ? AND season = ?');
    const flipSeasons = c.prepare('UPDATE seasons SET number = -number WHERE seriesId = ? AND number < 0');
    const flipEpisodes = c.prepare('UPDATE episodes SET season = -season WHERE seriesId = ? AND season < 0');
    c.exec('BEGIN IMMEDIATE');
    try {
      const series = [...new Set(old.map((r) => r.seriesId))];
      for (const id of series) {
        let next = Number((top.get(id, NAMED_SEASON_BASE) as { n: number }).n) + 1;
        // Through negative numbers, so no step collides with a number still in use.
        for (const r of old.filter((x) => x.seriesId === id)) {
          moveSeason.run(-next, id, r.key);
          moveEpisodes.run(-next, id, r.number);
          next++;
        }
        flipSeasons.run(id);
        flipEpisodes.run(id);
      }
      c.exec('COMMIT');
    } catch (err) {
      c.exec('ROLLBACK');
      throw err;
    }
    // A sanctioned move: the numbering guard's history is re-taken from what is stored now.
    this.setState(NUMBERING_HISTORY, this.numberingNow());
    return old.length;
  }

  /**
   * Rebuild the id registry (series ids, season and episode numbers) from a published `registry.json`, into an
   * empty database. The counters continue after the highest series number per source, so no id is ever given
   * out twice. A fresh read then finds every show and episode under its old id and number.
   */
  restoreRegistry(reg: ReturnType<Store['registry']>): { series: number; seasons: number; episodes: number } {
    const have = this.db.select({ n: sql<number>`count(*)` }).from(t.series).get()?.n ?? 0;
    if (have > 0) throw new Error(`the database already has ${have} series; restore only into an empty one`);
    this.tx(() => {
      for (let i = 0; i < reg.series.length; i += 500)
        this.db
          .insert(t.series)
          .values(reg.series.slice(i, i + 500))
          .run();
      for (let i = 0; i < reg.seasons.length; i += 500)
        this.db
          .insert(t.seasons)
          .values(reg.seasons.slice(i, i + 500))
          .run();
      for (let i = 0; i < reg.episodes.length; i += 500)
        this.db
          .insert(t.episodes)
          .values(reg.episodes.slice(i, i + 500))
          .run();
      const highest = new Map<string, number>();
      for (const r of reg.series) {
        const p = parseSeriesId(r.id);
        if (p) highest.set(p.source, Math.max(highest.get(p.source) ?? 0, p.n));
      }
      for (const [source, n] of highest)
        this.db
          .insert(t.counters)
          .values({ source, next: n + 1 })
          .onConflictDoUpdate({ target: t.counters.source, set: { next: n + 1 } })
          .run();
    });
    return { series: reg.series.length, seasons: reg.seasons.length, episodes: reg.episodes.length };
  }

  /** A consistent copy of the whole database at `file` (which must not exist). */
  backupTo(file: string): void {
    this.db.$client.prepare('VACUUM INTO ?').run(file);
    ownerOnly(file);
  }

  close(): void {
    this.db.$client.close();
  }

  /** Run `fn` in one transaction; an inner call joins the outer one (all or nothing). */
  transaction<T>(fn: () => T): T {
    return this.tx(fn);
  }

  private depth = 0;

  private tx<T>(fn: () => T): T {
    const c = this.db.$client;
    if (this.depth > 0) {
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
      }
    }
    this.depth = 1;
    try {
      return this.txOuter(c, fn);
    } finally {
      this.depth = 0;
    }
  }

  private txOuter<T>(c: DatabaseSync, fn: () => T): T {
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

  /**
   * Replace a series' season and episode numbers. Only for a recorded one-time migration (see apps/ingest
   * renumber.ts): everything else only ever adds numbers. The caller re-takes the numbering snapshot after.
   */
  replaceAssignments(seriesId: string, a: Assignments): void {
    const ts = now();
    this.tx(() => {
      this.db.delete(t.episodes).where(eq(t.episodes.seriesId, seriesId)).run();
      this.db.delete(t.seasons).where(eq(t.seasons.seriesId, seriesId)).run();
      for (const x of a.seasons)
        this.db
          .insert(t.seasons)
          .values({ seriesId, ...x, createdAt: ts })
          .run();
      for (const x of a.episodes)
        this.db
          .insert(t.episodes)
          .values({ seriesId, ...x, createdAt: ts })
          .run();
    });
  }

  /** Every episode's published number: `seriesId|key` → `season:episode` (the numbering guard's history). */
  numberingNow(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.db.select().from(t.episodes).all())
      out[`${e.seriesId}|${e.key}`] = `${e.season}:${e.episode}`;
    return out;
  }

  /** Whole registry, for the public backup file. */
  registry(): {
    series: (typeof t.series.$inferSelect)[];
    seasons: (typeof t.seasons.$inferSelect)[];
    episodes: (typeof t.episodes.$inferSelect)[];
  } {
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
    /** Whether the added episodes are newly published (moves the show up "newest first"). */
    fresh = true,
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
        added.episodes.length > 0 && fresh
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

  /** Put back a show's last good read after a data-only rewrite (a recorded migration), which is not a read. */
  restoreLastOk(seriesId: string, lastOkAt: string): void {
    this.db.update(t.shows).set({ lastOkAt }).where(eq(t.shows.seriesId, seriesId)).run();
  }

  /** A good read that changed nothing: clear an earlier failure. */
  markShowChecked(seriesId: string): void {
    this.db
      .update(t.shows)
      .set({ lastCheckedAt: now(), lastError: null })
      .where(eq(t.shows.seriesId, seriesId))
      .run();
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
      .map((r) => this.toShowRow(r))
      .filter((r): r is ShowRow => r !== undefined);
  }

  private toShowRow(r: typeof t.shows.$inferSelect): ShowRow | undefined {
    const parsed = ScrapedShowSchema.safeParse(JSON.parse(r.data));
    // Data is validated before it is stored; an unreadable row (older format) is skipped, not fatal.
    if (!parsed.success) return undefined;
    return {
      seriesId: r.seriesId,
      source: r.source as Source,
      catalog: r.catalog,
      title: r.title,
      show: parsed.data,
      latestAirDate: r.latestAirDate,
      latestEpisodeSeenAt: r.latestEpisodeSeenAt,
      lastOkAt: r.lastOkAt,
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
      .map((r) => this.toShowRow(r))
      .filter((r): r is ShowRow => r !== undefined);
  }

  countShows(source: Source, state: 'listed' | 'delisted'): number {
    return (
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(t.shows)
        .where(and(eq(t.shows.source, source), eq(t.shows.state, state)))
        .get()?.n ?? 0
    );
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
      .map((r) => this.toShowRow(r))
      .filter((r): r is ShowRow => r !== undefined);
  }

  /** Series already holding a TMDB id or IMDb id. */
  seriesWithExternalIds(tmdbId: number, imdbId: string | null): string[] {
    return this.db
      .select({ id: t.shows.seriesId })
      .from(t.shows)
      .where(
        imdbId
          ? sql`${t.shows.tmdbId} = ${tmdbId} or ${t.shows.imdbId} = ${imdbId}`
          : eq(t.shows.tmdbId, tmdbId),
      )
      .all()
      .map((r) => r.id);
  }

  /** Our series for an IMDb (`tt…`) or TMDB (`tmdb:…`) id, with its numbered seasons. */
  externalSeries(id: string): { series: string; seasons: number[] } | undefined {
    const rows = id.startsWith('tmdb:')
      ? this.db
          .select({ id: t.shows.seriesId })
          .from(t.shows)
          .where(eq(t.shows.tmdbId, Number(id.slice(5))))
          .all()
      : this.db.select({ id: t.shows.seriesId }).from(t.shows).where(eq(t.shows.imdbId, id)).all();
    // An id held by two series is ambiguous: answer nothing rather than pick one.
    const row = rows.length === 1 ? rows[0] : undefined;
    if (!row) return undefined;
    const seasons = this.db
      .select({ number: t.seasons.number })
      .from(t.seasons)
      .where(and(eq(t.seasons.seriesId, row.id), inArray(t.seasons.kind, ['numbered', 'single'])))
      .all()
      .map((x) => x.number);
    return { series: row.id, seasons };
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
    const run = this.db.select().from(t.runs).where(eq(t.runs.id, id)).get();
    if (run) this.onRunFinished?.(run);
  }

  recentRuns(limit = 20): RunRow[] {
    return this.db.select().from(t.runs).orderBy(desc(t.runs.id)).limit(limit).all();
  }

  /** Runs of one source (its full reads, airing checks, show reads, retries, crawl slices), newest first. */
  runsOf(source: string, limit = 20, kinds?: RunKind[]): RunRow[] {
    return this.db
      .select()
      .from(t.runs)
      .where(
        and(
          or(eq(t.runs.scope, source), like(t.runs.scope, `${source}:%`)),
          kinds ? inArray(t.runs.kind, kinds) : undefined,
        ),
      )
      .orderBy(desc(t.runs.id))
      .limit(limit)
      .all();
  }

  /** Finished runs of these kinds started since `since` (ISO), stopped ones left out, oldest first: just what a day-by-day history needs. */
  finishedRunsSince(
    since: string,
    kinds: RunKind[],
  ): { kind: RunKind; scope: string; startedAt: string; status: RunStatus }[] {
    return this.db
      .select({ kind: t.runs.kind, scope: t.runs.scope, startedAt: t.runs.startedAt, status: t.runs.status })
      .from(t.runs)
      .where(
        and(
          gte(t.runs.startedAt, since),
          inArray(t.runs.kind, kinds),
          // Neither good nor bad: still going, or stopped for a restart.
          notInArray(t.runs.status, ['running', 'stopped']),
        ),
      )
      .orderBy(t.runs.id)
      .all();
  }

  /** Recent runs of one kind (e.g. every publish), newest first. */
  runsOfKind(kind: RunKind, limit = 20): RunRow[] {
    return this.db
      .select()
      .from(t.runs)
      .where(eq(t.runs.kind, kind))
      .orderBy(desc(t.runs.id))
      .limit(limit)
      .all();
  }

  /** Newest run of a kind (and scope); `settled` leaves out runs stopped for a restart (they judge nothing). */
  lastRun(kind: RunKind, scope?: string, opts: { settled?: boolean } = {}): RunRow | undefined {
    return this.db
      .select()
      .from(t.runs)
      .where(
        and(
          eq(t.runs.kind, kind),
          scope ? eq(t.runs.scope, scope) : undefined,
          opts.settled ? ne(t.runs.status, 'stopped') : undefined,
        ),
      )
      .orderBy(desc(t.runs.id))
      .limit(1)
      .get();
  }

  /** Oldest run of a kind/scope. */
  firstRun(kind: RunKind, scope: string): RunRow | undefined {
    return this.db
      .select()
      .from(t.runs)
      .where(and(eq(t.runs.kind, kind), eq(t.runs.scope, scope)))
      .orderBy(t.runs.id)
      .limit(1)
      .get();
  }

  /** Newest run of a kind/scope that did not fail. */
  lastGoodRun(kind: RunKind, scope: string): RunRow | undefined {
    return this.db
      .select()
      .from(t.runs)
      .where(and(eq(t.runs.kind, kind), eq(t.runs.scope, scope), inArray(t.runs.status, ['ok', 'partial'])))
      .orderBy(desc(t.runs.id))
      .limit(1)
      .get();
  }

  /**
   * Record that this process is stopping on purpose (a service stop or restart), before it waits for its work to
   * reach a safe point. A run it leaves open (the wait ran out, or the service manager killed it first) is then
   * closed at the next start as stopped, not failed.
   */
  noteShutdown(pid = process.pid): void {
    this.setState(SHUTDOWN_KEY, { pid, at: now() });
  }

  /** Runs in progress now: `running`, in a process that still exists (a deploy can wait for none). */
  openRuns(isAlive: (pid: number) => boolean = processAlive): RunRow[] {
    return this.db
      .select()
      .from(t.runs)
      .where(eq(t.runs.status, 'running'))
      .orderBy(t.runs.id)
      .all()
      .filter((r) => r.pid !== null && isAlive(r.pid));
  }

  /** Close this process's runs that are still open as stopped (the stop's wait ran out). Returns how many. */
  stopOpenRuns(note: string = STOPPED_FOR_RESTART, pid = process.pid): number {
    const open = this.db
      .select({ id: t.runs.id })
      .from(t.runs)
      .where(and(eq(t.runs.status, 'running'), eq(t.runs.pid, pid)))
      .all();
    for (const r of open) this.finishRun(r.id, { status: 'stopped', error: note });
    return open.length;
  }

  /**
   * Close runs left `running` by a process that no longer exists: `stopped` when that process had begun a
   * deliberate stop (noteShutdown), else `failed` with a label that says the process ended without one.
   */
  closeStaleRuns(isAlive: (pid: number) => boolean = processAlive): { stopped: number; failed: number } {
    const running = this.db
      .select({ id: t.runs.id, pid: t.runs.pid })
      .from(t.runs)
      .where(eq(t.runs.status, 'running'))
      .all();
    const shutdown = this.getState<{ pid: number; at: string } | null>(SHUTDOWN_KEY);
    const out = { stopped: 0, failed: 0 };
    for (const r of running) {
      // This process has not started any run yet when this is called, so a run with its pid is a leftover
      // from an earlier process that had the same pid (e.g. pid 1 in a container).
      if (r.pid !== null && r.pid !== process.pid && isAlive(r.pid)) continue;
      const deliberate = shutdown?.pid !== undefined && r.pid === shutdown.pid;
      this.db
        .update(t.runs)
        .set(
          deliberate
            ? {
                status: 'stopped',
                error: `${STOPPED_FOR_RESTART} (closed at the next start)`,
                finishedAt: now(),
              }
            : { status: 'failed', error: INTERRUPTED, finishedAt: now() },
        )
        .where(eq(t.runs.id, r.id))
        .run();
      out[deliberate ? 'stopped' : 'failed']++;
    }
    // Used once (a later process that happens to get the same pid must not inherit it), but only once that
    // process is gone: a command run while the service is still stopping must not clear it.
    if (shutdown && (shutdown.pid === process.pid || !isAlive(shutdown.pid)))
      this.setState(SHUTDOWN_KEY, null);
    return out;
  }

  /** Record warnings; one already recorded for the same show with the same text is not repeated. */
  addWarnings(
    runId: number | null,
    seriesId: string | null,
    list: readonly { code: string; message: string }[],
  ): void {
    if (list.length === 0) return;
    const createdAt = now();
    const known = new Set(
      this.db
        .select({ code: t.warnings.code, message: t.warnings.message })
        .from(t.warnings)
        .where(seriesId === null ? sql`${t.warnings.seriesId} is null` : eq(t.warnings.seriesId, seriesId))
        .all()
        .map((w) => `${w.code}\n${w.message}`),
    );
    const fresh = list.filter((w) => !known.has(`${w.code}\n${w.message}`));
    if (fresh.length === 0) return;
    this.db
      .insert(t.warnings)
      .values(fresh.map((w) => ({ runId, seriesId, code: w.code, message: w.message, createdAt })))
      .run();
  }

  /** Drop warnings and finished runs older than `days` days (the log would otherwise grow forever). */
  prune(days = 60): void {
    const before = new Date(Date.now() - days * 86_400_000).toISOString();
    const oldRuns = sql`select ${t.runs.id} from ${t.runs} where ${t.runs.startedAt} < ${before} and ${t.runs.status} != 'running'`;
    // Warnings first (they reference runs), then the runs themselves.
    this.db
      .delete(t.warnings)
      .where(sql`${t.warnings.createdAt} < ${before} or ${t.warnings.runId} in (${oldRuns})`)
      .run();
    this.db.delete(t.runs).where(sql`${t.runs.id} in (${oldRuns})`).run();
  }

  /** When a show's stored data last changed (cheap; for caches). */
  showStamp(seriesId: string): string | undefined {
    return this.db.select({ at: t.shows.lastOkAt }).from(t.shows).where(eq(t.shows.seriesId, seriesId)).get()
      ?.at;
  }

  recentWarnings(limit = 50): WarningRow[] {
    return this.db.select().from(t.warnings).orderBy(desc(t.warnings.id)).limit(limit).all();
  }
}

/** The database and its journal files readable by their owner only (they hold ids, and the usage salt). */
function ownerOnly(path: string): void {
  if (process.platform === 'win32' || path === ':memory:') return;
  for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);
}
