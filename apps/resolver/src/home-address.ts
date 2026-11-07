// The home network's own public address, learned by asking a trace endpoint (Cloudflare's /cdn-cgi/trace answers
// `ip=<the address it sees>`). The helper's tunnel door uses it to tell a request from home (the tunnel passes the
// client's address) from one away. The address itself is never logged: only a salted hash of it.
import { clientHash } from '@israel-tv/core';
import type { Fetch, Log } from './context.ts';

export interface HomeAddressOptions {
  fetch: Fetch;
  /** Trace endpoints (one for IPv4, one for IPv6); each answers a line `ip=…`. */
  urls: readonly string[];
  /** Asked again after this long (default 10 minutes). */
  refreshMs?: number;
  /** A request from another address asks again at most this often (the home address may have just changed). */
  recheckMs?: number;
  /** Salt for the hash that is logged instead of the address. */
  salt: string;
  log?: Log;
  now?: () => number;
}

/** IPv4 as is; IPv6 cut to its /64 network (devices at home each pick their own address inside it). */
export function networkOf(address: string): string | undefined {
  const a = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped?.[1]) return mapped[1];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) return a;
  if (!a.includes(':') || !/^[0-9a-f:]+$/.test(a)) return undefined;
  const [head = '', tail, extra] = a.split('::');
  if (extra !== undefined) return undefined;
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups =
    tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  if (groups.length !== 8 || groups.some((g) => g.length === 0 || g.length > 4)) return undefined;
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':');
}

export function homeAddress(o: HomeAddressOptions) {
  const now = o.now ?? Date.now;
  const refreshMs = o.refreshMs ?? 10 * 60_000;
  const recheckMs = o.recheckMs ?? 60_000;
  let networks = new Set<string>();
  let at = Number.NEGATIVE_INFINITY;
  let inflight: Promise<void> | undefined;
  /** The last networks seen, in memory only (to log a change); logs carry a salted hash instead. */
  let lastKey = '';

  async function ask(url: string): Promise<string | undefined> {
    try {
      const r = await o.fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) {
        await r.body?.cancel();
        return undefined;
      }
      const ip = /^ip=(.+)$/m.exec(await r.text())?.[1];
      return ip ? networkOf(ip) : undefined;
    } catch {
      return undefined; // e.g. no IPv6 at home: that endpoint simply has nothing to say
    }
  }

  function refresh(): Promise<void> {
    inflight ??= (async () => {
      const found = (await Promise.all(o.urls.map(ask))).filter((x): x is string => !!x);
      at = now();
      // Nothing answered: keep what was known (a short outage should not turn home into away).
      if (found.length === 0) {
        if (networks.size === 0) o.log?.('home address: no trace endpoint answered; home requests look away');
        return;
      }
      networks = new Set(found);
      const key = [...networks].sort().join(' ');
      if (key !== lastKey) {
        o.log?.(lastKey ? 'home address changed' : 'home address learned', {
          home: await clientHash(o.salt, key),
        });
        lastKey = key;
      }
    })().finally(() => {
      inflight = undefined;
    });
    return inflight;
  }

  return {
    refresh,
    /** Whether a client address (as the tunnel passes it) is the home network's. */
    async isHome(address: string | undefined): Promise<boolean> {
      const net = address ? networkOf(address) : undefined;
      if (!net) return false;
      const age = now() - at;
      if (age >= refreshMs || (!networks.has(net) && age >= recheckMs)) await refresh();
      return networks.has(net);
    },
  };
}
