// The usage dashboard on the LAN admin page (owner only): this home's plays as the resolver sees them, the
// public addon's counts as Cloudflare counts them, what each cannot see, and the health of ingest and of the
// usage data itself. Server-rendered HTML from events.sqlite; no address is ever shown or stored.
import { type DailyRow, type EventStore, queryEvents } from '@israel-tv/events';
import type { ActiveSession } from '@israel-tv/resolver';

/** The latest playback canary result per source (last 3 days). */
export function latestCanary(events: EventStore): Dashboard['canary'] {
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const latest = new Map<string, Dashboard['canary'][number]>();
  for (const e of events.events({ kind: 'canary', since, limit: 100 })) {
    if (!e.source || latest.has(e.source)) continue;
    const d = e.detail ? (JSON.parse(e.detail) as { step?: string; reason?: string; statuses?: string }) : {};
    latest.set(e.source, {
      source: e.source,
      outcome: e.outcome,
      at: e.ts,
      ...(d.step ? { step: d.step } : {}),
      detail: [d.statuses, d.reason, e.episodeId ?? e.showId].filter(Boolean).join(' · '),
    });
  }
  return [...latest.values()];
}

export interface Totals {
  plays: number;
  failures: number;
  /** Unique clients per day (hashes change daily, so days cannot be merged): average and highest. */
  uniqueAvg: number;
  uniqueMax: number;
  days: number;
}

type ShowLine = { source: string; showId: string; title?: string; plays: number; failures: number };

export interface Dashboard {
  generatedAt: string;
  home: {
    today: Totals;
    d7: Totals;
    d30: Totals;
    uniqueByDay: { day: string; n: number }[];
    topShows: ShowLine[];
    failures: { stage: string; status: number | null; reason: string; n: number; last: string }[];
    active: (ActiveSession & { title?: string })[];
  };
  public: {
    via?: string;
    note?: string;
    lastDay?: string;
    d7: Totals;
    d30: Totals;
    uniqueByDay: { day: string; n: number }[];
    topShows: ShowLine[];
  };
  ingest: { source: string; health: string; notes: string[]; lastFullRun?: string }[];
  canary: { source: string; outcome: string; at: string; step?: string; detail?: string }[];
  data: {
    eventsPerDay: { day: string; n: number }[];
    sizeMB: number;
    growthPerDayMB?: number;
    overCap: boolean;
    renderCpuMs?: number;
  };
}

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function totals(rows: DailyRow[]): Totals {
  const all = rows.filter((r) => r.source === '' && r.showId === '');
  const uniques = all.map((r) => r.uniqueClients);
  return {
    plays: all.reduce((n, r) => n + r.plays, 0),
    failures: all.reduce((n, r) => n + r.failures, 0),
    uniqueAvg: uniques.length
      ? Math.round((uniques.reduce((a, b) => a + b, 0) / uniques.length) * 10) / 10
      : 0,
    uniqueMax: uniques.length ? Math.max(...uniques) : 0,
    days: all.length,
  };
}

function topShows(rows: DailyRow[], title: (id: string) => string | undefined): ShowLine[] {
  const by = new Map<string, ShowLine>();
  for (const r of rows) {
    if (!r.showId) continue;
    const k = `${r.source}|${r.showId}`;
    const t = by.get(k) ?? { source: r.source, showId: r.showId, plays: 0, failures: 0 };
    t.plays += r.plays;
    t.failures += r.failures;
    by.set(k, t);
  }
  return [...by.values()]
    .sort((a, b) => b.plays - a.plays || b.failures - a.failures)
    .slice(0, 20)
    .map((t) => {
      const name = title(t.showId);
      return name ? { ...t, title: name } : t;
    });
}

