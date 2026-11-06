// How much of Cloudflare's free plan the public addon uses today: Worker requests (all Workers on the account
// share 100,000 a day) and Analytics Engine data points written (100,000 a day). Read once an hour with the
// project's token ("Account Analytics: Read"); shown on the dashboard, and on /status from 80% of a limit.
// Days are UTC days, as Cloudflare counts them.
import type { Config } from '@israel-tv/core';

/** Cloudflare's free-plan daily limits (Workers Free; Analytics Engine on Workers Free). */
export const FREE_LIMITS = { requests: 100_000, aeWrites: 100_000 } as const;
export const WARN_AT = 0.8;
export const QUOTA_KEY = 'cloudflare:quota';
const DATASET = 'israel_tv_usage';

export interface Quota {
  day: string;
  at: string;
  requests: number;
  byScript: { script: string; requests: number }[];
  aeWrites: number;
  limits: { requests: number; aeWrites: number };
  /** Set from 80% of a limit: what is close, in plain words. */
  warn?: string;
}

/** The warning for a day's use, or undefined while under 80% of both limits. */
export function quotaWarning(q: Pick<Quota, 'requests' | 'aeWrites' | 'limits'>): string | undefined {
  const parts: string[] = [];
  const pct = (n: number, of: number) => Math.round((n / of) * 100);
  if (q.requests >= q.limits.requests * WARN_AT)
    parts.push(
      `Worker requests ${pct(q.requests, q.limits.requests)}% of the free ${q.limits.requests.toLocaleString('en')} a day`,
    );
  if (q.aeWrites >= q.limits.aeWrites * WARN_AT)
    parts.push(
      `usage data points ${pct(q.aeWrites, q.limits.aeWrites)}% of the free ${q.limits.aeWrites.toLocaleString('en')} a day`,
    );
  return parts.length
    ? `Cloudflare free plan today: ${parts.join('; ')}. Past a limit the public addon's dynamic answers (rows, streams) fail until 00:00 UTC.`
    : undefined;
}

export async function readQuota(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<Quota | undefined> {
  const p = config.publisher;
  if (p.type !== 'cloudflare') return undefined;
  const token = env[p.apiTokenEnv];
  const account = env[p.accountIdEnv];
  if (!token || !account) return undefined;
  const day = new Date(now).toISOString().slice(0, 10);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const gql = await fetchImpl('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query:
        'query($a:String!,$d:Date!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsAdaptive(limit:100,filter:{date_geq:$d,date_leq:$d}){sum{requests}dimensions{scriptName}}}}}',
      variables: { a: account, d: day },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const g = (await gql.json()) as {
    errors?: { message?: string }[] | null;
    data?: {
      viewer?: {
        accounts?: {
          workersInvocationsAdaptive?: { sum: { requests: number }; dimensions: { scriptName: string } }[];
        }[];
      };
    };
  };
  if (!gql.ok || g.errors?.length)
    throw new Error(`Worker requests could not be read: ${g.errors?.[0]?.message ?? `HTTP ${gql.status}`}`);
  const rows = g.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
  const byScript = rows
    .map((r) => ({ script: r.dimensions.scriptName, requests: Number(r.sum.requests) || 0 }))
    .sort((a, b) => b.requests - a.requests);
  const sql = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: `SELECT sum(_sample_interval) AS points FROM ${DATASET} WHERE timestamp >= toDateTime('${day} 00:00:00') FORMAT JSON`,
      signal: AbortSignal.timeout(30_000),
    },
  );
  const text = await sql.text();
  if (!sql.ok) throw new Error(`usage data points could not be read: HTTP ${sql.status}`);
  const aeWrites =
    Number((JSON.parse(text) as { data?: { points?: string | number }[] }).data?.[0]?.points) || 0;
  const q: Quota = {
    day,
    at: new Date(now).toISOString(),
    requests: byScript.reduce((n, r) => n + r.requests, 0),
    byScript,
    aeWrites,
    limits: { ...FREE_LIMITS },
  };
  const warn = quotaWarning(q);
  return warn ? { ...q, warn } : q;
}
