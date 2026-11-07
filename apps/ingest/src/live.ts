// Live channels: render entries, and the daily check that plays every one of their streams.
import {
  ISRAEL_ONLY,
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
}
export interface LiveCheck {
  at: string;
  /** Whether this instance is outside Israel (a refusal then means "Israel only"). */
  abroad: boolean;
  channels: Record<string, LiveStreamCheck[]>;
}

/**
 * Live channels for rendering; `logos` are the channel ids that have a logo tile among the site's images. A stream
 * says it plays only in Israel when the last check, made from abroad, was refused; without such a check, the
 * channels the broadcaster sometimes geo-blocks say so.
 */
export function liveRender(logos: ReadonlySet<string> = new Set(), check?: LiveCheck): LiveChannelRender[] {
  return LIVE_CHANNELS.map((c) => ({
    id: c.id,
    name: c.name,
    ...(logos.has(c.id) ? { logo: `${ORIGIN_TOKEN}/${sitePaths.channelLogo(c.id)}` } : {}),
    description: c.description,
    streams: c.direct.map((l) => {
      const seen = check?.abroad ? check.channels[c.id]?.find((x) => x.url === l.url) : undefined;
      const israelOnly = seen ? seen.outcome === 'refused' : !check?.abroad && !!c.geo;
      return {
        url: l.url,
        name: c.name,
        title: israelOnly ? `${l.title} · ${ISRAEL_ONLY}` : l.title,
        // DASH: apps that cannot play it themselves (Stremio in a browser) hand it to their streaming server.
        ...(/\/livedash\//.test(l.url) ? { behaviorHints: { notWebReady: true } } : {}),
      };
    }),
  }));
}

const judge = (r: Awaited<ReturnType<typeof playCheck>>): LiveStreamCheck['outcome'] => {
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
  let ok = 0;
  for (const c of channels) {
    const list: LiveStreamCheck[] = [];
    for (const l of c.direct) {
      const r = await playCheck(l.url, f);
      list.push({
        title: l.title,
        via: 'direct',
        url: l.url,
        outcome: judge(r),
        statuses: r.statuses,
        ...(r.detail ? { detail: r.detail } : {}),
      });
    }
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
          list.push({
            title: m.title,
            via: 'helper',
            outcome: 'failed',
            statuses: [],
            detail: 'no stream offered',
          });
          continue;
        }
        const r = await playCheck(url, f);
        list.push({
          title: m.title,
          via: 'helper',
          outcome: judge(r),
          statuses: r.statuses,
          ...(r.detail ? { detail: r.detail } : {}),
        });
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
