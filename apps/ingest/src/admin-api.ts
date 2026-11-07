// The owner's admin API (`/api/v1/*`, see packages/admin-contract): the numbers the dashboard shows, each answer
// built here from the usage events, the catalog database, the live sessions and the published files. Read-only
// except two safe actions (refresh one show, run the canary). Mounted behind the admin gate (daemon.ts).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statfsSync, statSync } from 'node:fs';
import { arch, freemem, platform, totalmem } from 'node:os';
import { join } from 'node:path';
import type {
  Deploys,
  Failures,
  Health,
  Live,
  Overview,
  PlayLine,
  Plays,
  Session,
  Sources,
  System,
  Trace,
} from '@israel-tv/admin-contract';
import { ADMIN_API } from '@israel-tv/admin-contract';
import { apiWorkerName, type Freshness, LIVE_CHANNELS, roleOf, staleSince } from '@israel-tv/core';
import type { DailyRow, EventRow } from '@israel-tv/events';
import { RELEASE_VERSION } from '@israel-tv/runtime';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { csrfFor } from './admin-auth.ts';
import { GUIDE_KEY, type GuideState } from './epg.ts';
import { kanProgress } from './kan.ts';
import { LIVE_CHECK_KEY, type LiveCheck } from './live.ts';
import { API_VERSION, DATA_VERSION } from './publish.ts';

/** What the API reads from the running daemon (it does not import the daemon: no cycle). */
export interface Daemon {
  readonly config: import('@israel-tv/core').Config;
  readonly store: import('@israel-tv/store').Store;
  readonly events: import('@israel-tv/events').EventStore;
  readonly sessions: import('@israel-tv/resolver').PlaySessions;
  readonly revision: string;
  readonly startedAt: string;
  /** The running version and when it was first started (its deploy). */
  readonly release: { revision: string; at: string };
  readonly geo: { proxies: string[]; lastError?: string; lastErrorAt?: string };
  readonly exits: ReadonlyMap<
    string,
    {
      server: string;
      ok: number;
      errors: number;
      lastOkAt?: string;
      lastErrorAt?: string;
      lastError?: string;
    }
  >;
  status(): import('@israel-tv/core').StatusFile & { notes?: string[] };
  dashboard(): import('./usage-page.ts').Dashboard;
  canaryStatus(): import('./usage-page.ts').Dashboard['canary'];
  refresh(seriesId: string): { queued: boolean; position: number } | { error: string };
  canary(): Promise<unknown>;
}

const DAY_MS = 86_400_000;

/** Memory programs can still get without swapping, in MB (see SystemSchema.memoryMB). */
function availableMemoryMB(): number {
  try {
    if (platform() === 'darwin') {
      const out = execFileSync('vm_stat', { encoding: 'utf8', timeout: 2000 });
      const page = Number(/page size of (\d+) bytes/.exec(out)?.[1] ?? 4096);
      const pages = (k: string) => Number(new RegExp(`Pages ${k}:\\s+(\\d+)`).exec(out)?.[1] ?? 0);
      return mb((pages('free') + pages('inactive') + pages('speculative') + pages('purgeable')) * page);
    }
    if (platform() === 'linux') {
      const kb = /MemAvailable:\s+(\d+) kB/.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1];
      if (kb) return mb(Number(kb) * 1024);
    }
  } catch {}
  return mb(freemem());
}
const mb = (bytes: number) => Math.round((bytes / 1_048_576) * 100) / 100;

