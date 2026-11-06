// The owner's admin API (`/api/v1/*`, see packages/admin-contract): the numbers the dashboard shows, each answer
// built here from the usage events, the catalog database, the live sessions and the published files. Read-only
// except two safe actions (refresh one show, run the canary). Mounted behind the admin gate (daemon.ts).
import { existsSync, readFileSync, statfsSync, statSync } from 'node:fs';
import { freemem } from 'node:os';
import { join } from 'node:path';
import type {
  Deploys,
  Failures,
  Live,
  Overview,
  Plays,
  Session,
  Sources,
  System,
  Trace,
} from '@israel-tv/admin-contract';
import { ADMIN_API } from '@israel-tv/admin-contract';
import { apiWorkerName, type Freshness, LIVE_CHANNELS, roleOf, staleSince } from '@israel-tv/core';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { csrfFor } from './admin-auth.ts';
import { kanProgress } from './kan.ts';
import { API_VERSION, DATA_VERSION } from './publish.ts';

/** What the API reads from the running daemon (it does not import the daemon: no cycle). */
export interface Daemon {
  readonly config: import('@israel-tv/core').Config;
  readonly store: import('@israel-tv/store').Store;
  readonly events: import('@israel-tv/events').EventStore;
  readonly sessions: import('@israel-tv/resolver').PlaySessions;
  readonly revision: string;
  readonly geo: { proxies: string[]; lastError?: string; lastErrorAt?: string };
  status(): import('@israel-tv/core').StatusFile;
  dashboard(): import('./usage-page.ts').Dashboard;
  canaryStatus(): { source: string; outcome: string; at: string; step?: string; detail?: string }[];
  refresh(seriesId: string): { queued: boolean; position: number } | { error: string };
  canary(): Promise<unknown>;
}

const DAY_MS = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const days = (n: number, now: number) =>
  Array.from({ length: n }, (_, i) => isoDay(now - (n - 1 - i) * DAY_MS));
const mb = (bytes: number) => Math.round((bytes / 1_048_576) * 100) / 100;

function percentile(sorted: number[], p: number): number | undefined {
  if (!sorted.length) return undefined;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export function session(d: Daemon, csrf: string, revision: string): Session {
  const p = d.config.publisher;
  return {
    csrf,
    revision,
    role: roleOf(d.config),
    publisher: p.type,
    ...(p.type === 'cloudflare' && p.publicUrl ? { publicUrl: p.publicUrl } : {}),
  };
}

export function overview(d: Daemon, now = Date.now()): Overview {
  const dash = d.dashboard();
  const totals = (t: { plays: number; failures: number; uniqueAvg: number }, minutes = 0) => ({
    plays: t.plays,
    uniqueClients: Math.round(t.uniqueAvg),
    failures: t.failures,
    minutesWatched: minutes,
  });
  const perDay = (origin: 'home' | 'public') => {
    const rows = d.events
      .daily(isoDay(now - 29 * DAY_MS), origin)
      .filter((r) => r.source === '' && r.showId === '');
    const today =
      origin === 'home'
        ? d.events.homeDay(isoDay(now)).filter((r) => r.source === '' && r.showId === '')
        : [];
    const byDay = new Map([...rows, ...today].map((r) => [r.day, r]));
    return days(30, now).map((day) => {
      const r = byDay.get(day);
      return { day, plays: r?.plays ?? 0, unique: r?.uniqueClients ?? 0, failures: r?.failures ?? 0 };
    });
  };
  const minutes = (origin: 'home' | 'public', since: string) =>
    Math.round(
      d.events
        .daily(since, origin)
        .filter((r) => r.source === '' && r.showId === '')
        .reduce((n, r) => n + (r.minutesWatched ?? 0), 0),
    );
  const since7 = isoDay(now - 6 * DAY_MS);
  const since30 = isoDay(now - 29 * DAY_MS);
  const line = (s: { showId: string; title?: string; plays: number; source: string }) => ({
    showId: s.showId,
    plays: s.plays,
    source: s.source,
    ...(s.title ? { title: s.title } : {}),
  });
  const home7 = dash.home.d7;
  return {
    generatedAt: new Date(now).toISOString(),
    home: {
      today: totals(dash.home.today),
      d7: totals(home7, minutes('home', since7)),
      d30: totals(dash.home.d30, minutes('home', since30)),
      perDay: perDay('home'),
      topShows: dash.home.topShows.map(line),
    },
    public: {
      counted: dash.public.via === 'analytics-engine',
      ...(dash.public.note ? { note: dash.public.note } : {}),
      ...(dash.public.lastDay ? { lastDay: dash.public.lastDay } : {}),
      d7: totals(dash.public.d7),
      d30: totals(dash.public.d30),
      perDay: perDay('public'),
      topShows: dash.public.topShows.map(line),
    },
    failureRate7d: home7.plays + home7.failures ? home7.failures / (home7.plays + home7.failures) : 0,
  };
}

/** The published freshness file (what the public addon compares), if this instance publishes. */
function freshness(d: Daemon): Freshness | undefined {
  const f = join(d.config.publisher.dir, 'freshness.json');
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as Freshness;
  } catch {
    return undefined;
  }
}

