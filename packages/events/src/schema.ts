// Usage and diagnostics database (events.sqlite), kept apart from the catalog database so its writes never
// contend with ingest. Raw events are kept EVENT_RETENTION_DAYS; daily rollups a year.
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** One row per meaningful action (never per video segment). See docs/operations.md for the kinds. */
export const events = sqliteTable(
  'events',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    ts: text().notNull(),
    kind: text().notNull(),
    component: text().notNull(),
    outcome: text().notNull(),
    playId: text('play_id'),
    source: text(),
    showId: text('show_id'),
    episodeId: text('episode_id'),
    /** Salted daily hash of the client's address (never the address). */
    client: text(),
    status: integer(),
    latencyMs: integer('latency_ms'),
    /** JSON: upstream statuses, reason, bytes, segments, duration, … */
    detail: text(),
  },
  (t) => [
    index('events_ts').on(t.ts),
    index('events_kind_ts').on(t.kind, t.ts),
    index('events_show').on(t.showId),
    index('events_play').on(t.playId),
  ],
);

/** Per day, origin (`home`: this resolver; `public`: the public addon), source and show (`''` = all shows). */
export const dailyUsage = sqliteTable(
  'daily_usage',
  {
    day: text().notNull(),
    origin: text().notNull(),
    source: text().notNull(),
    showId: text('show_id').notNull(),
    plays: integer().notNull(),
    uniqueClients: integer('unique_clients').notNull(),
    failures: integer().notNull(),
    /** Known only for relayed plays (Mako video goes player ↔ CDN and is not seen). */
    minutesWatched: real('minutes_watched').notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.origin, t.source, t.showId] })],
);

export const meta = sqliteTable('meta', {
  key: text().primaryKey(),
  value: text().notNull(),
});
