// The remote resolver: Mako playback (mako-auth) reachable from outside the home through a tunnel, for viewers
// away from home. Deliberately narrow:
//
// - every path starts with a long secret token (compared in constant time); anything else is a bare 404;
// - only the Mako routes exist here: the manifest, Mako stream requests and the ~1 KB play playlists. No relay
//   (geo-relay is off: no video ever passes through the tunnel) and nothing of the admin page;
// - per-client limits (the tunnel passes the client's address; it is only hashed, never kept).
//
// It listens on its own port, on 127.0.0.1 by default, for the tunnel connector on the same machine.
import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { createResolverApp, type ResolverDeps } from './app.ts';

export interface RemoteOptions {
  /** The secret path token (at least 32 characters). */
  token: string;
  /** The public address the tunnel serves this at, e.g. https://example.net (the token is added to it). */
  publicUrl: string;
  /** Per client per minute: play starts (each fetches a Mako ticket), and all requests. */
  playsPerMinute: number;
  requestsPerMinute: number;
}

/** The only paths served (after the token). */
const ALLOWED = [
  /^\/manifest\.json$/,
  /^\/(logo\.png|background\.jpg)$/,
  /^\/stream\/(series|tv)\/(iltv_mako_|iltv_live_|tt\d|tmdb%3A|tmdb:)[^/]*\.json$/,
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
  deps: Omit<ResolverDeps, 'geoFetch' | 'publicBase' | 'manifest' | 'modules' | 'clientAddress'>,
  now: () => number = Date.now,
) {
  if (o.token.length < 32) throw new Error('the remote resolver token must be at least 32 characters');
  if (!/^[A-Za-z0-9_-]+$/.test(o.token))
    throw new Error(
      'the remote resolver token may only use letters, digits, - and _ (it is part of a URL path)',
    );
  const base = `${o.publicUrl.replace(/\/+$/, '')}/${o.token}`;
  const clientOf = (headers: Headers) => headers.get('cf-connecting-ip') ?? 'unknown';
  const inner = createResolverApp({
    ...deps,
    modules: { makoAuth: true, geoRelay: false },
    publicBase: () => base,
    clientAddress: (c) => clientOf(c.req.raw.headers),
    manifest: {
      id: 'community.israel-tv.resolver.remote',
      name: 'Israel TV · Mako (away from home)',
      description: 'Plays Mako (Keshet 12) episodes and live channels from anywhere, through your home.',
      idPrefixes: ['iltv_mako_', 'iltv_live_', 'tt', 'tmdb:'],
    },
  });
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
