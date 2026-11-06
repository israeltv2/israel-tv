// Plays and relay sessions in memory, keyed by playId: what is playing now (for the usage dashboard), and one
// `relay_session` event per relay session (duration, bytes, segments, errors) when it goes quiet — never one
// per segment.
import type { UsageEvent } from '@israel-tv/core';

export interface PlayInfo {
  source?: string;
  showId?: string;
  episodeId?: string;
  client?: string;
}

interface Session extends PlayInfo {
  playId: string;
  kind: 'play' | 'relay';
  startedAt: number;
  lastAt: number;
  /** Time to the first playlist answered. */
  firstMs?: number;
  segments: number;
  bytes: number;
  errors: number;
  lastError?: string;
  lastStatus?: number;
}

export interface ActiveSession extends PlayInfo {
  kind: 'play' | 'relay';
  playId: string;
  since: string;
  segments: number;
  bytes: number;
}

/** A relay session with no request for this long is over. */
const IDLE_MS = 90_000;
/** A Mako play is "playing now" this long after its playlist was handed out (video then goes player ↔ CDN). */
const PLAY_ACTIVE_MS = 10 * 60_000;

export class PlaySessions {
  private readonly started = new Map<string, PlayInfo>();
  private readonly sessions = new Map<string, Session>();
  private readonly emit: (e: UsageEvent) => void;
  private readonly now: () => number;

  constructor(emit: (e: UsageEvent) => void = () => {}, now: () => number = Date.now) {
    this.emit = emit;
    this.now = now;
  }

  /** What a stream response handed out under this playId (so later requests know the show). */
  begin(playId: string, info: PlayInfo): void {
    this.started.set(playId, info);
    if (this.started.size > 2000) this.started.delete(this.started.keys().next().value as string);
  }

  info(playId: string | undefined): PlayInfo {
    return (playId && this.started.get(playId)) || {};
  }

  /** A Mako play handed out its playlist. */
  play(playId: string, info: PlayInfo, ms: number): void {
    const t = this.now();
    this.sessions.set(`play:${playId}`, {
      playId,
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
    playId: string,
    info: PlayInfo,
    r: { playlist: boolean; ms: number; status: number; error?: string },
  ): void {
    this.flush();
    const t = this.now();
    const key = `relay:${playId}`;
    let s = this.sessions.get(key);
    if (!s) {
      s = { playId, kind: 'relay', ...info, startedAt: t, lastAt: t, segments: 0, bytes: 0, errors: 0 };
      this.sessions.set(key, s);
    }
    s.lastAt = t;
    s.lastStatus = r.status;
    const ok = !r.error && r.status < 400;
    if (r.playlist && s.firstMs === undefined && ok) s.firstMs = r.ms;
    if (!r.playlist && ok) s.segments++;
    if (!ok) {
      s.errors++;
      s.lastError = r.error ?? `HTTP ${r.status}`;
    }
  }

  /** Bytes that finished streaming after the response was handed back. */
  addBytes(playId: string, n: number): void {
    const s = this.sessions.get(`relay:${playId}`);
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
        ts: new Date(s.startedAt).toISOString(),
        kind: 'relay_session',
        component: 'geo-relay',
        outcome: s.errors > 0 && s.segments === 0 ? 'error' : 'ok',
        playId: s.playId,
        ...(s.client ? { client: s.client } : {}),
        ...(s.source ? { source: s.source } : {}),
        ...(s.showId ? { showId: s.showId } : {}),
        ...(s.episodeId ? { episodeId: s.episodeId } : {}),
        ...(s.lastStatus !== undefined ? { status: s.lastStatus } : {}),
        ...(s.firstMs !== undefined ? { latencyMs: s.firstMs } : {}),
        detail: {
          durationMs: s.lastAt - s.startedAt,
          segments: s.segments,
          bytes: s.bytes,
          errors: s.errors,
          ...(s.lastError ? { lastError: s.lastError } : {}),
        },
      });
    }
  }

  /** Plays and relay sessions going on now. */
  active(): ActiveSession[] {
    this.flush();
    return [...this.sessions.values()].map((s) => ({
      kind: s.kind,
      playId: s.playId,
      since: new Date(s.startedAt).toISOString(),
      segments: s.segments,
      bytes: s.bytes,
      ...(s.source ? { source: s.source } : {}),
      ...(s.showId ? { showId: s.showId } : {}),
      ...(s.episodeId ? { episodeId: s.episodeId } : {}),
      ...(s.client ? { client: s.client } : {}),
    }));
  }
}
