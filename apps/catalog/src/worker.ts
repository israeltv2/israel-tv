// Cloudflare Worker for the public addon. Static files (catalogs, meta, stream files) are served by Cloudflare
// without running it; it answers search, streams, paging past the end and /status, and fills the addon's own
// address into the files that carry image URLs. For each request it answers it logs one JSON line (route, id,
// status, time, and a salted daily hash of the client — never the address) to Workers Logs, and for each
// stream request writes one Analytics Engine data point; the home daemon reads the daily counts back.
import { createAddonApp } from '@israel-tv/addon';
import { clientHash, parseSeriesId, withOrigin } from '@israel-tv/core';

interface Env {
  ASSETS: Fetcher;
  /** Secret salt for client hashes (uploaded by `israel-tv publish`). */
  CLIENT_SALT?: string;
  /** Analytics Engine dataset for stream-request counts. */
  USAGE?: AnalyticsEngineDataset;
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
        const what = describeRequest(url);
        const client = salt && address ? await clientHash(salt, address) : undefined;
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
