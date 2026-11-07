// The status is public: whatever an error message carried, nothing in it may point at the machine that made it, the
// network it runs on or the services it uses privately. Kept: web addresses on the broadcasters' and a few well-known
// public hosts (origin and path only, so they help a contributor find the page) and the public addon's own origin.
// Everything else that names a place is replaced: other web addresses, host names with or without a scheme or port,
// LAN names with a port, IP addresses and file paths.
import type { StatusFile } from '@israel-tv/core';

/** Hosts a public status may name (and their subdomains): the broadcasters and well-known public services. */
export const PUBLIC_HOSTS = [
  'kan.org.il',
  'mako.co.il',
  '13tv.co.il',
  'reshet.tv',
  'themoviedb.org',
  'imdb.com',
  'github.com',
  'stremio.com',
  'ynet.co.il',
  'i24news.tv',
  'knesset.gov.il',
] as const;

export const PRIVATE = '[private address]';
export const PATH = '[path]';

export interface PublicTextOptions {
  /** Exact origins that may also be named (the public addon's own, `publisher.publicUrl`). */
  origins?: readonly string[];
}

/** Dotted words that are file names, not hosts ("status.json", "Node.js"). */
const FILE_EXT = new Set(
  'json js mjs cjs ts tsx m3u8 m3u mpd ts db sqlite sqlite3 png jpg jpeg webp svg ico html htm txt log env xml yml yaml toml md csv conf cfg ini pem key crt lock gz zip'.split(
    ' ',
  ),
);
/** `word:digits` that are ours, not a host and port ("kan:72126" is an episode key). */
const NOT_HOSTS = new Set([
  'kan',
  'mako',
  'reshet',
  'live',
  'tmdb',
  'imdb',
  'tt',
  'iltv',
  'season',
  'episode',
  'http',
  'https',
]);

const TOKEN = new RegExp(
  [
    // 1: a web address with a scheme
    String.raw`(\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\];,]+)`,
    // 2: a file path: ~/…, C:\… or C:/…, \\server\share, or an absolute path of two parts or more
    String.raw`(~[\/\\][^\s"'<>;,]*|\b[a-z]:[\/\\][^\s"'<>;,]*|\\\\[^\s"'<>;,]+|(?<![\w.:\/\\-])\/[\w.@~%+-]+(?:\/[^\s"'<>;,]*)+)`,
    // 3: an IP address (v4, or v6 in brackets), with a port
    String.raw`(\[[0-9a-f:.]+\](?::\d+)?|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b)`,
    // 4: a bare IPv6 address
    String.raw`(\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}(?![\w:]))`,
    // 5: a host name without a scheme (label.label.tld), with a port
    String.raw`(\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9](?::\d{1,5})?\b)`,
    // 6: one-word host names: localhost, or a LAN name with a port ("mac-mini:7703")
    String.raw`(\blocalhost\b(?::\d+)?|(?<![\w:\/.-])[a-z][a-z0-9-]*:\d{2,5}\b(?![\d:]))`,
  ].join('|'),
  'gi',
);

function hostAllowed(host: string, origins: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return PUBLIC_HOSTS.some((p) => h === p || h.endsWith(`.${p}`)) || origins.some((o) => hostOf(o) === h);
}

const hostOf = (origin: string) => {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/** Text with private addresses, host names and paths replaced by placeholders. */
export function publicText(text: string, opts: PublicTextOptions = {}): string {
  const origins = opts.origins ?? [];
  return text.replace(TOKEN, (m, url, path, ip, ipv6, host, single) => {
    if (url) {
      try {
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol) || !hostAllowed(u.hostname, origins)) return PRIVATE;
        // Origin and path only: no user, password, query (tickets, tokens) or fragment.
        return `${u.origin}${u.pathname}`;
      } catch {
        return PRIVATE;
      }
    }
    if (path) return PATH;
    if (ip) return PRIVATE;
    if (ipv6) return /[a-f]|::/i.test(ipv6) || (ipv6.match(/:/g)?.length ?? 0) >= 3 ? PRIVATE : m;
    if (host) {
      const name = host.replace(/:\d+$/, '');
      const tld = name.split('.').at(-1)?.toLowerCase() ?? '';
      if (!host.includes(':') && FILE_EXT.has(tld)) return m;
      return hostAllowed(name, origins) ? m : PRIVATE;
    }
    if (single) {
      const label = single.split(':')[0]?.toLowerCase() ?? '';
      return label !== 'localhost' && NOT_HOSTS.has(label) ? m : PRIVATE;
    }
    return m;
  });
}

/** Every string in a value through publicText (keys stay). */
function scrubAll<T>(v: T, opts: PublicTextOptions): T {
  if (typeof v === 'string') return publicText(v, opts) as T;
  if (Array.isArray(v)) return v.map((x) => scrubAll(x, opts)) as T;
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubAll(x, opts)])) as T;
  return v;
}

/** The status file as published (status.json and the status page): no private address, host name or path. */
export function publicStatus(status: StatusFile, opts: PublicTextOptions = {}): StatusFile {
  return scrubAll(status, opts);
}
