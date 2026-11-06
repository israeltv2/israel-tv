// The resolver on its own (role "resolver-only"): the home resolver, and the remote one when enabled, playing
// from a published Israel TV catalog. No reading of sites, no publishing, no catalog database — this module and
// its entry point (cli.ts) need only the resolver's own packages, so a resolver-only install stays small.
import type { Config, UsageEvent } from '@israel-tv/core';
import { EventStore } from '@israel-tv/events';
import { createLogger, lanAddresses, listen, stopSignal } from '@israel-tv/runtime';
import { Cron } from 'croner';
import { checkCatalog, remoteResolverApp, resolverApp } from './server.ts';
import { PlaySessions } from './sessions.ts';

/** The resolver-only role: the home resolver (and the remote one, when enabled), from a published catalog. */
export async function runResolverOnly(config: Config): Promise<number> {
  const logger = createLogger(config.log);
  const events = EventStore.open(config.events.path);
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
  };
  await listen(
    resolverApp(config, shared).fetch as never,
    config.resolver.host,
    config.resolver.port,
    'resolver.port',
  );
  logger.log(
    `resolver (from ${config.resolver.catalogUrl}) — install in your app: ${lanAddresses(config.resolver.host)
      .map((a) => `http://${a}:${config.resolver.port}/manifest.json`)
      .join('  ')}`,
  );
  if (config.resolver.remote.enabled) {
    const remote = remoteResolverApp(config, shared);
    if ('error' in remote) logger.log(`remote resolver not started: ${remote.error}`);
    else {
      await listen(
        remote.fetch as never,
        config.resolver.remote.host,
        config.resolver.remote.port,
        'resolver.remote.port',
      );
      logger.log(
        `remote resolver (Mako away from home) served at ${config.resolver.remote.publicUrl} — \`israel-tv remote-url\` prints the link`,
      );
    }
  }
  setInterval(() => sessions.flush(), 30_000).unref();
  // Daily: the same usage housekeeping as a full instance (rollups, 30-day pruning, VACUUM, size cap).
  const maintain = () => {
    sessions.flush(false, Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`));
    logger.log('usage events maintained', {
      ...events.maintain(Date.now(), config.events.maxMB * 1024 * 1024),
    });
  };
  maintain();
  new Cron(config.schedule.daily, { timezone: config.schedule.timezone, protect: true }, maintain);
  // Say at once if the catalog cannot serve a resolver (a typo, or a host on an older version).
  void checkCatalog(config.resolver.catalogUrl ?? '').then((problem) =>
    logger.log(problem ? `catalog check: ${problem}` : 'catalog check: ok'),
  );
  await stopSignal(logger.log);
  sessions.flush(true);
  events.close();
  logger.flush();
  return 0;
}
