// What the public status page adds to the status file: the rows with their counts, a day-by-day history per source,
// the live channels' last check (up or down, never a stream address) and when things are refreshed. Read cheaply
// from the store at publish time (docs/operations.md, "The public status page").
import {
  CATALOGS,
  type Config,
  type Health,
  LIVE_CHANNELS,
  type Source,
  type StatusCatalog,
  type StatusFile,
  type StatusLiveChannel,
  type StatusSchedule,
} from '@israel-tv/core';
import type { RunKind, ShowRow, Store } from '@israel-tv/store';
import { Cron } from 'croner';
import { kanRowProgress, stillFilling } from './kan.ts';
import { LIVE_CHECK_KEY, type LiveCheck } from './live.ts';
import { episodeCount } from './runner.ts';

/** Days of history on the status page (runs are kept 60 days; store.prune). */
export const HISTORY_DAYS = 30;

/** The runs that refresh each source. */
const KINDS: Record<Source, RunKind[]> = {
  mako: ['full', 'airing', 'show'],
  reshet: ['full', 'airing', 'show'],
  kan: ['crawl'],
  live: ['full'],
};

const dayIn = (timeZone: string) => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (ms: number) => f.format(ms);
};

/**
 * One health per day per source: no runs → null; nothing succeeded → error (Kan: warn, its slices back off and
 * retry); some failures → warn (Kan: when more failed than succeeded); else ok. Limited test runs do not count.
 */
export function runHistory(
  store: Pick<Store, 'finishedRunsSince'>,
  sources: Source[],
  timeZone: string,
  now = Date.now(),
  days = HISTORY_DAYS,
): NonNullable<StatusFile['history']> {
  const day = dayIn(timeZone);
  const list: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = day(now - i * 86_400_000);
    if (list.at(-1) !== d) list.push(d);
  }
  const at = new Map(list.map((d, i) => [d, i]));
  // A day earlier than the first listed one in this zone, so the first day is complete.
  const since = new Date(now - (days + 1) * 86_400_000).toISOString();
  const kinds = [...new Set(sources.flatMap((s) => KINDS[s]))];
  const tally = new Map<string, { good: number; failed: number }[]>(
    sources.map((s) => [s, list.map(() => ({ good: 0, failed: 0 }))]),
  );
  for (const r of store.finishedRunsSince(since, kinds)) {
    const [source, part] = r.scope.split(':');
    if (part === 'limited' || !source) continue;
    if (!KINDS[source as Source]?.includes(r.kind)) continue;
    const i = at.get(day(Date.parse(r.startedAt)));
    const t = i === undefined ? undefined : tally.get(source)?.[i];
    if (!t) continue;
    if (r.status === 'failed') t.failed++;
    else t.good++;
  }
  const out: Record<string, (Health | null)[]> = {};
  for (const s of sources) {
    out[s] = (tally.get(s) ?? []).map(({ good, failed }) => {
      if (good + failed === 0) return null;
      if (good === 0) return s === 'kan' ? 'warn' : 'error';
      if (s === 'kan' ? failed > good : failed > 0) return 'warn';
      return 'ok';
    });
  }
  return { days: list, sources: out };
}

/** The live channels as last checked: up when any of a channel's streams played (or was refused abroad). */
export function liveChannels(check: LiveCheck | null | undefined): StatusFile['live'] {
  if (!check) return undefined;
  const channels: StatusLiveChannel[] = LIVE_CHANNELS.map((c) => {
    const list = check.channels[c.id] ?? [];
    const fine = list.filter((x) => x.outcome === 'ok' || (check.abroad && x.outcome === 'refused'));
    const israelOnly = check.abroad && fine.length > 0 && fine.every((x) => x.outcome === 'refused');
    return {
      id: c.id,
      name: c.name,
      state: list.length === 0 ? 'unchecked' : fine.length > 0 ? 'up' : 'down',
      helper: c.direct.length === 0,
      ...(israelOnly ? { israelOnly: true } : {}),
    };
  });
  return { at: check.at, abroad: check.abroad, channels };
}

/** When the next runs are, and the nightly run's time when it is a plain daily one ("30 3 * * *" → "03:30"). */
export function refreshSchedule(schedule: Config['schedule'], now = Date.now()): StatusSchedule {
  const tz = schedule.timezone;
  const from = new Date(now);
  const out: StatusSchedule = { timezone: tz };
  try {
    const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule.fullRun.trim());
    if (m) out.fullRunTime = `${m[2]?.padStart(2, '0')}:${m[1]?.padStart(2, '0')}`;
    const next = new Cron(schedule.fullRun, { timezone: tz, paused: true }).nextRun(from);
    if (next) out.nextFullRun = next.toISOString();
    let perDay = 0;
    let soonest: Date | undefined;
    for (const p of schedule.airingChecks) {
      const runs = new Cron(p, { timezone: tz, paused: true }).nextRuns(24 * 60, from);
      const inDay = runs.filter((d) => d.getTime() - now <= 86_400_000);
      perDay += inDay.length;
      if (runs[0] && (!soonest || runs[0] < soonest)) soonest = runs[0];
    }
    if (schedule.airingChecks.length) out.airingChecksPerDay = perDay;
    if (soonest) out.nextAiringCheck = soonest.toISOString();
  } catch {
    // A schedule croner cannot read is the daemon's problem to report; the page just says less.
  }
  return out;
}

/**
 * The rows as the store holds them (the renderer replaces the counts with what it actually published), with a Kan
 * row's first-fill progress.
 */
export function catalogSummary(
  store: Pick<Store, 'getState' | 'findSeriesId' | 'getShow'>,
  sources: Source[],
  rows: ShowRow[],
): StatusCatalog[] {
  const progress = sources.includes('kan') ? kanRowProgress(store) : {};
  return CATALOGS.filter((c) => sources.includes(c.source)).map((c) => {
    const listed = rows.filter((r) => r.catalog === c.id && r.state === 'listed' && episodeCount(r.show) > 0);
    const p = progress[c.id];
    return {
      id: c.id,
      name: c.name,
      source: c.source,
      shows: c.source === 'live' ? LIVE_CHANNELS.length : listed.length,
      episodes: listed.reduce((n, r) => n + episodeCount(r.show), 0),
      ...(p && stillFilling(p) ? { filling: { inCatalog: p.inCatalog, known: p.known } } : {}),
    };
  });
}

/** Everything the public status page adds to buildStatus's file. */
export function publicStatusExtras(
  store: Store,
  config: Pick<Config, 'schedule'>,
  sources: Source[],
  rows: ShowRow[],
  now = Date.now(),
): Pick<StatusFile, 'catalogs' | 'history' | 'live' | 'schedule'> {
  const live = sources.includes('live') ? liveChannels(store.getState<LiveCheck>(LIVE_CHECK_KEY)) : undefined;
  return {
    catalogs: catalogSummary(store, sources, rows),
    history: runHistory(store, sources, config.schedule.timezone, now),
    ...(live ? { live } : {}),
    schedule: refreshSchedule(config.schedule, now),
  };
}
