// Abuse protection for the public addon: per-client limits on the requests that cost work (search and
// streams), sized for a family with several devices behind one home address. Uses Cloudflare's rate-limiting
// binding when the Worker has it; otherwise a simple in-memory window per Worker instance (weaker: each
// instance counts on its own, but it still stops a single runaway client).

export interface RateLimiter {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}

export type LimitKind = 'stream' | 'search';

/** Requests per minute per client. */
export const LIMITS: Record<LimitKind, number> = { stream: 120, search: 60 };

/** Which limit a request falls under, if any. */
export function limitKind(url: URL): LimitKind | undefined {
  if (url.pathname.startsWith('/stream/')) return 'stream';
  if (url.pathname.startsWith('/catalog/') && url.pathname.includes('search=')) return 'search';
  return undefined;
}

/** The in-memory fallback: a fixed one-minute window per key. */
export function memoryLimiter(perMinute: number, now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, { start: number; n: number }>();
  return {
    async limit({ key }) {
      const t = now();
      let w = windows.get(key);
      if (!w || t - w.start >= 60_000) {
        w = { start: t, n: 0 };
        windows.set(key, w);
        if (windows.size > 10_000) windows.delete(windows.keys().next().value as string);
      }
      w.n++;
      return { success: w.n <= perMinute };
    },
  };
}

/** The answer when a client is over its limit. */
export function tooMany(kind: LimitKind): Response {
  return Response.json(
    {
      error: `Too many ${kind === 'stream' ? 'stream' : 'search'} requests from your network (more than ${LIMITS[kind]} a minute). Wait a minute and try again.`,
      streams: [],
      metas: [],
    },
    { status: 429, headers: { 'retry-after': '60', 'cache-control': 'no-store' } },
  );
}
