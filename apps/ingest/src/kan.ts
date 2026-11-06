// Kan VOD crawler. Kan pages need a real browser, and only the first page of a browser session passes
// Cloudflare, so every page costs a fresh browser context (and, outside Israel, a fresh proxy session).
// The crawl therefore runs in small slices with a page budget and keeps its progress in the store:
// lobbies daily, show pages when due, then episode pages oldest first. The catalog fills over days and
// then stays current with a few pages per day.

import { setTimeout as sleep } from 'node:timers/promises';
import {
  assignNumbers,
  type BrowserConfig,
  type Config,
  cleanShow,
  DAY_MS,
  HOUR_MS,
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
  /** Episode pages given up on after several tries; kept so they never re-enter the queue. */
  failed: string[];
  /** Last time a re-read of the show page found new episode links (not set by the first read). */
  lastNewAt?: string;
  /** Episode pages found as new on a re-read (newly published), as opposed to the first fill's backlog. */
  fresh?: string[];
  /** When a show page that was never read successfully last failed (retried after a week). */
  failedAt?: string;
  /** Episode pages that failed and will be tried again before reading past them. */
  retry?: Record<string, { n: number; at: string }>;
}

interface CrawlState {
  lobbiesAt?: string;
  backoffUntil?: string;
  shows: Record<string, ShowState>;
}

const STATE_KEY = 'kan:crawl';
/** A failed episode page is tried this many times, at least RETRY_GAP_MS apart, before it is skipped. */
const MAX_EPISODE_TRIES = 3;
const RETRY_GAP_MS = 2 * 3_600_000;
const HOUR = HOUR_MS;

export interface KanCrawlOptions {
  browser: BrowserConfig;
  proxy?: ProxyEndpoint;
  pagesPerRun: number;
  pageIntervalMs: number;
  /** Shows with an episode in this many days are re-read every 6 hours; others weekly. */
  airingWindowDays: number;
  /** Shows to read first in this slice, whatever their schedule (single-show refresh). */
  priority?: string[];
  /** Test seam. */
  loader?: PageLoader;
  log?: (line: string) => void;
}

export function showDue(s: ShowState, now: number, windowDays: number): boolean {
  if (!s.checkedAt) return !s.failedAt || now - Date.parse(s.failedAt) > 7 * 24 * HOUR;
  const age = now - Date.parse(s.checkedAt);
  const airing = s.lastNewAt !== undefined && now - Date.parse(s.lastNewAt) < windowDays * DAY_MS;
  return age > (airing ? 6 : 7 * 24) * HOUR;
}

/** Episodes are keyed by their Kan page id (stable; the player config's id on an episode page). */
export function kanEpisodeKey(e: { id: string }): string {
  return `kan:${e.id}`;
}

