// Geo adapter: how requests that must look Israeli leave this machine.
import type { GeoConfig } from '@israel-tv/core';

export interface ProxyEndpoint {
  /** Proxy URL without credentials (safe to log). */
  server: string;
  username?: string;
  password?: string;
}

/** Resolve the configured proxies with credentials from the environment. Empty for `geo.type: none`. */
export function proxyEndpoints(
  geo: GeoConfig,
  env: Record<string, string | undefined> = process.env,
): ProxyEndpoint[] {
  if (geo.type === 'none') return [];
  const username = geo.usernameEnv ? env[geo.usernameEnv] : undefined;
  const password = geo.passwordEnv ? env[geo.passwordEnv] : undefined;
  return geo.urls.map((u) => {
    const url = new URL(u);
    // Credentials written into the URL are taken out of it, so `server` is always safe to print.
    const user = username ?? (url.username ? decodeURIComponent(url.username) : undefined);
    const pass = password ?? (url.password ? decodeURIComponent(url.password) : undefined);
    url.username = '';
    url.password = '';
    return {
      server: url.toString().replace(/\/$/, ''),
      ...(user ? { username: user } : {}),
      ...(pass ? { password: pass } : {}),
    };
  });
}

/** Proxy URL with credentials embedded, for HTTP clients that take one string. Never log the result. */
export function proxyUrlWithAuth(p: ProxyEndpoint): string {
  const url = new URL(p.server);
  if (p.username) url.username = encodeURIComponent(p.username);
  if (p.password) url.password = encodeURIComponent(p.password);
  return url.toString();
}

/** A proxy/network failure in plain words, with what to check. */
export function explainNetError(err: unknown): string {
  const e = err as {
    message?: string;
    code?: string;
    cause?: { code?: string; message?: string; statusCode?: number };
  };
  // Only symbolic codes (ENOTFOUND, …); DOMException-style numeric codes say nothing useful.
  const raw = e.cause?.code ?? e.code;
  const code = typeof raw === 'string' ? raw : '';
  const text = `${e.message ?? ''} ${e.cause?.message ?? ''}`;
  if (/\b407\b/.test(text) || e.cause?.statusCode === 407)
    return 'the proxy rejected the login (407): check the username and password variables in .env';
  if (code === 'ENOTFOUND')
    return 'proxy host not found: check the proxy host name (geo.urls, or ISRAEL_TV_PROXY)';
  if (code === 'ECONNREFUSED')
    return 'nothing is listening on that proxy port: check the proxy port (geo.urls, or ISRAEL_TV_PROXY)';
  if (/TIMEOUT/i.test(code) || /timed? ?out/i.test(text)) return 'the proxy did not answer in time';
  if (/WRONG_VERSION_NUMBER|wrong version number/i.test(`${code} ${text}`))
    return 'this proxy speaks plain HTTP: write the URL with http:// instead of https://';
  if (/certificate|CERT_|self.signed/i.test(`${code} ${text}`))
    return "the proxy's TLS certificate does not match its address: check the host name (or use http:// if the provider says so)";
  const detail = code || e.cause?.message || e.message;
  return detail && !/^Request was cancelled|^fetch failed$/.test(detail)
    ? detail
    : 'the proxy refused or dropped the connection: check the proxy address (geo.urls or ISRAEL_TV_PROXY), the login, and that the provider allows this server';
}
