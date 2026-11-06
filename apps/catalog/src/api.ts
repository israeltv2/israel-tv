// The private API Worker (Cloudflare publisher): rows, search, streams and /status for the public addon. It has no
// public URL: the data Worker's router hands it each dynamic request as an envelope (router-contract.ts) with the
// catalog files it asked for. It keeps the per-client limits, writes one Workers Logs line per request (route, id,
// status, time and a salted daily hash of the client — never the address) and one Analytics Engine data point per
// stream request; the home daemon reads the daily counts back. Deployed from code releases only
// (`israel-tv deploy-api`), never by a catalog publish.
import { createAddonApp } from '@israel-tv/addon';
import { clientHash, parseSeriesId } from '@israel-tv/core/edge';
import {
  ENVELOPE_PATH,
  NEED_HEADER,
  ROUTER_CONTRACT_VERSION,
  type RouterEnvelope,
  safeSitePath,
} from '@israel-tv/core/router-contract';
import { LIMITS, limitKind, memoryLimiter, type RateLimiter, tooMany } from './limit.ts';

interface Env {
  /** Secret salt for client hashes (uploaded by `israel-tv publish`). */
  CLIENT_SALT?: string;
  /** Analytics Engine dataset for stream-request counts. */
  USAGE?: AnalyticsEngineDataset;
  /** Cloudflare rate-limiting bindings (per client, per minute). */
  RATE_STREAM?: RateLimiter;
  RATE_SEARCH?: RateLimiter;
}

const fallback = { stream: memoryLimiter(LIMITS.stream), search: memoryLimiter(LIMITS.search) };

/** Catalog files the router sent, shared by requests for a minute (the catalog changes at most every half hour). */
const FILE_TTL_MS = 60_000;
const files = new Map<string, { text: string | null; at: number }>();

/** A catalog file this request needs and the router has not sent yet. */
class NeedFile extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`need ${path}`);
    this.path = path;
  }
}

const app = createAddonApp({
  async read(path) {
    const hit = files.get(path);
    if (!hit || Date.now() - hit.at > FILE_TTL_MS) {
      if (!safeSitePath(path)) return undefined;
      throw new NeedFile(path);
    }
    return hit.text ?? undefined;
  },
});
app.onError((err, c) => {
  if (err instanceof NeedFile)
    return c.json({ need: [err.path] }, 409, { [NEED_HEADER]: '1', 'cache-control': 'no-store' });
  throw err;
});

/** A router speaking another contract version: say so, plainly (on /status as a page). */
function refuse(e: { v?: unknown; url?: unknown }): Response {
  const message = `Israel TV: the public router speaks contract version ${String(e.v)}, this API speaks ${ROUTER_CONTRACT_VERSION}. Deploy matching versions (israel-tv deploy-api, then a publish).`;
  const statusPage = typeof e.url === 'string' && new URL(e.url).pathname.startsWith('/status');
  return statusPage
    ? new Response(`<!doctype html><meta charset="utf-8"><title>Israel TV status</title><p>${message}</p>`, {
        status: 500,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      })
    : Response.json({ error: message }, { status: 500, headers: { 'cache-control': 'no-store' } });
}

/** Marks this Worker's own events in Workers Logs. */
export const EVENT_MARK = 'iltv';

export function describeRequest(url: URL): {
  route: string;
  video?: string;
  series?: string;
  source?: string;
} {
  const [, resource, , file] = url.pathname.split('/');
  if (url.pathname === '/manifest.json') return { route: 'manifest' };
  if (resource === 'catalog') return { route: url.pathname.includes('search=') ? 'search' : 'catalog' };
  if (resource !== 'meta' && resource !== 'stream') return { route: resource || 'root' };
  const id = decodeURIComponent(file ?? '').replace(/\.json$/, '');
  const series = id.split(':')[0] ?? id;
  const source = parseSeriesId(series)?.source ?? (series.startsWith('iltv_live_') ? 'live' : undefined);
  return { route: resource, series, ...(id !== series ? { video: id } : {}), ...(source ? { source } : {}) };
}

export default {
  async fetch(incoming: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const t0 = Date.now();
    if (incoming.method !== 'POST' || new URL(incoming.url).pathname !== ENVELOPE_PATH)
      return new Response(null, { status: 404 });
    let e: RouterEnvelope;
    try {
      e = (await incoming.json()) as RouterEnvelope;
    } catch {
      return refuse({});
    }
    if (e?.v !== ROUTER_CONTRACT_VERSION || typeof e.url !== 'string') return refuse(e ?? {});
    for (const [path, text] of Object.entries(e.files ?? {}))
      if (safeSitePath(path))
        files.set(path, { text: typeof text === 'string' ? text : null, at: Date.now() });
    const request = new Request(e.url, {
      method: e.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: {
        ...(e.headers ?? {}),
        ...(e.client ? { 'cf-connecting-ip': e.client } : {}),
        ...(e.ray ? { 'cf-ray': e.ray } : {}),
      },
    });
    // Static files first (as Cloudflare does when the Worker does not run first), then the app.
    // Search and stream requests are limited per client (salted daily hash of the address, never the address).
    const url = new URL(request.url);
    const kind = limitKind(url);
    const salt = env.CLIENT_SALT;
    const address = request.headers.get('cf-connecting-ip');
    const client = salt && address ? await clientHash(salt, address) : undefined;
    // Counted once per viewer request: later rounds of the same request only bring files.
    const firstRound = Object.keys(e.files ?? {}).length === 0;
    if (kind && firstRound) {
      // Cloudflare's limiter counts across locations but lets bursts through while it syncs; the in-memory
      // window stops a burst at once within this instance. A request over either is refused.
      const key = client ?? address ?? 'unknown';
      const shared = kind === 'stream' ? env.RATE_STREAM : env.RATE_SEARCH;
      const local = (await fallback[kind].limit({ key })).success;
      const success = local && (shared ? (await shared.limit({ key })).success : true);
      if (!success) {
        console.log(
          JSON.stringify({
            ev: EVENT_MARK,
            kind: 'request',
            // Not `stream`/`search`: a refused request is not usage (the daily counts filter on route).
            route: 'limited',
            limited: kind,
            status: 429,
            outcome: 'error',
            client,
          }),
        );
        return tooMany(kind);
      }
    }
    const res = await app.fetch(request, env, ctx);
    // Asking the router for a file is not a request of its own: logged once, when answered.
    if (res.headers.has(NEED_HEADER)) return res;
    ctx.waitUntil(
      (async () => {
        const what = describeRequest(url);
        const outcome = res.status < 400 ? 'ok' : 'error';
        const ms = Date.now() - t0;
        console.log(
          JSON.stringify({
            ev: EVENT_MARK,
            kind: 'request',
            ...what,
            status: res.status,
            outcome,
            ms,
            ray: request.headers.get('cf-ray') ?? undefined,
            client,
          }),
        );
        if (what.route === 'stream')
          env.USAGE?.writeDataPoint({
            blobs: [what.source ?? '', what.series ?? '', what.video ?? '', client ?? '', outcome],
            doubles: [1, ms],
            indexes: [what.source ?? 'none'],
          });
      })(),
    );
    return res;
  },
} satisfies ExportedHandler<Env>;
