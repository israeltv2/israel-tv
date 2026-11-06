// Resolver wiring: home database (read-only) + geo adapter from the config.
import type { Config, ScrapedEpisode } from '@israel-tv/core';
import { createGeoFetch, proxyEndpoints } from '@israel-tv/net';
import { Store } from '@israel-tv/store';
import { createResolverApp } from './app.ts';

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
  env: NodeJS.ProcessEnv = process.env,
  log: (l: string) => void = console.log,
) {
  const proxies = proxyEndpoints(config.geo, env);
  return createResolverApp({
    log,
    episode: episodeLookup(config.store.path),
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }),
    ...(proxies.length > 0 ? { geoFetch: createGeoFetch(proxies) } : {}),
  });
}