export function buildDashboard(
  events: EventStore,
  input: {
    active: ActiveSession[];
    title: (showId: string) => string | undefined;
    ingest: Dashboard['ingest'];
    canary: Dashboard['canary'];
  },
  now = Date.now(),
): Dashboard {
  const cpu0 = process.cpuUsage();
  const today = isoDay(now);
  const since30 = isoDay(now - 29 * DAY_MS);
  const since7 = isoDay(now - 6 * DAY_MS);
  // Home: finished days from the rollups, today from the raw events.
  const homeRows = [
    ...events.daily(since30, 'home').filter((r) => r.day !== today),
    ...events.homeDay(today),
  ];
  const within = (rows: DailyRow[], since: string) => rows.filter((r) => r.day >= since);
  const uniqueByDay = (rows: DailyRow[]) =>
    rows
      .filter((r) => r.source === '' && r.showId === '')
      .map((r) => ({ day: r.day, n: r.uniqueClients }))
      .sort((a, b) => b.day.localeCompare(a.day));
  const publicRows = events.daily(since30, 'public');
  const lastPublic = events.getMeta('public-usage:last');
  const pub = lastPublic ? (JSON.parse(lastPublic) as { via?: string; note?: string; day?: string }) : {};
  const sizeAt = (d: number) => Number(events.getMeta(`size:${isoDay(now - d * DAY_MS)}`)) || undefined;
  const [size0, size7] = [sizeAt(0), sizeAt(7)];
  const growth = size0 && size7 ? (size0 - size7) / 7 / 1_048_576 : undefined;
  const dash: Dashboard = {
    generatedAt: new Date(now).toISOString(),
    home: {
      today: totals(within(homeRows, today)),
      d7: totals(within(homeRows, since7)),
      d30: totals(homeRows),
      uniqueByDay: uniqueByDay(homeRows).slice(0, 30),
      topShows: topShows(within(homeRows, since7), input.title),
      failures: events.failuresByReason(`${since7}T00:00:00.000Z`),
      active: input.active.map((a) => {
        const name = a.showId ? input.title(a.showId) : undefined;
        return name ? { ...a, title: name } : a;
      }),
    },
    public: {
      ...(pub.via ? { via: pub.via } : {}),
      ...(pub.note ? { note: pub.note } : {}),
      ...(pub.day ? { lastDay: pub.day } : {}),
      d7: totals(within(publicRows, since7)),
      d30: totals(publicRows),
      uniqueByDay: uniqueByDay(publicRows).slice(0, 30),
      topShows: topShows(within(publicRows, since7), input.title),
    },
    ingest: input.ingest,
    canary: input.canary,
    data: {
      eventsPerDay: events.perDay(`${since7}T00:00:00.000Z`),
      sizeMB: Math.round((events.sizeBytes() / 1_048_576) * 10) / 10,
      ...(growth !== undefined ? { growthPerDayMB: Math.round(growth * 100) / 100 } : {}),
      overCap: events.overCap(),
    },
  };
  const cpu = process.cpuUsage(cpu0);
  dash.data.renderCpuMs = Math.round((cpu.user + cpu.system) / 100) / 10;
  return dash;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function table(head: string[], rows: unknown[][]): string {
  if (rows.length === 0) return '<p class="none">nothing yet</p>';
  return `<table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</table>`;
}

const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;
const when = (iso: string | undefined) => esc(iso?.slice(0, 16).replace('T', ' '));

function totalsRow(label: string, t: Totals): unknown[] {
  return [esc(label), esc(t.plays), esc(t.uniqueAvg), esc(t.uniqueMax), esc(t.failures)];
}

/** The dashboard as HTML. Links to a play's events go to `/events.json` (same token cookie). */
export function renderUsagePage(d: Dashboard): string {
  const show = (r: { title?: string; showId: string }) => esc(r.title ?? r.showId);
  const playLink = (id: string) =>
    `<a href="/events.json?playId=${encodeURIComponent(id)}"><code>${esc(id)}</code></a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="refresh" content="60"><meta name="referrer" content="no-referrer"><title>Israel TV usage</title><style>
body{font:14px system-ui,sans-serif;margin:16px;background:#111;color:#eee;max-width:1100px}a{color:#8cf}
table{border-collapse:collapse;margin:6px 0 16px}td,th{border-bottom:1px solid #333;padding:4px 8px;text-align:left;vertical-align:top}
th{color:#aaa;font-weight:500}h2{margin:26px 0 4px;font-size:18px}h3{margin:14px 0 4px;font-size:15px}
.none,.cant{color:#999}.cant{font-size:13px;margin:2px 0 10px}.err{color:#f88}code{font-size:12px}
</style></head><body>
<h1>Israel TV usage</h1>
<p>Clients are counted by a salted hash of their address that changes every day; no address is stored. "Unique per day"
cannot be added up across days, so 7 and 30 days show the daily average and highest. Raw events are kept 30 days, daily
totals a year. Generated ${when(d.generatedAt)} UTC. <a href="/status">status</a> · <a href="/usage.json">json</a></p>

<h2>This home (resolver)</h2>
<p class="cant">What the resolver on this network sees: its stream requests, Mako play starts and tickets, and relayed
plays. It cannot see other people's resolvers, catalog browsing, or plays that go straight from the public addon to a
broadcaster (at home in Israel, Reshet and Kan play that way, so they show up only under the public addon). Watch time is
known only for relayed plays (Mako video goes from the CDN to the player directly).</p>
${table(
  ['', 'plays', 'unique per day (avg)', 'unique per day (max)', 'failures'],
  [totalsRow('today', d.home.today), totalsRow('7 days', d.home.d7), totalsRow('30 days', d.home.d30)],
)}
<h3>Playing now</h3>
${table(
  ['kind', 'source', 'show', 'episode', 'since (UTC)', 'segments relayed', 'bytes relayed', 'play'],
  d.home.active.map((s) => [
    esc(s.kind),
    esc(s.source),
    esc(s.title ?? s.showId),
    esc(s.episodeId),
    esc(s.since.slice(11, 19)),
    esc(s.segments),
    esc(mb(s.bytes)),
    playLink(s.playId),
  ]),
)}
<h3>Top shows (7 days)</h3>
${table(
  ['source', 'show', 'plays', 'failures'],
  d.home.topShows.map((r) => [esc(r.source), show(r), esc(r.plays), esc(r.failures)]),
)}
<h3>Failures by reason (7 days)</h3>
${table(
  ['stage', 'status', 'reason', 'count', 'last (UTC)'],
  d.home.failures.map((f) => [esc(f.stage), esc(f.status), esc(f.reason), esc(f.n), when(f.last)]),
)}

<h2>Public addon (all users, anonymous)</h2>
<p class="cant">Counted by Cloudflare: one count per stream request to the public addon, from anyone who installed it,
read back once a day (so today is not in yet). It cannot see catalog browsing (served as static files), what is actually
watched or for how long (video goes from the broadcasters' servers to the player), or anything the home resolver
answers. ${
    d.public.via
      ? `Counted with Workers Analytics Engine${d.public.lastDay ? `; last day read ${esc(d.public.lastDay)}` : ''}.`
      : 'Not read yet.'
  }
${d.public.note ? `<span class="err">${esc(d.public.note)}</span>` : ''}</p>
${table(
  ['', 'stream requests', 'unique per day (avg)', 'unique per day (max)', 'failed'],
  [totalsRow('7 days', d.public.d7), totalsRow('30 days', d.public.d30)],
)}
<h3>Top shows (7 days)</h3>
${table(
  ['source', 'show', 'stream requests', 'failed'],
  d.public.topShows.map((r) => [esc(r.source), show(r), esc(r.plays), esc(r.failures)]),
)}

<h2>Health</h2>
<h3>Playback canary (daily)</h3>
${table(
  ['source', 'result', 'when (UTC)', 'failed step', 'detail'],
  d.canary.map((c) => [
    esc(c.source),
    c.outcome === 'ok' ? 'pass' : '<span class="err">FAIL</span>',
    when(c.at),
    esc(c.step),
    esc(c.detail),
  ]),
)}
<h3>Ingest</h3>
${table(
  ['source', 'health', 'last full run (UTC)', 'notes'],
  d.ingest.map((s) => [
    esc(s.source),
    s.health === 'ok' ? 'ok' : `<span class="err">${esc(s.health)}</span>`,
    when(s.lastFullRun),
    esc(s.notes.join('; ')),
  ]),
)}
<h3>Usage data</h3>
<p>events.sqlite: ${esc(d.data.sizeMB)} MB${d.data.growthPerDayMB !== undefined ? `, growing ${esc(d.data.growthPerDayMB)} MB/day` : ''}${
    d.data.overCap ? ' <span class="err">— over its size cap: raw events cut to the last week</span>' : ''
  }. Events per day: ${d.data.eventsPerDay.map((r) => `${esc(r.day.slice(5))} ${esc(r.n)}`).join(' · ') || 'none yet'}.
This page took ${esc(d.data.renderCpuMs)} ms of CPU to build.</p>
</body></html>`;
}

export { queryEvents };
