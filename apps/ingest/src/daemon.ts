// The long-running process: scheduled runs, one job at a time (single writer), publish after each run,
// LAN-only admin endpoints, the local publisher and the private resolver.
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { serve } from '@hono/node-server';
import { type Config, DAY_MS, enabledSources, parseSeriesId, type Source, tmdbApiKey } from '@israel-tv/core';
import { proxyEndpoints } from '@israel-tv/net';
import { resolverApp } from '@israel-tv/resolver';
import type { Store } from '@israel-tv/store';
import { Cron } from 'croner';
import { Hono } from 'hono';
import { crawlKan, kanCrawlOptions, kanEnabled, markKanShowDue } from './kan.ts';
import { checkLive } from './live.ts';
import { localAddonApp } from './local-server.ts';
import { buildStatus, publishSite } from './publish.ts';
import { type RunOptions, runAiring, runFull, runOne } from './runner.ts';
import { createAdapters } from './sources.ts';
import { matchShows } from './tmdb.ts';

type Log = (line: string) => void;

/** Git revision of this install, written by deploy tooling into `.revision` at the repo root (optional). */
const REVISION = (() => {
  try {
    return readFileSync(new URL('../../../.revision', import.meta.url), 'utf8').trim();
  } catch {
    return 'dev';
  }
})();

/** True for loopback, private (RFC 1918), CGNAT, link-local and unique-local addresses. */
export function isLocalAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/, '');
  if (isIP(a) === 4) {
    const [x = 0, y = 0] = a.split('.').map(Number);
    return (
      x === 10 ||
      x === 127 ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 168) ||
      (x === 169 && y === 254) ||
      (x === 100 && y >= 64 && y <= 127)
    );
  }
  const l = a.toLowerCase();
  return l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80:');
}

interface Job {
  name: string;
  run: () => Promise<void>;
}

export class Daemon {
  private queue: Job[] = [];
  private running: string | undefined;
  private crons: Cron[] = [];
  private readonly sources: Source[];
  private readonly config: Config;
  private readonly store: Store;
  private readonly log: Log;

  constructor(config: Config, store: Store, log: Log) {
    this.config = config;
    this.store = store;
    this.log = log;
    this.sources = enabledSources(config);
  }

  private get runOpts(): RunOptions {
    return { minShareOfPrevious: this.config.scraping.minShareOfPrevious, log: this.log };
  }

  /** Queue a job unless one with the same name is already waiting. */
  enqueue(name: string, run: () => Promise<void>): { queued: boolean; position: number } {
    const pos = this.queue.findIndex((j) => j.name === name);
    if (pos >= 0 || this.running === name) return { queued: false, position: pos + 1 };
    this.queue.push({ name, run });
    void this.drain();
    return { queued: true, position: this.queue.length };
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    for (let job = this.queue.shift(); job; job = this.queue.shift()) {
      this.running = job.name;
      try {
        await job.run();
      } catch (err) {
        this.log(`job ${job.name} failed: ${(err as Error).stack ?? err}`);
      } finally {
        this.running = undefined;
      }
    }
  }

  async publish(): Promise<void> {
    await publishSite(this.store, this.config, this.log);
  }

  fullRun(): void {
    this.enqueue('full', async () => {
      const adapters = createAdapters(this.config);
      for (const make of Object.values(adapters)) await runFull(this.store, make(), this.runOpts);
      if (this.config.sources.live) await checkLive(this.store);
      const key = tmdbApiKey(this.config);
      if (key) await matchShows(this.store, key, { log: this.log });
      await this.publish();
    });
  }

  airingRun(): void {
    this.enqueue('airing', async () => {
      const adapters = createAdapters(this.config);
      for (const make of Object.values(adapters)) {
        await runAiring(this.store, make(), this.config.schedule.airingWindowDays, this.runOpts);
      }
      await this.publish();
    });
  }

