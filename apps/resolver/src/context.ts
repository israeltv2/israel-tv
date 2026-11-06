// What the resolver's modules share: the play being answered, how to record events and log, and helpers.
import type { UsageEvent } from '@israel-tv/core';
import type { Context } from 'hono';
import type { PlayInfo, PlaySessions } from './sessions.ts';

/** Structured log line: a message plus fields (playId, showId, …). Secrets never go in either. */
export type Log = (msg: string, fields?: Record<string, unknown>) => void;

export type Fetch = (
  url: string,
  init?: { headers?: Record<string, string>; redirect?: 'follow' | 'manual'; signal?: AbortSignal },
) => Promise<Response>;

export interface ModuleContext {
  fetch: Fetch;
  sessions: PlaySessions;
  /** Record an event (the module's component is filled in). */
  emit: (e: Omit<UsageEvent, 'ts' | 'component'>) => void;
  log: Log;
  /** The salted daily hash of the requesting client, when its address is known. */
  clientOf: (c: Context) => Promise<string | undefined>;
}

/** One play being answered: its id and what is known about it. */
export interface Play {
  playId: string;
  info: PlayInfo;
}

export const HLS = 'application/vnd.apple.mpegurl';

export const playerUA = (c: { req: { header(n: string): string | undefined } }) =>
  c.req.header('user-agent') ?? 'Mozilla/5.0 (Linux; Android) ExoPlayer';

export const withPlayId = (url: string, playId: string) => `${url}?p=${encodeURIComponent(playId)}`;

/** Make every URI in a playlist absolute (relative to where the playlist was fetched). */
export function absolutize(
  playlist: string,
  base: string,
  rewrite: (abs: string) => string = (u) => u,
): string {
  return playlist
    .split('\n')
    .map((line) => {
      const l = line.trim();
      if (l === '') return line;
      if (l.startsWith('#')) {
        return line.replace(
          /URI="([^"]+)"/g,
          (_, u: string) => `URI="${rewrite(new URL(u, base).toString())}"`,
        );
      }
      return rewrite(new URL(l, base).toString());
    })
    .join('\n');
}
