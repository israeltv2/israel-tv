// Resolver wiring: home database (read-only) + geo adapter from the config.
import type { Config, ScrapedEpisode } from '@israel-tv/core';
import { createGeoFetch, proxyEndpoints } from '@israel-tv/net';
import { Store } from '@israel-tv/store';
import { createResolverApp, type ResolverDeps } from './app.ts';
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
    episode: episodeLookup(config.store.path),
    external: externalLookup(config.store.path),
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
      episode: episodeLookup(config.store.path),
      external: externalLookup(config.store.path),
      fetch: (url, init) => fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) }),
    },
  );
}
