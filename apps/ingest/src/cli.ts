// israel-tv command line. Run `node apps/ingest/src/cli.ts help`.
import { parseArgs } from 'node:util';
import { ConfigError, parseSeriesId, type Source, tmdbApiKey } from '@israel-tv/core';
import { createGeoFetch, proxyEndpoints } from '@israel-tv/net';
import { Store } from '@israel-tv/store';
import { loadConfig } from './config.ts';
import { listen, startDaemon } from './daemon.ts';
import { crawlKan, kanCrawlOptions } from './kan.ts';
import { checkLive } from './live.ts';
import { localAddonApp } from './local-server.ts';
import { createLogger } from './log.ts';
import { PublishError, publishSite } from './publish.ts';
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

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
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
  const [cmd = 'help', arg] = positionals;
  if (cmd === 'help' || values.help) {
    console.log(HELP);
    return 0;
  }
  const { config } = loadConfig();
  const store = Store.open(config.store.path);
  store.closeStaleRuns();
  const adapters = createAdapters(config);
  const pick = (only?: string) =>
    Object.entries(adapters)
      .filter(([s]) => !only || s === only)
      .map(([, make]) => make());
  const log = (l: string) => console.log(`${new Date().toISOString().slice(11, 19)}Z ${l}`);
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0))
    throw new Error('--limit must be a positive whole number');
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
        if (!arg) throw new Error('show needs a series id or source:key');
        let source: Source;
        let key: string;
        const parsed = parseSeriesId(arg);
        if (parsed) {
          const row = store.getShow(arg);
          if (!row) throw new Error(`unknown series ${arg}`);
          source = parsed.source;
          key = row.show.key;
        } else {
          const i = arg.indexOf(':');
          source = arg.slice(0, i) as Source;
          key = arg.slice(i + 1);
        }
        const make = adapters[source];
        if (!make) throw new Error(`source ${source} is not enabled`);
        const title = store.getShow(store.findSeriesId(source, key) ?? '')?.title ?? key;
        const r = await runOne(store, make(), { key, title }, opts);
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
        await new Promise(() => {});
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
        await new Promise(() => {});
        return 0;
      }
      case 'serve': {
        const p = config.publisher;
        const port = values.port ? Number(values.port) : p.type === 'local' ? p.port : 7700;
        const host = p.type === 'local' ? p.host : '127.0.0.1';
        await listen(
          localAddonApp(p.dir).fetch as never,
          host,
          port,
          values.port ? '--port' : 'publisher.port',
        );
        log(`serving ${p.dir} on http://${host}:${port}/manifest.json`);
        await new Promise(() => {});
        return 0;
      }
      case 'kan': {
        const proxy = proxyEndpoints(config.geo)[0];
        const r = await crawlKan(store, {
          ...kanCrawlOptions(config, proxy, log),
          ...(limit ? { pagesPerRun: limit } : {}),
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
            const cause = (err as { cause?: { code?: string } }).cause?.code;
            console.log(`${p.server}: ✗ ${cause ?? (err as Error).message}`);
          }
        }
        return ok > 0 ? 0 : 1;
      }
      case 'match': {
        const key = tmdbApiKey(config);
        if (!key) throw new Error('add "tmdb": {} to israel-tv.config.json and TMDB_API_KEY to .env');
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

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    // Problems the user can fix are printed plainly; anything else with its stack (or set ISRAEL_TV_DEBUG).
    const plain =
      err instanceof ConfigError || err instanceof PublishError || (err as Error).name === 'UserError';
    console.error(
      plain && !process.env.ISRAEL_TV_DEBUG ? `error: ${(err as Error).message}` : (err as Error).stack,
    );
    process.exit(1);
  },
);