function percentile(sorted: number[], p: number): number | undefined {
  if (!sorted.length) return undefined;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const parseDetail = (detail: string | null): Record<string, unknown> => {
  if (!detail) return {};
  try {
    return JSON.parse(detail) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/** A show's (or live channel's) name. */
function titleOf(d: Daemon, showId: string | null | undefined): string | undefined {
  if (!showId) return undefined;
  return d.store.getShow(showId)?.title ?? LIVE_CHANNELS.find((c) => c.id === showId)?.name;
}

const posters = new Map<string, { at: number; url: string | undefined }>();

/** A show's poster as the public catalog publishes it (read from the published meta; cached 10 minutes). */
function posterOf(d: Daemon, showId: string): string | undefined {
  const hit = posters.get(showId);
  if (hit && Date.now() - hit.at < 600_000) return hit.url;
  let url: string | undefined;
  if (/^[A-Za-z0-9_]+$/.test(showId)) {
    try {
      const meta = JSON.parse(
        readFileSync(join(d.config.publisher.dir, 'meta', 'series', `${showId}.json`), 'utf8'),
      ) as {
        meta?: { poster?: string };
      };
      const p = meta.meta?.poster;
      const origin = d.config.publisher.type === 'cloudflare' ? d.config.publisher.publicUrl : undefined;
      url =
        p && /^https:\/\//.test(p)
          ? p
          : p?.startsWith('/') && origin
            ? `${origin.replace(/\/$/, '')}${p}`
            : undefined;
    } catch {}
  }
  posters.set(showId, { at: Date.now(), url });
  if (posters.size > 500) posters.delete(posters.keys().next().value as string);
  return url;
}

export function session(d: Daemon, csrf: string, revision: string): Session {
  const p = d.config.publisher;
  return {
    csrf,
    revision,
    role: roleOf(d.config),
    publisher: p.type,
    ...(p.type === 'cloudflare' && p.publicUrl ? { publicUrl: p.publicUrl } : {}),
    timeZone: d.events.timeZone,
  };
}

/** Everything that needs the owner's eye, worst first (the banner and the menu dots). */
export function health(d: Daemon, now = Date.now()): Health {
  const status = d.status();
  const problems: Health['problems'] = [];
  const add = (section: Health['problems'][number]['section'], severity: 'warn' | 'error', message: string) =>
    problems.push({ section, severity, message });
  for (const s of status.sources)
    if (s.health !== 'ok') add('sources', s.health, `${s.source}: ${s.notes[0] ?? s.health}`);
  for (const c of d.canaryStatus())
    if (c.outcome !== 'ok')
      add('sources', 'error', `canary: ${c.source} does not play (failed at ${c.step ?? '?'})`);
  if (status.failingShows.length)
    add(
      'sources',
      'warn',
      `${status.failingShows.length} ${status.failingShows.length === 1 ? 'show' : 'shows'} failed to read (last good data still served)`,
    );
  const fresh = freshness(d);
  for (const [cat, src] of Object.entries(fresh?.catalogs ?? {}))
    if (fresh && staleSince(fresh, cat, now))
      add('sources', 'error', `the ${src} row is shown as stale in the addon`);
  if (status.publish) add('deploys', 'error', status.publish);
  if (status.tmdb) add('deploys', 'warn', status.tmdb);
  for (const n of status.notes ?? []) add('system', 'warn', n);
  const day = new Date(now - DAY_MS).toISOString();
  const failed = d.events.events({ kind: 'failure', since: day, limit: 1000, viewersOnly: true });
  if (failed.length) {
    const titles = failed.filter((e) => parseDetail(e.detail).blame === 'episode').length;
    add(
      'failures',
      'warn',
      `${failed.length} ${failed.length === 1 ? 'play' : 'plays'} failed in the last 24 hours${titles ? ` (${titles} where only that title was refused)` : ''}`,
    );
  }
  const backup = d.store.getState<{ at: string; check?: string }>('backup:last');
  if (backup && now - Date.parse(backup.at) > 2 * DAY_MS)
    add('system', 'warn', `last backup ${backup.at.slice(0, 10)}`);
  if (backup?.check && !/^ok/i.test(backup.check)) add('system', 'warn', `backup check: ${backup.check}`);
  try {
    const fs = statfsSync(d.config.store.path);
    const free = fs.bavail / fs.blocks;
    if (free < 0.03) add('system', 'error', `disk ${Math.round((1 - free) * 100)}% full`);
    else if (free < 0.08) add('system', 'warn', `disk ${Math.round((1 - free) * 100)}% full`);
  } catch {}
  problems.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  return {
    state: problems.some((p) => p.severity === 'error') ? 'error' : problems.length ? 'warn' : 'ok',
    checkedAt: new Date(now).toISOString(),
    problems,
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
  const month = d.events.lastDays(30, now);
  const today = month[29] as string;
  const all = (r: DailyRow) => r.source === '' && r.showId === '';
  const rowsOf = (origin: 'home' | 'public') => {
    const rows = d.events.daily(month[0] as string, origin).filter((r) => all(r) && r.day !== today);
    const live =
      origin === 'home' ? d.events.homeDay(today).filter(all) : d.events.daily(today, origin).filter(all);
    return new Map([...rows, ...live].map((r) => [r.day, r]));
  };
  const perDay = (origin: 'home' | 'public') => {
    const byDay = rowsOf(origin);
    return month.map((day) => {
      const r = byDay.get(day);
      return {
        day,
        plays: r?.plays ?? 0,
        unique: r?.uniqueClients ?? 0,
        failures: r?.failures ?? 0,
        minutes: Math.round(r?.minutesWatched ?? 0),
      };
    });
  };
  const home = perDay('home');
  const minutes = (n: number) => home.slice(-n).reduce((m, r) => m + r.minutes, 0);
  const line = (s: { showId: string; title?: string; plays: number; source: string }) => {
    const poster = posterOf(d, s.showId);
    return {
      showId: s.showId,
      plays: s.plays,
      source: s.source,
      ...(s.title ? { title: s.title } : {}),
      ...(poster ? { poster } : {}),
    };
  };
  const home7 = dash.home.d7;
  const status = d.status();
  const fresh = freshness(d);
  const lastPublish = d.store.lastGoodRun('publish', d.config.publisher.type);
  const quota = d.store.getState<System['quota']>('cloudflare:quota');
  return {
    generatedAt: new Date(now).toISOString(),
    home: {
      today: totals(dash.home.today, minutes(1)),
      d7: totals(home7, minutes(7)),
      d30: totals(dash.home.d30, minutes(30)),
      perDay: home,
      topShows: dash.home.topShows.filter((t) => t.plays > 0).map(line),
    },
    public: {
      counted: dash.public.via === 'analytics-engine',
      ...(dash.public.note ? { note: dash.public.note } : {}),
      ...(dash.public.lastDay ? { lastDay: dash.public.lastDay } : {}),
      d7: totals(dash.public.d7),
      d30: totals(dash.public.d30),
      perDay: perDay('public'),
      topShows: dash.public.topShows.filter((t) => t.plays > 0).map(line),
    },
    failureRate7d: home7.plays + home7.failures ? home7.failures / (home7.plays + home7.failures) : 0,
    freshness: status.sources.map((s) => {
      const f = fresh?.sources[s.source];
      const cat = Object.entries(fresh?.catalogs ?? {}).find(([, x]) => x === s.source)?.[0];
      return {
        source: s.source,
        health: s.health,
        ...(f?.lastGoodAt ? { lastGoodAt: f.lastGoodAt } : {}),
        ...(f ? { cadenceHours: f.cadenceHours } : {}),
        stale: !!(fresh && cat && staleSince(fresh, cat, now)),
      };
    }),
    ...(lastPublish ? { lastPublishAt: lastPublish.finishedAt ?? lastPublish.startedAt } : {}),
    sinceRelease: (() => {
      const since = d.release.at;
      const ok = [
        ...d.events.events({ kind: 'play_start', since, limit: 5000, viewersOnly: true }),
        ...d.events
          .events({ kind: 'relay_session', since, limit: 5000, viewersOnly: true })
          .filter((e) => e.outcome === 'ok'),
      ].length;
      const failed = d.events.events({ kind: 'failure', since, limit: 5000, viewersOnly: true }).length;
      return { revision: d.release.revision, at: since, plays: ok, failures: failed };
    })(),
    ...(quota && quota.day === new Date(now).toISOString().slice(0, 10)
      ? {
          quota: {
            requests: quota.requests,
            requestsLimit: quota.limits.requests,
            aeWrites: quota.aeWrites,
            aeLimit: quota.limits.aeWrites,
          },
        }
      : {}),
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
  const check = d.store.getState<LiveCheck>(LIVE_CHECK_KEY);
  const guides = d.store.getState<GuideState>(GUIDE_KEY) ?? {};
  const live: Sources['live'] = d.config.sources.live
    ? {
        ...(check ? { checkedAt: check.at } : {}),
        channels: LIVE_CHANNELS.map((c) => {
          const g = guides[c.id];
          const last = g?.rows.at(-1);
          return {
            id: c.id,
            name: c.name,
            streams: (check?.channels[c.id] ?? []).map((x) => ({
              title: x.title,
              via: x.via,
              outcome: x.outcome,
              ...(x.statuses.length ? { statuses: x.statuses.join('/') } : {}),
              ...(x.detail ? { detail: x.detail } : {}),
            })),
            ...(g
              ? {
                  guide: {
                    at: g.at,
                    programmes: g.rows.filter((r) => r[1] > now).length,
                    ...(last ? { until: new Date(last[1]).toISOString() } : {}),
                    ...(g.error ? { error: g.error } : {}),
                  },
                }
              : {}),
          };
        }),
      }
    : undefined;
  const canaries = d.events
    .events({ kind: 'canary', since: new Date(now - 14 * DAY_MS).toISOString(), limit: 1000 })
    .reverse();
  return {
    sources: status.sources.map((s) => {
      const f = fresh?.sources[s.source];
      const cat = catalogOf(s.source);
      const c = canary.get(s.source);
      return {
        source: s.source,
        health: s.health,
        notes: s.notes,
        shows: s.shows,
        episodes: s.episodes,
        ...(f?.lastGoodAt ? { lastGoodAt: f.lastGoodAt } : {}),
        ...(f ? { cadenceHours: f.cadenceHours } : {}),
        stale: !!(fresh && cat && staleSince(fresh, cat, now)),
        ...(s.lastFullRun ? { lastFullRun: s.lastFullRun.at } : {}),
        ...(s.lastAiringRun ? { lastAiringRun: s.lastAiringRun.at } : {}),
        emptyShows: s.emptyShows ?? [],
        ...(s.blocked ? { blocked: s.blocked } : {}),
        ...(c
          ? {
              canary: {
                outcome: c.outcome,
                at: c.at,
                ...(c.step ? { step: c.step } : {}),
                ...(c.detail ? { detail: c.detail } : {}),
                ...(c.unavailable ? { unavailable: c.unavailable } : {}),
              },
            }
          : {}),
        canaryHistory: canaries
          .filter((e) => e.source === s.source)
          .map((e) => {
            const x = parseDetail(e.detail) as { step?: string; statuses?: string; unavailable?: unknown[] };
            return {
              at: e.ts,
              outcome: e.outcome,
              ...(x.step ? { step: x.step } : {}),
              ...(e.episodeId ? { episodeId: e.episodeId } : {}),
              ...(x.statuses ? { statuses: x.statuses } : {}),
              unavailable: Array.isArray(x.unavailable) ? x.unavailable.length : 0,
            };
          }),
        runs: d.store.runsOf(s.source, 20, ['full', 'airing', 'show', 'crawl']).map((r) => ({
          at: r.startedAt,
          kind: r.scope.endsWith(':retry') ? 'retry' : r.kind,
          status: r.status,
          showsOk: r.showsOk,
          showsFailed: r.showsFailed,
          newEpisodes: r.newEpisodes,
          ...(r.finishedAt
            ? { seconds: Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000) }
            : {}),
          ...(r.error ? { error: r.error.slice(0, 300) } : {}),
        })),
      };
    }),
    proxy: {
      servers: d.geo.proxies,
      ...(d.geo.lastError ? { lastError: d.geo.lastError } : {}),
      ...(d.geo.lastErrorAt ? { lastErrorAt: d.geo.lastErrorAt } : {}),
      exits: d.geo.proxies.map((server) => d.exits.get(server) ?? { server, ok: 0, errors: 0 }),
    },
    ...(kan ? { kan } : {}),
    ...(live ? { live } : {}),
  };
}

function playLine(d: Daemon, e: EventRow): PlayLine {
  const x = parseDetail(e.detail);
  const title = titleOf(d, e.showId);
  return {
    playId: e.playId ?? '',
    at: e.ts,
    outcome: e.outcome,
    ...(e.source ? { source: e.source } : {}),
    ...(e.showId ? { showId: e.showId } : {}),
    ...(e.episodeId ? { episodeId: e.episodeId } : {}),
    ...(title ? { title } : {}),
    ...(e.latencyMs !== null ? { latencyMs: e.latencyMs } : {}),
    ...(e.status !== null ? { status: e.status } : {}),
    ...(typeof x.reason === 'string' ? { reason: x.reason.slice(0, 200) } : {}),
  };
}

export function plays(d: Daemon, now = Date.now()): Plays {
  const month = d.events.lastDays(30, now);
  const today = month[29] as string;
  const rows = [
    ...d.events.daily(month[0] as string, 'home').filter((r) => r.day !== today),
    ...d.events.homeDay(today),
  ];
  const bySource = rows.filter((r) => r.source !== '' && r.showId === '');
  const since14 = d.events.dayRange(d.events.lastDays(14, now)[0] as string).from;
  const since7 = d.events.dayRange(d.events.lastDays(7, now)[0] as string).from;
  const starts = d.events.events({ kind: 'play_start', since: since14, limit: 5000, viewersOnly: true });
  const relays = d.events.events({ kind: 'relay_session', since: since14, limit: 5000, viewersOnly: true });
  const byEpisode = new Map<string, { n: number; source?: string }>();
  for (const e of starts)
    if (e.episodeId && e.ts >= since7)
      byEpisode.set(e.episodeId, {
        n: (byEpisode.get(e.episodeId)?.n ?? 0) + 1,
        ...(e.source ? { source: e.source } : {}),
      });
  const timed = [...starts, ...relays].filter(
    (e): e is EventRow & { latencyMs: number } => typeof e.latencyMs === 'number',
  );
  const sorted = (list: number[]) => list.sort((a, b) => a - b);
  const week = sorted(timed.filter((e) => e.ts >= since7).map((e) => e.latencyMs));
  const perDay = new Map<string, number[]>();
  for (const e of timed) {
    const day = d.events.dayOf(e.ts);
    const list = perDay.get(day);
    if (list) list.push(e.latencyMs);
    else perDay.set(day, [e.latencyMs]);
  }
  const week0 = d.events.lastDays(7, now)[0] as string;
  const shows = new Map<string, { source: string; plays: number }>();
  for (const r of rows.filter((x) => x.showId !== '' && x.day >= week0))
    shows.set(r.showId, { source: r.source, plays: (shows.get(r.showId)?.plays ?? 0) + r.plays });
  const failures = d.events.events({ kind: 'failure', since: since14, limit: 30, viewersOnly: true });
  return {
    bySourcePerDay: bySource.map((r) => ({ day: r.day, source: r.source, plays: r.plays })),
    topShows: [...shows]
      .filter(([, v]) => v.plays > 0)
      .sort((a, b) => b[1].plays - a[1].plays)
      .slice(0, 8)
      .map(([showId, v]) => {
        const title = titleOf(d, showId);
        const poster = posterOf(d, showId);
        return {
          showId,
          source: v.source,
          plays: v.plays,
          ...(title ? { title } : {}),
          ...(poster ? { poster } : {}),
        };
      }),
    topEpisodes: [...byEpisode]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 10)
      .map(([episodeId, v]) => {
        const show = episodeId.split(':')[0] ?? '';
        const t = titleOf(d, show);
        const poster = posterOf(d, show);
        return {
          episodeId,
          plays: v.n,
          ...(t ? { title: t } : {}),
          ...(v.source ? { source: v.source } : {}),
          ...(poster ? { poster } : {}),
        };
      }),
    firstPlaylistMs: {
      n: week.length,
      ...(week.length ? { p50: percentile(week, 50), p95: percentile(week, 95) } : {}),
    } as Plays['firstPlaylistMs'],
    latencyPerDay: d.events.lastDays(14, now).map((day) => {
      const l = sorted(perDay.get(day) ?? []);
      return {
        day,
        n: l.length,
        ...(l.length ? { p50: percentile(l, 50) as number, p95: percentile(l, 95) as number } : {}),
      };
    }),
    recent: [...starts.slice(0, 30), ...failures]
      .filter((e) => e.playId)
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, 30)
      .map((e) => playLine(d, e)),
  };
}

export function failures(d: Daemon, now = Date.now()): Failures {
  const week = d.events.lastDays(7, now);
  const since = d.events.dayRange(week[0] as string).from;
  const groups = new Map<string, Failures['groups'][number]>();
  const all = d.events.events({ kind: 'failure', since, limit: 5000, viewersOnly: true });
  for (const e of all) {
    const detail = parseDetail(e.detail) as { stage?: string; reason?: string; blame?: string };
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
        ...(detail.blame ? { blame: detail.blame } : {}),
      };
      groups.set(key, g);
    }
    g.n++;
    if (e.ts >= g.last) {
      g.last = e.ts;
      if (e.playId) g.lastPlayId = e.playId;
    }
    const i = week.indexOf(d.events.dayOf(e.ts));
    if (i >= 0) g.perDay[i] = (g.perDay[i] ?? 0) + 1;
  }
  return {
    days: week,
    recent: all
      .filter((e) => e.playId)
      .slice(0, 30)
      .map((e) => playLine(d, e)),
    groups: [...groups.values()].sort((a, b) => b.n - a.n).slice(0, 50),
  };
}

