// The contract between the public data Worker's router and the private API Worker (Cloudflare publisher).
//
// The router runs only for dynamic paths (rows, search, streams, status). It forwards each such request to the API
// through a service binding as an envelope: the request, the client's address (the API has no public URL, so the
// router is the only one who sees it), and catalog files the API asked for. The API answers with the response,
// or with "need these files" (status 409 and the NEED_HEADER): the router reads them from its static assets and
// sends the envelope again, at most MAX_ROUNDS times. The API keeps files it may reuse for a while, so most
// requests take one round.
//
// Kept free of imports: the router bundle is this file and a few lines.

/** Bump on any change an older API (or router) could misread. */
export const ROUTER_CONTRACT_VERSION = 1;

/** The API's only path. */
export const ENVELOPE_PATH = '/__israel-tv/router';

/** Marks an API answer asking for files (body: `{ need: string[] }`). */
export const NEED_HEADER = 'x-israel-tv-need';

/** Rounds of "need files" per request (the live row reads three files: row, freshness, guide), and files per round. */
export const MAX_ROUNDS = 6;
export const MAX_FILES = 8;

export interface RouterEnvelope {
  v: number;
  method: string;
  /** The public URL as the viewer asked it. */
  url: string;
  /** Request headers worth passing on (user agent, accept, the probe/canary markers). */
  headers: Record<string, string>;
  /** The viewer's address (CF-Connecting-IP), for per-client limits and the salted daily hash. */
  client?: string;
  ray?: string;
  /** Catalog files by site path; null: the file does not exist. */
  files: Record<string, string | null>;
}

/** Headers the router passes on. */
export const PASSED_HEADERS = [
  'user-agent',
  'accept',
  'accept-language',
  'x-israel-tv-canary',
  'x-israel-tv-probe',
];

/** A site path a router may read for the API: relative, no `..`, no scheme. */
export function safeSitePath(path: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_./%:=-]*$/.test(path) && !path.includes('..') && !path.includes('//');
}
