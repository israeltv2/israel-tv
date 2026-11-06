// Resolver wiring: episode details (the home database on a full host, or a published catalog for a resolver that
// runs on its own) + geo adapter from the config.
import { type Config, roleOf, type ScrapedEpisode, type SeasonPlay, sitePaths } from '@israel-tv/core';
import { createGeoFetch, proxyEndpoints } from '@israel-tv/net';
import { Store } from '@israel-tv/store';
import { createResolverApp, type ExternalHit, type ResolverDeps } from './app.ts';
import { brandImage } from './branding.ts';
import { createRemoteResolverApp } from './remote.ts';

export function episodeLookup(storePath: string) {
  let store: Store | undefined;
  // Parsed episodes per show, reused until the show's data changes (Stremio asks for every episode opened).
  const cache = new Map<string, { stamp: string; byKey: Map<string, ScrapedEpisode> }>();
  return (series: string, season: number, episode: number): ScrapedEpisode | undefined => {
    store ??= Store.openReadOnly(storePath);
    const key = store.episodeKey(series, season, episode);
    if (!key) return undefined;
    const stamp = store.showStamp(series);
    if (!stamp) return undefined;
    let hit = cache.get(series);
    if (hit?.stamp !== stamp) {
      const byKey = new Map<string, ScrapedEpisode>();
      for (const s of store.getShow(series)?.show.seasons ?? [])
        for (const e of s.episodes) byKey.set(e.key, e);
      hit = { stamp, byKey };
      cache.set(series, hit);
      if (cache.size > 200) cache.delete(cache.keys().next().value as string);
    }
    return hit.byKey.get(key);
  };
}

export function resolverApp(
  config: Config,
  opts: Pick<ResolverDeps, 'log' | 'onRelay' | 'onEvent' | 'sessions' | 'salt' | 'clientAddress'> & {
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  const { env = process.env, ...extra } = opts;
  const proxies = proxyEndpoints(config.geo, env);
  const logo = brandImage(config.branding.dir, 'resolver-logo');
  const background = brandImage(config.branding.dir, 'background');
  return createResolverApp({
    ...extra,
    modules: { makoAuth: config.resolver.makoAuth.enabled, geoRelay: config.resolver.geoRelay.enabled },
    branding: { ...(logo ? { logo } : {}), ...(background ? { background } : {}) },
    ...lookups(config),
    fetch: (url, init) => fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) }),
    ...(proxies.length > 0 ? { geoFetch: createGeoFetch(proxies) } : {}),
  });
}

export function externalLookup(storePath: string) {
  let store: Store | undefined;
  return (id: string) => {
    store ??= Store.openReadOnly(storePath);
    return store.externalSeries(id);
  };
}

/** The remote (Mako-only) resolver for the tunnel, or a reason it cannot run. */
export function remoteResolverApp(
  config: Config,
  opts: Pick<ResolverDeps, 'log' | 'onEvent' | 'sessions' | 'salt'> & { env?: NodeJS.ProcessEnv } = {},
): ReturnType<typeof createRemoteResolverApp> | { error: string } {
  const r = config.resolver.remote;
  const { env = process.env, ...extra } = opts;
  const token = env[r.tokenEnv];
  if (!r.publicUrl) return { error: 'resolver.remote.publicUrl is not set' };
  if (!token || token.length < 32)
    return { error: `${r.tokenEnv} must be set in .env (32 characters or more)` };
  if (!/^[A-Za-z0-9_-]+$/.test(token))
    return {
      error: `${r.tokenEnv} may only use letters, digits, - and _ (make one with: openssl rand -hex 32)`,
    };
  const logo = brandImage(config.branding.dir, 'resolver-logo');
  const background = brandImage(config.branding.dir, 'background');
  return createRemoteResolverApp(
    {
      token,
      publicUrl: r.publicUrl,
      playsPerMinute: r.playsPerMinute,
      requestsPerMinute: r.requestsPerMinute,
    },
    {
      ...extra,
      branding: { ...(logo ? { logo } : {}), ...(background ? { background } : {}) },
      ...lookups(config),
      fetch: (url, init) => fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) }),
    },
  );
}

/**
 * Episode details from a published Israel TV catalog instead of the home database (for a resolver that runs
 * without ingest): the per-season play files and the external-id map, fetched and kept a while.
 */