/** Kan VOD is geo-blocked outside Israel per title, nearly always (measured): labelled Israel-only. */
export function toEpisode(e: ReturnType<typeof parseEpisodePage> & object): ScrapedEpisode {
  return {
    key: kanEpisodeKey(e),
    title: e.title,
    ...(e.description ? { description: e.description } : {}),
    ...(e.poster ? { thumbnail: e.poster } : {}),
    availableAbroad: false,
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
): Promise<{
  pages: number;
  newEpisodes: number;
  note: string;
  failed?: boolean;
  readShows?: string[];
  attemptedShows?: string[];
}> {
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
  let pages = 0;
  let newEpisodes = 0;
  let blocked = 0;
  let problems = 0;
  const readShows: string[] = [];
  /** Shows whose page was read or failed without a block (a refresh of them is done either way). */
  const attemptedShows: string[] = [];
  let note = '';

  const origin = (url: string) => new URL(url).origin;
  const load = async (url: string) => {
    if (pages > 0) await sleep(opts.pageIntervalMs);
    pages++;
    let r: Awaited<ReturnType<PageLoader['load']>>;
    try {
      loader ??= await createChromeLoader(
        opts.browser as Extract<BrowserConfig, { type: 'chrome' }>,
        opts.proxy,
      );
      r = await loader.load(url);
    } catch (err) {
      // The browser could not load the page at all (proxy refused or down, browser missing): that is the
      // slice failing, not this page — back off instead of marking pages as broken.
      blocked++;
      throw new Error(`${url}: ${(err as Error).message.split('\n')[0]}`);
    }
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
      let lobbyEmpty = false;
      for (const l of KAN_LOBBIES) {
        if (!byUrl.has(l.url) && pages >= opts.pagesPerRun) break;
        const html = byUrl.get(l.url) ?? (await load(l.url));
        byUrl.set(l.url, html);
        const paths = parseLobby(html, l.origin, l.channelPath);
        if (paths.length === 0) {
          // A lobby that loads but lists no shows is a layout change: say so and try again next slice.
          problems++;
          lobbyEmpty = true;
          store.addWarnings(runId, null, [
            { code: 'source-note', message: `Kan lobby ${l.url} (${l.channelPath}) lists no shows` },
          ]);
        }
        for (const path of paths) {
          const key = `${l.origin}${path}`;
          state.shows[key] ??= { origin: l.origin, catalog: l.catalog, pending: [], failed: [] };
        }
      }
      if (!lobbyEmpty && byUrl.size === new Set(KAN_LOBBIES.map((l) => l.url)).size)
        state.lobbiesAt = new Date(now).toISOString();
      log(`kan: ${Object.keys(state.shows).length} shows known`);
    }

    // 2. Show pages that are due (never read, airing, or a week old). While episode pages are waiting,
    //    at most half the slice goes to show pages, so both make progress.
    const waiting = Object.values(state.shows).some((s) => s.pending.length > 0);
    const showBudget = waiting ? Math.ceil(opts.pagesPerRun / 2) : opts.pagesPerRun;
    // Refresh requests first, made due now; then everything else in order.
    const prio = new Set((opts.priority ?? []).filter((k) => state.shows[k]));
    const order = [...prio, ...Object.keys(state.shows).filter((k) => !prio.has(k))];
    for (const key of order) {
      const s = state.shows[key];
      if (!s) continue;
      if (pages >= showBudget && !prio.has(key)) break;
      const id = store.findSeriesId('kan', key);
      if (!prio.has(key) && !showDue(s, now, opts.airingWindowDays)) continue;
      const firstRead = !s.checkedAt;
      const path = new URL(key).pathname;
      let page: ReturnType<typeof parseShowPage>;
      try {
        page = parseShowPage(await load(key), path);
      } catch (err) {
        if (blocked > 0) throw err;
        attemptedShows.push(key);
        // A broken show page is that show's problem only: note it and try again next week. A show never read
        // successfully keeps "first read" status, so its backlog is not mistaken for new episodes later.
        if (s.checkedAt) s.checkedAt = new Date().toISOString();
        else s.failedAt = new Date().toISOString();
        store.addWarnings(runId, id ?? null, [
          { code: 'source-note', message: `Kan ${key}: ${(err as Error).message}` },
        ]);
        // A show we already have: keep its data, and show it as failing on /status.
        if (id) {
          problems++;
          store.markShowFailed(id, `kept last good data: ${(err as Error).message}`);
        }
        continue;
      }
      s.checkedAt = new Date().toISOString();
      readShows.push(key);
      attemptedShows.push(key);
      if (page.title) s.title = page.title;
      if (page.description) s.description = page.description;
      if (page.image) s.image = page.image;
      const known = new Set(
        id ? (store.getShow(id)?.show.seasons.flatMap((x) => x.episodes.map((e) => e.key)) ?? []) : [],
      );
      const seenBefore = new Set([...s.pending, ...s.failed]);
      // Pages given up on (after several tries) stay given up: they never re-enter the ordered queue, where
      // they would hold back newer episodes and, if they ever loaded, be numbered after them.
      const gaveUp = new Set(s.failed);
      s.pending = page.episodes
        .map((e) => `${s.origin}${e.path}`)
        .filter((u) => !known.has(`kan:${/(\d+)\/$/.exec(u)?.[1]}`) && !gaveUp.has(u));
      // "Airing" means the show page revealed links we had never seen, not an old backlog or retries.
      const fresh = firstRead ? [] : s.pending.filter((u) => !seenBefore.has(u));
      if (fresh.length > 0) {
        s.lastNewAt = s.checkedAt;
        s.fresh = [...new Set([...(s.fresh ?? []), ...fresh])];
      }
      // Episodes come only from episode pages (stable page ids); a video embedded in a show page is never
      // stored (multi-episode pages embed one too, premieres embed one before listing episodes). So a show we
      // have episodes for whose page now lists none is a failed read — most likely a layout change.
      if (page.episodes.length === 0 && known.size > 0 && id) {
        problems++;
        store.markShowFailed(id, 'kept last good data: the show page lists no episodes (layout change?)');
        store.addWarnings(runId, id, [
          { code: 'source-note', message: `Kan ${key}: show page lists no episodes` },
        ]);
      }
      // A good read of the show page clears an earlier failure (e.g. one empty page during a Kan deploy).
      else if (id && page.episodes.length > 0) store.markShowChecked(id);
    }

    // 3. Episode pages, airing shows first, oldest episode first within a show.
    // A show whose next episode page just failed waits (see below) instead of reading past the gap.
    const retryAfter = (s: ShowState) => {
      const r = s.pending[0] ? s.retry?.[s.pending[0]] : undefined;
      return r ? Date.parse(r.at) + RETRY_GAP_MS : 0;
    };
    const queue = Object.entries(state.shows)
      .filter(([, s]) => s.pending.length > 0 && retryAfter(s) <= Date.now())
      .sort(([, a], [, b]) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? ''));
    for (const [key, s] of queue) {
      const batch: { episode: ScrapedEpisode; season: number | undefined; url?: string }[] = [];
      try {
        while (s.pending.length > 0 && pages < opts.pagesPerRun) {
          const url = s.pending[0] as string;
          let problem: string | undefined;
          try {
            const e = parseEpisodePage(await load(url), origin(url));
            if (e) batch.push({ episode: toEpisode(e), season: e.seasonNumber, url });
            else problem = 'no video player config on the page (layout changed?)';
          } catch (err) {
            if (blocked > 0) throw err;
            problem = (err as Error).message;
          }
          if (problem) {
            problems++;
            // Kan episodes are numbered in reading order (page-id order), so never read past a gap: keep this
            // page first, pause the show, and try again later. Only after several tries is it given up.
            const tries = (s.retry?.[url]?.n ?? 0) + 1;
            if (tries < MAX_EPISODE_TRIES) {
              s.retry = { ...(s.retry ?? {}), [url]: { n: tries, at: new Date().toISOString() } };
              break;
            }
            if (s.retry) delete s.retry[url];
            s.failed.push(url);
            if (s.fresh) s.fresh = s.fresh.filter((u) => u !== url);
            store.addWarnings(runId, store.findSeriesId('kan', key) ?? null, [
              {
                code: 'source-note',
                message: `Kan episode ${url}: ${problem} (gave up after ${tries} tries)`,
              },
            ]);
          } else if (s.retry?.[url]) delete s.retry[url];
          s.pending.shift();
        }
      } finally {
        // Episodes read before a block are kept, never re-read.
        if (batch.length > 0) newEpisodes += saveEpisodes(store, key, s, batch, runId);
      }
      if (pages >= opts.pagesPerRun) break;
    }
    const pendingTotal = Object.values(state.shows).reduce((n, s) => n + s.pending.length, 0);
    note = `${pages} pages, +${newEpisodes} episodes, ${pendingTotal} episode pages still to read`;
    // Pages that loaded but did not parse make the slice partial, so a layout change shows on /status.
    store.finishRun(runId, {
      status: problems > 0 ? 'partial' : 'ok',
      requests: pages,
      newEpisodes,
      ...(problems > 0
        ? { showsFailed: problems, error: `${problems} Kan pages could not be read (see warnings)` }
        : {}),
    });
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
  return {
    pages,
    newEpisodes,
    note,
    readShows,
    attemptedShows,
    ...(note.startsWith('stopped:') ? { failed: true } : {}),
  };
}

