// The status is public: whatever an error message carried, nothing in it may point at the machine that made it.
// Addresses of the broadcasters and the services everyone uses stay (they help a contributor find the page); any
// other web address, IP address, local host name or file path is replaced by a placeholder.
import type { StatusFile } from '@israel-tv/core';

/** Hosts a public status may name: the broadcasters' and well-known services' (and their subdomains). */
export const PUBLIC_HOSTS = [
  'kan.org.il',
  'mako.co.il',
  '13tv.co.il',
  'reshet.tv',
  'themoviedb.org',
  'imdb.com',
  'github.com',
  'cloudflare.com',
  'workers.dev',
  'stremio.com',
] as const;

const isPublicHost = (host: string) => {
  const h = host.toLowerCase();
  return PUBLIC_HOSTS.some((p) => h === p || h.endsWith(`.${p}`));
};

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\];]+/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g;
const IPV6 = /\[?\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}\]?(?::\d+)?/gi;
/** Names that only mean something on one network: localhost, *.local, *.lan, *.home, *.internal, *.ts.net. */
const LOCAL_HOST =
  /\b(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:local|lan|home|internal|localdomain|ts\.net))(?::\d+)?\b/gi;
/** Absolute paths: /Users/…, /home/…, /var/…, ~/…, C:\…; three parts or more for the generic Unix form. */
const PATH_RE =
  /(?:~\/|\b[A-Za-z]:\\)[^\s"'<>]+|(?<![\w.:/-])\/(?:Users|home|root|var|opt|srv|etc|tmp|private|mnt|Volumes|data|app)\/[^\s"'<>]+/g;

/** Text with private addresses, host names and paths replaced by placeholders. */
export function publicText(text: string): string {
  return text
    .replace(URL_RE, (u) => {
      try {
        return isPublicHost(new URL(u).hostname) ? u : '[private address]';
      } catch {
        return '[private address]';
      }
    })
    .replace(PATH_RE, '[path]')
    .replace(LOCAL_HOST, '[private address]')
    .replace(IPV4, '[private address]')
    .replace(IPV6, (m) =>
      /[a-f]|::/i.test(m) || (m.match(/:/g)?.length ?? 0) >= 3 ? '[private address]' : m,
    );
}

/** Every string in a value through publicText (keys stay). */
function scrubAll<T>(v: T): T {
  if (typeof v === 'string') return publicText(v) as T;
  if (Array.isArray(v)) return v.map(scrubAll) as T;
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubAll(x)])) as T;
  return v;
}

/** The status file as published (status.json and the status page): no private address, host name or path. */
export function publicStatus(status: StatusFile): StatusFile {
  return scrubAll(status);
}
