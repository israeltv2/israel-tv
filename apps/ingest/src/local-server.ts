// Local publisher: serve the rendered site on the local network with the same addon app the Worker uses.
import { readFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { createAddonApp } from '@israel-tv/addon';
import { Hono } from 'hono';

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
};

export function localAddonApp(dir: string) {
  const root = normalize(dir);
  const inside = (p: string) => p.startsWith(root.endsWith(sep) ? root : root + sep);
  const images = new Hono();
  // Images (the addon's logo and background, channel logos, the pages' icons) are served as they are.
  images.get(
    '/:path{(logos/[a-z0-9_]+\\.(?:png|webp)|art/[a-z0-9_]+(-poster)?\\.jpg|art/placeholder-poster\\.jpg|logo\\.png|background\\.jpg|favicon\\.ico|icon\\.svg|apple-touch-icon\\.png|icon-[a-z0-9-]+\\.png|og\\.jpg|hero\\.jpg|fonts/[a-z0-9-]+\\.woff2)}',
    async (c) => {
      const p = normalize(join(root, c.req.param('path')));
      if (!inside(p)) return c.notFound();
      try {
        const body = await readFile(p);
        const type = IMAGE_TYPES[p.split('.').pop() ?? ''] ?? 'application/octet-stream';
        return c.body(body, 200, { 'content-type': type, 'cache-control': 'public, max-age=86400' });
      } catch {
        return c.notFound();
      }
    },
  );
  const addon = createAddonApp(
    {
      async read(path) {
        const p = normalize(join(root, path));
        if (!inside(p)) return undefined;
        try {
          return await readFile(p, 'utf8');
        } catch {
          return undefined;
        }
      },
    },
    { cacheMs: 5_000 },
  );
  images.route('/', addon);
  // Addresses neither app knows get the addon's answer (the site's not-found page for a person, JSON for an app).
  images.notFound((c) => addon.fetch(c.req.raw));
  return images;
}
