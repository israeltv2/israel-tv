// Geo proxy for the spikes, taken from the project config (geo adapter), so nothing here names a provider.
import { readFileSync } from 'node:fs';
import { parseConfig } from '@israel-tv/core';
import { type ProxyEndpoint, proxyEndpoints } from '@israel-tv/net';

export function configuredProxies(): ProxyEndpoint[] {
  const file = process.env.ISRAEL_TV_CONFIG ?? '../israel-tv.config.json';
  const config = parseConfig(JSON.parse(readFileSync(file, 'utf8')));
  const list = proxyEndpoints(config.geo);
  if (list.length === 0)
    throw new Error(`${file}: geo.type is none; these spikes need an http-proxy with an Israeli exit`);
  return list;
}

export function pickProxy(index: number): ProxyEndpoint {
  const list = configuredProxies();
  const p = list[index % list.length];
  if (!p) throw new Error('no proxy configured');
  return p;
}
