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

export type EventOutcome = 'ok' | 'error' | 'not-mine';

/** Which part of the system recorded it. */
export type Component = 'resolver' | 'mako-auth' | 'geo-relay' | 'ingest' | 'canary';

export interface UsageEvent {
  /** ISO time. */
  ts: string;
  kind: EventKind;
  component: Component;
  /**
   * `not-mine`: the home helper was asked for an id it has nothing to add to (another addon's title, or a channel
   * the public addon already plays). Apps ask every installed addon for every id: that is normal, not a failure,
   * and never counts in failure rates.
   */
  outcome: EventOutcome;
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

/**
 * The project's own traffic (the daily canary, smoke tests, audits, CI) says so with this header: its value is
 * the kind (`canary`, `test`, `audit`, …). Such plays get a play id starting with `probe-` (`canary-` for the
 * canary) and are kept out of usage, failures and "playing now"; they stay queryable by play id.
 */
export const PROBE_HEADER = 'x-israel-tv-probe';
/** Older canaries sent this one (value `1`); still honoured. */
export const CANARY_HEADER = 'x-israel-tv-canary';

/** Play ids of internal traffic start with one of these. */
export const INTERNAL_PLAY_PREFIXES = ['canary-', 'probe-'] as const;

/** Whether a play id belongs to the project's own traffic. */
export function isInternalPlay(playId: string | null | undefined): boolean {
  return !!playId && INTERNAL_PLAY_PREFIXES.some((p) => playId.startsWith(p));
}

/** The play-id prefix for a request's probe headers ('' for a viewer's request). */
export function probePrefix(header: (name: string) => string | undefined): '' | 'canary-' | 'probe-' {
  const probe = header(PROBE_HEADER)?.trim().toLowerCase();
  if (probe === 'canary' || header(CANARY_HEADER) === '1') return 'canary-';
  return probe ? 'probe-' : '';
}

/** SQL condition (events table) that leaves out internal traffic. */
export const NOT_INTERNAL_SQL =
  "(play_id is null or (play_id not like 'canary-%' and play_id not like 'probe-%'))";

/** A short random id for one play. */
export function newPlayId(): string {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
