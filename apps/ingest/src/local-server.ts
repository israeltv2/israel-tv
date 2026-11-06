// Local publisher: serve the rendered site on the local network with the same addon app the Worker uses.
import { readFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { serve } from '@hono/node-server';
import { createAddonApp } from '@israel-tv/addon';

export function startLocalServer(dir: string, host: string, port: number) {
  const root = normalize(dir);
  const app = createAddonApp(
    {
      async read(path) {
        const p = normalize(join(root, path));
        if (!p.startsWith(root.endsWith(sep) ? root : root + sep)) return undefined;
        try {
          return await readFile(p, 'utf8');
        } catch {
          return undefined;
        }
      },
    },
    { cacheMs: 5_000 },
  );
  return serve({ fetch: app.fetch, hostname: host, port });
}
