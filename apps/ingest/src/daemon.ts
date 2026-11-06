// The long-running process: scheduled runs, one job at a time (single writer), publish after each run,
// LAN-only admin endpoints, the local publisher and the private resolver.
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { serve } from '@hono/node-server';
import { type Config, parseSeriesId, type Source } from '@israel-tv/core';
import { proxyEndpoints } from '@israel-tv/net';
import { startResolver } from '@israel-tv/resolver';
import type { Store } from '@israel-tv/store';
import { Cron } from 'croner';
import { Hono } from 'hono';
import { crawlKan } from './kan.ts';
import { checkLive, liveRender } from './live.ts';
import { startLocalServer } from './local-server.ts';
import { buildStatus, deploy, renderFromStore, writeSite } from './publish.ts';
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
    this.sources = (Object.keys(config.sources) as Source[]).filter((s) => config.sources[s]);
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
    const t0 = Date.now();
    const files = renderFromStore(this.store, this.config, this.config.sources.live ? liveRender() : []);
    const w = writeSite(this.config.publisher.dir, files);
    if (w.written === 0 && w.deleted === 0) {
      this.log('publish: nothing changed');
      return;
    }
    try {
      const d = await deploy(this.config);
      this.log(
        `publish: ${w.written} files changed, ${w.deleted} removed; ${d.detail} (${Math.round((Date.now() - t0) / 1000)} s)`,
      );
    } catch (err) {
      const runId = this.store.startRun('publish', this.config.publisher.type);
      this.store.finishRun(runId, { status: 'failed', error: (err as Error).message });
      this.log(`publish failed: ${(err as Error).message}`);
    }
  }

  fullRun(): void {
    this.enqueue('full', async () => {
      const adapters = createAdapters(this.config);
      for (const make of Object.values(adapters)) await runFull(this.store, make(), this.runOpts);
      if (this.config.sources.live) await checkLive(this.store);
      const key = this.config.tmdb ? process.env[this.config.tmdb.apiKeyEnv] : undefined;
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
    const make = createAdapters(this.config)[parsed.source];
    if (!make) return { error: `source ${parsed.source} is not enabled` };
    return this.enqueue(`show:${seriesId}`, async () => {
      await runOne(this.store, make(), { key: row.show.key, title: row.title }, this.runOpts);
      await this.publish();
    });
  }

  private kanSlices = 0;

  /** One Kan crawl slice (a few browser pages), then publish if anything was added. */
  kanCrawl(): void {
    if (!this.config.sources.kan || this.config.browser.type === 'none') return;
    this.enqueue('kan', async () => {
      const proxies = proxyEndpoints(this.config.geo);
      const proxy = proxies[this.kanSlices++ % Math.max(proxies.length, 1)];
      const r = await crawlKan(this.store, {
        browser: this.config.browser,
        ...(proxy ? { proxy } : {}),
        pagesPerRun: this.config.scraping.browserPagesPerRun,
        pageIntervalMs: this.config.scraping.browserPageIntervalSec * 1000,
        airingWindowDays: this.config.schedule.airingWindowDays,
        log: this.log,
      });
      if (r.newEpisodes > 0) await this.publish();
    });
  }

  schedule(): void {
    const tz = this.config.schedule.timezone;
    const at = (pattern: string, fn: () => void) =>
      this.crons.push(new Cron(pattern, { timezone: tz, protect: true }, fn));
    at(this.config.schedule.fullRun, () => this.fullRun());
    for (const p of this.config.schedule.airingChecks) at(p, () => this.airingRun());
    if (this.config.sources.kan && this.config.browser.type !== 'none')
      at(this.config.schedule.kanCrawl, () => this.kanCrawl());
  }

  nextRuns(): Record<string, string | null> {
    return Object.fromEntries(
      this.crons.map((c) => [c.getPattern() ?? '?', c.nextRun()?.toISOString() ?? null]),
    );
  }

  state() {
    return { running: this.running ?? null, queued: this.queue.map((j) => j.name), next: this.nextRuns() };
  }

  status() {
    return { ...buildStatus(this.store, this.sources), daemon: { ...this.state(), revision: REVISION } };
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
    await next();
  });
  app.get('/', (c) => c.redirect('/status'));
  app.get('/status', (c) => c.json(d.status()));
  const refresh = (c: import('hono').Context) => {
    const r = d.refresh(c.req.param('id') ?? '');
    return 'error' in r ? c.json(r, 404) : c.json(r, 202);
  };
  app.post('/refresh/:id', refresh);
  app.get('/refresh/:id', refresh);
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

/** Start everything the config enables. */
export function startDaemon(config: Config, store: Store, log: Log): Daemon {
  const d = new Daemon(config, store, log);
  d.schedule();
  serve({ fetch: adminApp(d).fetch, hostname: config.admin.host, port: config.admin.port });
  log(`admin: http://${config.admin.host}:${config.admin.port}/status (local network only)`);
  if (config.publisher.type === 'local') {
    startLocalServer(config.publisher.dir, config.publisher.host, config.publisher.port);
    log(`addon: http://${config.publisher.host}:${config.publisher.port}/manifest.json`);
  }
  if (config.resolver.enabled) {
    startResolver(config);
    log(`resolver: http://${config.resolver.host}:${config.resolver.port}/manifest.json`);
  }
  // First start (or after a long stop): fill the catalog now instead of waiting for the night.
  const firstSource = (Object.keys(config.sources) as Source[]).find(
    (s) => config.sources[s] && s !== 'live',
  );
  const last = firstSource ? store.lastRun('full', firstSource) : undefined;
  if (firstSource && (!last || Date.now() - Date.parse(last.startedAt) > 24 * 3_600_000)) {
    log('no full run in the last 24 hours: starting one now');
    d.fullRun();
  } else {
    void d.publish();
  }
  return d;
}