  /** Re-read one show (all seasons) and publish. */
  refresh(seriesId: string): { queued: boolean; position: number } | { error: string } {
    const parsed = parseSeriesId(seriesId);
    const row = this.store.getShow(seriesId);
    if (!parsed || !row) return { error: `unknown series ${seriesId}` };
    if (parsed.source === 'kan') {
      // Kan is read by the crawler: make the show due and start a slice now.
      if (!kanEnabled(this.config)) return { error: 'Kan is turned off in the config' };
      markKanShowDue(this.store, row.show.key);
      this.kanCrawl();
      return { queued: true, position: 0 };
    }
    const make = createAdapters(this.config)[parsed.source];
    if (!make) return { error: `source ${parsed.source} is not enabled` };
    return this.enqueue(`show:${seriesId}`, async () => {
      await runOne(this.store, make(), { key: row.show.key, title: row.title }, this.runOpts);
      await this.publish();
    });
  }

  private kanSlices = 0;
  private kanRunning = false;

  /**
   * One Kan crawl slice, in its own lane: its pauses between browser pages must not hold the shared
   * queue (airing checks and refreshes). It only writes Kan shows; publishing goes through the queue.
   */
  kanCrawl(): void {
    if (!kanEnabled(this.config) || this.kanRunning) return;
    this.kanRunning = true;
    const proxies = proxyEndpoints(this.config.geo);
    const proxy = proxies[this.kanSlices++ % Math.max(proxies.length, 1)];
    crawlKan(this.store, kanCrawlOptions(this.config, proxy, this.log))
      .then((r) => {
        if (r.newEpisodes > 0) this.enqueue('publish', () => this.publish());
      })
      .catch((err) => this.log(`kan crawl failed: ${(err as Error).stack ?? err}`))
      .finally(() => {
        this.kanRunning = false;
      });
  }

  schedule(): void {
    const tz = this.config.schedule.timezone;
    const at = (pattern: string, fn: () => void) =>
      this.crons.push(new Cron(pattern, { timezone: tz, protect: true }, fn));
    at(this.config.schedule.fullRun, () => this.fullRun());
    for (const p of this.config.schedule.airingChecks) at(p, () => this.airingRun());
    if (kanEnabled(this.config)) at(this.config.schedule.kanCrawl, () => this.kanCrawl());
  }

  nextRuns(): Record<string, string | null> {
    return Object.fromEntries(
      this.crons.map((c) => [c.getPattern() ?? '?', c.nextRun()?.toISOString() ?? null]),
    );
  }

  state() {
    return { running: this.running ?? null, queued: this.queue.map((j) => j.name), next: this.nextRuns() };
  }

  /** Last outcome of relaying through the geo proxy (resolver), for /status. */
  geo: { proxies: string[]; lastOkAt?: string; lastErrorAt?: string; lastError?: string } = { proxies: [] };

  noteRelay(r: { ok: boolean; error?: string }): void {
    const at = new Date().toISOString();
    if (r.ok) this.geo.lastOkAt = at;
    else {
      this.geo.lastErrorAt = at;
      if (r.error) this.geo.lastError = r.error;
    }
  }

  status() {
    return {
      ...buildStatus(this.store, this.sources),
      ...(this.geo.proxies.length ? { geo: this.geo } : {}),
      daemon: { ...this.state(), revision: REVISION },
    };
  }

  stop(): void {
    for (const c of this.crons) c.stop();
  }
}

export function adminApp(d: Daemon) {
  const app = new Hono<{ Bindings: { incoming: { socket: { remoteAddress?: string } } } }>();
  app.use('*', async (c, next) => {
    const addr = c.env?.incoming?.socket?.remoteAddress;
    if (!isLocalAddress(addr)) return c.text('admin endpoints are for the local network only', 403);
    // Browsers send Origin with cross-site requests; a web page must not be able to trigger runs here.
    // (curl and scripts send none.)
    const origin = c.req.header('origin');
    if (origin && new URL(origin).host !== c.req.header('host'))
      return c.text('cross-site request refused', 403);
    await next();
  });
  app.get('/', (c) => c.redirect('/status'));
  app.get('/status', (c) => c.json(d.status()));
  const refresh = (c: import('hono').Context) => {
    const r = d.refresh(c.req.param('id') ?? '');
    return 'error' in r ? c.json(r, 404) : c.json(r, 202);
  };
  app.post('/refresh/:id', refresh);
  app.post('/run/full', (c) => {
    d.fullRun();
    return c.json(d.state(), 202);
  });
  app.post('/run/airing', (c) => {
    d.airingRun();
    return c.json(d.state(), 202);
  });
  return app;
}

