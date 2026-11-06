// Commands every role that runs a resolver has (the full entry point and the resolver's own share them):
// checking the geo proxy, printing the away-from-home link, and reading the event log.
import { type Config, ConfigError } from '@israel-tv/core';
import { EventStore, queryEvents } from '@israel-tv/events';
import { createGeoFetch, proxyEndpoints } from '@israel-tv/net';

/** Does each configured proxy exit in Israel? 0 when at least one does (or none is configured). */
export async function checkProxy(config: Config, out: (line: string) => void = console.log): Promise<number> {
  const proxies = proxyEndpoints(config.geo);
  if (proxies.length === 0) {
    out('geo.type is "none": no proxy configured (right inside Israel).');
    return 0;
  }
  let ok = 0;
  for (const p of proxies) {
    try {
      const r = await createGeoFetch([p])('https://ipinfo.io/country', {
        signal: AbortSignal.timeout(20_000),
      });
      const country = (await r.text()).trim();
      const good = r.ok && country === 'IL';
      if (good) ok++;
      out(
        `${p.server}: ${r.ok ? `exits in ${country}` : `HTTP ${r.status}`}${good ? ' ✓' : ' ✗ (needs an Israeli exit)'}`,
      );
    } catch (err) {
      // The geo fetch already explains the failure as "<proxy>: <why>".
      out(`${p.server}: ✗ ${(err as Error).message.replace(`${p.server}: `, '')}`);
    }
  }
  return ok > 0 ? 0 : 1;
}

/** The away-from-home (remote resolver) install link. */
export function remoteUrl(config: Config, env: NodeJS.ProcessEnv = process.env): string {
  const r = config.resolver.remote;
  const token = env[r.tokenEnv];
  if (!r.enabled || !r.publicUrl || !token)
    throw new ConfigError(
      'the remote resolver is not set up (resolver.remote in the config, and its token in .env)',
    );
  return `${r.publicUrl.replace(/\/+$/, '')}/${token}/manifest.json`;
}

/** Print events (oldest first) by filter: play id, kind, errors only, since (ISO or 30m/2h/7d), show, limit. */
export function printEvents(
  config: Config,
  q: { play?: string; kind?: string; errors?: boolean; since?: string; show?: string; limit?: string },
  out: (line: string) => void = console.log,
): number {
  const events = EventStore.openReadOnly(config.events.path);
  try {
    const rows = queryEvents(events, {
      ...(q.play ? { playId: q.play } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.errors ? { outcome: 'error' } : {}),
      ...(q.since ? { since: q.since } : {}),
      ...(q.show ? { show: q.show } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
    });
    for (const r of rows.reverse()) {
      const { detail, ...rest } = r;
      const line = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null));
      out(JSON.stringify(detail ? { ...line, detail: JSON.parse(detail) } : line));
    }
  } finally {
    events.close();
  }
  return 0;
}

/**
 * At start, when a proxy is configured: say which (address only, never the login) and check once that it exits in
 * Israel, so a wrong proxy shows in the log at once rather than as a failed play later.
 */
export function checkProxyAtStart(config: Config, log: (line: string) => void): void {
  const proxies = proxyEndpoints(config.geo);
  if (proxies.length === 0) return;
  log(`geo proxy: ${proxies.map((p) => p.server).join(', ')}`);
  void checkProxy(config, (line) => log(`proxy check: ${line}`)).catch((err: Error) =>
    log(`proxy check: ${err.message}`),
  );
}
