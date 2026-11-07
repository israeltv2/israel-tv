// The resolver on its own (role "resolver-only"): the home resolver, and the remote one when enabled, playing
// from a published Israel TV catalog. No reading of sites, no publishing, no catalog database — this module and
// its entry point (cli.ts) need only the resolver's own packages, so a resolver-only install stays small.
import { randomBytes } from 'node:crypto';
import type { Config, UsageEvent } from '@israel-tv/core';
import { EventStore } from '@israel-tv/events';
import { createLogger, lanAddresses, listen, stopSignal } from '@israel-tv/runtime';
import { Cron } from 'croner';
import { checkProxyAtStart } from './commands.ts';
import { checkCatalog, remoteResolverApp, resolverApp } from './server.ts';
import { PlaySessions } from './sessions.ts';

/** The resolver-only role: the home resolver (and the remote one, when enabled), from a published catalog. */
export async function runResolverOnly(config: Config): Promise<number> {
  const logger = createLogger(config.log);
  const log = logger.for('resolver');
  const events = EventStore.open(config.events.path, { timeZone: config.schedule.timezone });
  const sessions = new PlaySessions((e) => events.record(e));
  const shared = {
    log: (component: string) => logger.for(component),
    onEvent: (e: UsageEvent) => {
      events.record(e);
      const { ts: _ts, component, kind, ...fields } = e;
      logger.for(component)(kind, fields);
    },
    sessions,
    salt: events.clientSalt(),
    // Both doors sign relay URLs with one secret: the tunnel door hands out, at home, relayed streams that the
    // home-network door plays.
    secret: randomBytes(32),
  };
  await listen(
    resolverApp(config, shared).fetch as never,
    config.resolver.host,
    config.resolver.port,
    'resolver.port',
  );
  log(
    `resolver (from ${config.resolver.catalogUrl}) — install in your app: ${lanAddresses(config.resolver.host)
      .map((a) => `http://${a}:${config.resolver.port}/manifest.json`)
      .join('  ')}`,
  );
  if (config.resolver.remote.enabled) {
    const remote = remoteResolverApp(config, shared);
    if ('error' in remote) log(`remote resolver not started: ${remote.error}`);
    else {
      await listen(
        remote.fetch as never,
        config.resolver.remote.host,
        config.resolver.remote.port,
        'resolver.remote.port',
      );
      log(
        `helper tunnel door served at ${config.resolver.remote.publicUrl} — \`pnpm resolver remote-url\` prints the one helper link to install (it works at home and away)`,
      );
    }
  }
  setInterval(() => sessions.flush(), 30_000).unref();
  // Daily: the same usage housekeeping as a full instance (rollups, 30-day pruning, VACUUM, size cap).
  const maintain = () => {
    sessions.flush(false, Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`));
    log('usage events maintained', {
      ...events.maintain(Date.now(), config.events.maxMB * 1024 * 1024),
    });
  };
  maintain();
  new Cron(config.schedule.daily, { timezone: config.schedule.timezone, protect: true }, maintain);
  // Say at once if the catalog cannot serve a resolver (a typo, or a host on an older version).
  checkProxyAtStart(config, log);
  void checkCatalog(config.resolver.catalogUrl ?? '').then((problem) =>
    log(problem ? `catalog check: ${problem}` : 'catalog check: ok'),
  );
  await stopSignal(log);
  sessions.flush(true);
  events.close();
  logger.flush();
  return 0;
}
