// fetch() that leaves through the geo adapter's proxies (or directly when there are none).
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { type Dispatcher, ProxyAgent, Socks5ProxyAgent, fetch as undiciFetch } from 'undici';
import { explainNetError, type ProxyEndpoint, proxyUrlWithAuth } from './geo.ts';

export type GeoFetch = ((
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal; redirect?: 'follow' | 'manual' },
) => Promise<Response>) & {
  /**
   * Move on to the next configured exit (when there is more than one) and say which it is now; for a refusal
   * that may be the exit's fault (a CDN that does not take this exit as Israeli). Undefined with one or none.
   */
  rotate?: () => string | undefined;
  /** The exit requests leave through now (the proxy's address, no credentials); undefined without proxies. */
  current?: () => string | undefined;
};

function agentFor(p: ProxyEndpoint): Dispatcher {
  const url = new URL(p.server);
  if (url.protocol === 'socks5:') return new Socks5ProxyAgent(proxyUrlWithAuth(p));
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
  const geoFetch: GeoFetch = async (url, init) => {
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
          await r.body?.cancel();
          lastErr = new Error(`${proxies[idx]?.server}: ${explainNetError({ message: '407' })}`);
          continue;
        }
        current = idx;
        return r;
      } catch (err) {
        // The caller gave up (timeout): do not blame or try the other proxies.
        if (init?.signal?.aborted) throw err;
        const proxy = proxies[idx];
        // undici hides a refused CONNECT behind "Request was cancelled"; ask the proxy directly what it says.
        const said = proxy ? await connectStatus(proxy, url).catch(() => undefined) : undefined;
        const why = said === 407 ? explainNetError({ message: '407' }) : explainNetError(err);
        lastErr = new Error(
          `${proxy?.server}: ${said && said !== 200 && said !== 407 ? `answered HTTP ${said}` : why}`,
          { cause: err },
        );
      }
    }
    throw lastErr;
  };
  geoFetch.current = () => proxies[current]?.server;
  if (agents.length > 1)
    geoFetch.rotate = () => {
      current = (current + 1) % agents.length;
      return proxies[current]?.server;
    };
  return geoFetch;
}

/** Status line a proxy gives to a CONNECT for the target's host (HTTP proxies only). */
function connectStatus(p: ProxyEndpoint, target: string): Promise<number | undefined> {
  const proxy = new URL(p.server);
  if (proxy.protocol !== 'http:' && proxy.protocol !== 'https:') return Promise.resolve(undefined);
  const t = new URL(target);
  const headers: Record<string, string> = {
    host: `${t.hostname}:${t.port || (t.protocol === 'http:' ? 80 : 443)}`,
  };
  if (p.username)
    headers['proxy-authorization'] =
      `Basic ${Buffer.from(`${p.username}:${p.password ?? ''}`).toString('base64')}`;
  const mod = proxy.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve) => {
    const req = mod({
      host: proxy.hostname,
      port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT',
      path: headers.host,
      headers,
      timeout: 10_000,
    });
    req.on('connect', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode);
    });
    req.on('response', (res) => {
      res.destroy();
      resolve(res.statusCode);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(undefined));
    req.end();
  });
}
