// The owner's admin API (`/api/v1/*` on the admin port): one schema per answer. The daemon's answers are checked
// against these in tests; the dashboard uses the types. Version 1; a change an older dashboard could misread is a
// new version (a new path prefix).
import { z } from 'zod';

export { ADMIN_API, CSRF_HEADER, type RouteName, routePath, routes } from './routes.ts';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const iso = z.string();
const health = z.enum(['ok', 'warn', 'error']);

export const SessionSchema = z.object({
  csrf: z.string(),
  revision: z.string(),
  role: z.string(),
  publisher: z.enum(['local', 'cloudflare']),
  publicUrl: z.string().optional(),
  /** Days and times on the dashboard are in this time zone (the config's schedule.timezone). */
  timeZone: z.string(),
});

/** Everything that needs the owner's eye, worst first: the banner on every page and the dots in the menu. */
export const HealthSchema = z.object({
  state: health,
  checkedAt: iso,
  problems: z.array(
    z.object({
      section: z.enum(['sources', 'plays', 'failures', 'deploys', 'system']),
      severity: z.enum(['warn', 'error']),
      message: z.string(),
    }),
  ),
});

export const TotalsSchema = z.object({
  plays: z.number(),
  uniqueClients: z.number(),
  failures: z.number(),
  minutesWatched: z.number(),
});

/**
 * A show's (or live channel's) image, as the public catalog publishes it: its poster, or a channel's logo. Absent
 * when the catalog has none of its own for it (only the generic placeholder): the dashboard draws a tile then.
 */
const art = {
  /** Image URL (the public catalog's own copy, or the broadcaster's when reachable from anywhere). */
  poster: z.string().optional(),
  /** Its shape: `poster` 2:3 (default), `square` (channel logos), `landscape` 16:9. */
  posterShape: z.enum(['poster', 'square', 'landscape']).optional(),
};
const ArtSchema = z.object(art);

const showLine = z.object({
  showId: z.string(),
  title: z.string().optional(),
  plays: z.number(),
  source: z.string(),
  ...art,
});
const perDay = z.object({
  day,
  plays: z.number(),
  unique: z.number(),
  failures: z.number(),
  minutes: z.number(),
});

export const OverviewSchema = z.object({
  generatedAt: iso,
  home: z.object({
    today: TotalsSchema,
    d7: TotalsSchema,
    d30: TotalsSchema,
    perDay: z.array(perDay),
    /** The first day this home's plays were counted (its first event); earlier days have no data, not zero. */
    countedSince: day.optional(),
    topShows: z.array(showLine),
  }),
  public: z.object({
    counted: z.boolean(),
    note: z.string().optional(),
    lastDay: day.optional(),
    /** The first day the public addon was counted (its first daily total); earlier days have no data, not zero. */
    countedSince: day.optional(),
    d7: TotalsSchema,
    d30: TotalsSchema,
    perDay: z.array(perDay),
    topShows: z.array(showLine),
  }),
  failureRate7d: z.number(),
  /** Per source: when it was last read well, against how often it should be. */
  freshness: z.array(
    z.object({
      source: z.string(),
      health,
      lastGoodAt: iso.optional(),
      cadenceHours: z.number().optional(),
      stale: z.boolean(),
    }),
  ),
  lastPublishAt: iso.optional(),
  /** This home's plays and failures since the running version was deployed (a fix shows at once). */
  sinceRelease: z
    .object({ revision: z.string(), at: iso, plays: z.number(), failures: z.number() })
    .optional(),
  /** Today's Cloudflare free-plan use (public addon), when read. */
  quota: z
    .object({ requests: z.number(), requestsLimit: z.number(), aeWrites: z.number(), aeLimit: z.number() })
    .optional(),
});

export const SourceHealthSchema = z.object({
  source: z.string(),
  health: z.string(),
  notes: z.array(z.string()),
  lastGoodAt: iso.optional(),
  cadenceHours: z.number().optional(),
  stale: z.boolean(),
  lastFullRun: iso.optional(),
  canary: z
    .object({
      outcome: z.string(),
      at: iso,
      step: z.string().optional(),
      detail: z.string().optional(),
      unavailable: z.array(z.string()).optional(),
    })
    .optional(),
  shows: z.number(),
  episodes: z.number(),
  lastAiringRun: iso.optional(),
  /** Titles the site lists with nothing to watch (not in the catalog). */
  emptyShows: z.array(z.string()),
  /** Shows the last full run was refused (bot protection), and their retries. */
  blocked: z
    .object({
      pending: z.array(z.string()),
      recovered: z.array(z.string()),
      attempts: z.number(),
      nextAt: iso.optional(),
    })
    .optional(),
  /** Canary results, oldest first (14 days). */
  canaryHistory: z.array(
    z.object({
      at: iso,
      outcome: z.string(),
      step: z.string().optional(),
      episodeId: z.string().optional(),
      statuses: z.string().optional(),
      unavailable: z.number(),
    }),
  ),
  /** Reads of this source, newest first. */
  runs: z.array(
    z.object({
      at: iso,
      kind: z.string(),
      status: z.string(),
      showsOk: z.number(),
      showsFailed: z.number(),
      newEpisodes: z.number(),
      seconds: z.number().optional(),
      error: z.string().optional(),
    }),
  ),
});

