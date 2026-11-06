// The public addon as a Hono app over the rendered site files. Used by both publishers:
// Cloudflare (static assets answer plain file paths first; this app handles the rest) and local (Node).
import {
  type ExtIds,
  type Freshness,
  normalizeForSearch,
  parseVideoId,
  type SearchRow,
  type SeasonStreams,
  STALE_ID_PREFIX,
  type Stream,
  sitePaths,
  staleItem,
  staleSince,
  withOrigin,
} from '@israel-tv/core';
import { Hono } from 'hono';

/** Reads a rendered file by its site path; undefined when it does not exist. */
export interface SiteReader {
  read(path: string): Promise<string | undefined>;
}

export interface AddonOptions {
  /** How long lookups (search index, external ids) stay cached in memory. */
  cacheMs?: number;
}

const CACHE = {
  manifest: 'public, max-age=3600',
  list: 'public, max-age=600',
  stream: 'public, max-age=300',
  none: 'no-store',
};

const MAX_SEARCH = 100;

export function createAddonApp(reader: SiteReader, opts: AddonOptions = {}) {
  const cacheMs = opts.cacheMs ?? 60_000;
  const memo = new Map<string, { at: number; value: unknown }>();

  async function readJson<T>(path: string, cache = false): Promise<T | undefined> {
    if (cache) {
      const hit = memo.get(path);
      if (hit && Date.now() - hit.at < cacheMs) return hit.value as T;
    }
    const text = await reader.read(path);
    if (text === undefined) return undefined;
    const value = JSON.parse(text) as T;
    if (cache) memo.set(path, { at: Date.now(), value });
    return value;
  }

  const app = new Hono();

  app.use('*', async (c, next) => {
    await next();
    // Image URLs in rendered files are relative to wherever this addon is served from.
    if (/json/.test(c.res.headers.get('content-type') ?? '')) {
      const body = await c.res.text();
      c.res = new Response(withOrigin(body, new URL(c.req.url).origin), c.res);
    }
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Headers', '*');
  });

  const file =
    (path: string, cacheControl: string, type = 'application/json; charset=utf-8') =>
    async (c: import('hono').Context) => {
      const text = await reader.read(path);
      if (text === undefined) return c.json({ error: 'not found' }, 404);
      return c.body(text, 200, { 'content-type': type, 'cache-control': cacheControl });
    };

  app.get('/', (c) => c.redirect('/manifest.json'));
  app.get('/manifest.json', file(sitePaths.manifest, CACHE.manifest));
  app.get('/status', file(sitePaths.statusPage, CACHE.none, 'text/html; charset=utf-8'));
  app.get('/status.json', file(sitePaths.status, CACHE.none));
  app.get('/registry.json', file(sitePaths.registry, CACHE.list));
  app.get('/freshness.json', file(sitePaths.freshness, CACHE.none));

  // /catalog/:type/:id.json and /catalog/:type/:id/:extra.json
  app.get('/catalog/:type/*', async (c) => {
    const type = c.req.param('type');
    const rest = decodeURIComponent(c.req.path.slice(`/catalog/${type}/`.length)).replace(/\.json$/, '');
    const [id = '', extraRaw = ''] = rest.split('/');
    const extra = new URLSearchParams(extraRaw);
    const search = extra.get('search')?.trim();
    const skip = Math.max(0, Number(extra.get('skip') ?? 0) || 0);
    const headers = { 'cache-control': CACHE.list };
    if (search) {
      const index = (await readJson<SearchRow[]>(sitePaths.search, true)) ?? [];
      const q = normalizeForSearch(search);
      const hits: SearchRow[] = [];
      if (q) {
        for (const row of index) {
          if (row[2] === id && row[4].includes(q)) {
            hits.push(row);
            if (hits.length >= MAX_SEARCH) break;
          }
        }
      }
      return c.json(
        {
          metas: hits.map(([hid, htype, , name, , poster]) => ({
            id: hid,
            type: htype,
            name,
            ...(poster ? { poster } : {}),
            posterShape: htype === 'tv' ? 'square' : 'landscape',
          })),
        },
        200,
        headers,
      );
    }
    const page = await reader.read(sitePaths.catalog(type, id, skip));
    // A row that has not been updated for too long says so first (works without the home machine).
    if (page && skip === 0) {
      const fresh = await readJson<Freshness>(sitePaths.freshness, true);
      const since = fresh ? staleSince(fresh, id) : undefined;
      if (since) {
        const list = JSON.parse(page) as { metas: unknown[] };
        return c.json({ metas: [staleItem(id, type, since), ...list.metas] }, 200, {
          'cache-control': CACHE.stream,
        });
      }
    }
    // Past the last page (or an unknown catalog): an empty list, which tells the app to stop paging.
    return c.body(page ?? '{"metas":[]}', 200, {
      ...headers,
      'content-type': 'application/json; charset=utf-8',
    });
  });

  app.get('/meta/:type/:file', async (c) => {
    const id = decodeURIComponent(c.req.param('file')).replace(/\.json$/, '');
    if (id.startsWith(STALE_ID_PREFIX)) {
      const fresh = await readJson<Freshness>(sitePaths.freshness, true);
      const catalog = id.slice(STALE_ID_PREFIX.length);
      const since = fresh ? staleSince(fresh, catalog) : undefined;
      return c.json(
        {
          meta: { ...staleItem(catalog, c.req.param('type'), since ?? new Date().toISOString()), videos: [] },
        },
        200,
        {
          'cache-control': CACHE.none,
        },
      );
    }
    const text = await reader.read(sitePaths.meta(c.req.param('type'), id));
    if (text === undefined) return c.json({ meta: null }, 404);
    return c.body(text, 200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': CACHE.list,
    });
  });

  app.get('/stream/:type/:file', async (c) => {
    const id = decodeURIComponent(c.req.param('file')).replace(/\.json$/, '');
    const streams = await streamsFor(id);
    return c.json({ streams }, 200, { 'cache-control': CACHE.stream });
  });

  async function seasonStreams(series: string, season: number, episode: number): Promise<Stream[]> {
    const file = await readJson<SeasonStreams>(sitePaths.seasonStreams(series, season));
    return file?.[String(episode)] ?? [];
  }

  async function streamsFor(id: string): Promise<Stream[]> {
    const ours = parseVideoId(id);
    if (ours) return seasonStreams(ours.series, ours.season, ours.episode);
    if (id.startsWith('iltv_live_')) {
      return (await readJson<{ streams: Stream[] }>(sitePaths.liveStreams(id)))?.streams ?? [];
    }
    // Shows opened from other catalogs: tt123:2:5 or tmdb:123:2:5, numbered seasons only.
    const m = /^(tt\d+|tmdb:\d+):(\d+):(\d+)$/.exec(id);
    if (!m?.[1]) return [];
    const ext = (await readJson<ExtIds>(sitePaths.extIds, true))?.[m[1]];
    const season = Number(m[2]);
    if (!ext?.seasons.includes(season)) return [];
    return seasonStreams(ext.id, season, Number(m[3]));
  }

  app.notFound((c) => c.json({ error: 'not found' }, 404));
  return app;
}
