// Cloudflare Worker for the public addon. Static assets (manifest, catalogs, meta) are served by
// Cloudflare before this runs; the Worker handles search, streams, paging past the end and /status.
import { createAddonApp } from '@israel-tv/addon';

interface Env {
  ASSETS: Fetcher;
}

let app: ReturnType<typeof createAddonApp> | undefined;

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    app ??= createAddonApp({
      async read(path) {
        const r = await env.ASSETS.fetch(new Request(`https://assets.local/${path}`));
        return r.ok ? r.text() : undefined;
      },
    });
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