export function catalogLookup(catalogUrl: string, fetchImpl: typeof fetch = fetch) {
  const base = catalogUrl.replace(/\/+$/, '').replace(/\/manifest\.json$/, '');
  const seasons = new Map<string, { at: number; data: Promise<SeasonPlay> }>();
  let ext: { at: number; data: Promise<Record<string, { id: string; seasons: number[] }>> } | undefined;
  const getJson = async <T>(path: string, empty: T): Promise<T> => {
    try {
      const r = await fetchImpl(`${base}/${path}`, { signal: AbortSignal.timeout(15_000) });
      return r.ok ? ((await r.json()) as T) : empty;
    } catch {
      return empty;
    }
  };
  const SEASON_TTL = 10 * 60_000;
  return {
    async episode(series: string, season: number, episode: number): Promise<ScrapedEpisode | undefined> {
      const key = `${series}/${season}`;
      let hit = seasons.get(key);
      if (!hit || Date.now() - hit.at > SEASON_TTL) {
        hit = { at: Date.now(), data: getJson<SeasonPlay>(sitePaths.seasonPlay(series, season), {}) };
        seasons.set(key, hit);
        if (seasons.size > 500) seasons.delete(seasons.keys().next().value as string);
      }
      const p = (await hit.data)[String(episode)];
      if (!p) return undefined;
      return {
        key: `${series}:${season}:${episode}`,
        title: '',
        streams: p.direct ? [{ url: p.direct, kind: 'direct' }] : [],
        ...(p.mako ? { play: p.mako } : {}),
        ...(p.israelOnly ? { availableAbroad: false } : {}),
      };
    },
    async external(id: string): Promise<ExternalHit | undefined> {
      if (!ext || Date.now() - ext.at > 60 * 60_000)
        ext = { at: Date.now(), data: getJson(sitePaths.extIds, {}) };
      const hit = (await ext.data)[id];
      return hit ? { series: hit.id, seasons: hit.seasons } : undefined;
    },
  };
}

/** Where the resolver gets episode details: a published catalog (resolver-only role) or the home database. */
export function lookups(config: Config): Pick<ResolverDeps, 'episode' | 'external'> {
  if (roleOf(config) === 'resolver-only') {
    if (!config.resolver.catalogUrl)
      throw new Error('resolver.catalogUrl is needed for the resolver-only role');
    const c = catalogLookup(config.resolver.catalogUrl);
    return { episode: c.episode, external: c.external };
  }
  return { episode: episodeLookup(config.store.path), external: externalLookup(config.store.path) };
}

/**
 * Whether a published catalog can serve a resolver: its manifest answers, and one show's play file exists (a
 * catalog published before play files existed cannot). Returns the problem, or undefined when it is fine.
 */
export async function checkCatalog(
  catalogUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const base = catalogUrl.replace(/\/+$/, '').replace(/\/manifest\.json$/, '');
  const get = async (path: string) => {
    try {
      const r = await fetchImpl(`${base}/${path}`, { signal: AbortSignal.timeout(15_000) });
      return r.ok ? ((await r.json()) as unknown) : undefined;
    } catch {
      return undefined;
    }
  };
  const manifest = (await get('manifest.json')) as { catalogs?: { id: string; type: string }[] } | undefined;
  if (!manifest?.catalogs)
    return `no Israel TV manifest at ${base}/manifest.json (check resolver.catalogUrl)`;
  for (const c of manifest.catalogs.filter((x) => x.type === 'series')) {
    const row = (await get(`catalog/series/${c.id}.json`)) as { metas?: { id: string }[] } | undefined;
    const id = row?.metas?.find((m) => /^iltv_(mako|reshet|kan)_\d+$/.test(m.id))?.id;
    if (!id) continue;
    const meta = (await get(`meta/series/${id}.json`)) as
      | { meta?: { videos?: { season: number }[] } }
      | undefined;
    const season = meta?.meta?.videos?.[0]?.season;
    if (season === undefined) continue;
    return (await get(sitePaths.seasonPlay(id, season)))
      ? undefined
      : `the catalog at ${base} has no play files (its host runs an older Israel TV): Mako and relayed plays will not be offered until it updates`;
  }
  return `the catalog at ${base} lists no shows to check`;
}
