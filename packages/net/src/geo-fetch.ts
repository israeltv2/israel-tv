// fetch() that leaves through the geo adapter's proxies (or directly when there are none).
import { type Dispatcher, ProxyAgent, Socks5ProxyAgent, fetch as undiciFetch } from 'undici';
import type { ProxyEndpoint } from './geo.ts';

export type GeoFetch = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal; redirect?: 'follow' | 'manual' },
) => Promise<Response>;

function agentFor(p: ProxyEndpoint): Dispatcher {
  const url = new URL(p.server);
  if (url.protocol === 'socks5:') {
    if (p.username) {
      url.username = encodeURIComponent(p.username);
      url.password = encodeURIComponent(p.password ?? '');
    }
    return new Socks5ProxyAgent(url.toString());
  }
  const token = p.username
    ? `Basic ${Buffer.from(`${p.username}:${p.password ?? ''}`).toString('base64')}`
    : undefined;
  return new ProxyAgent({ uri: p.server, ...(token ? { token } : {}) });
}

/**
 * One proxy at a time; on a connection error or 407 the next configured proxy is tried and kept.
 * With no proxies this is plain fetch.
 */
export function createGeoFetch(proxies: ProxyEndpoint[]): GeoFetch {
  if (proxies.length === 0) {
    return (url, init) => fetch(url, { ...init, redirect: init?.redirect ?? 'follow' });
  }
  const agents = proxies.map(agentFor);
  let current = 0;
  return async (url, init) => {
    let lastErr: unknown;
    for (let i = 0; i < agents.length; i++) {
      const idx = (current + i) % agents.length;
      const dispatcher = agents[idx];
      if (!dispatcher) continue;
      try {
        const r = (await undiciFetch(url, {
          ...init,
          redirect: init?.redirect ?? 'follow',
          dispatcher,
        })) as unknown as Response;
        if (r.status === 407) {
          lastErr = new Error(`proxy ${proxies[idx]?.server} rejected the credentials (407)`);
          continue;
        }
        current = idx;
        return r;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  };
}
