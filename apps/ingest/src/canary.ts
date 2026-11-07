// The daily playback canary: once a day, play one recent title per source end to end, the way a viewer at home
// would — ask the home resolver for its streams (else the public addon's direct stream), then fetch the master
// playlist, a variant playlist and the first bytes of the first segment. Expected 200, 200, 206 (a CDN that
// ignores Range and answers 200 also passes). Titles are picked from the catalog (recent and playable), never
// hard-coded.
import { LIVE_CHANNELS, PROBE_HEADER, type Source, type UsageEvent } from '@israel-tv/core';
import type { Store } from '@israel-tv/store';

export interface CanaryTarget {
  source: Source | 'live';
  showId: string;
  episodeId?: string;
  /** Streams the public addon itself offers (no resolver needed). */
  direct?: string;
}

/** One title the canary tried and could not play, while others of the same source played. */
export interface UnavailableTitle {
  episodeId: string;
  step: Step;
  detail?: string;
  statuses: number[];
}

export interface CanaryResult extends CanaryTarget {
  /** `ok`: the source plays (perhaps after skipping titles listed in `unavailable`); `error`: it does not. */
  outcome: 'ok' | 'error';
  /** Statuses in order: master, variant, segment. */
  statuses: number[];
  /** The step that failed, if any. */
  step?: 'pick' | 'stream' | 'master' | 'variant' | 'segment';
  detail?: string;
  via?: 'resolver' | 'direct';
  ms: number;
  /** Titles that failed on their own before one played: "episode unavailable", not "source broken". */
  unavailable?: UnavailableTitle[];
  /** Titles tried, in order. */
  tried?: number;
  /** The check was repeated (a relay failure may be the proxy exit's fault; the relay tries the next exit). */
  retried?: boolean;
}

const UA = 'Mozilla/5.0 (Linux; Android 12) ExoPlayer';

type Step = NonNullable<CanaryResult['step']>;

/** How many titles of one source the canary tries before calling the source broken. */
export const CANARY_TITLES = 3;
/** A title that failed is skipped as a first pick for this long (it may come back; Mako's did in minutes). */
export const CANARY_SKIP_MS = 24 * 3_600_000;
export const CANARY_SKIP_KEY = 'canary:skip';

/**
 * Candidates per source, best first: the newest playable episode of each of the most recently aired shows
 * (one per show, so one dead show cannot take every try), titles that failed lately last; one live channel.
 */
export function pickCandidates(
  store: Store,
  sources: readonly string[],
  skip: ReadonlySet<string> = new Set(),
): CanaryTarget[][] {
  const out: CanaryTarget[][] = [];
  for (const source of ['mako', 'reshet', 'kan'] as const) {
    if (!sources.includes(source)) continue;
    const shows = store
      .listShows({ source, state: 'listed' })
      .filter((s) => !s.lastError)
      .sort((a, b) => (b.latestAirDate ?? '').localeCompare(a.latestAirDate ?? ''));
    const picks: CanaryTarget[] = [];
    for (const row of shows.slice(0, 12)) {
      const eps = row.show.seasons.flatMap((s) => s.episodes);
      const playable = eps.filter((e) => (source === 'mako' ? e.play?.vcmid : e.streams.some((x) => x.url)));
      const numbers = new Map(store.assignments(row.seriesId).episodes.map((a) => [a.key, a]));
      const latest = playable
        .sort((a, b) => (b.airDate ?? '').localeCompare(a.airDate ?? ''))
        .find((e) => numbers.has(e.key));
      const n = latest ? numbers.get(latest.key) : undefined;
      if (!latest || !n) continue;
      const direct = latest.streams.find((x) => x.kind === 'direct')?.url;
      picks.push({
        source,
        showId: row.seriesId,
        episodeId: `${row.seriesId}:${n.season}:${n.episode}`,
        ...(direct ? { direct } : {}),
      });
      if (picks.length >= CANARY_TITLES * 2) break;
    }
    const fresh = picks.filter((p) => !skip.has(p.episodeId ?? ''));
    const stale = picks.filter((p) => skip.has(p.episodeId ?? ''));
    if (picks.length) out.push([...fresh, ...stale].slice(0, CANARY_TITLES));
  }
  if (sources.includes('live')) {
    const ch = LIVE_CHANNELS.find((c) => c.direct.length > 0 && !c.geo) ?? LIVE_CHANNELS[0];
    if (ch)
      out.push([{ source: 'live', showId: ch.id, ...(ch.direct[0] ? { direct: ch.direct[0].url } : {}) }]);
  }
  return out;
}

