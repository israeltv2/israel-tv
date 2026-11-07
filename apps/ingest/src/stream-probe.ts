// Stream probes: facts about published streams that only playing them tells, measured once and remembered.
// - Kan: whether a title plays outside Israel. Kan blocks per title (measured 2026-11-07 from abroad: some titles
//   play fully, others are refused at the playlist). This instance is outside Israel when it has a geo proxy into
//   Israel (why else have one), so it asks Kan directly, without the proxy: the newest episode of each title,
//   playlist → variant → first segment. Inside Israel nothing can be told, and every Kan title stays labelled.
// - Reshet: the best quality each episode really has (Kaltura masters top out at 540p or 720p), read from the
//   master playlist's RESOLUTION lines.
// Results live in the store's key-value state; the publisher reads them (render: RenderInput.probes).
import type { Config } from '@israel-tv/core';
import type { Store } from '@israel-tv/store';

export const KAN_ABROAD_KEY = 'probe:kan-abroad';
export const QUALITY_KEY = 'probe:quality';

/** A title is asked again after this long (Kan changes rights now and then). */
const RECHECK_MS = 7 * 86_400_000;
/** A probe that could not tell (network, server error) is tried again after this long. */
const RETRY_MS = 6 * 3_600_000;
const TIMEOUT_MS = 15_000;
const UA = 'Mozilla/5.0 (compatible; israel-tv stream check)';

export interface KanAbroad {
  at: string;
  /** True: plays from outside Israel; false: refused there (HTTP 403/451). Absent: could not tell. */
  plays?: boolean;
  status: number;
  /** The episode that was asked, as `season:episode`-free source key. */
  episode: string;
}
export type KanAbroadState = Record<string, KanAbroad>;
/** Episode key (Reshet: Kaltura entry id) → its best height, or 0 when the master could not be read. */
export type QualityState = Record<string, { at: string; height: number }>;

export type ProbeFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface HlsProbe {
  /** `ok`: playlist, variant and segment answered; `refused`: a geo answer (403/451); `failed`: anything else. */
  result: 'ok' | 'refused' | 'failed';
  status: number;
  /** The tallest rendition the master lists. */
  maxHeight?: number;
  step?: 'master' | 'variant' | 'segment';
}

/** The tallest RESOLUTION in a master playlist. */
export function maxHeight(master: string): number | undefined {
  let best: number | undefined;
  for (const m of master.matchAll(/RESOLUTION=\d+x(\d+)/g)) {
    const h = Number(m[1]);
    if (h > (best ?? 0)) best = h;
  }
  return best;
}

const firstUri = (playlist: string) =>
  playlist
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));

/** Playlists larger than this are not playlists. */
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;

/** Only public https addresses are asked (a playlist pointing into this network is refused). */
export function publicHttps(u: string): boolean {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  const h = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (url.protocol !== 'https:' || h === 'localhost' || /\.(local|localhost)$/.test(h)) return false;
  if (
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
      h,
    )
  )
    return false;
  return !/^(::1?|f[cd][0-9a-f]{2}:|fe80:)/i.test(h);
}

async function textUpTo(r: Response, max = MAX_PLAYLIST_BYTES): Promise<string> {
  if (!r.body) return '';
  const reader = r.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return '';
    }
    parts.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(parts));
}

/** Master → first variant → first segment (2 KB of it), following redirects. `segment: false` stops at the master. */
export async function probeHls(
  url: string,
  fetchImpl: ProbeFetch = fetch,
  opts: { segment?: boolean } = {},
): Promise<HlsProbe> {
  /** One request, following up to 5 redirects by hand so every hop is a public https address. */
  const get = async (u: string, range = false): Promise<Response> => {
    let at = u;
    for (let hop = 0; hop < 6; hop++) {
      if (!publicHttps(at)) return new Response(null, { status: 400 });
      const r = await fetchImpl(at, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': UA, ...(range ? { range: 'bytes=0-2047' } : {}) },
      });
      const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
      if (!loc) {
        // Remember where the answer came from (relative playlist entries resolve against it).
        if (at !== u) Object.defineProperty(r, 'url', { value: at });
        return r;
      }
      await r.body?.cancel();
      at = new URL(loc, at).toString();
    }
    return new Response(null, { status: 508 });
  };
  const judge = (status: number, step: NonNullable<HlsProbe['step']>): HlsProbe => ({
    result: status === 403 || status === 451 ? 'refused' : 'failed',
    status,
    step,
  });
  try {
    const m = await get(url);
    if (!m.ok) return judge(m.status, 'master');
    const master = await textUpTo(m);
    if (!master.includes('#EXTM3U')) return judge(m.status, 'master');
    const height = maxHeight(master);
    const withHeight = height ? { maxHeight: height } : {};
    if (opts.segment === false) return { result: 'ok', status: 200, ...withHeight };
    const variantUri = firstUri(master);
    if (!variantUri) return { result: 'failed', status: 200, step: 'master', ...withHeight };
    const vUrl = new URL(variantUri, m.url || url).href;
    // A media playlist is its own variant.
    let mediaUrl = vUrl;
    let media = master;
    if (master.includes('#EXT-X-STREAM-INF')) {
      const v = await get(vUrl);
      if (!v.ok) return { ...judge(v.status, 'variant'), ...withHeight };
      media = await textUpTo(v);
      mediaUrl = v.url || vUrl;
    }
    const segUri = firstUri(media);
    if (!segUri) return { result: 'failed', status: 200, step: 'variant', ...withHeight };
    const s = await get(new URL(segUri, mediaUrl).href, true);
    await s.body?.cancel();
    if (!s.ok) return { ...judge(s.status, 'segment'), ...withHeight };
    return { result: 'ok', status: s.status, ...withHeight };
  } catch {
    return { result: 'failed', status: 0 };
  }
}

