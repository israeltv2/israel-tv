// Resolver wiring: home database (read-only) + geo adapter from the config.
import { serve } from '@hono/node-server';
import type { Config, ScrapedEpisode } from '@israel-tv/core';
import { createGeoFetch, proxyEndpoints } from '@israel-tv/net';
import { Store } from '@israel-tv/store';
import { createResolverApp } from './app.ts';

export function episodeLookup(storePath: string) {
  let store: Store | undefined;
  return (series: string, season: number, episode: number): ScrapedEpisode | undefined => {
    store ??= Store.openReadOnly(storePath);
    const key = store.episodeKey(series, season, episode);
    if (!key) return undefined;
    const show = store.getShow(series)?.show;
    for (const s of show?.seasons ?? []) for (const e of s.episodes) if (e.key === key) return e;
    return undefined;
  };
}

export function startResolver(config: Config, env: NodeJS.ProcessEnv = process.env) {
  const proxies = proxyEndpoints(config.geo, env);
  const app = createResolverApp({
    episode: episodeLookup(config.store.path),
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }),
    ...(proxies.length > 0 ? { geoFetch: createGeoFetch(proxies) } : {}),
  });
  return serve({ fetch: app.fetch, hostname: config.resolver.host, port: config.resolver.port });
}
