// israel-tv command line. Run `node apps/ingest/src/cli.ts help`.
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, parseSeriesId, type Source, tmdbApiKey } from '@israel-tv/core';
import { createGeoFetch, proxyEndpoints } from '@israel-tv/net';
import { Store } from '@israel-tv/store';
import { loadConfig } from './config.ts';
import { listen, startDaemon } from './daemon.ts';
import { crawlKan, kanCrawlOptions } from './kan.ts';
import { checkLive, liveRender } from './live.ts';
import { localAddonApp } from './local-server.ts';
import { createLogger } from './log.ts';
import { PublishError, publishSite, renderFromStore, writeSite } from './publish.ts';
import { runAiring, runFull, runOne } from './runner.ts';
import { createAdapters } from './sources.ts';
import { matchShows } from './tmdb.ts';

const HELP = `israel-tv <command>

  full [--source mako] [--limit N]   Read every show of each enabled source (all seasons)
  airing [--source mako]             Re-check shows with a recent episode (current season only)
  show <series-id | source:key>      Re-read one show, e.g. iltv_mako_12 or mako:/mako-vod-keshet/uvda
  start [--no-initial-run]           Run everything: schedules, admin, local addon server, resolver
  resolver                           Run only the private resolver
  publish                            Render the addon files and deploy them with the configured publisher
  serve [--port N]                   Serve the rendered files (also to preview a Cloudflare build locally)
  kan                                Read one Kan crawl slice now (needs a browser; see docs)
  check-proxy                        Check that the geo proxy works and exits in Israel
  match                              Look up TMDB/IMDb ids for shows (needs tmdb in the config)
  status                             Recent runs and warnings
  help                               This text

Config: israel-tv.config.json in the current folder (or ISRAEL_TV_CONFIG). Secrets: .env.`;

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
      `${first}. Options: --source, --limit, --no-initial-run, --port. Run \`pnpm israel-tv help\` for more.`,
    );
  }
  const { positionals, values } = parsed;
  const [cmd = 'help', arg] = positionals;
  if (cmd === 'help' || values.help) {
    console.log(HELP);
    return 0;
  }
  // Commands that only read local state do not need the secrets of every configured service.
  const { config } = loadConfig(process.env, { needSecrets: !['status', 'serve'].includes(cmd) });
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
      case 'publish': {
        return (await publishSite(store, config, log)) ? 0 : 1;
      }
      case 'start': {
        await startDaemon(
          config,
          store,
          config.log.file ? createLogger(config.log.file, config.log.maxMB) : log,
          {
            initialRun: !values['no-initial-run'],
          },
        );
        await stopSignal(log);
        return 0;
      }
      case 'resolver': {
        const { resolverApp } = await import('@israel-tv/resolver');
        await listen(
          resolverApp(config).fetch as never,
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
        writeSite(dir, renderFromStore(store, config, config.sources.live ? liveRender() : []));
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
      case 'check-proxy': {
        const proxies = proxyEndpoints(config.geo);
        if (proxies.length === 0) {
          console.log('geo.type is "none": no proxy configured (right inside Israel).');
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
            console.log(
              `${p.server}: ${r.ok ? `exits in ${country}` : `HTTP ${r.status}`}${good ? ' ✓' : ' ✗ (needs an Israeli exit)'}`,
            );
          } catch (err) {
            // The geo fetch already explains the failure as "<proxy>: <why>".
            console.log(`${p.server}: ✗ ${(err as Error).message.replace(`${p.server}: `, '')}`);
          }
        }
        return ok > 0 ? 0 : 1;
      }
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
      default:
        console.error(`unknown command ${cmd}\n\n${HELP}`);
        return 2;
    }
  } finally {
    store.close();
  }
}

/** Resolve on Ctrl-C or a service manager's stop, after logging it. */
function stopSignal(log: (line: string) => void): Promise<void> {
  return new Promise((resolve) => {
    const stop = (sig: string) => {
      log(`stopped (${sig})`);
      resolve();
    };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
  });
}

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
