// Resolver wiring: episode details (the home database on a full host, or a published catalog for a resolver that
// runs on its own) + geo adapter from the config.

import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Config,
  type Contract,
  ContractSchema,
  ExtIdsSchema,
  RESOLVER_CONTRACT_VERSION,
  roleOf,
  type ScrapedEpisode,
  type SeasonPlay,
  SeasonPlaySchema,
  sitePaths,
} from '@israel-tv/core';
import { safeSitePath } from '@israel-tv/core/router-contract';
import { createGeoFetch, proxyEndpoints } from '@israel-tv/net';
import type { z } from 'zod';
import { createResolverApp, type ExternalHit, type ResolverDeps } from './app.ts';
import { brandImage } from './branding.ts';
import { homeAddress } from './home-address.ts';
import { createRemoteResolverApp } from './remote.ts';

export function resolverApp(
  config: Config,
  opts: Pick<
    ResolverDeps,
    'log' | 'onRelay' | 'onEvent' | 'sessions' | 'salt' | 'clientAddress' | 'secret'
  > & {
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
    ...lookups(config, extra.log?.('resolver')),
    fetch: (url, init) => fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) }),
    ...(proxies.length > 0 ? { geoFetch: createGeoFetch(proxies) } : {}),
  });
}

/** Why the tunnel door offers no relayed streams at home, or undefined when it does. */
export function homeRelayProblem(config: Config, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!config.resolver.remote.home.lanUrl)
    return 'resolver.remote.home.lanUrl is not set: the tunnel link plays Mako and live channels only';
  if (!config.resolver.enabled) return 'the home-network helper (resolver.enabled) is off';
  if (!config.resolver.geoRelay.enabled) return 'resolver.geoRelay is off';
  if (proxyEndpoints(config.geo, env).length === 0) return 'no geo proxy is configured';
  return undefined;
}

/**
 * The helper's tunnel door, or a reason it cannot run. Pass the home-network door's relay `secret` so the relayed
 * streams it offers at home play there.
 */
export function remoteResolverApp(
  config: Config,
  opts: Pick<ResolverDeps, 'log' | 'onEvent' | 'sessions' | 'salt' | 'secret'> & {
    env?: NodeJS.ProcessEnv;
  } = {},
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
  const log = extra.log?.('resolver');
  const problem = homeRelayProblem(config, env);
  let home: { isHome(address: string): Promise<boolean>; lanUrl: string } | undefined;
  if (problem) log?.(`tunnel door: no relayed streams at home (${problem})`);
  else if (r.home.lanUrl && extra.secret) {
    const h = homeAddress({
      fetch: (url, init) => fetch(url, init),
      urls: r.home.addressUrls,
      refreshMs: r.home.refreshMinutes * 60_000,
      salt: extra.salt ?? randomBytes(16).toString('hex'),
      ...(log ? { log } : {}),
    });
    void h.refresh();
    home = { isHome: h.isHome, lanUrl: r.home.lanUrl };
  } else log?.('tunnel door: no relayed streams at home (no shared relay secret was passed)');
  return createRemoteResolverApp(
    {
      token,
      publicUrl: r.publicUrl,
      playsPerMinute: r.playsPerMinute,
      requestsPerMinute: r.requestsPerMinute,
      ...(home ? { home } : {}),
    },
    {
      ...extra,
      branding: { ...(logo ? { logo } : {}), ...(background ? { background } : {}) },
      ...lookups(config, extra.log?.('resolver')),
      fetch: (url, init) => fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) }),
    },
  );
}

/**
 * Episode details from a published Israel TV catalog instead of the home database (for a resolver that runs
 * without ingest): the per-season play files and the external-id map, fetched and kept a while.
 */
