// The long-running process: scheduled runs, one job at a time (single writer), publish after each run,
// LAN-only admin endpoints, the local publisher and the private resolver.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { ADMIN_API, CSRF_HEADER } from '@israel-tv/admin-contract';
import {
  type Config,
  DAY_MS,
  LIVE_CHANNELS,
  parseSeriesId,
  type Source,
  tmdbApiKey,
  type UsageEvent,
} from '@israel-tv/core';
import { dashboardBuilt, dashboardCsp, dashboardFile, newNonce } from '@israel-tv/dashboard';
import type { EventStore } from '@israel-tv/events';
import { proxyEndpoints } from '@israel-tv/net';
import { checkProxyAtStart, PlaySessions, remoteResolverApp, resolverApp } from '@israel-tv/resolver';
import { type Logger, lanAddresses, listen } from '@israel-tv/runtime';
import type { Store } from '@israel-tv/store';
import { Cron } from 'croner';
import { Hono } from 'hono';
import { z } from 'zod';
import { mountAdminApi } from './admin-api.ts';
import { csrfFor, sameSecret } from './admin-auth.ts';
import { backupCatalog, checkBackup } from './backup.ts';
import { type CanaryResult, canaryEvent, runCanary } from './canary.ts';
import { QUOTA_KEY, type Quota, readQuota } from './cloudflare-quota.ts';
import { refreshGuides } from './epg.ts';
import { crawlKan, kanCrawlOptions, kanEnabled, kanShowKnown } from './kan.ts';
import { checkLive, type LiveCheckOptions } from './live.ts';
import { localAddonApp } from './local-server.ts';
import { pullPublicUsage } from './public-usage.ts';
import { activeSources, analyticsOff, buildStatus, cleanSecrets, publishSite } from './publish.ts';
import {
  type BlockedRetry,
  type RunOptions,
  retryKey,
  runAiring,
  runBlockedRetry,
  runFull,
  runOne,
} from './runner.ts';
import { createAdapters } from './sources.ts';
import { probeStreams, probesAbroad } from './stream-probe.ts';
import { matchShows } from './tmdb.ts';
import { buildDashboard, latestCanary, queryEvents, renderUsagePage } from './usage-page.ts';

type Log = (msg: string, fields?: Record<string, unknown>) => void;

/** Git revision of this install, written by deploy tooling into `.revision` at the repo root (optional). */
const REVISION = (() => {
  try {
    return readFileSync(new URL('../../../.revision', import.meta.url), 'utf8').trim();
  } catch {
    return 'dev';
  }
})();

