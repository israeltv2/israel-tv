// IndexNow (https://www.indexnow.org/documentation): after a publish that changed public pages, tell the search
// engines that take part which ones are new, changed or gone, without any account. One POST per publish (more only
// past 10,000 addresses), sent after the deploy went through; a failure is logged and noted on the admin /status,
// never a failed publish. The key is public by design: it is served at `/<key>.txt` from the published site.
import { randomBytes } from 'node:crypto';
import { type Config, HOUR_MS, sitePaths } from '@israel-tv/core';
import type { Store } from '@israel-tv/store';

/** The protocol's limit of addresses per request. */
export const INDEXNOW_BATCH = 10_000;
/**
 * Pages that change with almost every publish (`/status`, `/he/status`, the programme guide in both languages): each
 * is sent at most this often.
 */
export const STATUS_EVERY_MS = 24 * HOUR_MS;
/** Those pages, each with the key its last submission is kept under. */
const DAILY: Record<string, string> = {
  status: 'indexnow:status-at',
  'he/status': 'indexnow:status-at',
  'live/guide/': 'indexnow:guide-at',
  'en/live/guide/': 'indexnow:guide-at',
};

const KEY = 'indexnow:key';
/** The host and key the whole site was last submitted for (a new host or key submits everything again). */
const FULL = 'indexnow:full';
/** Addresses a failed submission did not get through; sent again with the next one. */
const PENDING = 'indexnow:pending';
export const INDEXNOW_LAST = 'indexnow:last';

export interface IndexNowLast {
  at: string;
  ok: boolean;
  urls: number;
  /** The endpoint's HTTP status, when it answered. */
  status?: number;
  error?: string;
}

/** Whether this instance submits: on unless turned off, and only where a public site is published. */
export function indexNowEnabled(config: Config): boolean {
  return config.indexNow.enabled && config.publisher.type === 'cloudflare';
}

/** The key: the configured one, else one generated on first use (32 hex characters) and kept in the database. */
export function indexNowKey(store: Store, config: Config): string {
  if (config.indexNow.key) return config.indexNow.key;
  const kept = store.getState<string>(KEY);
  if (kept) return kept;
  const key = randomBytes(16).toString('hex');
  store.setState(KEY, key);
  return key;
}

/** The key file's path in the site. */
export const keyFile = (key: string) => `${key}.txt`;

/**
 * The public page a site file is, as a path below the site's address ('' is the home page), or undefined for
 * anything that is not a page meant for search (data, images, search, the 404 page). Same pages as sitemap.xml.
 */
export function pageFor(file: string): string | undefined {
  if (file === sitePaths.landing) return '';
  if (file === sitePaths.statusPage) return 'status';
  if (file === sitePaths.statusPageHe) return 'he/status';
  const m = /^(he|library|library\/[^/]+|show\/[^/]+|live|live\/guide|en\/live\/guide)\/index\.html$/.exec(
    file,
  );
  return m ? `${m[1]}/` : undefined;
}

