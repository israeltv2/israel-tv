// Cloudflare Worker for the public addon. Static files (manifest, catalogs, meta, stream files) come from the
// assets binding; the Worker answers search, streams, paging past the end and /status, and (with request logs
// on) logs one JSON event per request: route, id, status, time and a salted daily hash of the client — never
// the address itself. The home daemon pulls these events from Workers Logs for its usage dashboard.
import { createAddonApp } from '@israel-tv/addon';
import { clientHash, parseSeriesId, withOrigin } from '@israel-tv/core';

interface Env {
  ASSETS: Fetcher;
  /** Secret salt for client hashes (uploaded by `israel-tv publish`). */
  CLIENT_SALT?: string;
}

let app: ReturnType<typeof createAddonApp> | undefined;

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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const t0 = Date.now();
    app ??= createAddonApp({
      async read(path) {
        const r = await env.ASSETS.fetch(new Request(`https://assets.local/${path}`));
        return r.ok ? r.text() : undefined;
      },
    });
    // Static files first (as Cloudflare does when the Worker does not run first), then the app.
    let res = await env.ASSETS.fetch(request);
    if (res.status === 404) res = await app.fetch(request, env, ctx);
    // Static JSON files carry image URLs relative to this addon's address (the app does this for its own).
    else if (/json/.test(res.headers.get('content-type') ?? '')) {
      res = new Response(withOrigin(await res.text(), new URL(request.url).origin), res);
    }
    const salt = env.CLIENT_SALT;
    const address = request.headers.get('cf-connecting-ip');
    ctx.waitUntil(
      (async () => {
        const url = new URL(request.url);
        console.log(
          JSON.stringify({
            ev: EVENT_MARK,
            kind: 'request',
            ...describeRequest(url),
            status: res.status,
            outcome: res.status < 400 ? 'ok' : 'error',
            ms: Date.now() - t0,
            corr: request.headers.get('cf-ray') ?? undefined,
            client: salt && address ? await clientHash(salt, address) : undefined,
          }),
        );
      })(),
    );
    return res;
  },
} satisfies ExportedHandler<Env>;
