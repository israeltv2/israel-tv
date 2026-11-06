// Home database schema. The registry tables (series, seasons, episodes) only ever grow: a published id or
// number is never changed or reused.
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Next series number per source. */
export const counters = sqliteTable('counters', {
  source: text().primaryKey(),
  next: integer().notNull(),
});

/** Source key → public series id. */
export const series = sqliteTable(
  'series',
  {
    id: text().primaryKey(),
    source: text().notNull(),
    key: text().notNull(),
    createdAt: text().notNull(),
  },
  (t) => [uniqueIndex('series_source_key').on(t.source, t.key)],
);

export const seasons = sqliteTable(
  'seasons',
  {
    seriesId: text()
      .notNull()
      .references(() => series.id),
    key: text().notNull(),
    number: integer().notNull(),
    kind: text({ enum: ['numbered', 'year', 'named', 'single'] }).notNull(),
    createdAt: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.seriesId, t.key] }),
    uniqueIndex('seasons_number').on(t.seriesId, t.number),
  ],
);

export const episodes = sqliteTable(
  'episodes',
  {
    seriesId: text()
      .notNull()
      .references(() => series.id),
    key: text().notNull(),
    season: integer().notNull(),
    episode: integer().notNull(),
    createdAt: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.seriesId, t.key] }),
    uniqueIndex('episodes_number').on(t.seriesId, t.season, t.episode),
  ],
);

/** Last good scraped data per show and its health. */
export const shows = sqliteTable(
  'shows',
  {
    seriesId: text()
      .primaryKey()
      .references(() => series.id),
    source: text().notNull(),
    catalog: text().notNull(),
    title: text().notNull(),
    /** JSON of the last good ScrapedShow. */
    data: text().notNull(),
    latestAirDate: text(),
    /** First time an episode was seen, used for "newest first" ordering. */
    latestEpisodeSeenAt: text(),
    lastOkAt: text().notNull(),
    lastCheckedAt: text().notNull(),
    lastError: text(),
    /** `listed`: in the source's current index. `delisted`: gone from the index (kept, hidden). */
    state: text({ enum: ['listed', 'delisted'] })
      .notNull()
      .default('listed'),
    tmdbId: integer(),
    imdbId: text(),
    /** Last TMDB lookup (match or miss), so misses are not searched again every night. */
    tmdbCheckedAt: text(),
  },
  (t) => [index('shows_catalog').on(t.catalog)],
);

export const runs = sqliteTable('runs', {
  id: integer().primaryKey({ autoIncrement: true }),
  kind: text({ enum: ['full', 'airing', 'show', 'publish', 'match', 'crawl'] }).notNull(),
  scope: text().notNull(),
  startedAt: text().notNull(),
  finishedAt: text(),
  status: text({ enum: ['running', 'ok', 'partial', 'failed'] }).notNull(),
  requests: integer().notNull().default(0),
  showsOk: integer().notNull().default(0),
  showsFailed: integer().notNull().default(0),
  newEpisodes: integer().notNull().default(0),
  error: text(),
  /** Process that runs it, so a crashed run can be told apart from one still going. */
  pid: integer(),
});

export const warnings = sqliteTable(
  'warnings',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    runId: integer().references(() => runs.id),
    seriesId: text(),
    code: text().notNull(),
    message: text().notNull(),
    createdAt: text().notNull(),
  },
  (t) => [index('warnings_series').on(t.seriesId)],
);

/** Small persistent state (e.g. a crawler's progress), as JSON. */
export const kv = sqliteTable('kv', {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: text().notNull(),
});

/** Usage and diagnostics events (see @israel-tv/core events.ts), kept EVENT_RETENTION_DAYS. */
export const events = sqliteTable(
  'events',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    at: text().notNull(),
    kind: text().notNull(),
    origin: text().notNull(),
    outcome: text().notNull(),
    corr: text(),
    client: text(),
    source: text(),
    series: text(),
    video: text(),
    route: text(),
    status: integer(),
    upstream: text(),
    ms: integer(),
    bytes: integer(),
    segments: integer(),
    reason: text(),
    /** De-duplication key for events pulled from elsewhere (Workers Logs). */
    ext: text(),
  },
  (t) => [index('events_at').on(t.at), index('events_corr').on(t.corr), uniqueIndex('events_ext').on(t.ext)],
);