/** Split into requests of at most `size` addresses. */
export function batches<T>(items: T[], size = INDEXNOW_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface IndexNowInput {
  /** The public site's address, e.g. https://name.sub.workers.dev (no trailing slash). */
  base: string;
  /** Files this publish wrote (new or changed) and removed. */
  changed: string[];
  removed: string[];
  /** Every file of the site, for the first (whole-site) submission. */
  all: Iterable<string>;
  fetch?: typeof fetch;
  now?: number;
  log: (line: string) => void;
}

/** The addresses to submit now, whether the whole site is among them, and the daily pages' keys to stamp. */
export function indexNowPlan(
  store: Store,
  key: string,
  input: Pick<IndexNowInput, 'base' | 'changed' | 'removed' | 'all' | 'now'>,
): { urls: string[]; full: boolean; daily: string[] } {
  const now = input.now ?? Date.now();
  const host = new URL(input.base).host;
  const done = store.getState<{ host: string; key: string }>(FULL);
  const full = done?.host !== host || done?.key !== key;
  const files = full ? [...input.all] : [...input.changed, ...input.removed];
  const pages = new Set<string>();
  for (const f of files) {
    const p = pageFor(f);
    if (p !== undefined) pages.add(p);
  }
  const daily = new Set<string>();
  for (const [page, stamp] of Object.entries(DAILY)) {
    if (!pages.has(page)) continue;
    const at = store.getState<string>(stamp);
    if (full || !at || now - Date.parse(at) >= STATUS_EVERY_MS) daily.add(stamp);
    else pages.delete(page);
  }
  const urls = new Set([...pages].map((p) => `${input.base}/${p}`));
  for (const u of store.getState<string[]>(PENDING) ?? []) if (u.startsWith(`${input.base}/`)) urls.add(u);
  return { urls: [...urls], full, daily: [...daily] };
}

/**
 * Submit the publish's new, changed and removed pages (the whole site the first time, or for a new address or key).
 * Never throws: a failure is logged, kept for the admin /status, and its addresses go with the next submission.
 */
export async function submitIndexNow(store: Store, config: Config, input: IndexNowInput): Promise<void> {
  if (!indexNowEnabled(config)) return;
  const at = new Date(input.now ?? Date.now()).toISOString();
  let plan: ReturnType<typeof indexNowPlan> | undefined;
  try {
    const key = indexNowKey(store, config);
    plan = indexNowPlan(store, key, input);
    if (plan.urls.length === 0) return;
    const host = new URL(input.base).host;
    const endpoint = config.indexNow.endpoint;
    const endpointHost = new URL(endpoint).host;
    const post = input.fetch ?? fetch;
    const groups = batches(plan.urls);
    let status = 0;
    for (const [i, urlList] of groups.entries()) {
      const res = await post(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host, key, keyLocation: `${input.base}/${keyFile(key)}`, urlList }),
        signal: AbortSignal.timeout(30_000),
      });
      status = res.status;
      if (res.status !== 200 && res.status !== 202) {
        const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200);
        // This request's addresses and the ones not sent yet go with the next submission.
        store.setState(PENDING, groups.slice(i).flat());
        const error = `HTTP ${res.status}${body ? `: ${body}` : ''}`;
        store.setState(INDEXNOW_LAST, {
          at,
          ok: false,
          urls: plan.urls.length,
          status,
          error,
        } satisfies IndexNowLast);
        input.log(
          `indexnow warning: ${endpointHost} answered ${error} for ${urlList.length} URLs; they are sent again with the next publish`,
        );
        return;
      }
    }
    store.setState(PENDING, []);
    if (plan.full) store.setState(FULL, { host, key, at });
    for (const stamp of plan.daily) store.setState(stamp, at);
    store.setState(INDEXNOW_LAST, { at, ok: true, urls: plan.urls.length, status } satisfies IndexNowLast);
    input.log(
      `indexnow: ${endpointHost} answered ${status} for ${plan.urls.length} URLs${plan.full ? ' (the whole site, first submission)' : ''}${groups.length > 1 ? ` in ${groups.length} requests` : ''}`,
    );
  } catch (err) {
    const error = (err as Error).message;
    try {
      if (plan) store.setState(PENDING, plan.urls);
      store.setState(INDEXNOW_LAST, {
        at,
        ok: false,
        urls: plan?.urls.length ?? 0,
        error,
      } satisfies IndexNowLast);
    } catch {}
    input.log(`indexnow warning: submission failed (${error}); it is tried again with the next publish`);
  }
}

/** The admin /status note while the last submission failed. */
export function indexNowNote(store: Store, config: Config): string | undefined {
  if (!indexNowEnabled(config)) return undefined;
  const last = store.getState<IndexNowLast>(INDEXNOW_LAST);
  if (!last || last.ok) return undefined;
  return `IndexNow: the last submission (${last.at}) failed: ${last.error ?? 'unknown error'}; its ${last.urls} URLs are sent again with the next publish that changes a page`;
}
