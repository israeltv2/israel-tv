// The public data Worker's script: a tiny, stable router. The catalog is this Worker's static assets, served by
// Cloudflare without running any code; only the dynamic paths (rows, search, streams, status: `run_worker_first`)
// reach this script, which hands them to the private API Worker through a service binding and answers the API's
// requests for catalog files from the assets. See packages/core/src/router-contract.ts.
import {
  ENVELOPE_PATH,
  MAX_FILES,
  MAX_ROUNDS,
  NEED_HEADER,
  PASSED_HEADERS,
  ROUTER_CONTRACT_VERSION,
  type RouterEnvelope,
  safeSitePath,
} from '@israel-tv/core/router-contract';

export interface RouterEnv {
  ASSETS: Fetcher;
  API: Fetcher;
}

const unavailable = (why: string) =>
  new Response(`Israel TV is updating or unavailable (${why}); try again in a minute.\n`, {
    status: 503,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'retry-after': '60',
      'cache-control': 'no-store',
    },
  });

export async function route(request: Request, env: RouterEnv): Promise<Response> {
  // The addon is read-only: anything but GET and HEAD is refused here, before it costs the API anything.
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  const headers: Record<string, string> = {};
  for (const h of PASSED_HEADERS) {
    const v = request.headers.get(h);
    if (v) headers[h] = v;
  }
  const client = request.headers.get('cf-connecting-ip') ?? undefined;
  const ray = request.headers.get('cf-ray') ?? undefined;
  const envelope: RouterEnvelope = {
    v: ROUTER_CONTRACT_VERSION,
    method: request.method,
    url: request.url,
    headers,
    ...(client ? { client } : {}),
    ...(ray ? { ray } : {}),
    files: {},
  };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let res: Response;
    try {
      res = await env.API.fetch(`https://api.internal${ENVELOPE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      });
    } catch (err) {
      return unavailable(`API: ${(err as Error).message}`);
    }
    if (!res.headers.has(NEED_HEADER)) return res;
    const { need } = (await res.json()) as { need?: unknown };
    const paths = Array.isArray(need) ? need.filter((p): p is string => typeof p === 'string') : [];
    if (paths.length === 0 || paths.length > MAX_FILES || !paths.every(safeSitePath))
      return unavailable('API asked for files a router does not give');
    for (const p of paths) {
      const a = await env.ASSETS.fetch(new Request(`https://assets.local/${p}`));
      envelope.files[p] = a.ok ? await a.text() : null;
    }
  }
  return unavailable('too many rounds');
}

export default {
  fetch: (request: Request, env: RouterEnv) => route(request, env),
} satisfies ExportedHandler<RouterEnv>;
