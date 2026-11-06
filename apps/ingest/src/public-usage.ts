// The public addon's usage, counted by Cloudflare: once a day, one query for the day before — stream requests
// and unique clients per show, per source and in total — into events.sqlite's daily rollups (origin `public`).
// The Worker writes one Analytics Engine data point per stream request; reading them needs an API token with
// "Account Analytics: Read". Without it, the same counts come from Workers Logs (the Worker also logs each
// request it answers; the publishing token can query those).
import { apiWorkerName, type Config } from '@israel-tv/core';
import type { DailyRow, EventStore } from '@israel-tv/events';

const DATASET = 'israel_tv_usage';
const api = (account: string) => `https://api.cloudflare.com/client/v4/accounts/${account}`;

export interface PublicUsageResult {
  day: string;
  via: 'analytics-engine' | 'workers-logs';
  rows: number;
  note?: string;
}

/** Analytics Engine: blob1 source, blob2 show, blob3 episode, blob4 client hash, blob5 outcome. */
async function fromAnalyticsEngine(
  token: string,
  account: string,
  day: string,
  fetchImpl: typeof fetch,
): Promise<DailyRow[] | { denied: string }> {
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const where = `timestamp >= toDateTime('${day} 00:00:00') AND timestamp < toDateTime('${next} 00:00:00')`;
  const q = (group: string, cols: string) =>
    `SELECT ${cols} sum(_sample_interval) AS plays, count(DISTINCT blob4) AS clients,
       sumIf(_sample_interval, blob5 = 'error') AS failures
     FROM ${DATASET} WHERE ${where} ${group} FORMAT JSON`;
  const out: DailyRow[] = [];
  for (const [group, cols, src, show] of [
    ['GROUP BY blob1, blob2', 'blob1 AS source, blob2 AS show,', true, true],
    ['GROUP BY blob1', 'blob1 AS source,', true, false],
    ['', '', false, false],
  ] as const) {
    const r = await fetchImpl(`${api(account)}/analytics_engine/sql`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: q(group, cols),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await r.text();
    if (!r.ok) return { denied: `HTTP ${r.status}: ${text.slice(0, 120)}` };
    const j = JSON.parse(text) as {
      data?: { source?: string; show?: string; plays: number; clients: number; failures: number }[];
    };
    for (const d of j.data ?? [])
      out.push({
        day,
        origin: 'public',
        source: src ? (d.source ?? '') : '',
        showId: show ? (d.show ?? '') : '',
        plays: Number(d.plays) || 0,
        uniqueClients: Number(d.clients) || 0,
        failures: Number(d.failures) || 0,
        minutesWatched: 0,
      });
  }
  return out;
}

interface Aggregate {
  groups?: { key: string; value: string }[];
  value: number;
}

/** Workers Logs: the Worker's own request lines (`route: stream`), counted by Cloudflare. */
async function fromWorkersLogs(
  token: string,
  account: string,
  worker: string,
  day: string,
  fetchImpl: typeof fetch,
): Promise<DailyRow[]> {
  const from = Date.parse(`${day}T00:00:00Z`);
  const query = async (groupBy: string[], filters: { key: string; value: string }[] = []) => {
    const r = await fetchImpl(`${api(account)}/workers/observability/telemetry/query`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        queryId: 'israel-tv-daily-usage',
        timeframe: { from, to: from + 86_400_000 - 1 },
        view: 'calculations',
        parameters: {
          datasets: ['cloudflare-workers'],
          calculations: [
            { operator: 'count', alias: 'plays' },
            { operator: 'uniq', key: 'client', keyType: 'string', alias: 'clients' },
          ],
          groupBys: groupBy.map((value) => ({ type: 'string', value })),
          filters: [
            { key: '$metadata.service', operation: 'eq', type: 'string', value: worker },
            { key: 'route', operation: 'eq', type: 'string', value: 'stream' },
            ...filters.map((f) => ({ key: f.key, operation: 'eq', type: 'string', value: f.value })),
          ],
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await r.json().catch(() => ({}))) as {
      success?: boolean;
      errors?: { message?: string }[];
      result?: { calculations?: { alias: string; aggregates: Aggregate[] }[] };
    };
    if (!r.ok || !j.success)
      throw new Error(`Workers Logs query failed: HTTP ${r.status} ${j.errors?.[0]?.message ?? ''}`.trim());
    const by = (alias: string) => j.result?.calculations?.find((c) => c.alias === alias)?.aggregates ?? [];
    const key = (a: Aggregate) => (a.groups ?? []).map((g) => g.value).join('|');
    const clients = new Map(by('clients').map((a) => [key(a), a.value]));
    return by('plays').map((a) => ({
      groups: a.groups ?? [],
      plays: a.value,
      clients: clients.get(key(a)) ?? 0,
    }));
  };
  const key = (r: { groups: { value: string }[] }) => r.groups.map((g) => g.value).join('|');
  const rows: DailyRow[] = [];
  for (const [levels, src, show] of [
    [['source', 'series'], true, true],
    [['source'], true, false],
    [[], false, false],
  ] as const) {
    // Failed requests at the same level, so every level (not only per show) has its failures.
    const failures = new Map(
      (await query([...levels], [{ key: 'outcome', value: 'error' }])).map((r) => [key(r), r.plays]),
    );
    for (const r of await query([...levels])) {
      const g = (k: string) => r.groups.find((x) => x.key === k)?.value ?? '';
      rows.push({
        day,
        origin: 'public',
        source: src ? g('source') : '',
        showId: show ? g('series') : '',
        plays: r.plays,
        uniqueClients: r.clients,
        failures: failures.get(key(r)) ?? 0,
        minutesWatched: 0,
      });
    }
  }
  return rows;
}

/** Pull the public addon's usage for `day` (yyyy-mm-dd) into the rollups. */
export async function pullPublicUsage(
  events: EventStore,
  config: Config,
  day: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicUsageResult | undefined> {
  const p = config.publisher;
  if (p.type !== 'cloudflare') return undefined;
  const token = env[p.apiTokenEnv];
  const account = env[p.accountIdEnv];
  if (!token || !account) return undefined;
  const ae = await fromAnalyticsEngine(token, account, day, fetchImpl).catch((err: Error) => ({
    denied: err.message,
  }));
  let result: PublicUsageResult;
  if (Array.isArray(ae)) {
    events.putDaily(ae);
    result = { day, via: 'analytics-engine', rows: ae.length };
  } else {
    // The API Worker writes the request events; days before the two-Worker split were written by the public one.
    let rows = await fromWorkersLogs(token, account, apiWorkerName(p), day, fetchImpl);
    if (rows.length === 0) rows = await fromWorkersLogs(token, account, p.workerName, day, fetchImpl);
    events.putDaily(rows);
    result = {
      day,
      via: 'workers-logs',
      rows: rows.length,
      note: `Analytics Engine could not be read (${ae.denied}); the API token needs "Account Analytics: Read"`,
    };
  }
  events.setMeta('public-usage:last', JSON.stringify(result));
  return result;
}
