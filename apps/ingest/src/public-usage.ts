// The public addon's usage, counted by Cloudflare: once a day, one query for the day before — stream requests
// and unique clients per show, per source and in total — into events.sqlite's daily rollups (origin `public`).
// The API Worker writes one Analytics Engine data point per stream request; reading them needs an API token with
// "Account Analytics: Read" and Analytics Engine enabled on the account. A failed read is an error the daemon
// shows on /status and the dashboard (the Workers Logs lines stay for debugging, not for counting).
import type { Config } from '@israel-tv/core';
import type { DailyRow, EventStore } from '@israel-tv/events';

const DATASET = 'israel_tv_usage';
const api = (account: string) => `https://api.cloudflare.com/client/v4/accounts/${account}`;

export interface PublicUsageResult {
  day: string;
  via: 'analytics-engine';
  rows: number;
  note?: string;
}

/** Analytics Engine: blob1 source, blob2 show, blob3 episode, blob4 client hash, blob5 outcome. */
async function fromAnalyticsEngine(
  token: string,
  account: string,
  day: string,
  fetchImpl: typeof fetch,
): Promise<DailyRow[]> {
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
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 120)}`);
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
  const rows = await fromAnalyticsEngine(token, account, day, fetchImpl).catch((err: Error) => {
    throw new Error(
      `Analytics Engine could not be read (${err.message}): the API token needs "Account Analytics: Read", and Analytics Engine must be enabled on the account`,
    );
  });
  events.putDaily(rows);
  const result: PublicUsageResult = { day, via: 'analytics-engine', rows: rows.length };
  events.setMeta('public-usage:last', JSON.stringify(result));
  return result;
}