/** Host header that names this machine locally: an IP literal, localhost, or a .local/.lan/.home.arpa name. */
export function isLocalHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  const name = host
    .replace(/:\d+$/, '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  return (
    isIP(name) !== 0 ||
    name === 'localhost' ||
    /\.(local|lan|home\.arpa|internal)$/.test(name) ||
    !name.includes('.')
  );
}

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
  readonly config: Config;
  readonly store: Store;
  private readonly log: Log;
  readonly events: EventStore;
  readonly logger: Logger;
  /** The deployed git revision (or `dev`). */
  readonly revision = REVISION;

  constructor(config: Config, store: Store, events: EventStore, logger: Logger) {
    const log = logger.log;
    this.events = events;
    this.logger = logger;
    this.config = config;
    this.store = store;
    this.log = log;
    this.sources = activeSources(config);
  }

  private get runOpts(): RunOptions {
    return { minShareOfPrevious: this.config.scraping.minShareOfPrevious, log: this.log };
  }

  /** Queue a job unless one with the same name is already waiting. */
  enqueue(name: string, run: () => Promise<void>): { queued: boolean; position: number } {
    const pos = this.queue.findIndex((j) => j.name === name);
    // Already waiting: no need to add it twice. (If it is running now, queue it once more: the running one
    // may have started before the change that asked for it.)
    if (pos >= 0) return { queued: false, position: pos + 1 };
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
    this.lastPublishAt = Date.now();
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.publishTimer = undefined;
    await publishSite(this.store, this.config, this.log);
  }

  private lastPublishAt = 0;
  private publishTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Publish routine changes: at once when the last publish is long enough ago, else once when the interval is up
   * (changes in between are gathered into that one deploy). `urgent` publishes now (owner refresh, full run).
   */
  requestPublish(urgent = false): void {
    const p = this.config.publisher;
    const gap = p.type === 'cloudflare' ? p.minIntervalMinutes * 60_000 : 0;
    const wait = urgent ? 0 : this.lastPublishAt + gap - Date.now();
    if (wait <= 0) {
      this.enqueue('publish', () => this.publish());
      return;
    }
    this.publishTimer ??= setTimeout(() => {
      this.publishTimer = undefined;
      this.enqueue('publish', () => this.publish());
    }, wait);
  }

  fullRun(): void {
    this.enqueue('full', async () => {
      const adapters = createAdapters(this.config);
      for (const make of Object.values(adapters)) await runFull(this.store, make(), this.runOpts);
      if (this.config.sources.live) await checkLive(this.store, this.liveCheckOptions());
      await this.probeStreams(1500);
      await this.refreshGuides();
      const key = tmdbApiKey(this.config);
      if (key) await matchShows(this.store, key, { log: this.log });
      this.store.prune();
      await this.publish();
      this.scheduleRetries();
    });
  }

  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Shows a source's last full run was refused (bot protection) are read again later the same night, after
   * growing pauses (runner.ts BLOCK_RETRIES); each retry that reads something publishes.
   */
  scheduleRetries(): void {
    const adapters = createAdapters(this.config);
    for (const source of this.sources) {
      const make = adapters[source];
      const st = this.store.getState<BlockedRetry | null>(retryKey(source));
      clearTimeout(this.retryTimers.get(source));
      this.retryTimers.delete(source);
      if (!make || !st?.nextAt || st.pending.length === 0) continue;
      if (this.store.lastRun('full', source)?.id !== st.runId) continue;
      const wait = Math.max(0, Date.parse(st.nextAt) - Date.now());
      const timer = setTimeout(() => {
        this.retryTimers.delete(source);
        this.enqueue(`retry:${source}`, async () => {
          const r = await runBlockedRetry(this.store, make(), this.runOpts);
          if (r && r.recovered.length > 0) this.requestPublish();
          this.scheduleRetries();
        });
      }, wait);
      timer.unref?.();
      this.retryTimers.set(source, timer);
    }
  }

  airingRun(): void {
    this.enqueue('airing', async () => {
      const adapters = createAdapters(this.config);
      for (const make of Object.values(adapters)) {
        await runAiring(this.store, make(), this.config.schedule.airingWindowDays, this.runOpts);
      }
      await this.probeStreams(300);
      await this.refreshGuides();
      this.requestPublish();
    });
  }

  /** Read the live guides that are due (epg.ts); a failure keeps the last good guide and never fails the run. */
  private async refreshGuides(): Promise<void> {
    try {
      await refreshGuides(this.store, this.config, { log: this.log });
    } catch (err) {
      this.log(`guide refresh failed: ${(err as Error).stack ?? err}`);
    }
  }

  /** Measure what is due (stream-probe.ts); a failure here never fails the run it follows. */
  private async probeStreams(budget: number): Promise<void> {
    try {
      await probeStreams(this.store, this.config, { budget, log: this.log });
    } catch (err) {
      this.log(`stream probes failed: ${(err as Error).stack ?? err}`);
    }
  }

  /** Re-read one show (all seasons) and publish. */
  refresh(seriesId: string): { queued: boolean; position: number } | { error: string } {
    const parsed = parseSeriesId(seriesId);
    const row = this.store.getShow(seriesId);
    if (!parsed || !row) return { error: `unknown series ${seriesId}` };
    if (parsed.source === 'kan') {
      // Kan is read by the crawler: make the show due and start a slice now.
      if (!kanEnabled(this.config)) return { error: 'Kan is turned off in the config' };
      if (!kanShowKnown(this.store, row.show.key))
        return { error: `Kan show ${seriesId} is not in the crawler's list` };
      // Kept in memory and handed to the next slice (a running slice would overwrite stored state).
      this.kanRefresh.add(row.show.key);
      this.kanCrawl();
      return { queued: true, position: this.kanRunning ? 1 : 0 };
    }
    const make = createAdapters(this.config)[parsed.source];
    if (!make) return { error: `source ${parsed.source} is not enabled` };
    return this.enqueue(`show:${seriesId}`, async () => {
      const poster = row.show.poster;
      await runOne(
        this.store,
        make(),
        { key: row.show.key, title: row.title, ...(poster ? { poster } : {}) },
        this.runOpts,
      );
      await this.publish();
    });
  }

  /**
   * The proxy exit Kan uses: sticky, because Cloudflare's clearance (kept in the exit's browser profile) is tied to the
   * exit's address. It moves to the next exit only after a slice that failed (a block or an outage).
   */
  private kanExit = 0;
  private kanRunning = false;
  private kanRefresh = new Set<string>();

  /**
   * One Kan crawl slice, in its own lane: its pauses between browser pages must not hold the shared
   * queue (airing checks and refreshes). It only writes Kan shows; publishing goes through the queue.
   */
  kanCrawl(): void {
    if (!kanEnabled(this.config) || this.kanRunning) return;
    this.kanRunning = true;
    const proxies = proxyEndpoints(this.config.geo);
    const proxy = proxies[this.kanExit % Math.max(proxies.length, 1)];
    const priority = [...this.kanRefresh];
    this.kanRefresh.clear();
    // Handled below: failures are caught and logged; the last step cannot throw.
    void crawlKan(this.store, { ...kanCrawlOptions(this.config, proxy, this.log), priority })
      .then((r) => {
        if (r.failed) this.kanExit++;
        // Refreshes asked for while this slice ran get a slice of their own right away.
        const arrived = this.kanRefresh.size > 0;
        // Refreshes this slice never got to (back-off, block) wait for the next scheduled slice; one whose
        // page was tried and failed is done (it shows on /status) and is not retried in a loop.
        const attempted = new Set(r.attemptedShows ?? []);
        for (const k of priority) if (!attempted.has(k)) this.kanRefresh.add(k);
        // New episodes, or newly copied show images.
        // A slice that served an owner's refresh publishes at once; routine slices are gathered.
        if (r.newEpisodes > 0 || (r.artSaved ?? 0) > 0) this.requestPublish(priority.length > 0);
        return arrived && r.pages > 0;
      })
      .catch((err) => {
        for (const k of priority) this.kanRefresh.add(k);
        this.log(`kan crawl failed: ${(err as Error).stack ?? err}`);
        return false;
      })
      .then((read) => {
        this.kanRunning = false;
        // Only refreshes that arrived during a slice that read pages start a slice right away, so this
        // can never spin; the rest wait for the scheduled slices.
        if (read) setTimeout(() => this.kanCrawl(), 0);
      });
  }

  schedule(): void {
    const tz = this.config.schedule.timezone;
    const at = (pattern: string, fn: () => void) =>
      this.crons.push(new Cron(pattern, { timezone: tz, protect: true }, fn));
    at(this.config.schedule.fullRun, () => this.fullRun());
    for (const p of this.config.schedule.airingChecks) at(p, () => this.airingRun());
    if (kanEnabled(this.config)) at(this.config.schedule.kanCrawl, () => this.kanCrawl());
    at(this.config.schedule.daily, () => this.daily());
    // Cloudflare free-plan use, hourly (and once now).
    at('20 * * * *', () => void this.readQuota());
    void this.readQuota();
  }

  /** Today's Cloudflare free-plan use; a failed read is kept for the dashboard, not an error of the addon. */
  async readQuota(): Promise<void> {
    try {
      const q = await readQuota(this.config);
      if (q) this.store.setState(QUOTA_KEY, q);
    } catch (err) {
      const prev = this.store.getState<Quota>(QUOTA_KEY);
      if (prev) this.store.setState(QUOTA_KEY, { ...prev, readError: cleanSecrets((err as Error).message) });
      this.log(`cloudflare quota: ${cleanSecrets((err as Error).message)}`);
    }
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

  /** Why the remote resolver is not running, when it is enabled but cannot start. */
  remoteProblem: string | undefined;
  /** Why the last daily read of the public addon's usage failed (cleared when one succeeds). */
  publicUsageProblem: string | undefined;

  /** Play and relay sessions of the resolver (what is playing now). */
  readonly sessions = new PlaySessions((e) => this.record(e));

  /** Record a usage/diagnostics event: in events.sqlite (for the dashboard and queries) and the log. */
  record(e: UsageEvent): void {
    try {
      this.events.record(e);
    } catch (err) {
      this.log(`could not record an event: ${(err as Error).message}`);
    }
    const { ts: _ts, component, kind, ...fields } = e;
    this.logger.for(component)(kind, fields);
  }

  /**
   * Daily housekeeping: back up the catalog database (keeping a week), roll up and prune usage events,
   * read the public addon's counts for yesterday, and run the playback canary.
   */
  daily(): void {
    this.enqueue('daily', async () => {
      const now = Date.now();
      try {
        const b = backupCatalog(this.store, this.config.backup, now);
        const check = b.file ? checkBackup(b.file) : undefined;
        this.log('catalog backup', { ...b, ...(check ? { check } : {}) });
        if (b.file)
          this.store.setState('backup:last', {
            file: b.file,
            at: new Date(now).toISOString(),
            bytes: b.bytes,
            check,
          });
      } catch (err) {
        this.log(`catalog backup failed: ${(err as Error).message}`);
      }
      // Relay sessions started before today and still open are written now, so they land in the day being rolled
      // up; ones started today go on as one session.
      this.sessions.flush(false, Date.parse(this.events.dayRange(this.events.dayOf(now)).from));
      const m = this.events.maintain(now, this.config.events.maxMB * 1024 * 1024);
      this.log('usage events maintained', m);
      await this.canary();
      const yesterday = this.events.lastDays(2, now)[0] as string;
      try {
        const r = await pullPublicUsage(this.events, this.config, yesterday);
        if (r) this.log('public addon usage read', { ...r });
        this.publicUsageProblem = undefined;
      } catch (err) {
        const why = cleanSecrets((err as Error).message);
        this.publicUsageProblem = `reading the public addon's usage failed on ${new Date(now).toISOString().slice(0, 16)}Z: ${why} (the "Public addon" numbers stop at the last day read)`;
        this.log(this.publicUsageProblem);
        // The dashboard shows it next to the public numbers, in red.
        const last = this.events.getMeta('public-usage:last');
        this.events.setMeta(
          'public-usage:last',
          JSON.stringify({ ...(last ? JSON.parse(last) : {}), note: this.publicUsageProblem }),
        );
      }
    });
  }

  /** The daily live check plays Mako channels through this instance's home helper, when it runs one. */
  liveCheckOptions(): LiveCheckOptions {
    return {
      resolverBase: this.config.resolver.enabled
        ? `http://127.0.0.1:${this.config.resolver.port}`
        : undefined,
      abroad: probesAbroad(this.config),
    };
  }

  /** Play one recent title per source end to end and record the results. */
  async canary(): Promise<CanaryResult[]> {
    const base = this.config.resolver.enabled ? `http://127.0.0.1:${this.config.resolver.port}` : undefined;
    const results = await runCanary(this.store, this.sources, base);
    for (const r of results) {
      this.record(canaryEvent(r));
      this.log(`canary ${r.source}: ${r.outcome === 'ok' ? 'pass' : `FAIL at ${r.step}`}`, {
        showId: r.showId,
        episodeId: r.episodeId,
        statuses: r.statuses.join('/'),
        via: r.via,
        ...(r.detail ? { reason: r.detail } : {}),
      });
    }
    return results;
  }

  /** The latest canary result per source (last 3 days). */
  canaryStatus() {
    return latestCanary(this.events);
  }

  dashboard() {
    const titles = new Map<string, string>();
    const status = this.status();
    return buildDashboard(this.events, {
      active: this.sessions.active(),
      title: (id) => {
        if (!titles.has(id))
          titles.set(id, this.store.getShow(id)?.title ?? LIVE_CHANNELS.find((c) => c.id === id)?.name ?? '');
        return titles.get(id) || undefined;
      },
      ingest: status.sources.map((s) => ({
        source: s.source,
        health: s.health,
        notes: s.notes,
        ...(s.lastFullRun ? { lastFullRun: s.lastFullRun.at } : {}),
      })),
      canary: this.canaryStatus(),
    });
  }

  queryEvents(q: Record<string, string | undefined>) {
    return queryEvents(this.events, q);
  }

  noteRelay(r: { ok: boolean; error?: string; exit?: string }): void {
    const at = new Date().toISOString();
    if (r.ok) this.geo.lastOkAt = at;
    else {
      this.geo.lastErrorAt = at;
      if (r.error) this.geo.lastError = r.error;
    }
    if (!r.exit) return;
    const e = this.exits.get(r.exit) ?? { server: r.exit, ok: 0, errors: 0 };
    if (r.ok) {
      e.ok++;
      e.lastOkAt = at;
    } else {
      e.errors++;
      e.lastErrorAt = at;
      if (r.error) e.lastError = r.error;
    }
    this.exits.set(r.exit, e);
  }

  /** What the relay saw per proxy exit since the service started (the dashboard's proxy table). */
  readonly exits = new Map<
    string,
    {
      server: string;
      ok: number;
      errors: number;
      lastOkAt?: string;
      lastErrorAt?: string;
      lastError?: string;
    }
  >();

  /** When the service started. */
  readonly startedAt = new Date().toISOString();

  /** The running revision and when it first started here (a restart of the same revision keeps the date). */
  get release(): { revision: string; at: string } {
    const kept = this.store.getState<{ revision: string; at: string }>('release:current');
    if (kept?.revision === REVISION) return kept;
    const now = { revision: REVISION, at: this.startedAt };
    this.store.setState('release:current', now);
    return now;
  }

  status() {
    const notes = [
      ...(this.config.publisher.type === 'cloudflare' && analyticsOff(this.store)
        ? [
            'Analytics Engine is not enabled on the Cloudflare account (Workers & Pages → Analytics Engine → enable, then `pnpm israel-tv deploy-api`); the public addon is not counted meanwhile',
          ]
        : []),
      ...(this.remoteProblem ? [this.remoteProblem] : []),
      ...(this.publicUsageProblem ? [this.publicUsageProblem] : []),
      ...(() => {
        const q = this.store.getState<Quota>(QUOTA_KEY);
        return q?.warn && q.day === new Date().toISOString().slice(0, 10) ? [q.warn] : [];
      })(),
      ...(dashboardBuilt()
        ? []
        : ['the dashboard is not built in this copy (`pnpm build`); /dash shows how to fix it']),
      ...(this.events.overCap()
        ? [
            `events.sqlite is over its ${this.config.events.maxMB} MB cap: raw events were cut to the last week`,
          ]
        : []),
    ];
    const canary = this.canaryStatus();
    return {
      ...buildStatus(this.store, this.sources),
      ...(notes.length ? { notes } : {}),
      ...(canary.length ? { canary } : {}),
      ...(this.geo.proxies.length ? { geo: this.geo } : {}),
      daemon: { ...this.state(), revision: REVISION },
    };
  }

  stop(): void {
    for (const c of this.crons) c.stop();
    for (const t of this.retryTimers.values()) clearTimeout(t);
  }
}

