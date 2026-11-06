// israel-tv command line. Run `node apps/ingest/src/cli.ts help`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  apiWorkerName,
  ConfigError,
  parseSeriesId,
  roleOf,
  type Source,
  secretOwners,
  tmdbApiKey,
} from '@israel-tv/core';
import { EventStore } from '@israel-tv/events';
import { proxyEndpoints } from '@israel-tv/net';
import { checkProxy, printEvents, remoteUrl, resolverApp, runResolverOnly } from '@israel-tv/resolver';
import {
  createLogger,
  instancePaths,
  instanceUrls,
  loadConfig,
  registerSecretNames,
  stopSignal,
} from '@israel-tv/runtime';
import { Store } from '@israel-tv/store';
import { adminToken, lanAddresses, listen, startDaemon } from './daemon.ts';
import { crawlKan, kanCrawlOptions } from './kan.ts';
import { checkLive } from './live.ts';
import { localAddonApp } from './local-server.ts';
import {
  activeSources,
  buildStatus,
  deployApi,
  PublishError,
  publishSite,
  renderFromStore,
  rollbackWorker,
  workerVersions,
  writeSite,
} from './publish.ts';
import { runAiring, runFull, runOne } from './runner.ts';
import { createAdapters } from './sources.ts';
import { matchShows } from './tmdb.ts';
import { buildDashboard, latestCanary } from './usage-page.ts';

const HELP = `israel-tv <command>

  full [--source mako] [--limit N]   Read every show of each enabled source (all seasons)
  airing [--source mako]             Re-check shows with a recent episode (current season only)
  show <series-id | source:key>      Re-read one show, e.g. iltv_mako_12 or mako:/mako-vod-keshet/uvda
  start [--no-initial-run]           Run everything: schedules, admin, local addon server, resolver
  resolver                           Run only the private resolver
  publish                            Render the addon files and deploy them with the configured publisher
  deploy-api                         Cloudflare: deploy the private API Worker (after each code update)
  deploy                             Cloudflare: deploy-api, then publish (first setup, or after an update)
  versions <data|api>                Cloudflare: the Worker's recent versions
  rollback <data|api> [version-id]   Cloudflare: roll one Worker back on its own (default: the previous version)
  serve [--port N]                   Serve the rendered files (also to preview a Cloudflare build locally)
  kan                                Read one Kan crawl slice now (needs a browser; see docs)
  check-proxy                        Check that the geo proxy works and exits in Israel
  match                              Look up TMDB/IMDb ids for shows (needs tmdb in the config)
  status                             Recent runs and warnings
  paths                              Where the config, the secrets file and the data are on this computer
  urls                               The links to install in your app (as other devices on this network see them)
  events [--play P] [--kind K] [--errors] [--since 2h] [--show S] [--limit N]
                                     Usage and diagnostics events as JSON lines, oldest first (pnpm logs …)
  usage                              The usage dashboard's figures as JSON (pnpm usage)
  admin-url                          The admin page's address with its token (open it once in a browser)
  restore <registry.json file or URL> Rebuild ids and numbering into an empty database (see docs/operations.md)
  remote-url                         The away-from-home (Mako) resolver's manifest URL, with its token
  help                               This text

Config: israel-tv.config.json and .env in the config folder (\`paths\` shows it; ISRAEL_TV_HOME picks another).`;

/** A problem the user can fix; printed without a stack trace. */
class UserError extends Error {
  override name = 'UserError';
}

function parseCli(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      source: { type: 'string' },
      limit: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      'no-initial-run': { type: 'boolean' },
      port: { type: 'string' },
      play: { type: 'string' },
      kind: { type: 'string' },
      errors: { type: 'boolean' },
      since: { type: 'string' },
      show: { type: 'string' },
    },
  });
}

