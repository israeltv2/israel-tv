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
}

export interface Fetcher {
  text(url: string, headers?: Record<string, string>): Promise<{ status: number; body: string }>;
  json<T = unknown>(url: string, headers?: Record<string, string>): Promise<T>;
  readonly requests: number;
}

const BLOCK_MARKERS = [/radware/i, /captcha/i, /Just a moment/i, /רק רגע/, /cf-chl/i, /Access Denied/i];

export function createFetcher(opts: FetcherOptions): Fetcher {
  const lastByHost = new Map<string, Promise<void>>();
  const retries = opts.retries ?? 3;
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
  ): Promise<{ status: number; body: string }> {
    const proxy = opts.proxies?.[proxyIndex % (opts.proxies.length || 1)];
    const t0 = Date.now();
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
    return { status: res.statusCode, body: String(res.body) };
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
      if (attempt < retries) await sleep(Math.min(30_000, 2000 * 2 ** attempt));
    }
    throw lastErr;
  }

  async function json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const r = await text(url, { accept: 'application/json, text/plain, */*', ...headers });
    const trimmed = r.body.trimStart();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      const marker = BLOCK_MARKERS.find((m) => m.test(r.body));
      if (marker || r.status === 403)
        throw new BlockedError(url, r.status, marker ? `page matches ${marker}` : 'not JSON');
      if (r.status >= 400) throw new HttpError(url, r.status);
      throw new BlockedError(url, r.status, `expected JSON, got ${trimmed.slice(0, 60)}`);
    }
    if (r.status >= 400) throw new HttpError(url, r.status);
    return JSON.parse(r.body) as T;
  }

  return {
    text,
    json,
    get requests() {
      return requests;
    },
  };
}