export function trace(d: Daemon, playId: string): Trace {
  const rows = d.events.events({ playId, limit: 500 }).reverse();
  const title = titleOf(d, rows.find((e) => e.showId)?.showId);
  return {
    playId,
    ...(title ? { title } : {}),
    events: rows.map((e) => ({
      ts: e.ts,
      kind: e.kind,
      component: e.component,
      outcome: e.outcome,
      ...(e.source ? { source: e.source } : {}),
      ...(e.showId ? { showId: e.showId } : {}),
      ...(e.episodeId ? { episodeId: e.episodeId } : {}),
      ...(e.status !== null ? { status: e.status } : {}),
      ...(e.latencyMs !== null ? { latencyMs: e.latencyMs } : {}),
      ...(e.detail ? { detail: parseDetail(e.detail) } : {}),
    })),
  };
}

export function live(d: Daemon, now = Date.now()): Live {
  return {
    at: new Date(now).toISOString(),
    sessions: d.sessions.active().map((s) => {
      const title = titleOf(d, s.showId);
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
    publishes: d.store.runsOfKind('publish', 15).map((r) => ({
      at: r.startedAt,
      status: r.status,
      ...(r.finishedAt
        ? { seconds: Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000) }
        : {}),
      ...(r.error ? { detail: r.error.slice(0, 300) } : {}),
    })),
    ...(status.audit ? { audit: status.audit } : {}),
    failingShows: status.failingShows,
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
  let disk: { free: number; total: number } | undefined;
  try {
    const s = statfsSync(d.config.store.path);
    disk = {
      free: Math.round((s.bavail * s.bsize) / 1_048_576),
      total: Math.round((s.blocks * s.bsize) / 1_048_576),
    };
  } catch {}
  const dash = d.dashboard();
  const backup = d.store.getState<{ file: string; at: string; bytes?: number; check?: string }>(
    'backup:last',
  );
  const quota = d.store.getState<System['quota']>('cloudflare:quota');
  const byDay = new Map(dash.data.eventsPerDay.map((r) => [r.day, r.n]));
  return {
    revision,
    version: RELEASE_VERSION,
    node: process.version,
    platform: `${platform()} ${arch()}`,
    uptimeSec: Math.round(process.uptime()),
    startedAt: d.startedAt,
    memoryMB: {
      process: mb(process.memoryUsage().rss),
      freeSystem: mb(freemem()),
      availableSystem: availableMemoryMB(),
      totalSystem: mb(totalmem()),
    },
    ...(disk ? { diskFreeMB: disk.free, diskTotalMB: disk.total } : {}),
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
    eventsPerDay: d.events.lastDays(30, now).map((day) => ({ day, n: byDay.get(day) ?? 0 })),
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
  // Each builder returns its contract type (Responses in packages/admin-contract): drift fails typecheck.
  api.get('/session', (c) => c.json(session(d, csrfFor(token), d.revision)));
  api.get('/health', (c) => c.json(health(d)));
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
