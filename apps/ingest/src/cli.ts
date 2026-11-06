// israel-tv command line. Run `node apps/ingest/src/cli.ts help`.
import { parseArgs } from 'node:util';
import { ConfigError, parseSeriesId, type Source } from '@israel-tv/core';
import { proxyEndpoints } from '@israel-tv/net';
import { Store } from '@israel-tv/store';
import { loadConfig } from './config.ts';
import { startDaemon } from './daemon.ts';
import { crawlKan } from './kan.ts';
import { checkLive, liveRender } from './live.ts';
import { startLocalServer } from './local-server.ts';
import { createLogger } from './log.ts';
import { deploy, renderFromStore, writeSite } from './publish.ts';
import { runAiring, runFull, runOne } from './runner.ts';
import { createAdapters } from './sources.ts';
import { matchShows } from './tmdb.ts';

const HELP = `israel-tv <command>

  full [--source mako] [--limit N]   Read every show of each enabled source (all seasons)
  airing [--source mako]             Re-check shows with a recent episode (current season only)
  show <series-id | source:key>      Re-read one show, e.g. iltv_mako_12 or mako:/mako-vod-keshet/uvda
  start                              Run everything: schedules, admin, local addon server, resolver
  resolver                           Run only the private resolver
  publish                            Render the addon files and deploy them with the configured publisher
  serve                              Serve the rendered files on the local network (local publisher)
  kan                                Read one Kan crawl slice now (needs a browser; see docs)
  match                              Look up TMDB/IMDb ids for shows (needs tmdb in the config)
  status                             Recent runs and warnings
  help                               This text

Config: israel-tv.config.json in the current folder (or ISRAEL_TV_CONFIG). Secrets: .env.`;

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { source: { type: 'string' }, limit: { type: 'string' } },
  });
  const [cmd = 'help', arg] = positionals;
  if (cmd === 'help' || cmd === '--help') {
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
  const log = (l: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${l}`);
  const opts = {
    minShareOfPrevious: config.scraping.minShareOfPrevious,
    log,
    ...(values.limit ? { limit: Number(values.limit) } : {}),
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
        const t0 = Date.now();
        const files = renderFromStore(store, config, config.sources.live ? liveRender() : []);
        const w = writeSite(config.publisher.dir, files);
        log(
          `rendered ${w.total} files (${w.written} changed, ${w.deleted} removed) in ${Date.now() - t0} ms`,
        );
        const d = await deploy(config);
        log(
          `published (${config.publisher.type}): ${d.detail}${d.url ? ` ${d.url}` : ''} in ${Math.round(d.ms / 1000)} s`,
        );
        return 0;
      }
      case 'start': {
        startDaemon(config, store, config.log.file ? createLogger(config.log.file, config.log.maxMB) : log);
        await new Promise(() => {});
        return 0;
      }
      case 'resolver': {
        const { startResolver } = await import('@israel-tv/resolver');
        startResolver(config);
        log(`resolver: http://${config.resolver.host}:${config.resolver.port}/manifest.json`);
        await new Promise(() => {});
        return 0;
      }
      case 'serve': {
        const p = config.publisher;
        const port = p.type === 'local' ? p.port : 7000;
        const host = p.type === 'local' ? p.host : '127.0.0.1';
        startLocalServer(p.dir, host, port);
        log(`serving ${p.dir} on http://${host}:${port}/manifest.json`);
        await new Promise(() => {});
        return 0;
      }
      case 'kan': {
        const proxy = proxyEndpoints(config.geo)[0];
        const r = await crawlKan(store, {
          browser: config.browser,
          ...(proxy ? { proxy } : {}),
          pagesPerRun: values.limit ? Number(values.limit) : config.scraping.browserPagesPerRun,
          pageIntervalMs: config.scraping.browserPageIntervalSec * 1000,
          airingWindowDays: config.schedule.airingWindowDays,
          log,
        });
        return r.pages > 0 || r.note.includes('backing off') ? 0 : 1;
      }
      case 'match': {
        const key = config.tmdb ? process.env[config.tmdb.apiKeyEnv] : undefined;
        if (!key) throw new Error('add "tmdb": {} to israel-tv.config.json and TMDB_API_KEY to .env');
        await matchShows(store, key, { log });
        return 0;
      }
      case 'status': {
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
    console.error(err instanceof ConfigError ? err.message : (err as Error).stack);
    process.exit(1);
  },
);
