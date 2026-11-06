// Usage and diagnostics events, shared by the resolver, ingest and the public Worker.
//
// One event per meaningful action, never per video segment. A play is followed across components by its
// `playId`: the resolver's stream response hands out play/relay URLs carrying it. No IP address is ever kept:
// a client is an HMAC of its address keyed with a secret salt and the day, so a viewer counts once a day and
// the hash cannot be turned back into an address or followed across days.

export type EventKind =
  /** The resolver answered a stream request (what it offered, and why). */
  | 'stream_request'
  /** A play started: the player got its first playlist (latency = time to it). */
  | 'play_start'
  /** One relay session through the geo proxy, written when it ends (duration, bytes, segments, errors). */
  | 'relay_session'
  /** A Mako entitlement (ticket) fetch. */
  | 'ticket_fetch'
  /** Something a viewer asked for failed (stage, upstream statuses, reason). */
  | 'failure'
  /** An ingest run, publish or crawl slice finished. */
  | 'run'
  /** The daily playback canary checked one title end to end. */
  | 'canary';

/** Which part of the system recorded it. */
export type Component = 'resolver' | 'mako-auth' | 'geo-relay' | 'ingest' | 'canary';

export interface UsageEvent {
  /** ISO time. */
  ts: string;
  kind: EventKind;
  component: Component;
  outcome: 'ok' | 'error';
  playId?: string;
  source?: string;
  /** Series id (iltv_…) or live channel id. */
  showId?: string;
  /** Video id (series:season:episode). */
  episodeId?: string;
  /** Salted daily hash of the client's address. */
  client?: string;
  /** HTTP status answered (or, for a failure, the upstream status that caused it). */
  status?: number;
  latencyMs?: number;
  detail?: Record<string, unknown>;
}

/** Raw events are kept this long; daily rollups a year. */
export const EVENT_RETENTION_DAYS = 30;
export const ROLLUP_RETENTION_DAYS = 365;

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

/** A short random id for one play. */
export function newPlayId(): string {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
