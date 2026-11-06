// Play and relay sessions in memory, keyed by correlation id: what is playing now (for the usage dashboard),
// and one `relay` event per relay session (segments, bytes, errors) when it goes quiet.
import type { UsageEvent } from '@israel-tv/core';

interface Session {
  corr: string;
  client?: string;
  source?: string;
  series?: string;
  video?: string;
  kind: 'play' | 'relay';
  startedAt: number;
  lastAt: number;
  /** Time to the first playlist answered. */
  firstMs?: number;
  segments: number;
  bytes: number;
  errors: number;
  lastError?: string;
  upstream?: number;
}

export interface SessionInfo {
  source?: string;
  series?: string;
  video?: string;
  client?: string;
}

/** A relay session with no request for this long is over. */
const IDLE_MS = 90_000;
/** A Mako play is "active" this long after its playlist was handed out (video then goes player ↔ CDN). */
const PLAY_ACTIVE_MS = 10 * 60_000;

export class PlaySessions {
  private readonly started = new Map<string, SessionInfo>();
  private readonly sessions = new Map<string, Session>();
  private readonly emit: (e: UsageEvent) => void;
  private readonly now: () => number;

  constructor(emit: (e: UsageEvent) => void = () => {}, now: () => number = Date.now) {
    this.emit = emit;
    this.now = now;
  }

  /** What a stream response handed out under this correlation id (so later requests know the show). */
  begin(corr: string, info: SessionInfo): void {
    this.started.set(corr, info);
    if (this.started.size > 2000) this.started.delete(this.started.keys().next().value as string);
  }

  info(corr: string | undefined): SessionInfo {
    return (corr && this.started.get(corr)) || {};
  }

  /** A Mako play handed out its playlist. */
  play(corr: string, info: SessionInfo, ms: number): void {
    const t = this.now();
    this.sessions.set(`play:${corr}`, {
      corr,
      kind: 'play',
      ...info,
      startedAt: t,
      lastAt: t,
      firstMs: ms,
      segments: 0,
      bytes: 0,
      errors: 0,
    });
  }

  /** One relay request (a playlist or a segment). */
  relay(
    corr: string,
    info: SessionInfo,
    r: { playlist: boolean; ms: number; status: number; bytes?: number; error?: string },
  ): void {
    this.flush();
    const t = this.now();
    const key = `relay:${corr}`;
    let s = this.sessions.get(key);
    if (!s) {
      s = { corr, kind: 'relay', ...info, startedAt: t, lastAt: t, segments: 0, bytes: 0, errors: 0 };
      this.sessions.set(key, s);
    }
    s.lastAt = t;
    s.upstream = r.status;
    if (r.playlist && s.firstMs === undefined && !r.error && r.status < 400) s.firstMs = r.ms;
    if (!r.playlist && !r.error && r.status < 400) s.segments++;
    s.bytes += r.bytes ?? 0;
    if (r.error || r.status >= 400) {
      s.errors++;
      s.lastError = r.error ?? `HTTP ${r.status}`;
    }
  }

  /** Bytes that finished streaming after the response was handed back. */
  addBytes(corr: string, n: number): void {
    const s = this.sessions.get(`relay:${corr}`);
    if (s) s.bytes += n;
  }

  /** End quiet sessions: relay sessions become one event each; old plays are dropped. */
  flush(force = false): void {
    const t = this.now();
    for (const [key, s] of this.sessions) {
      if (s.kind === 'play') {
        if (force || t - s.lastAt > PLAY_ACTIVE_MS) this.sessions.delete(key);
        continue;
      }
      if (!force && t - s.lastAt <= IDLE_MS) continue;
      this.sessions.delete(key);
      this.emit({
        at: new Date(s.startedAt).toISOString(),
        kind: 'relay',
        origin: 'resolver',
        outcome: s.errors > 0 && s.segments === 0 ? 'error' : 'ok',
        corr: s.corr,
        route: 'relay',
        ...(s.client ? { client: s.client } : {}),
        ...(s.source ? { source: s.source } : {}),
        ...(s.series ? { series: s.series } : {}),
        ...(s.video ? { video: s.video } : {}),
        ...(s.firstMs !== undefined ? { ms: s.firstMs } : {}),
        ...(s.upstream !== undefined ? { upstream: `last ${s.upstream}` } : {}),
        segments: s.segments,
        bytes: s.bytes,
        ...(s.errors ? { reason: `${s.errors} errors, last: ${s.lastError}` } : {}),
      });
    }
  }

  /** Plays and relay sessions going on now. */
  active(): (SessionInfo & {
    kind: 'play' | 'relay';
    corr: string;
    since: string;
    segments: number;
    bytes: number;
  })[] {
    this.flush();
    return [...this.sessions.values()].map((s) => ({
      kind: s.kind,
      corr: s.corr,
      since: new Date(s.startedAt).toISOString(),
      segments: s.segments,
      bytes: s.bytes,
      ...(s.source ? { source: s.source } : {}),
      ...(s.series ? { series: s.series } : {}),
      ...(s.video ? { video: s.video } : {}),
      ...(s.client ? { client: s.client } : {}),
    }));
  }
}