/** The first candidate per source (what a single check would play). */
export function pickTargets(store: Store, sources: readonly string[]): CanaryTarget[] {
  return pickCandidates(store, sources).flatMap((c) => c.slice(0, 1));
}

/** master → variant → first segment, with one User-Agent. */
export async function playCheck(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ statuses: number[]; step?: Step; detail?: string }> {
  const statuses: number[] = [];
  const get = (u: string, range = false) =>
    fetchImpl(u, {
      headers: { 'user-agent': UA, ...(range ? { range: 'bytes=0-65535' } : {}) },
      signal: AbortSignal.timeout(20_000),
    });
  const firstUri = (text: string, base: string) => {
    const line = text.split('\n').find((l) => l.trim() && !l.startsWith('#'));
    return line ? new URL(line.trim(), base).toString() : undefined;
  };
  try {
    const m = await get(url);
    statuses.push(m.status);
    if (!m.ok) return { statuses, step: 'master', detail: `master HTTP ${m.status}` };
    let base = m.url || url;
    const text = await m.text();
    // A DASH manifest (Kan's backup live streams) is a full description, not a list of URLs: answering it is the
    // check (its segments are addressed by templates).
    if (/<MPD[\s>]/.test(text.slice(0, 4096))) return { statuses };
    let next = firstUri(text, base);
    if (!next) return { statuses, step: 'master', detail: 'master lists nothing' };
    // A media playlist (no variants: Channel 14, ynet's 720p) lists segments itself: its first entry is the segment.
    if (!/#EXT-X-STREAM-INF/.test(text)) {
      const r = await get(next, true);
      statuses.push(r.status);
      await r.body?.cancel();
      return r.status === 200 || r.status === 206
        ? { statuses }
        : { statuses, step: 'segment', detail: `segment HTTP ${r.status}` };
    }
    // Variant playlists (a master may point at another master), then the first segment. What a URL is comes
    // from its answer (a playlist starts with #EXTM3U), not from its name.
    for (let level = 0; level < 3; level++) {
      const r = await get(next, true);
      statuses.push(r.status);
      const step = level === 0 ? 'variant' : 'segment';
      if (r.status !== 200 && r.status !== 206) return { statuses, step, detail: `${step} HTTP ${r.status}` };
      const body = new Uint8Array(await r.arrayBuffer());
      const head = new TextDecoder().decode(body.subarray(0, 7));
      if (head !== '#EXTM3U')
        return level === 0 ? { statuses, step, detail: 'variant is not a playlist' } : { statuses };
      base = r.url || next;
      next = firstUri(new TextDecoder().decode(body), base);
      if (!next) return { statuses, step, detail: 'playlist lists nothing' };
    }
    return { statuses, step: 'segment', detail: 'no segment within three playlist levels' };
  } catch (err) {
    const step: Step = statuses.length === 0 ? 'master' : statuses.length === 1 ? 'variant' : 'segment';
    return { statuses, step, detail: (err as Error).message };
  }
}

interface CheckOptions {
  resolverBase: string | undefined;
  fetchImpl: typeof fetch;
  /** Pause before repeating a relayed check (ms). */
  retryDelayMs: number;
}