const ADMIN_COOKIE = 'iltv_admin';

/** The host part of an Origin header; undefined for `null` or anything that is not a URL. */
function hostOf(origin: string): string | undefined {
  try {
    return new URL(origin).host;
  } catch {
    return undefined;
  }
}

/** What /events.json accepts (anything else is refused, not passed on). */
const EventsQuery = z.strictObject({
  playId: z.string().max(80).optional(),
  kind: z.string().max(40).optional(),
  outcome: z.enum(['ok', 'error', 'not-mine']).optional(),
  since: z.string().max(40).optional(),
  show: z.string().max(80).optional(),
  limit: z
    .string()
    .regex(/^\d{1,4}$/)
    .optional(),
});

/** The admin token: from the configured .env variable, else one generated once and kept in the database. */
export function adminToken(config: Config, store: Store, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[config.admin.tokenEnv];
  if (fromEnv) return fromEnv;
  const kept = store.getState<string>('admin-token');
  if (kept) return kept;
  const made = randomBytes(24).toString('base64url');
  store.setState('admin-token', made);
  return made;
}

export function adminApp(d: Daemon, token: string) {
  const app = new Hono<{ Bindings: { incoming: { socket: { remoteAddress?: string } } } }>();
  // The owner's pages and answers are never indexed (refusals included), whatever finds them.
  app.use('*', async (c, next) => {
    await next();
    c.header('x-robots-tag', 'noindex, nofollow');
  });
  app.use('*', async (c, next) => {
    const addr = c.env?.incoming?.socket?.remoteAddress;
    if (!isLocalAddress(addr)) return c.text('admin endpoints are for the local network only', 403);
    // DNS rebinding: a web page can point its own name at this address; accept only local host names.
    if (!isLocalHostHeader(c.req.header('host')))
      return c.text('use the IP address or a local host name', 403);
    // Browsers send Origin with cross-site requests; a web page must not be able to trigger runs here.
    // (curl and scripts send none.)
    const origin = c.req.header('origin');
    if (origin && hostOf(origin) !== c.req.header('host')) return c.text('cross-site request refused', 403);
    // Owner only: a token as well (guests on the same Wi-Fi get a plain 404). A browser opens a page once with
    // ?token=…, which is moved into a cookie and taken out of the address bar.
    const bearer = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
    const cookie = /(?:^|;\s*)iltv_admin=([^;]+)/.exec(c.req.header('cookie') ?? '')?.[1];
    // The token in the address is accepted only to open a page (it then moves into the cookie), never on the API.
    const query =
      c.req.method === 'GET' && !c.req.path.startsWith(ADMIN_API) ? c.req.query('token') : undefined;
    const given = bearer ?? query ?? cookie;
    if (!given || !sameSecret(given, token)) return c.json({ error: 'not found' }, 404);
    // A change asked for with the cookie (a browser) must also carry the CSRF value the dashboard got from /session.
    if (c.req.method !== 'GET' && !bearer) {
      const sent = c.req.header(CSRF_HEADER);
      if (!sent || !sameSecret(sent, csrfFor(token)))
        return c.json({ error: 'missing or wrong CSRF value' }, 403);
    }
    if (query) {
      const url = new URL(c.req.url);
      url.searchParams.delete('token');
      c.header('set-cookie', `${ADMIN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
      return c.redirect(`${url.pathname}${url.search}`, 303);
    }
    await next();
  });
  app.get('/', (c) => c.redirect('/dash/'));
  mountAdminApi(app, d, token);
  app.get('/dash', (c) => c.redirect('/dash/'));
  app.get('/dash/*', (c) => {
    const nonce = newNonce();
    const f = dashboardFile(c.req.path.slice('/dash/'.length), nonce);
    if (!f) return c.json({ error: 'not found' }, 404);
    return c.body(typeof f.body === 'string' ? f.body : new Uint8Array(f.body), 200, {
      'content-type': f.type,
      'cache-control': f.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'content-security-policy': dashboardCsp(nonce),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
  });
  app.get('/status', (c) => c.json(d.status()));
  app.get('/usage', (c) => c.html(renderUsagePage(d.dashboard())));
  app.get('/usage.json', (c) => c.json(d.dashboard()));
  // For agents and scripts: /events.json?playId=…&kind=failure&outcome=error&since=2h&show=…&limit=100
  app.get('/events.json', (c) => {
    const q = EventsQuery.safeParse(c.req.query());
    return q.success ? c.json(d.queryEvents(q.data)) : c.json({ error: q.error.issues[0]?.message }, 400);
  });
  const refresh = (c: import('hono').Context) => {
    const r = d.refresh(c.req.param('id') ?? '');
    return 'error' in r ? c.json(r, 404) : c.json(r, 202);
  };
  app.post('/refresh/:id', refresh);
  app.post('/run/full', (c) => {
    d.fullRun();
    return c.json(d.state(), 202);
  });
  app.post('/run/canary', async (c) => c.json(await d.canary()));
  app.post('/run/daily', (c) => {
    d.daily();
    return c.json(d.state(), 202);
  });
  app.post('/run/airing', (c) => {
    d.airingRun();
    return c.json(d.state(), 202);
  });
  return app;
}

/** Start everything the config enables. Ports are opened first, so a clash stops before any work. */
export async function startDaemon(
  config: Config,
  store: Store,
  events: EventStore,
  logger: Logger,
  opts: { initialRun?: boolean } = {},
): Promise<Daemon> {
  const log = logger.log;
  const d = new Daemon(config, store, events, logger);
  // Every finished run (full, airing, show, crawl slice, publish, match) is also an event.
  store.onRunFinished = (run) =>
    d.record({
      ts: run.finishedAt ?? new Date().toISOString(),
      kind: 'run',
      component: 'ingest',
      outcome: run.status === 'failed' ? 'error' : 'ok',
      source: run.scope,
      latencyMs: Date.parse(run.finishedAt ?? new Date().toISOString()) - Date.parse(run.startedAt),
      detail: {
        run: run.kind,
        status: run.status,
        showsOk: run.showsOk,
        showsFailed: run.showsFailed,
        newEpisodes: run.newEpisodes,
        requests: run.requests,
        ...(run.error ? { error: run.error.slice(0, 300) } : {}),
      },
    });
  const token = adminToken(config, store);
  const urls = (host: string, port: number, path: string) =>
    lanAddresses(host)
      .map((a) => `http://${a}:${port}${path}`)
      .join('  ');
  await listen(adminApp(d, token).fetch as never, config.admin.host, config.admin.port, 'admin.port');
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
      resolverApp(config, {
        log: (component) => logger.for(component),
        onRelay: (r) => d.noteRelay(r),
        onEvent: (e) => d.record(e),
        sessions: d.sessions,
        salt: events.clientSalt(),
      }).fetch as never,
      config.resolver.host,
      config.resolver.port,
      'resolver.port',
    );
  }
  if (config.resolver.remote.enabled) {
    const remote = remoteResolverApp(config, {
      log: (component) => logger.for(`remote-${component}`),
      onEvent: (e) => d.record(e),
      sessions: d.sessions,
      salt: events.clientSalt(),
    });
    if ('error' in remote) {
      d.remoteProblem = `remote resolver not started: ${remote.error}`;
      log(d.remoteProblem);
    } else {
      await listen(
        remote.fetch as never,
        config.resolver.remote.host,
        config.resolver.remote.port,
        'resolver.remote.port',
      );
      log(
        `remote resolver (Mako away from home) on ${config.resolver.remote.host}:${config.resolver.remote.port}, served at ${config.resolver.remote.publicUrl} — \`israel-tv remote-url\` prints the link to install`,
      );
    }
  }
  log(
    `the dashboard (local network, owner only): ${urls(config.admin.host, config.admin.port, '/dash/')} — open it once with ?token=… (\`israel-tv admin-url\` prints the link)`,
  );
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
  store.prune();
  d.schedule();
  // Retries of shows the last full run was refused, if any are still due (e.g. after a restart).
  d.scheduleRetries();
  // Relay sessions end after a quiet minute or two.
  setInterval(() => d.sessions.flush(), 30_000).unref();
  // Live channels are checked right away (as a job, not holding startup), so /status reflects them.
  if (config.sources.live) d.enqueue('live', async () => void (await checkLive(store, d.liveCheckOptions())));
  // First start (or after a long stop): fill the catalog now instead of waiting for the night.
  // Sources read by full runs (Mako, Reshet), in order.
  // Stale when any source read by full runs has had no good run in a day (e.g. the first run was stopped).
  const fullSources = Object.keys(createAdapters(config)) as Source[];
  const stale = fullSources.some((src) => {
    const good = store.lastGoodRun('full', src);
    return !good || Date.now() - Date.parse(good.startedAt) > DAY_MS;
  });
  // Publish first, whatever else is due: a new release's manifest (its version, its code's output) goes out now,
  // not after a half-hour full run or the next batched publish.
  d.enqueue('publish', () => d.publish());
  if (stale && opts.initialRun !== false) {
    log('no full run in the last 24 hours: starting one now (about half an hour; see /status)');
    d.fullRun();
  } else if (stale)
    log(
      `no recent full run (a --limit test run does not count); skipped because of --no-initial-run. Next full run: ${d.nextRuns()[config.schedule.fullRun] ?? 'per schedule.fullRun'} (UTC; schedule is ${config.schedule.timezone})`,
    );
  if (config.resolver.enabled) checkProxyAtStart(config, logger.for('geo-relay'), false); // the proxies are already listed above
  d.kanCrawl();
  return d;
}

export { csrfFor, lanAddresses, listen, sameSecret };
