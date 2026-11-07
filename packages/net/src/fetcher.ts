// Polite HTTP client for source sites: one request at a time per host, a pause between requests,
// retries with backoff, and loud failures when a site answers with a block page instead of data.
import { setTimeout as sleep } from 'node:timers/promises';
import { gotScraping } from 'got-scraping';
import { type ProxyEndpoint, proxyUrlWithAuth } from './geo.ts';

export class BlockedError extends Error {
  readonly url: string;
  readonly status: number;
  constructor(url: string, status: number, detail: string) {
    super(`blocked by ${new URL(url).host} (HTTP ${status}): ${detail}`);
    this.url = url;
    this.status = status;
  }
}

export class HttpError extends Error {
  readonly url: string;
  readonly status: number;
  constructor(url: string, status: number) {
    super(`HTTP ${status} for ${url}`);
    this.url = url;
    this.status = status;
  }
}

export interface FetcherOptions {
  delayMs: number;
  retries?: number;
  timeoutMs?: number;
  /** Route through these proxies (geo adapter), falling back in order when one fails. */
  proxies?: ProxyEndpoint[];
  /** Count of requests made, for run statistics. */
  onRequest?: (url: string, status: number, ms: number) => void;
  /**
   * Pauses (ms) before reading a JSON address again after the site answered with a bot-check page instead of data
   * (Mako's Radware). Each pause gets ±25% jitter; every retry is a fresh request with new browser headers and no
   * cookies. Default 5 s, 15 s, 30 s; [] turns block retries off.
   */
  blockBackoffMs?: readonly number[];
  /** The clock's pause (tests). */
  sleep?: (ms: number) => Promise<unknown>;
  /** Answers requests instead of the network (tests replaying recorded pages). */
  transport?: Transport;
}

/** One HTTP exchange: the final address after redirects, its status and body. */
export type Transport = (req: {
  url: string;
  headers: Record<string, string>;
}) => Promise<{ status: number; body: string; url: string }>;

/** Bot-check pages met by one fetcher (one run). */
export interface BlockStats {
  /** Responses that were a bot-check page. */
  pages: number;
  /** Addresses read on a retry after at least one bot-check page. */
  cleared: number;
  /** Addresses still refused after every retry (BlockedError thrown). */
  refused: number;
}

export interface Fetcher {
  text(url: string, headers?: Record<string, string>): Promise<{ status: number; body: string }>;
  json<T = unknown>(url: string, headers?: Record<string, string>): Promise<T>;
  readonly requests: number;
  /** Bot-check pages met so far (absent on fetchers that cannot tell). */
  readonly blocks?: BlockStats;
}

/** Where Radware sends a request it scores as a bot (HTTP 302 from the site, then a 200 block page). */
const BLOCK_HOSTS = ['validate.perfdrive.com'];
const BLOCK_MARKERS = [/radware/i, /captcha/i, /Just a moment/i, /רק רגע/, /cf-chl/i, /Access Denied/i];

export function createFetcher(opts: FetcherOptions): Fetcher {
  const lastByHost = new Map<string, Promise<void>>();
  const retries = opts.retries ?? 3;
  const blockBackoff = opts.blockBackoffMs ?? [5000, 15_000, 30_000];
  const pause = opts.sleep ?? sleep;
  const blocks: BlockStats = { pages: 0, cleared: 0, refused: 0 };
  let requests = 0;
  let proxyIndex = 0;

  /** Serialize requests per host with `delayMs` between them. */
  async function turn(host: string): Promise<() => void> {
    const prev = lastByHost.get(host) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => {
      release = r;
    });
    lastByHost.set(
      host,
      prev.then(() => next),
    );
    await prev;
    return () => {
      setTimeout(release, opts.delayMs);
    };
  }

  async function once(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string; url: string }> {
    const t0 = Date.now();
    if (opts.transport) {
      const r = await opts.transport({ url, headers });
      requests++;
      opts.onRequest?.(url, r.status, Date.now() - t0);
      return r;
    }
    const proxy = opts.proxies?.[proxyIndex % (opts.proxies.length || 1)];
    const res = await gotScraping({
      url,
      headers,
      responseType: 'text',
      throwHttpErrors: false,
      followRedirect: true,
      timeout: { request: opts.timeoutMs ?? 30_000 },
      retry: { limit: 0 },
      ...(proxy ? { proxyUrl: proxyUrlWithAuth(proxy) } : {}),
    });
    requests++;
    opts.onRequest?.(url, res.statusCode, Date.now() - t0);
    return { status: res.statusCode, body: String(res.body), url: res.url ?? url };
  }

  async function text(url: string, headers: Record<string, string> = {}) {
    const host = new URL(url).host;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const done = await turn(host);
      try {
        const r = await once(url, headers);
        if (r.status === 407 && opts.proxies && opts.proxies.length > 1) {
          proxyIndex++;
          lastErr = new HttpError(url, 407);
        } else if ((r.status === 403 || r.status === 429 || r.status >= 500) && attempt < retries) {
          // 403 included: bot walls answer it intermittently; a short pause usually clears it.
          lastErr = new HttpError(url, r.status);
        } else {
          return r;
        }
      } catch (err) {
        lastErr = err;
        if (opts.proxies && opts.proxies.length > 1) proxyIndex++;
      } finally {
        done();
      }
      if (attempt < retries) await pause(Math.min(30_000, 2000 * 2 ** attempt));
    }
    throw lastErr;
  }

  /** Why a non-JSON answer is a bot-check page, or undefined when it is not one. */
  function blockReason(r: { status: number; body: string; url: string }): string | undefined {
    const marker = BLOCK_MARKERS.find((m) => m.test(r.body));
    if (marker) return `page matches ${marker}`;
    const host = URL.canParse(r.url) ? new URL(r.url).host : '';
    return BLOCK_HOSTS.includes(host) ? `sent to ${host}` : undefined;
  }

  async function json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    let blockedBefore = false;
    for (let attempt = 0; ; attempt++) {
      const r = await text(url, { accept: 'application/json, text/plain, */*', ...headers });
      const trimmed = r.body.trimStart();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        const reason = blockReason(r);
        if (reason) {
          blocks.pages++;
          blockedBefore = true;
          // A bot-check page is scored per request, not a ban: a fresh request a little later is usually let through.
          const wait = blockBackoff[attempt];
          if (wait !== undefined) {
            await pause(Math.round(wait * (0.75 + Math.random() * 0.5)));
            continue;
          }
          blocks.refused++;
          throw new BlockedError(url, r.status, reason);
        }
        if (r.status === 403) throw new BlockedError(url, r.status, 'not JSON');
        if (r.status >= 400) throw new HttpError(url, r.status);
        throw new BlockedError(url, r.status, `expected JSON, got ${trimmed.slice(0, 60)}`);
      }
      if (r.status >= 400) throw new HttpError(url, r.status);
      if (blockedBefore) blocks.cleared++;
      return JSON.parse(r.body) as T;
    }
  }

  return {
    text,
    json,
    get requests() {
      return requests;
    },
    get blocks() {
      return { ...blocks };
    },
  };
}