/** Ask the resolver (when there is one) for a title's stream, else take the public addon's; then play-check it. */
async function checkOne(t: CanaryTarget, o: CheckOptions): Promise<CanaryResult> {
  const t0 = Date.now();
  let url: string | undefined;
  let via: CanaryResult['via'];
  if (o.resolverBase) {
    const id = t.episodeId ?? t.showId;
    const type = t.source === 'live' ? 'tv' : 'series';
    try {
      const r = await o.fetchImpl(`${o.resolverBase}/stream/${type}/${encodeURIComponent(id)}.json`, {
        headers: { [PROBE_HEADER]: 'canary' },
        signal: AbortSignal.timeout(20_000),
      });
      const j = (await r.json()) as { streams?: { url?: string }[] };
      url = j.streams?.find((s) => s.url)?.url;
      if (url) via = 'resolver';
    } catch {}
  }
  if (!url && t.direct) {
    url = t.direct;
    via = 'direct';
  }
  if (!url)
    return {
      ...t,
      outcome: 'error',
      statuses: [],
      step: 'stream',
      detail: 'no stream offered',
      ms: Date.now() - t0,
    };
  let c = await playCheck(url, o.fetchImpl);
  let retried = false;
  // Through the relay a refusal may be the proxy exit's fault: the relay has already tried its next exit for
  // that request; one more full check a little later settles it before anything is reported red.
  if (c.step && (/\/relay\//.test(url) || t.source === 'kan')) {
    retried = true;
    await new Promise((r) => setTimeout(r, o.retryDelayMs));
    c = await playCheck(url, o.fetchImpl);
  }
  return {
    ...t,
    ...c,
    outcome: c.step ? 'error' : 'ok',
    ...(via ? { via } : {}),
    ...(retried ? { retried } : {}),
    ms: Date.now() - t0,
  };
}

/** A failure that belongs to one title (the source answered, this title would not play). */
function titleProblem(r: CanaryResult): boolean {
  if (r.step === 'stream') return true;
  const last = r.statuses.at(-1);
  return last !== undefined && last >= 400 && last < 500;
}

/**
 * Run the canary. Per source, titles are tried in turn: a title that fails on its own (4xx, no stream) is
 * reported as unavailable and the next one is tried; the source is red only when none of its titles plays,
 * or when a failure is not the title's (5xx, network). Failed titles are remembered for a day so the next
 * run starts with another one.
 */
export async function runCanary(
  store: Store,
  sources: readonly string[],
  resolverBase: string | undefined,
  fetchImpl: typeof fetch = fetch,
  { now = Date.now(), retryDelayMs = 20_000 }: { now?: number; retryDelayMs?: number } = {},
): Promise<CanaryResult[]> {
  const skipped = Object.entries(store.getState<Record<string, string>>(CANARY_SKIP_KEY) ?? {}).filter(
    ([, at]) => now - Date.parse(at) < CANARY_SKIP_MS,
  );
  const skip = new Map(skipped);
  const out: CanaryResult[] = [];
  const o = { resolverBase, fetchImpl, retryDelayMs };
  for (const candidates of pickCandidates(store, sources, new Set(skip.keys()))) {
    const unavailable: UnavailableTitle[] = [];
    let result: CanaryResult | undefined;
    for (const [i, t] of candidates.entries()) {
      const r = await checkOne(t, o);
      result = { ...r, tried: i + 1 };
      if (r.outcome === 'ok') {
        if (r.episodeId) skip.delete(r.episodeId);
        break;
      }
      if (r.episodeId) skip.set(r.episodeId, new Date(now).toISOString());
      if (!titleProblem(r) || i === candidates.length - 1) break;
      if (r.episodeId)
        unavailable.push({
          episodeId: r.episodeId,
          step: r.step ?? 'master',
          statuses: r.statuses,
          ...(r.detail ? { detail: r.detail } : {}),
        });
    }
    if (result) out.push(unavailable.length ? { ...result, unavailable } : result);
  }
  store.setState(CANARY_SKIP_KEY, Object.fromEntries(skip));
  return out;
}

/** A canary result as an event. */
export function canaryEvent(r: CanaryResult): UsageEvent {
  return {
    ts: new Date().toISOString(),
    kind: 'canary',
    component: 'canary',
    outcome: r.outcome,
    source: r.source,
    showId: r.showId,
    ...(r.episodeId ? { episodeId: r.episodeId } : {}),
    ...(r.statuses.length ? { status: r.statuses.at(-1) as number } : {}),
    latencyMs: r.ms,
    detail: {
      statuses: r.statuses.join('/'),
      ...(r.step ? { step: r.step } : {}),
      ...(r.detail ? { reason: r.detail } : {}),
      ...(r.via ? { via: r.via } : {}),
      ...(r.tried && r.tried > 1 ? { tried: r.tried } : {}),
      ...(r.retried ? { retried: true } : {}),
      ...(r.unavailable?.length ? { unavailable: r.unavailable } : {}),
    },
  };
}
