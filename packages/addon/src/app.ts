// The public addon as a Hono app over the rendered site files. Used by both publishers:
// Cloudflare (static assets answer plain file paths first; this app handles the rest) and local (Node).
import {
  CATALOG_PAGE_SIZE,
  type ExtIds,
  expandSearchKey,
  type Freshness,
  normalizeForSearch,
  parseVideoId,
  type SearchRow,
  type SeasonStreams,
  STALE_ID_PREFIX,
  type Stream,
  searchMatches,
  sitePaths,
  staleItem,
  staleSince,
  withOrigin,
} from '@israel-tv/core/edge';
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

/** Shows per page of a genre filter. */
const GENRE_PAGE = 100;
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

  // The addon is read-only.
  app.use('*', async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
    return c.text('Israel TV is read-only: use GET or HEAD.\n', 405, { allow: 'GET, HEAD' });
  });

  const file =
    (path: string, cacheControl: string, type = 'application/json; charset=utf-8') =>
    async (c: import('hono').Context) => {
      const text = await reader.read(path);
      if (text === undefined) return c.json({ error: 'not found' }, 404);
      return c.body(text, 200, { 'content-type': type, 'cache-control': cacheControl });
    };

  // A short page for people who open the address in a browser (rendered with the site); the manifest otherwise.
  app.get('/', async (c) => {
    const page = await reader.read(sitePaths.landing);
    return page === undefined
      ? c.redirect('/manifest.json')
      : c.body(page, 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': CACHE.list });
  });
  app.get('/manifest.json', file(sitePaths.manifest, CACHE.manifest));
  app.get('/status', file(sitePaths.statusPage, CACHE.none, 'text/html; charset=utf-8'));
  app.get('/status.json', file(sitePaths.status, CACHE.none));
  app.get('/registry.json', file(sitePaths.registry, CACHE.list));
  app.get('/freshness.json', file(sitePaths.freshness, CACHE.none));
  // The catalog ↔ resolver contract (docs/contract.md): what a resolver pointed at this catalog reads.
  app.get(`/${sitePaths.contract}`, file(sitePaths.contract, CACHE.list));
  app.get(`/${sitePaths.extIds}`, file(sitePaths.extIds, CACHE.list));
  app.get('/play/:series/:file', async (c) => {
    const series = c.req.param('series');
    const m = /^(\d+)\.json$/.exec(c.req.param('file'));
    if (!m || !/^iltv_[a-z0-9]+_\d+$/.test(series)) return c.json({ error: 'not found' }, 404);
    return file(sitePaths.seasonPlay(series, Number(m[1])), CACHE.list)(c);
  });

  // /catalog/:type/:id.json and /catalog/:type/:id/:extra.json
  app.get('/catalog/:type/*', async (c) => {
    const type = c.req.param('type');
    const rest = decodeURIComponent(c.req.path.slice(`/catalog/${type}/`.length)).replace(/\.json$/, '');
    const [id = '', extraRaw = ''] = rest.split('/');
    const extra = new URLSearchParams(extraRaw);
    const search = extra.get('search')?.trim();
    const genre = extra.get('genre')?.trim();
    const skip = Math.max(0, Number(extra.get('skip') ?? 0) || 0);
    const headers = { 'cache-control': CACHE.list };
    const asPreview = ([hid, htype, , name, , poster, genres]: SearchRow) => ({
      id: hid,
      type: htype,
      name,
      ...(poster ? { poster } : {}),
      posterShape: htype === 'tv' ? 'square' : 'poster',
      ...(genres?.length ? { genres } : {}),
    });
    // A genre filter: the row's shows of that genre, in the row's order, a page at a time.
    if (genre && !search) {
      const index = (await readJson<SearchRow[]>(sitePaths.search, true)) ?? [];
      const hits = index.filter((row) => row[2] === id && row[6]?.includes(genre));
      return c.json({ metas: hits.slice(skip, skip + GENRE_PAGE).map(asPreview) }, 200, headers);
    }
    if (search) {
      const index = await searchIndex();
      const q = normalizeForSearch(search);
      const hits: SearchRow[] = [];
      const later: SearchRow[] = [];
      if (q) {
        for (const [row, key] of index) {
          if (row[2] !== id || (genre && !row[6]?.includes(genre))) continue;
          // Whole words from their start; matches only through a Hebrew prefix letter come last (hebrew.ts).
          const how = searchMatches(key, q);
          if (how === 1) hits.push(row);
          else if (how === 2) later.push(row);
          if (hits.length >= MAX_SEARCH) break;
        }
      }
      hits.push(...later.slice(0, MAX_SEARCH - hits.length));
      return c.json({ metas: hits.map(asPreview) }, 200, headers);
    }
    // Pages are stored every CATALOG_PAGE_SIZE items; any other offset is cut from the two pages around it.
    const offset = skip % CATALOG_PAGE_SIZE;
    if (offset > 0) {
      const base = skip - offset;
      const read = async (at: number) =>
        ((await readJson<{ metas: unknown[] }>(sitePaths.catalog(type, id, at)))?.metas ?? []) as unknown[];
      const metas = [...(await read(base)), ...(await read(base + CATALOG_PAGE_SIZE))].slice(
        offset,
        offset + CATALOG_PAGE_SIZE,
      );
      return c.json({ metas }, 200, headers);
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
    // Only the types the manifest declares: live channels are `tv`, everything else `series`.
    const type = c.req.param('type');
    const live = id.startsWith('iltv_live_');
    if (type !== (live ? 'tv' : 'series'))
      return c.json({ streams: [] }, 200, { 'cache-control': CACHE.list });
    const streams = await streamsFor(id);
    return c.json({ streams }, 200, { 'cache-control': CACHE.stream });
  });

  /** The search index with each row's key expanded for Hebrew prefixes, built once per index read. */
  let expanded: { from: SearchRow[]; rows: [SearchRow, string][] } | undefined;
  async function searchIndex(): Promise<[SearchRow, string][]> {
    const index = (await readJson<SearchRow[]>(sitePaths.search, true)) ?? [];
    if (expanded?.from !== index)
      expanded = { from: index, rows: index.map((r) => [r, expandSearchKey(r[4])]) };
    return expanded.rows;
  }

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