export function sources(d: Daemon, now = Date.now()): Sources {
  const status = d.status();
  const fresh = freshness(d);
  const canary = new Map(d.canaryStatus().map((c) => [c.source, c]));
  const catalogOf = (source: string) =>
    Object.entries(fresh?.catalogs ?? {}).find(([, s]) => s === source)?.[0];
  const kan = kanProgress(d.store);
  return {
    sources: status.sources.map((s) => {
      const f = fresh?.sources[s.source];
      const cat = catalogOf(s.source);
      const c = canary.get(s.source);
      return {
        source: s.source,
        health: s.health,
        notes: s.notes,
        ...(f?.lastGoodAt ? { lastGoodAt: f.lastGoodAt } : {}),
        ...(f ? { cadenceHours: f.cadenceHours } : {}),
        stale: !!(fresh && cat && staleSince(fresh, cat, now)),
        ...(s.lastFullRun ? { lastFullRun: s.lastFullRun.at } : {}),
        ...(c
          ? {
              canary: {
                outcome: c.outcome,
                at: c.at,
                ...(c.step ? { step: c.step } : {}),
                ...(c.detail ? { detail: c.detail } : {}),
              },
            }
          : {}),
      };
    }),
    proxy: {
      servers: d.geo.proxies,
      ...(d.geo.lastError ? { lastError: d.geo.lastError } : {}),
      ...(d.geo.lastErrorAt ? { lastErrorAt: d.geo.lastErrorAt } : {}),
    },
    ...(kan ? { kan } : {}),
  };
}

export function plays(d: Daemon, now = Date.now()): Plays {
  const since30 = isoDay(now - 29 * DAY_MS);
  const rows = [...d.events.daily(since30, 'home'), ...d.events.homeDay(isoDay(now))].filter(
    (r) => r.source !== '' && r.showId === '',
  );
  const since7 = new Date(now - 7 * DAY_MS).toISOString();
  const starts = d.events.events({ kind: 'play_start', since: since7, limit: 5000, viewersOnly: true });
  const byEpisode = new Map<string, number>();
  for (const e of starts) if (e.episodeId) byEpisode.set(e.episodeId, (byEpisode.get(e.episodeId) ?? 0) + 1);
  const latency = [
    ...starts,
    ...d.events.events({ kind: 'relay_session', since: since7, limit: 5000, viewersOnly: true }),
  ]
    .map((e) => e.latencyMs)
    .filter((n): n is number => typeof n === 'number')
    .sort((a, b) => a - b);
  const title = (episodeId: string) => d.store.getShow(episodeId.split(':')[0] ?? '')?.title;
  return {
    bySourcePerDay: rows.map((r) => ({ day: r.day, source: r.source, plays: r.plays })),
    topEpisodes: [...byEpisode]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([episodeId, n]) => {
        const t = title(episodeId);
        return { episodeId, plays: n, ...(t ? { title: t } : {}) };
      }),
    firstPlaylistMs: {
      n: latency.length,
      ...(latency.length ? { p50: percentile(latency, 50), p95: percentile(latency, 95) } : {}),
    } as Plays['firstPlaylistMs'],
  };
}

