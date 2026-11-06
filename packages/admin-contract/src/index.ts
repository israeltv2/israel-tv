// The owner's admin API (`/api/v1/*` on the admin port): one schema per answer. The daemon's answers are checked
// against these in tests; the dashboard uses the types. Version 1; a change an older dashboard could misread is a
// new version (a new path prefix).
import { z } from 'zod';

export const ADMIN_API = '/api/v1';
/** Header a cookie-authenticated POST must carry (value from GET /session). */
export const CSRF_HEADER = 'x-israel-tv-csrf';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const iso = z.string();

export const SessionSchema = z.object({
  csrf: z.string(),
  revision: z.string(),
  role: z.string(),
  publisher: z.enum(['local', 'cloudflare']),
  publicUrl: z.string().optional(),
});

export const TotalsSchema = z.object({
  plays: z.number(),
  uniqueClients: z.number(),
  failures: z.number(),
  minutesWatched: z.number(),
});

const showLine = z.object({
  showId: z.string(),
  title: z.string().optional(),
  plays: z.number(),
  source: z.string(),
});
const perDay = z.object({ day, plays: z.number(), unique: z.number(), failures: z.number() });

export const OverviewSchema = z.object({
  generatedAt: iso,
  home: z.object({
    today: TotalsSchema,
    d7: TotalsSchema,
    d30: TotalsSchema,
    perDay: z.array(perDay),
    topShows: z.array(showLine),
  }),
  public: z.object({
    counted: z.boolean(),
    note: z.string().optional(),
    lastDay: day.optional(),
    d7: TotalsSchema,
    d30: TotalsSchema,
    perDay: z.array(perDay),
    topShows: z.array(showLine),
  }),
  failureRate7d: z.number(),
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
    .object({ outcome: z.string(), at: iso, step: z.string().optional(), detail: z.string().optional() })
    .optional(),
});

export const SourcesSchema = z.object({
  sources: z.array(SourceHealthSchema),
  proxy: z.object({
    servers: z.array(z.string()),
    lastError: z.string().optional(),
    lastErrorAt: iso.optional(),
  }),
  kan: z.object({ pending: z.number(), shows: z.number(), backoffUntil: iso.optional() }).optional(),
});

export const PlaysSchema = z.object({
  bySourcePerDay: z.array(z.object({ day, source: z.string(), plays: z.number() })),
  topEpisodes: z.array(z.object({ episodeId: z.string(), title: z.string().optional(), plays: z.number() })),
  firstPlaylistMs: z.object({ p50: z.number().optional(), p95: z.number().optional(), n: z.number() }),
});

export const FailuresSchema = z.object({
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
    }),
  ),
});

export const TraceSchema = z.object({
  playId: z.string(),
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
      segments: z.number(),
      bytes: z.number(),
    }),
  ),
});

export const DeploysSchema = z.object({
  catalog: z.array(z.object({ source: z.string(), shows: z.number(), episodes: z.number() })),
  lastPublish: z.object({ at: iso, status: z.string(), detail: z.string().optional() }).optional(),
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
  node: z.string(),
  uptimeSec: z.number(),
  memoryMB: z.object({ process: z.number(), freeSystem: z.number() }),
  diskFreeMB: z.number().optional(),
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
export type Overview = z.infer<typeof OverviewSchema>;
export type Sources = z.infer<typeof SourcesSchema>;
export type Plays = z.infer<typeof PlaysSchema>;
export type Failures = z.infer<typeof FailuresSchema>;
export type Trace = z.infer<typeof TraceSchema>;
export type Live = z.infer<typeof LiveSchema>;
export type Deploys = z.infer<typeof DeploysSchema>;
export type System = z.infer<typeof SystemSchema>;
export type Action = z.infer<typeof ActionSchema>;