async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseCli>;
  try {
    parsed = parseCli(argv);
  } catch (err) {
    // Node's message adds a hint about positional arguments that does not apply here; keep the first sentence.
    const first = (err as Error).message.split('. ')[0];
    throw new UserError(
      `${first}. Options: --source, --limit, --no-initial-run, --port (and for events: --play, --kind, --errors, --since, --show). Run \`pnpm israel-tv help\` for more.`,
    );
  }
  const { positionals, values } = parsed;
  const [cmd = 'help', arg] = positionals;
  if (cmd === 'help' || values.help) {
    console.log(HELP);
    return 0;
  }
  // Commands that only read local state do not need the secrets of every configured service.
  const { config } = loadConfig(process.env, {
    needSecrets: ![
      'status',
      'serve',
      'events',
      'usage',
      'admin-url',
      'restore',
      'remote-url',
      'paths',
      'urls',
    ].includes(cmd),
  });
  // Where things are and how to reach them: answered by the app itself, on any operating system.
  if (cmd === 'paths' || cmd === 'urls') {
    for (const line of cmd === 'paths' ? instancePaths(config) : instanceUrls(config)) console.log(line);
    return 0;
  }
  // Every secret the config names (proxy login, Cloudflare, TMDB, admin and remote tokens) is kept out of logs
  // and published files, whatever its variable is called.
  registerSecretNames([
    ...secretOwners(config).map((o) => o.name),
    config.admin.tokenEnv,
    config.resolver.remote.tokenEnv,
  ]);
  // A resolver-only instance has no catalog database of its own: it plays from a published catalog.
  if (roleOf(config) === 'resolver-only') {
    if (cmd === 'check-proxy') return checkProxy(config);
    if (cmd === 'events') return printEvents(config, values);
    if (cmd === 'remote-url') {
      console.log(remoteUrl(config));
      return 0;
    }
    if (cmd !== 'start' && cmd !== 'resolver')
      throw new UserError(
        `\`${cmd}\` is for an instance that reads the sites (role "host" or "local-only"); this one is "resolver-only": use start, check-proxy, remote-url or events`,
      );
    return runResolverOnly(config);
  }
  const store = Store.open(config.store.path);
  store.closeStaleRuns();
  const adapters = createAdapters(config);
  if (values.source !== undefined) {
    const known = [...Object.keys(adapters), ...(config.sources.live ? ['live'] : [])];
    if (!known.includes(values.source)) {
      throw new UserError(
        `unknown or disabled source "${values.source}" (enabled: ${known.join(', ') || 'none'})`,
      );
    }
  }
  const pick = (only?: string) =>
    Object.entries(adapters)
      .filter(([s]) => !only || s === only)
      .map(([, make]) => make());
  const log = (l: string) => console.log(`${new Date().toISOString().slice(11, 19)}Z ${l}`);
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0))
    throw new UserError('--limit must be a positive whole number');
  const opts = {
    minShareOfPrevious: config.scraping.minShareOfPrevious,
    log,
    ...(limit ? { limit } : {}),
  };
  try {
    switch (cmd) {
      case 'full': {
        let ok = true;
        for (const a of pick(values.source)) ok = (await runFull(store, a, opts)).status !== 'failed' && ok;
        if (config.sources.live && (!values.source || values.source === 'live')) {
          const r = await checkLive(store);
          log(
            `live: ${r.ok} channels answering${r.failed.length ? `, not answering: ${r.failed.join(', ')}` : ''}`,
          );
        }
        return ok ? 0 : 1;
      }
      case 'airing': {
        for (const a of pick(values.source))
          await runAiring(store, a, config.schedule.airingWindowDays, opts);
        return 0;
      }
      case 'show': {
        if (!arg) throw new UserError('show needs a series id or source:key');
        let source: Source;
        let key: string;
        const parsed = parseSeriesId(arg);
        if (parsed) {
          const row = store.getShow(arg);
          if (!row) throw new UserError(`unknown series ${arg}`);
          source = parsed.source;
          key = row.show.key;
        } else {
          const i = arg.indexOf(':');
          if (i <= 0)
            throw new UserError(`show takes a series id (e.g. iltv_mako_12) or source:key, got "${arg}"`);
          source = arg.slice(0, i) as Source;
          key = arg.slice(i + 1);
        }
        const make = adapters[source];
        if (!make)
          throw new UserError(
            `source ${source} is not enabled (Kan shows refresh through the running service: POST /refresh/<id>)`,
          );
        const known = store.getShow(store.findSeriesId(source, key) ?? '');
        const title = known?.title ?? key;
        const poster = known?.show.poster;
        const r = await runOne(store, make(), { key, title, ...(poster ? { poster } : {}) }, opts);
        return r.status === 'ok' ? 0 : 1;
      }
      case 'publish':
        return (await publishSite(store, config, log)) ? 0 : 1;
      case 'deploy-api':
      case 'deploy': {
        const events = EventStore.open(config.events.path);
        try {
          const d = await deployApi(config, store, events.clientSalt(), log);
          log(
            `deploy-api: ${config.publisher.type === 'cloudflare' ? apiWorkerName(config.publisher) : ''} deployed (${Math.round(d.ms / 1000)} s)`,
          );
        } finally {
          events.close();
        }
        if (cmd === 'deploy-api') return 0;
        return (await publishSite(store, config, log)) ? 0 : 1;
      }
      case 'versions':
      case 'rollback': {
        if (arg !== 'data' && arg !== 'api')
          throw new UserError(
            `${cmd} needs the Worker: \`${cmd} data\` (the catalog) or \`${cmd} api\` (the code)`,
          );
        const out =
          cmd === 'versions'
            ? await workerVersions(config, arg)
            : await rollbackWorker(config, arg, positionals[2]);
        console.log(out.trim());
        return 0;
      }
      case 'start': {
        const logger = createLogger(config.log);
        const events = EventStore.open(config.events.path);
        const daemon = await startDaemon(config, store, events, logger, {
          initialRun: !values['no-initial-run'],
        });
        await stopSignal(logger.log);
        // Relay sessions still open are written before the database closes.
        daemon.sessions.flush(true);
        events.close();
        logger.flush();
        return 0;
      }
      case 'resolver': {
        await listen(
          resolverApp(config, {
            log: (component) => createLogger({ ...config.log, file: undefined }).for(component),
          }).fetch as never,
          config.resolver.host,
          config.resolver.port,
          'resolver.port',
        );
        log(`resolver: http://${config.resolver.host}:${config.resolver.port}/manifest.json`);
        await stopSignal(log);
        return 0;
      }
      case 'serve': {
        const p = config.publisher;
        // Serve what the database holds now (a run may have finished since the last publish). With Cloudflare,
        // render into a separate preview folder so a later publish still sees what changed since the upload.
        const dir = p.type === 'cloudflare' ? join(dirname(p.dir), 'preview') : p.dir;
        writeSite(dir, renderFromStore(store, config));
        const port = values.port ? Number(values.port) : p.type === 'local' ? p.port : 7700;
        const host = p.type === 'local' ? p.host : '127.0.0.1';
        await listen(
          localAddonApp(dir).fetch as never,
          host,
          port,
          values.port ? '--port' : 'publisher.port',
        );
        log(`serving ${dir} on http://${host}:${port}/manifest.json`);
        await stopSignal(log);
        return 0;
      }
      case 'kan': {
        const proxy = proxyEndpoints(config.geo)[0];
        const r = await crawlKan(store, {
          ...kanCrawlOptions(config, proxy, log),
          ...(limit ? { pagesPerRun: Math.max(2, limit) } : {}),
        });
        return r.failed ? 1 : 0;
      }
      case 'check-proxy':
        return checkProxy(config);
      case 'match': {
        const key = tmdbApiKey(config);
        if (!key) throw new UserError('add "tmdb": {} to israel-tv.config.json and TMDB_API_KEY to .env');
        await matchShows(store, key, { log });
        return 0;
      }
      case 'status': {
        if (store.recentRuns(1).length === 0)
          console.log('no runs yet (start with `start`, or `full` for a one-off read)');
        for (const r of store.recentRuns(10)) {
          console.log(
            `${r.startedAt} ${r.kind} ${r.scope} ${r.status} ok=${r.showsOk} failed=${r.showsFailed} +${r.newEpisodes} req=${r.requests}${r.error ? ` error=${r.error}` : ''}`,
          );
        }
        for (const w of store.recentWarnings(10))
          console.log(`warning ${w.seriesId ?? ''} ${w.code}: ${w.message}`);
        return 0;
      }
      case 'events':
        return printEvents(config, values);
      case 'usage': {
        const events = EventStore.openReadOnly(config.events.path);
        try {
          const status = buildStatus(store, activeSources(config));
          const dash = buildDashboard(events, {
            active: [],
            title: (id) => store.getShow(id)?.title,
            ingest: status.sources.map((s) => ({
              source: s.source,
              health: s.health,
              notes: s.notes,
              ...(s.lastFullRun ? { lastFullRun: s.lastFullRun.at } : {}),
            })),
            canary: latestCanary(events),
          });
          console.log(JSON.stringify(dash, null, 2));
        } finally {
          events.close();
        }
        return 0;
      }
      case 'restore': {
        if (!arg)
          throw new UserError('restore needs a registry.json file or URL (e.g. https://…/registry.json)');
        const text = /^https?:\/\//.test(arg)
          ? await (await fetch(arg, { signal: AbortSignal.timeout(60_000) })).text()
          : readFileSync(arg, 'utf8');
        const reg = JSON.parse(text) as Parameters<Store['restoreRegistry']>[0];
        if (!Array.isArray(reg.series) || !Array.isArray(reg.seasons) || !Array.isArray(reg.episodes))
          throw new UserError(`${arg} is not a registry.json (series, seasons, episodes)`);
        const n = store.restoreRegistry(reg);
        console.log(
          `restored ${n.series} series, ${n.seasons} seasons, ${n.episodes} episode numbers into ${config.store.path}. Next: \`pnpm israel-tv full\` (or start the service) reads every show again under its old ids.`,
        );
        return 0;
      }
      case 'remote-url':
        console.log(remoteUrl(config));
        return 0;
      case 'admin-url': {
        const token = adminToken(config, store);
        for (const a of lanAddresses(config.admin.host))
          console.log(`http://${a}:${config.admin.port}/usage?token=${encodeURIComponent(token)}`);
        return 0;
      }
      default:
        console.error(`unknown command ${cmd}\n\n${HELP}`);
        return 2;
    }
  } finally {
    store.close();
  }
}

/** Resolve on Ctrl-C or a service manager's stop, after logging it. */

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    // Problems the user can fix are printed plainly; set ISRAEL_TV_DEBUG=1 for stack traces.
    const known = err instanceof ConfigError || err instanceof PublishError || err instanceof UserError;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(known || !process.env.ISRAEL_TV_DEBUG ? `error: ${msg}` : (err as Error).stack);
    process.exit(1);
  },
);