/** Listen, or fail with a message that names the port and the option that sets it. */
export function listen(
  fetch: (req: Request, ...rest: never[]) => Response | Promise<Response>,
  host: string,
  port: number,
  option: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: fetch as never, hostname: host, port }, () => resolve());
    server.on('error', (err: NodeJS.ErrnoException) => {
      reject(
        new Error(
          err.code === 'EADDRINUSE'
            ? `port ${port} is already in use (${option}). Is israel-tv already running?`
            : `cannot listen on ${host}:${port} (${option}): ${err.message}`,
        ),
      );
    });
  });
}

/** Addresses other devices on the network can use to reach this machine. */
export function lanAddresses(host: string): string[] {
  if (host !== '0.0.0.0' && host !== '::') return [host];
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out.length ? out : ['127.0.0.1'];
}

/** Start everything the config enables. Ports are opened first, so a clash stops before any work. */
export async function startDaemon(
  config: Config,
  store: Store,
  log: Log,
  opts: { initialRun?: boolean } = {},
): Promise<Daemon> {
  const d = new Daemon(config, store, log);
  const urls = (host: string, port: number, path: string) =>
    lanAddresses(host)
      .map((a) => `http://${a}:${port}${path}`)
      .join('  ');
  await listen(adminApp(d).fetch as never, config.admin.host, config.admin.port, 'admin.port');
  if (config.publisher.type === 'local') {
    await listen(
      localAddonApp(config.publisher.dir).fetch as never,
      config.publisher.host,
      config.publisher.port,
      'publisher.port',
    );
  }
  if (config.resolver.enabled) {
    await listen(
      resolverApp(config, process.env, log, (r) => d.noteRelay(r)).fetch as never,
      config.resolver.host,
      config.resolver.port,
      'resolver.port',
    );
  }
  log(`admin (local network only): ${urls(config.admin.host, config.admin.port, '/status')}`);
  if (config.publisher.type === 'local') {
    log(
      `addon — install this in your app: ${urls(config.publisher.host, config.publisher.port, '/manifest.json')}`,
    );
  }
  if (config.resolver.enabled) {
    log(
      `resolver — install this too, at home: ${urls(config.resolver.host, config.resolver.port, '/manifest.json')}`,
    );
  }
  d.geo.proxies = proxyEndpoints(config.geo).map((p) => p.server);
  if (d.geo.proxies.length)
    log(`geo proxy: ${d.geo.proxies.join(', ')} (check with: pnpm israel-tv check-proxy)`);
  if (config.publisher.type === 'cloudflare') {
    const base =
      config.publisher.publicUrl ?? `https://${config.publisher.workerName}.<your-subdomain>.workers.dev`;
    log(`addon (public): ${base}/manifest.json — the exact URL is logged after each successful publish`);
  }
  d.schedule();
  // Live channels are checked right away (as a job, not holding startup), so /status reflects them.
  if (config.sources.live) d.enqueue('live', async () => void (await checkLive(store)));
  // First start (or after a long stop): fill the catalog now instead of waiting for the night.
  // Sources read by full runs (Mako, Reshet), in order.
  const firstSource = Object.keys(createAdapters(config))[0] as Source | undefined;
  const last = firstSource ? store.lastRun('full', firstSource) : undefined;
  const stale = firstSource && (!last || Date.now() - Date.parse(last.startedAt) > DAY_MS);
  if (stale && opts.initialRun !== false) {
    log('no full run in the last 24 hours: starting one now (about half an hour; see /status)');
    d.fullRun();
  } else {
    if (stale) log('no recent full run; skipped because of --no-initial-run (next one at schedule.fullRun)');
    d.enqueue('publish', () => d.publish());
  }
  d.kanCrawl();
  return d;
}
