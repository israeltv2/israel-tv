// The helper's tunnel door: the helper reachable from anywhere through a tunnel, so that one installed link works
// both at home and away. Deliberately narrow:
//
// - every path starts with a long secret token (compared in constant time); anything else is a bare 404;
// - only the manifest, stream requests and Mako's ~1 KB play playlists exist here. No relay route (no video ever
//   passes through the tunnel) and nothing of the admin page;
// - a request from the home network's own public address (`home`) is answered like the home-network door would:
//   relayed Reshet/Kan streams included where they are refused, but pointing at the helper's home-network address,
//   so their video stays on the home network. Away, those streams are left out (Mako still plays);
// - per-client limits (the tunnel passes the client's address; it is only hashed, never kept or logged).
//
// It listens on its own port, on 127.0.0.1 by default, for the tunnel connector on the same machine.
import { timingSafeEqual } from 'node:crypto';
import { REMOTE_RESOLVER_ADDON_ID } from '@israel-tv/core';
import type { GeoFetch } from '@israel-tv/net';
import { Hono } from 'hono';
import { createResolverApp, HELPER_NAME, type ResolverDeps } from './app.ts';

export interface RemoteOptions {
  /** The secret path token (at least 32 characters). */
  token: string;
  /** The public address the tunnel serves this at, e.g. https://example.net (the token is added to it). */
  publicUrl: string;
  /** Per client per minute: play starts (each fetches a Mako ticket), and all requests. */
  playsPerMinute: number;
  requestsPerMinute: number;
  /**
   * Relayed streams for requests from home: whether a client address is the home network's, and the helper's
   * address on the home network (its relay route answers there). Without it this door offers Mako only. The
   * relay URLs are signed, so `deps.secret` must be the home-network door's.
   */
  home?: { isHome(address: string): Promise<boolean>; lanUrl: string };
}

/**
 * The relay module needs a geo fetch to exist, but this door never mounts the relay route, so nothing may ever go
 * through it here.
 */
const noRelayHere: GeoFetch = async () => {
  throw new Error('no relay through the tunnel door');
};

/** The only paths served (after the token); Reshet and Kan stream requests only with `home`. */
const allowedPaths = (home: boolean) => [
  /^\/manifest\.json$/,
  /^\/(logo\.png|background\.jpg)$/,
  home
    ? /^\/stream\/(series|tv)\/(iltv_mako_|iltv_reshet_|iltv_kan_|iltv_live_|tt\d|tmdb%3A|tmdb:)[^/]*\.json$/
    : /^\/stream\/(series|tv)\/(iltv_mako_|iltv_live_|tt\d|tmdb%3A|tmdb:)[^/]*\.json$/,
  /^\/play\/mako\/[^/]+\.m3u8$/,
  /^\/play\/mako-live\/iltv_live_[a-z0-9_]+\/\d+\.m3u8$/,
];

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A fixed one-minute window per key. */
function windowLimiter(perMinute: number, now: () => number) {
  const windows = new Map<string, { start: number; n: number }>();
  return (key: string): boolean => {
    const t = now();
    let w = windows.get(key);
    if (!w || t - w.start >= 60_000) {
      w = { start: t, n: 0 };
      windows.set(key, w);
      if (windows.size > 10_000) windows.delete(windows.keys().next().value as string);
    }
    return ++w.n <= perMinute;
  };
}

export function createRemoteResolverApp(
  o: RemoteOptions,
  deps: Omit<
    ResolverDeps,
    | 'geoFetch'
    | 'publicBase'
    | 'manifest'
    | 'modules'
    | 'clientAddress'
    | 'relayBase'
    | 'serveRelay'
    | 'onRelay'
  >,
  now: () => number = Date.now,
) {
  if (o.token.length < 32) throw new Error('the remote resolver token must be at least 32 characters');
  if (!/^[A-Za-z0-9_-]+$/.test(o.token))
    throw new Error(
      'the remote resolver token may only use letters, digits, - and _ (it is part of a URL path)',
    );
  const base = `${o.publicUrl.replace(/\/+$/, '')}/${o.token}`;
  const clientOf = (headers: Headers) => headers.get('cf-connecting-ip') ?? 'unknown';
  const home = o.home;
  const lanBase = home?.lanUrl.replace(/\/+$/, '');
  const inner = createResolverApp({
    ...deps,
    modules: { makoAuth: true, geoRelay: !!home },
    ...(home ? { geoFetch: noRelayHere } : {}),
    serveRelay: false,
    publicBase: () => base,
    relayBase: async (c) => (home && (await home.isHome(clientOf(c.req.raw.headers))) ? lanBase : undefined),
    clientAddress: (c) => clientOf(c.req.raw.headers),
    manifest: {
      id: REMOTE_RESOLVER_ADDON_ID,
      name: HELPER_NAME,
      description: home
        ? 'Plays Keshet 12 and live channels anywhere, through your home; at home also Reshet and Kan where they are refused.'
        : 'Plays Keshet 12 and live channels anywhere, through your home.',
      idPrefixes: home
        ? ['iltv_mako_', 'iltv_reshet_', 'iltv_kan_', 'iltv_live_', 'tt', 'tmdb:']
        : ['iltv_mako_', 'iltv_live_', 'tt', 'tmdb:'],
    },
  });
  const ALLOWED = allowedPaths(!!home);
  const plays = windowLimiter(o.playsPerMinute, now);
  const requests = windowLimiter(o.requestsPerMinute, now);
  const app = new Hono();
  app.all('*', async (c) => {
    const url = new URL(c.req.url);
    const slash = url.pathname.indexOf('/', 1);
    const first = slash > 0 ? url.pathname.slice(1, slash) : url.pathname.slice(1);
    // No detail for anything that is not exactly an allowed path under the token.
    if (!sameSecret(first, o.token) || c.req.method !== 'GET') return c.body(null, 404);
    const path = url.pathname.slice(slash);
    if (slash < 0 || !ALLOWED.some((re) => re.test(path))) return c.body(null, 404);
    const client = clientOf(c.req.raw.headers);
    if (!requests(client) || (path.startsWith('/play/') && !plays(client)))
      return c.text('Too many requests; try again in a minute.', 429, { 'retry-after': '60' });
    const forwarded = new Request(`http://resolver${path}${url.search}`, c.req.raw);
    return inner.fetch(forwarded, c.env);
  });
  return app;
}
