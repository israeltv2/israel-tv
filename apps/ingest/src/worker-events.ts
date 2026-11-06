// Pull the public Worker's request events from Workers Logs (Cloudflare keeps them a few days) into the home
// database (kept EVENT_RETENTION_DAYS), next to the resolver's events. Uses the same API token as publishing
// (the Workers Observability query API); nothing here sees a client address, only the Worker's salted hashes.
import type { Config, UsageEvent } from '@israel-tv/core';
import type { Store } from '@israel-tv/store';

const CURSOR = 'worker-events:cursor';
/** Workers Logs keeps free-plan events about 3 days; never ask for more. */
const MAX_LOOKBACK_MS = 3 * 86_400_000;
const PAGE = 1000;

interface Telemetry {
  success: boolean;
  errors?: { message?: string }[];
  result?: { events?: { events?: { timestamp: number; source?: Record<string, unknown> }[] } };
}

/** Turn one Workers Logs event into ours (undefined for anything the Worker did not log itself). */
export function toUsageEvent(e: {
  timestamp: number;
  source?: Record<string, unknown>;
}): (UsageEvent & { ext: string }) | undefined {
  const s = e.source;
  if (s?.ev !== 'iltv' || s.kind !== 'request') return undefined;
  const str = (k: string) => (typeof s[k] === 'string' ? (s[k] as string) : undefined);
  const num = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : undefined);
  const out: UsageEvent & { ext: string } = {
    at: new Date(e.timestamp).toISOString(),
    kind: 'request',
    origin: 'worker',
    outcome: s.outcome === 'error' ? 'error' : 'ok',
    ext: `w:${e.timestamp}:${str('corr') ?? ''}:${str('route') ?? ''}`,
  };
  for (const k of ['corr', 'client', 'source', 'series', 'video', 'route'] as const) {
    const v = str(k);
    if (v) out[k] = v;
  }
  for (const k of ['status', 'ms'] as const) {
    const v = num(k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Pull new Worker events; returns how many were seen. */
export async function pullWorkerEvents(
  store: Store,
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<number> {
  const p = config.publisher;
  if (p.type !== 'cloudflare' || !p.requestLogs) return 0;
  const token = env[p.apiTokenEnv];
  const account = env[p.accountIdEnv];
  if (!token || !account) return 0;
  let from = Math.max(store.getState<number>(CURSOR) ?? 0, now - MAX_LOOKBACK_MS);
  let seen = 0;
  for (let page = 0; page < 20; page++) {
    const r = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          queryId: 'israel-tv-usage',
          timeframe: { from, to: now },
          view: 'events',
          limit: PAGE,
          parameters: {
            filters: [{ key: '$metadata.service', operation: 'eq', type: 'string', value: p.workerName }],
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const j = (await r.json().catch(() => ({ success: false }))) as Telemetry;
    if (!r.ok || !j.success)
      throw new Error(`Workers Logs query failed: HTTP ${r.status} ${j.errors?.[0]?.message ?? ''}`.trim());
    const list = (j.result?.events?.events ?? []).sort((a, b) => a.timestamp - b.timestamp);
    store.addEvents(list.map(toUsageEvent).filter((e) => e !== undefined));
    seen += list.length;
    const last = list.at(-1)?.timestamp;
    if (list.length < PAGE || last === undefined) break;
    from = last;
  }
  // Logs can arrive a little late: overlap the next pull (events are recorded once, by their key).
  store.setState(CURSOR, now - 10 * 60_000);
  return seen;
}