export const SourcesSchema = z.object({
  sources: z.array(SourceHealthSchema),
  proxy: z.object({
    servers: z.array(z.string()),
    lastError: z.string().optional(),
    lastErrorAt: iso.optional(),
    /** Per proxy exit, what the relay saw since the service started. */
    exits: z.array(
      z.object({
        server: z.string(),
        ok: z.number(),
        errors: z.number(),
        lastOkAt: iso.optional(),
        lastErrorAt: iso.optional(),
        lastError: z.string().optional(),
      }),
    ),
  }),
  /** The Kan reader's backlog: episodes pages waiting, and shows read through. */
  kan: z
    .object({ pending: z.number(), shows: z.number(), showsDone: z.number(), backoffUntil: iso.optional() })
    .optional(),
  /** Every live channel: each stream's last daily check, and its programme guide. */
  live: z
    .object({
      checkedAt: iso.optional(),
      channels: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          ...art,
          streams: z.array(
            z.object({
              title: z.string(),
              via: z.string(),
              outcome: z.string(),
              statuses: z.string().optional(),
              detail: z.string().optional(),
              /** The first try failed and this is the second, a little later (`outcome` says how it went). */
              retried: z.boolean().optional(),
              /** Latest outcomes, oldest first: o played, r refused (abroad), f failed. */
              recent: z.string().optional(),
              /** Plays outside Israel? `always` refused there, `sometimes` (some programmes). */
              israelOnly: z.enum(['always', 'sometimes']).optional(),
            }),
          ),
          guide: z
            .object({ at: iso, programmes: z.number(), until: iso.optional(), error: z.string().optional() })
            .optional(),
        }),
      ),
    })
    .optional(),
});

/** One play or failure, for lists that lead to its trace. */
const playLine = z.object({
  playId: z.string(),
  at: iso,
  outcome: z.string(),
  source: z.string().optional(),
  showId: z.string().optional(),
  episodeId: z.string().optional(),
  title: z.string().optional(),
  latencyMs: z.number().optional(),
  status: z.number().optional(),
  reason: z.string().optional(),
  ...art,
});

export const PlaysSchema = z.object({
  bySourcePerDay: z.array(z.object({ day, source: z.string(), plays: z.number() })),
  /** This home's most played shows, last 7 days. */
  topShows: z.array(showLine),
  topEpisodes: z.array(
    z.object({
      episodeId: z.string(),
      title: z.string().optional(),
      plays: z.number(),
      source: z.string().optional(),
      ...art,
    }),
  ),
  firstPlaylistMs: z.object({ p50: z.number().optional(), p95: z.number().optional(), n: z.number() }),
  /** Time to first playlist per day (last 14 days). */
  latencyPerDay: z.array(
    z.object({ day, p50: z.number().optional(), p95: z.number().optional(), n: z.number() }),
  ),
  recent: z.array(playLine),
});

export const FailuresSchema = z.object({
  /** The days `perDay` counts (last 7, in the dashboard's time zone). */
  days: z.array(day),
  recent: z.array(playLine),
  groups: z.array(
    z.object({
      source: z.string(),
      stage: z.string(),
      status: z.number().nullable(),
      reason: z.string(),
      n: z.number(),
      last: iso,
      lastPlayId: z.string().optional(),
      perDay: z.array(z.number()),
      /** Whose fault: one title (`episode`) or the source itself (`source`). */
      blame: z.string().optional(),
      /** What happened, in plain words. */
      plain: z.string().optional(),
      /** Set when these failures' cause was fixed after them: what was done. They are not open problems. */
      fixed: z.string().optional(),
    }),
  ),
});

