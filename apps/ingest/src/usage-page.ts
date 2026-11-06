// The usage dashboard on the LAN admin page: who watches (counted by salted daily hashes, never addresses),
// what plays, what fails and why, and what is playing now.
import type { EventRow, Store, Usage } from '@israel-tv/store';

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/**
 * Events by filter, newest first — shared by `/events.json` and `israel-tv events`. `since` is an ISO time or
 * a span like `30m`, `2h`, `7d`.
 */
export function queryEvents(store: Store, q: Record<string, string | undefined>): EventRow[] {
  const span = q.since ? /^(\d+)([mhd])$/.exec(q.since) : null;
  const since = span
    ? new Date(Date.now() - Number(span[1]) * UNIT_MS[span[2] as 'm' | 'h' | 'd']).toISOString()
    : q.since;
  return store.events({
    ...(q.corr ? { corr: q.corr } : {}),
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.outcome === 'ok' || q.outcome === 'error' ? { outcome: q.outcome } : {}),
    ...(q.series ? { series: q.series } : {}),
    ...(since ? { since } : {}),
    limit: Math.min(Number(q.limit) || 100, 1000),
  });
}

export interface ActiveSession {
  kind: 'play' | 'relay';
  corr: string;
  since: string;
  segments: number;
  bytes: number;
  source?: string;
  series?: string;
  video?: string;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function table(head: string[], rows: unknown[][]): string {
  if (rows.length === 0) return '<p class="none">nothing yet</p>';
  return `<table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</table>`;
}

const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;
const corrLink = (corr: string | null | undefined) =>
  corr ? `<a href="/events.json?corr=${encodeURIComponent(corr)}"><code>${esc(corr)}</code></a>` : '';

export function renderUsagePage(
  u: Usage,
  active: ActiveSession[],
  titles: (series: string) => string | undefined,
) {
  const label = (o: string) => (o === 'worker' ? 'public addon' : o === 'resolver' ? 'home resolver' : o);
  const today = u.clientsToday.map((r) => `${label(r.origin)}: <b>${r.n}</b>`).join(' · ') || '0';
  const days = [...new Set(u.clientsByDay.map((r) => r.day))];
  const name = (series?: string | null) => (series ? esc(titles(series) ?? series) : '');
  const failure = (e: EventRow) => [
    esc(e.at.slice(0, 19).replace('T', ' ')),
    esc(e.kind),
    esc(e.source),
    name(e.series),
    esc(e.status),
    esc(e.reason),
    esc(e.upstream),
    corrLink(e.corr),
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="refresh" content="60"><title>Israel TV usage</title><style>
body{font:14px system-ui,sans-serif;margin:16px;background:#111;color:#eee}a{color:#8cf}
table{border-collapse:collapse;margin:6px 0 18px}td,th{border-bottom:1px solid #333;padding:4px 8px;text-align:left;vertical-align:top}
th{color:#aaa;font-weight:500}h2{margin:18px 0 4px;font-size:16px}.none{color:#888}code{font-size:12px}
</style></head><body>
<h1>Israel TV usage</h1>
<p>Unique clients today (UTC): ${today}. Clients are counted by a salted hash of their address that changes every day; no address is stored. Events are kept 30 days. <a href="/status">status</a> · <a href="/usage.json">json</a></p>
<h2>Playing now</h2>
${table(
  ['kind', 'source', 'show', 'episode', 'since', 'segments', 'relayed', 'correlation'],
  active.map((s) => [
    esc(s.kind),
    esc(s.source),
    name(s.series),
    esc(s.video),
    esc(s.since.slice(11, 19)),
    esc(s.segments),
    esc(mb(s.bytes)),
    corrLink(s.corr),
  ]),
)}
<h2>Unique clients per day (last 7 days)</h2>
${table(
  ['day', 'public addon', 'home resolver'],
  days.map((d) => [
    esc(d),
    esc(u.clientsByDay.find((r) => r.day === d && r.origin === 'worker')?.n ?? 0),
    esc(u.clientsByDay.find((r) => r.day === d && r.origin === 'resolver')?.n ?? 0),
  ]),
)}
<h2>By source (7 days)</h2>
${table(
  ['source', 'stream requests', 'plays', 'failures'],
  u.bySource.map((r) => [esc(r.source ?? '—'), esc(r.streams), esc(r.plays), esc(r.failures)]),
)}
<h2>By show (7 days, top 30)</h2>
${table(
  ['source', 'show', 'stream requests', 'plays', 'failures'],
  u.byShow.map((r) => [esc(r.source), name(r.series), esc(r.streams), esc(r.plays), esc(r.failures)]),
)}
<h2>Public addon requests (7 days)</h2>
${table(
  ['route', 'requests', 'errors'],
  u.requests.map((r) => [esc(r.route ?? '—'), esc(r.n), esc(r.errors)]),
)}
<h2>Failures (7 days, latest 50)</h2>
${table(['time (UTC)', 'kind', 'source', 'show', 'status', 'reason', 'upstream', 'correlation'], u.failures.map(failure))}
</body></html>`;
}
