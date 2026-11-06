// Kan VOD crawler. Kan pages need a real browser, and only the first page of a browser session passes
// Cloudflare, so every page costs a fresh browser context (and, outside Israel, a fresh proxy session).
// The crawl therefore runs in small slices with a page budget and keeps its progress in the store:
// lobbies daily, show pages when due, then episode pages oldest first. The catalog fills over days and
// then stays current with a few pages per day.
import {
  assignNumbers,
  type BrowserConfig,
  type ScrapedEpisode,
  type ScrapedSeason,
  type ScrapedShow,
} from '@israel-tv/core';
import {
  createChromeLoader,
  type PageLoader,
  parseEpisodePage,
  parseLobby,
  parseShowPage,
} from '@israel-tv/kan';
import type { ProxyEndpoint } from '@israel-tv/net';
import type { Store } from '@israel-tv/store';
import { latestAirDate } from './runner.ts';

export interface KanLobby {
  url: string;
  origin: string;
  channelPath: string;
  catalog: string;
}

export const KAN_LOBBIES: KanLobby[] = [
  {
    url: 'https://www.kan.org.il/lobby/kan11/',
    origin: 'https://www.kan.org.il',
    channelPath: 'kan/kan-11',
    catalog: 'iltv_kan11',
  },
  {
    url: 'https://www.kankids.org.il/lobby-kids/kids-teens',
    origin: 'https://www.kankids.org.il',
    channelPath: 'kids/hinuchit-main',
    catalog: 'iltv_kankids',
  },
  {
    url: 'https://www.kankids.org.il/lobby-kids/kids-teens',
    origin: 'https://www.kankids.org.il',
    channelPath: 'kids/ktantanim-main',
    catalog: 'iltv_kankids',
  },
];

interface ShowState {
  origin: string;
  catalog: string;
  checkedAt?: string;
  title?: string;
  description?: string;
  image?: string;
  /** Episode page paths found on the show page and not read yet. */
  pending: string[];
  /** Episode page paths that failed to parse (not retried until the show page is read again). */
  failed: string[];
  /** Last time a re-read of the show page found new episode links (not set by the first read). */
  lastNewAt?: string;
}

interface CrawlState {
  lobbiesAt?: string;
  backoffUntil?: string;
  shows: Record<string, ShowState>;
}

const STATE_KEY = 'kan:crawl';
const HOUR = 3_600_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface KanCrawlOptions {
  browser: BrowserConfig;
  proxy?: ProxyEndpoint;
  pagesPerRun: number;
  pageIntervalMs: number;
  /** Shows with an episode in this many days are re-read every 6 hours; others weekly. */
  airingWindowDays: number;
  /** Test seam. */
  loader?: PageLoader;
  /** Test seam: whether a Redge URL plays from here without the proxy. */
  playsDirectly?: (hls: string) => Promise<boolean>;
  log?: (line: string) => void;
}

async function defaultPlaysDirectly(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    await r.body?.cancel();
    return r.ok;
  } catch {
    return false;
  }
}

export function showDue(s: ShowState, now: number, windowDays: number): boolean {
  if (!s.checkedAt) return true;
  const age = now - Date.parse(s.checkedAt);
  const airing = s.lastNewAt !== undefined && now - Date.parse(s.lastNewAt) < windowDays * 86_400_000;
  return age > (airing ? 6 : 7 * 24) * HOUR;
}

export function toEpisode(
  e: ReturnType<typeof parseEpisodePage> & object,
  availableAbroad: boolean | undefined,
): ScrapedEpisode {
  return {
    key: `kan:${e.id}`,
    title: e.title,
    ...(e.description ? { description: e.description } : {}),
    ...(e.poster ? { thumbnail: e.poster } : {}),
    ...(availableAbroad !== undefined ? { availableAbroad } : {}),
    streams: [{ url: e.hls, kind: 'direct' }],
  };
}

