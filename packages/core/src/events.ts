// Usage and diagnostics events, shared by the public Worker, the resolver and ingest.
//
// One event per thing that happened (a request, a play start, a Mako ticket, a relay session, an ingest run),
// with a correlation id that ties a play together: the stream request hands out play/relay URLs carrying it.
// No raw IP address is ever kept: a client is an HMAC of its address keyed with a secret salt and the day, so
// the same viewer counts once per day and the hash cannot be turned back into an address (or linked across days)
// without the salt.

export type EventKind = 'request' | 'stream' | 'play' | 'ticket' | 'relay' | 'ingest';
/** Where the event was recorded. */
export type EventOrigin = 'worker' | 'resolver' | 'ingest';

export interface UsageEvent {
  /** ISO time. */
  at: string;
  kind: EventKind;
  origin: EventOrigin;
  outcome: 'ok' | 'error';
  /** Ties the events of one play together (stream → play → relay); a Worker request's Cloudflare ray id. */
  corr?: string;
  /** Salted daily hash of the client's address. */
  client?: string;
  source?: string;
  /** Series id (iltv_…) or live channel id. */
  series?: string;
  /** Video id (series:season:episode) when there is one. */
  video?: string;
  /** Route or resource, e.g. `catalog`, `meta`, `stream`, `play/mako`, `relay`. */
  route?: string;
  /** HTTP status answered to the client. */
  status?: number;
  /** Upstream statuses in order, e.g. `playlist 200, ticket 200, master 403`. */
  upstream?: string;
  /** Duration in ms (for a play: time to the first playlist). */
  ms?: number;
  bytes?: number;
  segments?: number;
  /** Why it failed (or a short note). */
  reason?: string;
}

/** Events are kept this long. */
export const EVENT_RETENTION_DAYS = 30;

const enc = new TextEncoder();

/** The salted daily hash of a client address (hex, 16 chars). Works in Node and in Workers. */
export async function clientHash(salt: string, address: string, day = new Date().toISOString().slice(0, 10)) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${day}|${address}`)));
  return [...sig.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A short random correlation id. */
export function newCorrelationId(): string {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
