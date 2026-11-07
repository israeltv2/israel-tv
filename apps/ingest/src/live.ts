// Live channels: render entries, and the daily check that plays every one of their streams.
import {
  ISRAEL_ONLY,
  ISRAEL_ONLY_SOMETIMES,
  LIVE_CHANNELS,
  type LiveChannel,
  ORIGIN_TOKEN,
  PROBE_HEADER,
  sitePaths,
} from '@israel-tv/core';
import type { LiveChannelRender } from '@israel-tv/render';
import type { Store } from '@israel-tv/store';
import { playCheck } from './canary.ts';
import { runStatus } from './runner.ts';

/** kv key of the last live check (every stream of every channel). */
export const LIVE_CHECK_KEY = 'live:check';

export interface LiveStreamCheck {
  title: string;
  /** `direct`: the public addon's own stream; `helper`: through the home helper (Mako channels). */
  via: 'direct' | 'helper';
  url?: string;
  outcome: 'ok' | 'refused' | 'failed';
  statuses: number[];
  detail?: string;
  /** The first try failed and this is the second, a little later (what a viewer pressing play again sees). */
  retried?: boolean;
  /** This stream's latest outcomes, oldest first, this check last: `o` played, `r` refused, `f` failed (≤ 20). */
  recent?: string;
}
export interface LiveCheck {
  at: string;
  /** Whether this instance is outside Israel (a refusal then means "Israel only"). */
  abroad: boolean;
  channels: Record<string, LiveStreamCheck[]>;
}

/** How many of a stream's latest outcomes are kept (`recent`). */
export const LIVE_HISTORY = 20;
const LETTER = { ok: 'o', refused: 'r', failed: 'f' } as const;

/** A stream's outcomes, oldest first (a check from before histories were kept counts as its one outcome). */
const historyOf = (x: LiveStreamCheck | undefined): string => (x ? (x.recent ?? LETTER[x.outcome]) : '');

/**
 * Whether a stream plays outside Israel, from the checks made abroad: `always` refused (never played), `sometimes`
 * (refused in some checks, played in others: the broadcaster blocks some programmes only), or undefined (no
 * refusal seen). A channel known to block some programmes (`geo`: Kan's) is at least `sometimes`; an instance in
 * Israel cannot tell, so it goes by that alone. One refusal never turns a stream that plays into "Israel only".
 */
export function israelOnly(
  channel: Pick<LiveChannel, 'geo'>,
  seen: LiveStreamCheck | undefined,
  abroad: boolean,
): 'always' | 'sometimes' | undefined {
  const recent = historyOf(seen);
  if (abroad && recent.includes('r')) return recent.includes('o') ? 'sometimes' : 'always';
  return channel.geo ? 'sometimes' : undefined;
}

/**
 * Live channels for rendering; `logos` are the channel ids that have a logo tile among the site's images. A stream
 * says when it plays only in Israel, always or for some programmes (israelOnly).
 */