/** Add episodes to a show, grouped into seasons by Kan's season number. */
export function mergeEpisodes(
  show: ScrapedShow,
  added: { episode: ScrapedEpisode; season: number | undefined }[],
): ScrapedShow {
  const seasons = new Map<string, ScrapedSeason>(
    show.seasons.map((s) => [s.key, { ...s, episodes: [...s.episodes] }]),
  );
  for (const { episode, season } of added) {
    const key = `${show.key}|s${season ?? 1}`;
    const s = seasons.get(key) ?? { key, title: `עונה ${season ?? 1}`, episodes: [] };
    if (!s.episodes.some((e) => e.key === episode.key)) s.episodes.push(episode);
    seasons.set(key, s);
  }
  const list = [...seasons.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return { ...show, seasons: list };
}

export async function crawlKan(
  store: Store,
  opts: KanCrawlOptions,
): Promise<{ pages: number; newEpisodes: number; note: string; failed?: boolean }> {
  const log = opts.log ?? (() => {});
  const now = Date.now();
  const state = store.getState<CrawlState>(STATE_KEY) ?? { shows: {} };
  if (state.backoffUntil && Date.parse(state.backoffUntil) > now) {
    return { pages: 0, newEpisodes: 0, note: `backing off until ${state.backoffUntil}` };
  }
  if (opts.browser.type === 'none')
    return { pages: 0, newEpisodes: 0, note: 'browser.type is none: Kan is off' };

  const runId = store.startRun('crawl', 'kan');
  let loader: PageLoader | undefined = opts.loader;
  const playsDirectly = opts.playsDirectly ?? defaultPlaysDirectly;
  let pages = 0;
  let newEpisodes = 0;
  let blocked = 0;
  let note = '';

  const origin = (url: string) => new URL(url).origin;
  const load = async (url: string) => {
    if (pages > 0) await sleep(opts.pageIntervalMs);
    pages++;
    loader ??= await createChromeLoader(
      opts.browser as Extract<BrowserConfig, { type: 'chrome' }>,
      opts.proxy,
    );
    const r = await loader.load(url);
    if (r.challenged || r.status === 403 || r.status === 407) {
      blocked++;
      throw new Error(`${url}: ${r.challenged ? 'Cloudflare challenge did not clear' : `HTTP ${r.status}`}`);
    }
    blocked = 0;
    if (r.status >= 400) throw new Error(`${url}: HTTP ${r.status}`);
    return r.html;
  };

  try {
    // 1. Lobbies, once a day.
    if (!state.lobbiesAt || now - Date.parse(state.lobbiesAt) > 24 * HOUR) {
      const byUrl = new Map<string, string>();
      for (const l of KAN_LOBBIES) {
        if (!byUrl.has(l.url) && pages >= opts.pagesPerRun) break;
        const html = byUrl.get(l.url) ?? (await load(l.url));
        byUrl.set(l.url, html);
        for (const path of parseLobby(html, l.origin, l.channelPath)) {
          const key = `${l.origin}${path}`;
          state.shows[key] ??= { origin: l.origin, catalog: l.catalog, pending: [], failed: [] };
        }
      }
      if (byUrl.size === new Set(KAN_LOBBIES.map((l) => l.url)).size)
        state.lobbiesAt = new Date(now).toISOString();
      log(`kan: ${Object.keys(state.shows).length} shows known`);
    }

    // 2. Show pages that are due (never read, airing, or a week old). While episode pages are waiting,
    //    at most half the slice goes to show pages, so both make progress.
    const waiting = Object.values(state.shows).some((s) => s.pending.length > 0);
    const showBudget = waiting ? Math.ceil(opts.pagesPerRun / 2) : opts.pagesPerRun;
    for (const [key, s] of Object.entries(state.shows)) {
      if (pages >= showBudget) break;
      const id = store.findSeriesId('kan', key);
      if (!showDue(s, now, opts.airingWindowDays)) continue;
      const firstRead = !s.checkedAt;
      const path = new URL(key).pathname;
      let page: ReturnType<typeof parseShowPage>;
      try {
        page = parseShowPage(await load(key), path, s.origin);
      } catch (err) {
        if (blocked > 0) throw err;
        // A broken show page is that show's problem only: note it and try again next week.
        s.checkedAt = new Date().toISOString();
        store.addWarnings(runId, id ?? null, [
          { code: 'source-note', message: `Kan ${key}: ${(err as Error).message}` },
        ]);
        continue;
      }
      s.checkedAt = new Date().toISOString();
      if (page.title) s.title = page.title;
      if (page.description) s.description = page.description;
      if (page.image) s.image = page.image;
      const known = new Set(
        id ? (store.getShow(id)?.show.seasons.flatMap((x) => x.episodes.map((e) => e.key)) ?? []) : [],
      );
      const seenBefore = new Set([...s.pending, ...s.failed]);
      s.failed = [];
      s.pending = page.episodes
        .map((e) => `${s.origin}${e.path}`)
        .filter((u) => !known.has(`kan:${/(\d+)\/$/.exec(u)?.[1]}`));
      // "Airing" means the show page revealed links we had never seen, not an old backlog or retries.
      if (!firstRead && s.pending.some((u) => !seenBefore.has(u))) s.lastNewAt = s.checkedAt;
      // Single-video show: the video is on the show page itself.
      if (page.episodes.length === 0 && page.featured) {
        newEpisodes += saveEpisodes(store, key, s, [
          { episode: toEpisode(page.featured, await playsDirectly(page.featured.hls)), season: undefined },
        ]);
      }
    }

    // 3. Episode pages, airing shows first, oldest episode first within a show.
    const queue = Object.entries(state.shows)
      .filter(([, s]) => s.pending.length > 0)
      .sort(([, a], [, b]) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? ''));
    for (const [key, s] of queue) {
      const batch: { episode: ScrapedEpisode; season: number | undefined }[] = [];
      try {
        while (s.pending.length > 0 && pages < opts.pagesPerRun) {
          const url = s.pending[0] as string;
          let problem: string | undefined;
          try {
            const e = parseEpisodePage(await load(url), origin(url));
            if (e) batch.push({ episode: toEpisode(e, await playsDirectly(e.hls)), season: e.seasonNumber });
            else problem = 'no video player config on the page (layout changed?)';
          } catch (err) {
            if (blocked > 0) throw err;
            problem = (err as Error).message;
          }
          if (problem) {
            s.failed.push(url);
            store.addWarnings(runId, store.findSeriesId('kan', key) ?? null, [
              { code: 'source-note', message: `Kan episode ${url}: ${problem}` },
            ]);
          }
          s.pending.shift();
        }
      } finally {
        // Episodes read before a block are kept, never re-read.
        if (batch.length > 0) newEpisodes += saveEpisodes(store, key, s, batch);
      }
      if (pages >= opts.pagesPerRun) break;
    }
    const pendingTotal = Object.values(state.shows).reduce((n, s) => n + s.pending.length, 0);
    note = `${pages} pages, +${newEpisodes} episodes, ${pendingTotal} episode pages still to read`;
    store.finishRun(runId, { status: 'ok', requests: pages, newEpisodes });
  } catch (err) {
    // Blocked (challenge / proxy refusal): stop and wait well before trying again.
    state.backoffUntil = new Date(Date.now() + 45 * 60_000).toISOString();
    note = `stopped: ${(err as Error).message}; next try after ${state.backoffUntil}`;
    store.finishRun(runId, {
      status: newEpisodes > 0 ? 'partial' : 'failed',
      requests: pages,
      newEpisodes,
      error: note,
    });
  } finally {
    store.setState(STATE_KEY, state);
    if (!opts.loader) await loader?.close();
  }
  log(`kan: ${note}`);
  return { pages, newEpisodes, note, ...(note.startsWith('stopped:') ? { failed: true } : {}) };
}

function saveEpisodes(
  store: Store,
  key: string,
  s: ShowState,
  batch: { episode: ScrapedEpisode; season: number | undefined }[],
): number {
  const seriesId = store.seriesIdFor('kan', key);
  const prev = store.getShow(seriesId)?.show;
  const base: ScrapedShow = prev ?? {
    source: 'kan',
    key,
    title: s.title || key,
    catalog: s.catalog,
    seasons: [],
    pageUrl: key,
  };
  const show = mergeEpisodes(
    {
      ...base,
      title: s.title || base.title,
      ...(s.description ? { description: s.description } : {}),
      ...(s.image ? { poster: s.image, background: s.image } : {}),
    },
    batch,
  );
  const numbering = assignNumbers(show, store.assignments(seriesId));
  return store.saveShow(seriesId, show, numbering.added, latestAirDate(show));
}