/** True when this instance sits outside Israel (it reaches Israel through a geo proxy). */
export function probesAbroad(config: Pick<Config, 'geo'>): boolean {
  return config.geo.type !== 'none';
}

const due = (at: string | undefined, plays: boolean | undefined, now: number) =>
  !at || now - Date.parse(at) > (plays === undefined ? RETRY_MS : RECHECK_MS);

async function pool<T>(items: T[], n: number, work: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await work(items[i++] as T);
    }),
  );
}

export interface ProbeOptions {
  /** At most this many playlist reads in one call (spread over the day's runs). */
  budget?: number;
  fetch?: ProbeFetch;
  now?: number;
  log?: (line: string) => void;
}

/**
 * Probe what is due: Kan titles from abroad (newest episode each), then Reshet episodes whose quality is not known
 * (newest shows first). Returns how many probes ran.
 */
export async function probeStreams(
  store: Store,
  config: Pick<Config, 'geo' | 'sources'>,
  opts: ProbeOptions = {},
): Promise<{ kan: number; quality: number }> {
  const now = opts.now ?? Date.now();
  const f = opts.fetch ?? fetch;
  let budget = opts.budget ?? 300;
  const shows = store.listShows().filter((s) => s.state === 'listed');
  let kan = 0;
  if (config.sources.kan && probesAbroad(config)) {
    const state = store.getState<KanAbroadState>(KAN_ABROAD_KEY) ?? {};
    const todo = shows
      .filter((s) => s.source === 'kan' && due(state[s.seriesId]?.at, state[s.seriesId]?.plays, now))
      .sort((a, b) => (b.latestAirDate ?? '').localeCompare(a.latestAirDate ?? ''))
      .slice(0, Math.max(0, Math.floor(budget / 3)));
    await pool(todo, 3, async (s) => {
      const eps = s.show.seasons.flatMap((x) => x.episodes).filter((e) => e.streams[0]);
      const newest = [...eps].sort((a, b) => (b.airDate ?? '').localeCompare(a.airDate ?? ''))[0];
      const url = newest?.streams[0]?.url;
      if (!newest || !url) return;
      const p = await probeHls(url, f);
      const plays = p.result === 'ok' ? true : p.result === 'refused' ? false : undefined;
      state[s.seriesId] = {
        at: new Date(now).toISOString(),
        status: p.status,
        episode: newest.key,
        ...(plays !== undefined ? { plays } : {}),
      };
      kan++;
    });
    budget -= kan * 3;
    if (kan > 0) store.setState(KAN_ABROAD_KEY, state);
  }
  let quality = 0;
  if (config.sources.reshet && budget > 0) {
    const state = store.getState<QualityState>(QUALITY_KEY) ?? {};
    const todo: { key: string; url: string }[] = [];
    for (const s of [...shows]
      .filter((x) => x.source === 'reshet')
      .sort((a, b) => (b.latestAirDate ?? '').localeCompare(a.latestAirDate ?? ''))) {
      for (const e of s.show.seasons.flatMap((x) => x.episodes)) {
        const url = e.streams.find((x) => x.kind === 'direct')?.url;
        const known = state[e.key];
        if (url && (!known || (known.height === 0 && now - Date.parse(known.at) > RETRY_MS)))
          todo.push({ key: e.key, url });
        if (todo.length >= budget) break;
      }
      if (todo.length >= budget) break;
    }
    await pool(todo, 4, async ({ key, url }) => {
      const p = await probeHls(url, f, { segment: false });
      state[key] = { at: new Date(now).toISOString(), height: p.maxHeight ?? 0 };
      quality++;
    });
    if (quality > 0) store.setState(QUALITY_KEY, state);
  }
  if (kan + quality > 0)
    opts.log?.(`stream probes: ${kan} Kan titles from abroad, ${quality} Reshet qualities`);
  return { kan, quality };
}

/** What the renderer needs from the probes. */
export function probeResults(store: Store): {
  israelOnly: Record<string, boolean>;
  quality: Record<string, string>;
} {
  const kan = store.getState<KanAbroadState>(KAN_ABROAD_KEY) ?? {};
  const q = store.getState<QualityState>(QUALITY_KEY) ?? {};
  return {
    israelOnly: Object.fromEntries(
      Object.entries(kan)
        .filter(([, v]) => v.plays !== undefined)
        .map(([id, v]) => [id, v.plays === false]),
    ),
    quality: Object.fromEntries(
      Object.entries(q)
        .filter(([, v]) => v.height > 0)
        .map(([k, v]) => [k, `${v.height}p`]),
    ),
  };
}