export function liveRender(logos: ReadonlySet<string> = new Set(), check?: LiveCheck): LiveChannelRender[] {
  return LIVE_CHANNELS.map((c) => ({
    id: c.id,
    name: c.name,
    ...(logos.has(c.id) ? { logo: `${ORIGIN_TOKEN}/${sitePaths.channelLogo(c.id)}` } : {}),
    description: c.description,
    streams: c.direct.map((l) => {
      const seen = check?.channels[c.id]?.find((x) => x.via === 'direct' && x.url === l.url);
      const only = israelOnly(c, seen, !!check?.abroad);
      const label =
        only === 'always' ? ISRAEL_ONLY : only === 'sometimes' ? ISRAEL_ONLY_SOMETIMES : undefined;
      return {
        url: l.url,
        name: c.name,
        title: label ? `${l.title} · ${label}` : l.title,
        // DASH: apps that cannot play it themselves (Stremio in a browser) hand it to their streaming server.
        ...(/\/livedash\//.test(l.url) ? { behaviorHints: { notWebReady: true } } : {}),
      };
    }),
  }));
}

const judge = (r: { step?: string; statuses: number[] }): LiveStreamCheck['outcome'] => {
  if (!r.step) return 'ok';
  const last = r.statuses.at(-1);
  return last === 403 || last === 451 ? 'refused' : 'failed';
};

export interface LiveCheckOptions {
  /** The home helper's address (Mako channels are played through it). */
  resolverBase?: string | undefined;
  /** This instance is outside Israel (it has a geo proxy into Israel). */
  abroad?: boolean;
  fetchImpl?: typeof fetch;
  channels?: readonly LiveChannel[];
  /** Pause before playing a stream that did not play a second time (ms). */
  retryDelayMs?: number;
}

/**
 * Play every stream of every channel (playlist → variant → first segment): the public addon's direct streams, and
 * the Mako channels through the home helper when there is one. A channel is down when none of its streams plays;
 * every stream that fails is named on /status. Results are kept for the labels (liveRender) and the dashboard.
 */
export async function checkLive(
  store: Store,
  opts: LiveCheckOptions = {},
): Promise<{ ok: number; failed: string[]; streamsFailed: string[] }> {
  const channels = opts.channels ?? LIVE_CHANNELS;
  const f = opts.fetchImpl ?? fetch;
  const runId = store.startRun('full', 'live');
  const failed: string[] = [];
  const streamsFailed: string[] = [];
  const results: LiveCheck['channels'] = {};
  const before = store.getState<LiveCheck>(LIVE_CHECK_KEY);
  const delay = opts.retryDelayMs ?? 30_000;
  /**
   * Play a stream; one that fails is played again a little later, as a viewer would press play again. A refusal
   * from abroad is not tried again: it is the broadcaster's limit for the programme on air (measured: 22 minutes).
   */
  const play = async (url: string) => {
    const first = await playCheck(url, f);
    if (!first.step || (opts.abroad && judge(first) === 'refused')) return { ...first, retried: false };
    await new Promise((r) => setTimeout(r, delay));
    return { ...(await playCheck(url, f)), retried: true };
  };
  /** The result, with this stream's outcomes from earlier checks before it. */
  const entry = (
    c: LiveChannel,
    x: Omit<LiveStreamCheck, 'outcome' | 'statuses' | 'recent' | 'retried'>,
    r: { statuses: number[]; step?: string; detail?: string; retried?: boolean },
  ): LiveStreamCheck => {
    const outcome = judge(r);
    const prev = before?.channels[c.id]?.find((p) =>
      x.via === 'direct' ? p.via === 'direct' && p.url === x.url : p.via === x.via && p.title === x.title,
    );
    const past = historyOf(prev);
    return {
      ...x,
      outcome,
      statuses: r.statuses,
      ...(r.detail ? { detail: r.detail } : {}),
      ...(r.retried ? { retried: true } : {}),
      recent: `${past}${LETTER[outcome]}`.slice(-LIVE_HISTORY),
    };
  };
  let ok = 0;
  for (const c of channels) {
    const list: LiveStreamCheck[] = [];
    for (const l of c.direct)
      list.push(entry(c, { title: l.title, via: 'direct', url: l.url }, await play(l.url)));
    if (c.mako?.length && opts.resolverBase) {
      let urls: string[] = [];
      try {
        const res = await f(`${opts.resolverBase}/stream/tv/${encodeURIComponent(c.id)}.json`, {
          headers: { [PROBE_HEADER]: 'live-check' },
          signal: AbortSignal.timeout(20_000),
        });
        const j = (await res.json()) as { streams?: { url?: string }[] };
        urls = (j.streams ?? []).map((s) => s.url ?? '').filter((u) => /\/play\/mako-live\//.test(u));
      } catch {}
      for (const [i, m] of c.mako.entries()) {
        const url = urls.find((u) => u.includes(`/play/mako-live/${c.id}/${i}.m3u8`));
        if (!url) {
          list.push(
            entry(
              c,
              { title: m.title, via: 'helper' },
              { statuses: [], step: 'stream', detail: 'no stream offered' },
            ),
          );
          continue;
        }
        list.push(entry(c, { title: m.title, via: 'helper' }, await play(url)));
      }
    }
    results[c.id] = list;
    if (list.length === 0) continue; // a Mako channel without a helper to play it through
    // From abroad a refusal is the "Israel only" label, not a fault.
    const fine = (x: LiveStreamCheck) => x.outcome === 'ok' || (!!opts.abroad && x.outcome === 'refused');
    for (const s of list.filter((x) => !fine(x)))
      streamsFailed.push(`${c.name} · ${s.title} (${s.detail ?? s.statuses.join('/')})`);
    if (list.some(fine)) ok++;
    else failed.push(`${c.name} (${list[0]?.detail ?? 'no answer'})`);
  }
  store.setState(LIVE_CHECK_KEY, {
    at: new Date().toISOString(),
    abroad: !!opts.abroad,
    channels: results,
  } satisfies LiveCheck);
  const errors = [
    ...(failed.length ? [`not answering: ${failed.join(', ')}`] : []),
    ...(streamsFailed.length ? [`streams that did not play: ${streamsFailed.join(', ')}`] : []),
  ];
  store.finishRun(runId, {
    // A channel down fails the check; a stream down (another of the channel plays) makes it partial.
    status: failed.length ? runStatus(ok, failed.length) : streamsFailed.length ? 'partial' : 'ok',
    showsOk: ok,
    showsFailed: failed.length,
    ...(errors.length ? { error: errors.join('; ') } : {}),
  });
  return { ok, failed, streamsFailed };
}