export function failures(d: Daemon, now = Date.now()): Failures {
  const since = new Date(now - 7 * DAY_MS).toISOString();
  const week = days(7, now);
  const groups = new Map<string, Failures['groups'][number]>();
  for (const e of d.events.events({ kind: 'failure', since, limit: 5000, viewersOnly: true })) {
    const detail = e.detail ? (JSON.parse(e.detail) as { stage?: string; reason?: string }) : {};
    const stage = detail.stage ?? e.component;
    const reason = (detail.reason ?? '').slice(0, 120);
    const key = `${e.source}|${stage}|${e.status}|${reason}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        source: e.source ?? '',
        stage,
        status: e.status,
        reason,
        n: 0,
        last: e.ts,
        perDay: week.map(() => 0),
      };
      groups.set(key, g);
    }
    g.n++;
    if (e.ts >= g.last) {
      g.last = e.ts;
      if (e.playId) g.lastPlayId = e.playId;
    }
    const i = week.indexOf(e.ts.slice(0, 10));
    if (i >= 0) g.perDay[i] = (g.perDay[i] ?? 0) + 1;
  }
  return { groups: [...groups.values()].sort((a, b) => b.n - a.n).slice(0, 50) };
}

export function trace(d: Daemon, playId: string): Trace {
  return {
    playId,
    events: d.events
      .events({ playId, limit: 500 })
      .reverse()
      .map((e) => ({
        ts: e.ts,
        kind: e.kind,
        component: e.component,
        outcome: e.outcome,
        ...(e.source ? { source: e.source } : {}),
        ...(e.showId ? { showId: e.showId } : {}),
        ...(e.episodeId ? { episodeId: e.episodeId } : {}),
        ...(e.status !== null ? { status: e.status } : {}),
        ...(e.latencyMs !== null ? { latencyMs: e.latencyMs } : {}),
        ...(e.detail ? { detail: JSON.parse(e.detail) as Record<string, unknown> } : {}),
      })),
  };
}

export function live(d: Daemon, now = Date.now()): Live {
  return {
    at: new Date(now).toISOString(),
    sessions: d.sessions.active().map((s) => {
      const title = s.showId
        ? (d.store.getShow(s.showId)?.title ?? LIVE_CHANNELS.find((c) => c.id === s.showId)?.name)
        : undefined;
      return {
        kind: s.kind,
        playId: s.playId,
        since: s.since,
        segments: s.segments,
        bytes: s.bytes,
        ...(s.source ? { source: s.source } : {}),
        ...(s.showId ? { showId: s.showId } : {}),
        ...(s.episodeId ? { episodeId: s.episodeId } : {}),
        ...(title ? { title } : {}),
      };
    }),
  };
}

export function deploys(d: Daemon): Deploys {
  const status = d.status();
  const kind = d.config.publisher.type;
  const last = d.store.lastRun('publish', kind);
  const p = d.config.publisher;
  const dataVersion = d.store.getState<string>(DATA_VERSION);
  const apiVersion = d.store.getState<string>(API_VERSION);
  return {
    catalog: status.sources.map((s) => ({ source: s.source, shows: s.shows, episodes: s.episodes })),
    ...(last
      ? {
          lastPublish: {
            at: last.finishedAt ?? last.startedAt,
            status: last.status,
            ...(last.error ? { detail: last.error.slice(0, 300) } : {}),
          },
        }
      : {}),
    ...(p.type === 'cloudflare'
      ? {
          cloudflare: {
            dataWorker: p.workerName,
            apiWorker: apiWorkerName(p),
            ...(dataVersion ? { dataVersion } : {}),
            ...(apiVersion ? { apiVersion } : {}),
            commands: [
              'pnpm israel-tv versions data',
              'pnpm israel-tv rollback data',
              'pnpm israel-tv versions api',
              'pnpm israel-tv rollback api',
            ],
          },
        }
      : {}),
  };
}

export function system(d: Daemon, revision: string, now = Date.now()): System {
  const size = (f: string) => (existsSync(f) ? statSync(f).size : 0);
  let diskFreeMB: number | undefined;
  try {
    const s = statfsSync(d.config.store.path);
    diskFreeMB = Math.round((s.bavail * s.bsize) / 1_048_576);
  } catch {}
  const dash = d.dashboard();
  const backup = d.store.getState<{ file: string; at: string; bytes?: number; check?: string }>(
    'backup:last',
  );
  const quota = d.store.getState<System['quota']>('cloudflare:quota');
  return {
    revision,
    node: process.version,
    uptimeSec: Math.round(process.uptime()),
    memoryMB: { process: mb(process.memoryUsage().rss), freeSystem: mb(freemem()) },
    ...(diskFreeMB !== undefined ? { diskFreeMB } : {}),
    databases: [
      { name: 'catalog', sizeMB: mb(size(d.config.store.path)) },
      {
        name: 'usage events',
        sizeMB: dash.data.sizeMB,
        ...(dash.data.growthPerDayMB !== undefined ? { growthPerDayMB: dash.data.growthPerDayMB } : {}),
      },
    ],
    ...(backup
      ? {
          backup: {
            file: backup.file.split(/[\\/]/).pop() ?? backup.file,
            at: backup.at,
            sizeMB: mb(backup.bytes ?? 0),
            ...(backup.check ? { check: backup.check } : {}),
          },
        }
      : {}),
    ...(quota ? { quota } : {}),
    eventsPerDay: (() => {
      const byDay = new Map(dash.data.eventsPerDay.map((r) => [r.day, r.n]));
      return days(30, now).map((day) => ({ day, n: byDay.get(day) ?? 0 }));
    })(),
  };
}

/** At most this many live streams at once (one per open dashboard tab is plenty for the owner). */
const MAX_STREAMS = 4;
let streams = 0;
let canaryRunning = false;

/** The routes under /api/v1, behind the admin gate (local network, token, CSRF on changes). */
// biome-ignore lint/suspicious/noExplicitAny: mounted on the admin app, whatever its bindings
export function mountAdminApi(app: Hono<any>, d: Daemon, token: string): void {
  const api = new Hono();
  api.use('*', async (c, next) => {
    await next();
    c.header('cache-control', 'no-store');
  });
  api.get('/session', (c) => c.json(session(d, csrfFor(token), d.revision)));
  api.get('/overview', (c) => c.json(overview(d)));
  api.get('/sources', (c) => c.json(sources(d)));
  api.get('/plays', (c) => c.json(plays(d)));
  api.get('/failures', (c) => c.json(failures(d)));
  api.get('/trace/:playId', (c) => {
    const id = c.req.param('playId');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return c.json({ error: 'not a play id' }, 400);
    return c.json(trace(d, id));
  });
  api.get('/live', (c) => c.json(live(d)));
  api.get('/deploys', (c) => c.json(deploys(d)));
  api.get('/system', (c) => c.json(system(d, d.revision)));
  // Live sessions as Server-Sent Events: a snapshot when something changed (checked every 3 s), a comment every
  // 25 s so connections stay open; at most MAX_STREAMS at once.
  api.get('/live/stream', (c) => {
    if (streams >= MAX_STREAMS) return c.json({ error: 'too many live views open' }, 429);
    streams++;
    return streamSSE(c, async (stream) => {
      let last = '';
      let quiet = 0;
      let open = true;
      stream.onAbort(() => {
        open = false;
      });
      try {
        await stream.writeSSE({ event: 'live', data: JSON.stringify(live(d)), retry: 5000 });
        while (open) {
          await stream.sleep(3000);
          const snapshot = live(d);
          const key = JSON.stringify(snapshot.sessions);
          if (key !== last) {
            last = key;
            quiet = 0;
            await stream.writeSSE({ event: 'live', data: JSON.stringify(snapshot) });
          } else if (++quiet >= 8) {
            quiet = 0;
            await stream.write(': still here\n\n');
          }
        }
      } finally {
        streams--;
      }
    });
  });
  api.post('/actions/refresh/:id', (c) => {
    const r = d.refresh(c.req.param('id'));
    return 'error' in r
      ? c.json({ accepted: false, message: r.error }, 404)
      : c.json(
          { accepted: true, message: r.queued ? `queued (position ${r.position})` : 'already queued' },
          202,
        );
  });
  api.post('/actions/canary', (c) => {
    if (canaryRunning) return c.json({ accepted: false, message: 'the canary is already running' }, 409);
    canaryRunning = true;
    void d
      .canary()
      .catch(() => undefined)
      .finally(() => {
        canaryRunning = false;
      });
    return c.json(
      { accepted: true, message: 'the canary started; results appear under Sources in a minute' },
      202,
    );
  });
  app.route(ADMIN_API, api as never);
}
