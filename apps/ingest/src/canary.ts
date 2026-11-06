// The daily playback canary: once a day, play one recent title per source end to end, the way a viewer at home
// would — ask the home resolver for its streams (else the public addon's direct stream), then fetch the master
// playlist, a variant playlist and the first bytes of the first segment. Expected 200, 200, 206 (a CDN that
// ignores Range and answers 200 also passes). Titles are picked from the catalog (recent and playable), never
// hard-coded.
import { LIVE_CHANNELS, type Source, type UsageEvent } from '@israel-tv/core';
import type { Store } from '@israel-tv/store';

export interface CanaryTarget {
  source: Source | 'live';
  showId: string;
  episodeId?: string;
  /** Streams the public addon itself offers (no resolver needed). */
  direct?: string;
}

export interface CanaryResult extends CanaryTarget {
  outcome: 'ok' | 'error';
  /** Statuses in order: master, variant, segment. */
  statuses: number[];
  /** The step that failed, if any. */
  step?: 'pick' | 'stream' | 'master' | 'variant' | 'segment';
  detail?: string;
  via?: 'resolver' | 'direct';
  ms: number;
}

const UA = 'Mozilla/5.0 (Linux; Android 12) ExoPlayer';

type Step = NonNullable<CanaryResult['step']>;

/** The newest episode of the most recently aired show with something playable, per source; one live channel. */
export function pickTargets(store: Store, sources: readonly string[]): CanaryTarget[] {
  const out: CanaryTarget[] = [];
  for (const source of ['mako', 'reshet', 'kan'] as const) {
    if (!sources.includes(source)) continue;
    const shows = store
      .listShows({ source, state: 'listed' })
      .filter((s) => !s.lastError)
      .sort((a, b) => (b.latestAirDate ?? '').localeCompare(a.latestAirDate ?? ''));
    for (const row of shows.slice(0, 10)) {
      const eps = row.show.seasons.flatMap((s) => s.episodes);
      const playable = eps.filter((e) => (source === 'mako' ? e.play?.vcmid : e.streams.some((x) => x.url)));
      const latest = playable.sort((a, b) => (b.airDate ?? '').localeCompare(a.airDate ?? '')).at(0);
      const numbers = latest
        ? store.assignments(row.seriesId).episodes.find((a) => a.key === latest.key)
        : undefined;
      if (!latest || !numbers) continue;
      const direct = latest.streams.find((x) => x.kind === 'direct')?.url;
      out.push({
        source,
        showId: row.seriesId,
        episodeId: `${row.seriesId}:${numbers.season}:${numbers.episode}`,
        ...(direct ? { direct } : {}),
      });
      break;
    }
  }
  if (sources.includes('live')) {
    const ch = LIVE_CHANNELS.find((c) => c.direct.length > 0 && !c.geo) ?? LIVE_CHANNELS[0];
    if (ch)
      out.push({ source: 'live', showId: ch.id, ...(ch.direct[0] ? { direct: ch.direct[0].url } : {}) });
  }
  return out;
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
    let next = firstUri(text, base);
    if (!next) return { statuses, step: 'master', detail: 'master lists nothing' };
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

/** Run the canary: ask the resolver (when there is one) for each title's stream, then play-check it. */
export async function runCanary(
  store: Store,
  sources: readonly string[],
  resolverBase: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<CanaryResult[]> {
  const out: CanaryResult[] = [];
  for (const t of pickTargets(store, sources)) {
    const t0 = Date.now();
    let url: string | undefined;
    let via: CanaryResult['via'];
    if (resolverBase) {
      const id = t.episodeId ?? t.showId;
      const type = t.source === 'live' ? 'tv' : 'series';
      try {
        const r = await fetchImpl(`${resolverBase}/stream/${type}/${encodeURIComponent(id)}.json`, {
          headers: { 'x-israel-tv-canary': '1' },
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
    if (!url) {
      out.push({
        ...t,
        outcome: 'error',
        statuses: [],
        step: 'stream',
        detail: 'no stream offered',
        ms: Date.now() - t0,
      });
      continue;
    }
    const c = await playCheck(url, fetchImpl);
    out.push({ ...t, ...c, outcome: c.step ? 'error' : 'ok', ...(via ? { via } : {}), ms: Date.now() - t0 });
  }
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
    },
  };
}
