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
      const why = good
        ? ' ✓'
        : r.status === 407
          ? ' ✗ the proxy refused the login: check the proxy user name and password'
          : r.ok
            ? ' ✗ not an Israeli exit: pick a server in Israel'
            : ' ✗ the proxy answered with an error';
      out(`${p.server}: ${r.ok ? `exits in ${country}` : `HTTP ${r.status}`}${why}`);
    } catch (err) {
      // The geo fetch already explains the failure as "<proxy>: <why>".
      out(`${p.server}: ✗ ${(err as Error).message.replace(`${p.server}: `, '')}`);
    }
  }
  return ok > 0 ? 0 : 1;
}

/** What to say next to the tunnel link (on stderr: stdout stays the bare link, for scripts). */
export function remoteUrlHint(config: Config): string {
  return config.resolver.remote.home.lanUrl
    ? 'Install this one link on your account, instead of the home-network link: it plays at home (Reshet and Kan relayed where refused, video on your network) and away (Keshet 12 and live channels).'
    : 'Install this one link on your account, instead of the home-network link: it plays Keshet 12 and live channels at home and away. Set resolver.remote.home.lanUrl so that at home it also offers the relayed Reshet and Kan streams.';
}

/** The helper's tunnel link (resolver.remote): the one helper link to install when a tunnel is set up. */
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
  const events = EventStore.openReadOnly(config.events.path, { timeZone: config.schedule.timezone });
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
export function checkProxyAtStart(config: Config, log: (line: string) => void, announce = true): void {
  const proxies = proxyEndpoints(config.geo);
  if (proxies.length === 0) return;
  if (announce) log(`geo proxy: ${proxies.map((p) => p.server).join(', ')}`);
  void checkProxy(config, (line) => log(`proxy check: ${line}`)).catch((err: Error) =>
    log(`proxy check: ${err.message}`),
  );
}
