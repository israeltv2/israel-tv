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
    if (geo.type === 'socks5' && url.protocol !== 'socks5:') url.protocol = 'socks5:';
    return {
      server: url.toString().replace(/\/$/, ''),
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
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