export function catalogLookup(
  catalogUrl: string,
  fetchImpl: typeof fetch = fetch,
  log: (msg: string, fields?: Record<string, unknown>) => void = () => {},
  now: () => number = Date.now,
) {
  const base = catalogUrl.replace(/\/+$/, '').replace(/\/manifest\.json$/, '');
  /** A file as fetched: its data, or `missing` (404: nothing there), kept a while; failures are not kept. */
  type Got<T> = { at: number; data: T };
  const seasons = new Map<string, Got<SeasonPlay>>();
  let ext: Got<Record<string, { id: string; seasons: number[] }>> | undefined;
  /**
   * The file's content, checked against the contract's schema; `empty` when it does not exist (or does not fit
   * the contract: that is logged); undefined when the catalog could not be reached.
   */
  const getJson = async <T>(path: string, empty: T, schema: z.ZodType<T>): Promise<T | undefined> => {
    try {
      const r = await fetchImpl(`${base}/${path}`, { signal: AbortSignal.timeout(15_000) });
      if (r.status === 404) return empty;
      if (!r.ok) {
        log('catalog fetch failed', { path, status: r.status });
        return undefined;
      }
      // A catalog file is small (a season's play ids, the external-id map): anything huge is refused unread.
      const declared = Number(r.headers.get('content-length') ?? 0);
      const text = declared > MAX_CATALOG_FILE ? '' : await r.text();
      if (declared > MAX_CATALOG_FILE || text.length > MAX_CATALOG_FILE) {
        await r.body?.cancel().catch(() => {});
        log('catalog file too large; ignored', { path });
        return empty;
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        log('catalog file does not match the resolver contract', {
          path,
          problem: parsed.error.issues[0]?.message,
        });
        return empty;
      }
      return parsed.data;
    } catch (err) {
      log('catalog fetch failed', { path, error: (err as Error).message });
      return undefined;
    }
  };
  /** The catalog's contract version, checked once an hour; nothing is offered from a version not understood. */
  let contract: { at: number; ok: boolean } | undefined;
  async function contractOk(): Promise<boolean> {
    if (contract && now() - contract.at < 60 * 60_000) return contract.ok;
    const c = await getJson<Contract | null>(sitePaths.contract, null, ContractSchema.nullable());
    if (c === undefined) return contract?.ok ?? true; // unreachable now: keep the last answer
    const problem = contractProblem(c ?? undefined);
    if (problem && contract?.ok !== false) log(`catalog refused: ${problem}`);
    contract = { at: now(), ok: !problem };
    return contract.ok;
  }
  const SEASON_TTL = 10 * 60_000;
  /** A file kept longer than this is fetched again when it lacks what was asked (e.g. a just-published episode). */
  const RECHECK_MS = 60_000;
  async function season(series: string, n: number, wanted: string): Promise<SeasonPlay | undefined> {
    const key = `${series}/${n}`;
    const hit = seasons.get(key);
    const fresh = hit && now() - hit.at <= SEASON_TTL;
    if (fresh && (hit.data[wanted] || now() - hit.at <= RECHECK_MS)) return hit.data;
    const data = await getJson<SeasonPlay>(sitePaths.seasonPlay(series, n), {}, SeasonPlaySchema);
    if (data === undefined) return hit?.data; // unreachable now: keep using what we had, if anything
    seasons.set(key, { at: now(), data });
    if (seasons.size > 500) seasons.delete(seasons.keys().next().value as string);
    return data;
  }
  return {
    async episode(series: string, n: number, episode: number): Promise<ScrapedEpisode | undefined> {
      if (!(await contractOk())) return undefined;
      const p = (await season(series, n, String(episode)))?.[String(episode)];
      if (!p) return undefined;
      return {
        key: `${series}:${n}:${episode}`,
        title: '',
        streams: p.direct ? [{ url: p.direct, kind: 'direct' }] : [],
        ...(p.mako
          ? {
              play: {
                vcmid: p.mako.vcmid,
                channelId: p.mako.channelId,
                ...(p.mako.galleryChannelId ? { galleryChannelId: p.mako.galleryChannelId } : {}),
              },
            }
          : {}),
        ...(p.israelOnly ? { availableAbroad: false } : {}),
      };
    },
    async external(id: string): Promise<ExternalHit | undefined> {
      if (!(await contractOk())) return undefined;
      const stale = !ext || now() - ext.at > 60 * 60_000 || (!ext.data[id] && now() - ext.at > RECHECK_MS);
      if (stale) {
        const data = await getJson(sitePaths.extIds, {}, ExtIdsSchema);
        if (data !== undefined) ext = { at: now(), data };
      }
      const hit = ext?.data[id];
      return hit ? { series: hit.id, seasons: hit.seasons } : undefined;
    },
  };
}

/** The local publish folder as a catalog the resolver reads over a fetch-like call. */
const LOCAL_SITE = 'http://local-site';

/** Reads files from the publish folder (only safe site paths), answering like a catalog server. */
export function localSiteFetch(dir: string): typeof fetch {
  return (async (input: string | URL | Request) => {
    const path = decodeURIComponent(
      new URL(String(input instanceof Request ? input.url : input)).pathname.slice(1),
    );
    if (!safeSitePath(path)) return new Response('', { status: 404 });
    try {
      return new Response(await readFile(join(dir, path)), {
        headers: { 'content-type': 'application/json' },
      });
    } catch {
      return new Response('', { status: 404 });
    }
  }) as typeof fetch;
}

/** Where the resolver gets episode details: the catalog's published contract files (see docs/contract.md). */
export function lookups(
  config: Config,
  log?: (msg: string, fields?: Record<string, unknown>) => void,
): Pick<ResolverDeps, 'episode' | 'external'> {
  if (roleOf(config) === 'resolver-only') {
    if (!config.resolver.catalogUrl)
      throw new Error('resolver.catalogUrl is needed for the resolver-only role');
    const c = catalogLookup(config.resolver.catalogUrl, fetch, log);
    return { episode: c.episode, external: c.external };
  }
  // A full instance reads the same contract files from its own publish folder, written before each deploy: the
  // resolver never opens the catalog database.
  const c = catalogLookup(LOCAL_SITE, localSiteFetch(config.publisher.dir), log);
  return { episode: c.episode, external: c.external };
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
  const parsed = ContractSchema.safeParse(await get(sitePaths.contract));
  const problem = contractProblem(parsed.success ? parsed.data : undefined);
  if (problem) return problem;
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

/** The largest catalog file a resolver reads (bytes). */
const MAX_CATALOG_FILE = 8 * 1024 * 1024;

/** Why a catalog's contract cannot be used by this resolver, or undefined when it can. */
export function contractProblem(c: Contract | undefined): string | undefined {
  if (!c)
    return 'the catalog publishes no resolver contract (resolver-contract.json): its host runs an Israel TV older than this resolver; Mako and relayed plays are off until it updates';
  if (c.version !== RESOLVER_CONTRACT_VERSION)
    return `the catalog speaks resolver contract version ${c.version}, this resolver understands version ${RESOLVER_CONTRACT_VERSION}: update ${c.version > RESOLVER_CONTRACT_VERSION ? 'this resolver' : 'the catalog'} (Mako and relayed plays are off until then)`;
  return undefined;
}