function saveEpisodes(
  store: Store,
  key: string,
  s: ShowState,
  batch: { episode: ScrapedEpisode; season: number | undefined; url?: string }[],
  runId?: number,
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
  const clean = cleanShow(show);
  const numbering = assignNumbers(clean, store.assignments(seriesId));
  if (numbering.warnings.length) store.addWarnings(runId ?? null, seriesId, numbering.warnings);
  // Newly published episodes move the show up "newest first"; the first fill's backlog does not.
  const fresh = batch.some((b) => b.url && s.fresh?.includes(b.url));
  if (s.fresh) s.fresh = s.fresh.filter((u) => !batch.some((b) => b.url === u));
  return store.saveShow(seriesId, clean, numbering.added, latestAirDate(clean), fresh);
}

/** Whether a Kan show is known to the crawler (by its page URL). */
export function kanShowKnown(store: Store, key: string): boolean {
  return !!store.getState<CrawlState>(STATE_KEY)?.shows[key];
}

/** Kan VOD runs only when the source is on and a browser is configured. */
export function kanEnabled(config: Config): boolean {
  return config.sources.kan && config.browser.type !== 'none';
}

/** Crawl options from the config (the CLI may override the page budget). */
export function kanCrawlOptions(
  config: Config,
  proxy: ProxyEndpoint | undefined,
  log: (line: string) => void,
): KanCrawlOptions {
  return {
    browser: config.browser,
    ...(proxy ? { proxy } : {}),
    pagesPerRun: config.scraping.browserPagesPerRun,
    pageIntervalMs: config.scraping.browserPageIntervalSec * 1000,
    airingWindowDays: config.schedule.airingWindowDays,
    log,
  };
}