export const TraceSchema = z.object({
  playId: z.string(),
  /** The show's (or channel's) name, when the play had one. */
  title: z.string().optional(),
  events: z.array(
    z.object({
      ts: iso,
      kind: z.string(),
      component: z.string(),
      outcome: z.string(),
      source: z.string().optional(),
      showId: z.string().optional(),
      episodeId: z.string().optional(),
      status: z.number().optional(),
      latencyMs: z.number().optional(),
      detail: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

export const LiveSchema = z.object({
  at: iso,
  sessions: z.array(
    z.object({
      kind: z.enum(['play', 'relay']),
      playId: z.string(),
      since: iso,
      source: z.string().optional(),
      showId: z.string().optional(),
      episodeId: z.string().optional(),
      title: z.string().optional(),
      ...art,
      segments: z.number(),
      bytes: z.number(),
    }),
  ),
});

export const DeploysSchema = z.object({
  catalog: z.array(z.object({ source: z.string(), shows: z.number(), episodes: z.number() })),
  lastPublish: z.object({ at: iso, status: z.string(), detail: z.string().optional() }).optional(),
  /** Recent publishes, newest first. */
  publishes: z.array(
    z.object({ at: iso, status: z.string(), seconds: z.number().optional(), detail: z.string().optional() }),
  ),
  /** The publisher's own check of the last publish. */
  audit: z
    .object({
      at: iso,
      metas: z.number(),
      problems: z.array(z.object({ check: z.string(), count: z.number(), examples: z.array(z.string()) })),
      /** Per source, shows published without genres, a description of their own or a year line. */
      gaps: z
        .array(
          z.object({
            source: z.string(),
            shows: z.number(),
            noGenre: z.number(),
            noDescription: z.number(),
            noYear: z.number(),
          }),
        )
        .optional(),
    })
    .optional(),
  /** Shows whose last read failed (their last good data is still published). */
  failingShows: z.array(
    z.object({ id: z.string(), title: z.string(), error: z.string(), lastOkAt: iso, ...art }),
  ),
  cloudflare: z
    .object({
      dataWorker: z.string(),
      apiWorker: z.string(),
      dataVersion: z.string().optional(),
      apiVersion: z.string().optional(),
      commands: z.array(z.string()),
    })
    .optional(),
});

export const SystemSchema = z.object({
  revision: z.string(),
  version: z.string(),
  node: z.string(),
  platform: z.string(),
  uptimeSec: z.number(),
  startedAt: iso,
  /**
   * `availableSystem`: what programs can still get without the system swapping (free, inactive and purgeable memory
   * on macOS, MemAvailable on Linux); `freeSystem` alone leaves out the file cache and reads as nearly full.
   */
  memoryMB: z.object({
    process: z.number(),
    freeSystem: z.number(),
    availableSystem: z.number(),
    totalSystem: z.number(),
  }),
  diskFreeMB: z.number().optional(),
  diskTotalMB: z.number().optional(),
  databases: z.array(
    z.object({ name: z.string(), sizeMB: z.number(), growthPerDayMB: z.number().optional() }),
  ),
  backup: z
    .object({ file: z.string(), at: iso, sizeMB: z.number(), check: z.string().optional() })
    .optional(),
  eventsPerDay: z.array(z.object({ day, n: z.number() })),
  /** Cloudflare free-plan use today (public addon only; read hourly). */
  quota: z
    .object({
      day,
      at: iso,
      requests: z.number(),
      byScript: z.array(z.object({ script: z.string(), requests: z.number() })),
      aeWrites: z.number(),
      limits: z.object({ requests: z.number(), aeWrites: z.number() }),
      warn: z.string().optional(),
      readError: z.string().optional(),
    })
    .optional(),
});

export const ActionSchema = z.object({ accepted: z.boolean(), message: z.string() });

export type Session = z.infer<typeof SessionSchema>;
export type Health = z.infer<typeof HealthSchema>;
export type Overview = z.infer<typeof OverviewSchema>;
export type Sources = z.infer<typeof SourcesSchema>;
export type Plays = z.infer<typeof PlaysSchema>;
export type Failures = z.infer<typeof FailuresSchema>;
export type Trace = z.infer<typeof TraceSchema>;
export type Live = z.infer<typeof LiveSchema>;
export type Deploys = z.infer<typeof DeploysSchema>;
export type System = z.infer<typeof SystemSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type PlayLine = z.infer<typeof playLine>;
export type Art = z.infer<typeof ArtSchema>;

/** What each GET route answers (the dashboard's typed client; the daemon's handlers are checked against it). */
export interface Responses {
  session: Session;
  health: Health;
  overview: Overview;
  sources: Sources;
  plays: Plays;
  failures: Failures;
  trace: Trace;
  live: Live;
  deploys: Deploys;
  system: System;
  refresh: Action;
  canary: Action;
}
