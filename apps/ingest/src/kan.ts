// Kan VOD crawler. Kan pages need a real browser, and only the first page of a browser session passes
// Cloudflare, so every page costs a fresh browser context (and, outside Israel, a fresh proxy session).
// The crawl therefore runs in small slices with a page budget and keeps its progress in the store:
// lobbies daily, show pages when due, then episode pages oldest first. The catalog fills over days and
// then stays current with a few pages per day.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  assignNumbers,
  type BrowserConfig,
  type Config,
  cleanShow,
  DAY_MS,
  HOUR_MS,
  isTrailer,
  nextDay,
  parseEpisodeHint,
  type ScrapedEpisode,
  type ScrapedSeason,
  type ScrapedShow,
  zonedDay,
} from '@israel-tv/core';
import {
  type AppItem,
  appCategoryUrl,
  appEpisode,
  appProgramUrl,
  classifyEpisodePage,
  cleanKanTitle,
  createChromeLoader,
  isChallenge,
  KAN_APP_CATEGORIES,
  type KanEpisode,
  type LoadedPage,
  type LoadOptions,
  type PageLoader,
  parseAppCategory,
  parseAppProgram,
  parseLobby,
  parseLobbyPosters,
  parseShowPage,
} from '@israel-tv/kan';
import { createGeoFetch, type ProxyEndpoint } from '@israel-tv/net';
import type { Store } from '@israel-tv/store';
import { KAN_GUIDE_CHANNELS, parseKanGuide, storeGuide } from './epg.ts';
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
  // The preschool lobby lists more of the little ones' shows than kids-teens does (2026-11-07: 29 vs a few).
  {
    url: 'https://www.kankids.org.il/lobby-kids/tiny/',
    origin: 'https://www.kankids.org.il',
    channelPath: 'kids/ktantanim-main',
    catalog: 'iltv_kankids',
  },
  // Kan's archive: classic series of Israeli TV (183 shows, 2026-11-07). Read after everything else (KAN_LATER).
  {
    url: 'https://www.kan.org.il/lobby/series/',
    origin: 'https://www.kan.org.il',
    channelPath: 'archive1/vod',
    catalog: 'iltv_kanarchive',
  },
];

/** Rows with a large back catalogue: their show pages come after the others' in a slice, and they lose ties. */
export const KAN_LATER = new Set(['iltv_kanarchive']);

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
  /** Episode pages that are trailers, not episodes; kept so they never re-enter the queue. */
  skipped?: string[];
  /**
   * What the app API proved for this show: its list agrees with the pages (`trusted`), contradicts them
   * (`disagrees`), or the show has no app id (`unlisted`). Unset until known. Orders the episode queue.
   */
  app?: 'trusted' | 'disagrees' | 'unlisted';
  /** The show's id in Kan's app API when its page address has none (kankids slugs), from the app's category lists. */
  appId?: string;
  /** Episode pages whose video Kan took down (broadcast rights ended); counted on /status, never queued again. */
  removed?: string[];
  /** Pages linked among the episodes that hold no video (articles, promos); likewise. */
  notVideo?: string[];
  /** Last time a re-read of the show page found new episode links (not set by the first read). */
  lastNewAt?: string;
  /** Episode pages found as new on a re-read (newly published), as opposed to the first fill's backlog. */
  fresh?: string[];
  /** When a show page that was never read successfully last failed (retried after a week). */
  failedAt?: string;
  /** The show's poster on its lobby card (preferred over the show page's share image, which Kan refuses). */
  lobbyPoster?: string;
  /** The show's image, saved as our own copy (Kan's artwork is refused outside Israel). */
  art?: { from: string; file: string };
  /** Last try at saving the show's image (retried at most daily). */
  artTriedAt?: string;
  /** Episode pages that failed and will be tried again before reading past them. */
  retry?: Record<string, { n: number; at: string }>;
  /** Pages of episodes we have without an air date (read before dates were kept), re-read when time is left. */
  undated?: string[];
}

/**
 * Bumped when the way show images are copied changes (2: from the lobby, with the page's own images loaded;
 * 3: a show page's own still when the show has no lobby card; 4: through a session that cleared Kan's bot check,
 * which no longer refuses ~half the images).
 */
const ART_METHOD = 4;

export interface BotCheckDay {
  pages: number;
  challenged: number;
  images: number;
  imagesChallenged: number;
}

interface CrawlState {
  lobbiesAt?: string;
  /** Lobbies have been read since posters were taken from them (an older state reads them once more). */
  lobbyPosters?: true;
  /** The way show images are copied; a newer way tries every show still without a copy again at once. */
  artMethod?: number;
  backoffUntil?: string;
  shows: Record<string, ShowState>;
  /** Per site, the last episode page that loaded with a player: the yardstick for a failing episode page. */
  goodEpisode?: Record<string, string>;
  /** Episode pages whose player offered subtitles, and one sample of what it gave (to learn their shape). */
  subtitles?: { n: number; url: string; sample: string };
  /** Guide pages read (live programme guide): `<channel id>|<yyyy-mm-dd>` → when. */
  guideAt?: Record<string, string>;
  /** The last time a page or image met Cloudflare's bot check (the pace is halved for a day after it). */
  lastChallengeAt?: string;
  /** Pages and images loaded per day (UTC) and how many of them met Cloudflare's bot check: the measured rate. */
  botCheck?: Record<string, BotCheckDay>;
}

/** A guide page (one channel, one day) is read again after this long. */
const GUIDE_EVERY_MS = 12 * HOUR_MS;

const STATE_KEY = 'kan:crawl';
/** How a Cloudflare bot check is reported: Kan's site asked us to prove we are a person; we wait and try later. */
const BOT_CHECK = "blocked by Kan's bot check (Cloudflare)";
/** Browser errors that mean the connection is down (proxy, network, browser), not that one page is broken. */
const CONNECTION_DOWN =
  /ERR_PROXY|ERR_TUNNEL|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|ERR_SOCKS|Target (page, context or browser )?closed|browser has been closed/i;
/**
 * An episode page charged with a failure (its own: a 404, no player on it, or a server error while comparable
 * pages load) is tried this many times, at least RETRY_GAP_MS apart (so over at least a day), before it is skipped.
 */
const MAX_EPISODE_TRIES = 3;
const RETRY_GAP_MS = 12 * HOUR_MS;
/** At most this many app-named episodes per slice (each costs one master-playlist check on Kan's CDN). */
const MAX_STREAM_CHECKS = 400;

/** Listing pages (lobbies, show pages) and episode pages are compared only with their own kind. */
type Kind = 'listing' | 'episode';
/**
 * What a failed page load means: `outage` stops the slice and charges no page; `suspect` may be the page's own
 * problem or the site's (decided by comparison); `page` is the page's own problem.
 */
type Failure = 'outage' | 'suspect' | 'page';
class KanLoadError extends Error {
  readonly failure: Failure;
  constructor(message: string, failure: Failure) {
    super(message);
    this.failure = failure;
  }
}
/** Anything thrown that is not a load error (a page that does not parse) is the page's own problem. */
const failureOf = (err: unknown): Failure => (err instanceof KanLoadError ? err.failure : 'page');
const firstLine = (err: unknown) => (err as Error).message.split('\n')[0];

type BatchItem = { episode: ScrapedEpisode; season: number | undefined; url: string };

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
  /** Where to keep our copies of show images (none: images are not copied). */
  artworkDir?: string;
  /** The browser profile kept between slices (Cloudflare's clearance lives in its cookies). */
  profileDir?: string;
  /** Read episode lists from Kan's app API (default true): one request per show instead of a page per episode. */
  appApi?: boolean;
  /** Whether a stream's master playlist answers (test seam; default: a GET through the geo proxy). */
  streamPlays?: (url: string) => Promise<boolean>;
  /** App-named episodes per slice (default MAX_STREAM_CHECKS). */
  maxStreamChecks?: number;
  /** Read Kan's live programme guide pages too (default true). */
  guide?: boolean;
}

/**
 * A failed artwork copy is tried again after this long. Kan's CDN sometimes refuses one proxy exit (HTTP 403) and
 * slices rotate across exits, so a few tries a day get most copies without reading the lobbies every slice.
 */
export const ART_RETRY_MS = 6 * 3_600_000;

export function showDue(s: ShowState, now: number, windowDays: number): boolean {
  if (!s.checkedAt) return !s.failedAt || now - Date.parse(s.failedAt) > 7 * DAY_MS;
  // A show whose current image has no saved copy is read again for it (at most every ART_RETRY_MS).
  if (s.image && s.art?.from !== s.image && (!s.artTriedAt || now - Date.parse(s.artTriedAt) > ART_RETRY_MS))
    return true;
  const age = now - Date.parse(s.checkedAt);
  const airing = s.lastNewAt !== undefined && now - Date.parse(s.lastNewAt) < windowDays * DAY_MS;
  return age > (airing ? 6 * HOUR_MS : 7 * DAY_MS);
}

/** Episodes are keyed by their Kan page id (stable; the player config's id on an episode page). */
export function kanEpisodeKey(e: { id: string }): string {
  return `kan:${e.id}`;
}

/** Kan VOD is geo-blocked outside Israel per title, nearly always (measured): labelled Israel-only. */
export function toEpisode(e: KanEpisode): ScrapedEpisode {
  return {
    key: kanEpisodeKey(e),
    title: e.title,
    // Kan's own number ("פרק 4 - …"); episodes without one are numbered by air date after the others.
    ...(parseEpisodeHint(e.title) ? { numberHint: parseEpisodeHint(e.title) } : {}),
    ...(e.description ? { description: e.description } : {}),
    ...(e.poster ? { thumbnail: e.poster } : {}),
    ...(e.published ? { airDate: e.published } : {}),
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
  /** Show images copied in this slice (a publish carries them). */
  artSaved?: number;
  note: string;
  failed?: boolean;
  readShows?: string[];
  attemptedShows?: string[];
}> {
  const log = opts.log ?? (() => {});
  const now = Date.now();
  const state = store.getState<CrawlState>(STATE_KEY) ?? { shows: {} };
  if (opts.artworkDir && state.artMethod !== ART_METHOD) {
    for (const s of Object.values(state.shows)) if (!s.art) delete s.artTriedAt;
    state.artMethod = ART_METHOD;
  }
  // Names kept from before titles were cleaned (and any new rule) are cleaned in place, without a page read.
  for (const [key, s] of Object.entries(state.shows)) {
    const clean = s.title ? cleanKanTitle(s.title) : s.title;
    if (clean && clean !== s.title) {
      s.title = clean;
      renameShow(store, key, clean);
    }
  }
  if (state.backoffUntil && Date.parse(state.backoffUntil) > now) {
    return { pages: 0, newEpisodes: 0, note: `backing off until ${state.backoffUntil}` };
  }
  if (opts.browser.type === 'none')
    return { pages: 0, newEpisodes: 0, note: 'browser.type is none: Kan is off' };
  // Pace: the configured one while Kan's bot check stays quiet; half the pages, twice the pause for a day after it
  // stopped anything (on top of the 45-minute stop the challenge itself causes). docs/decisions.md "Kan's pace".
  const calm = !!state.lastChallengeAt && now - Date.parse(state.lastChallengeAt) < DAY_MS;
  if (calm)
    opts = {
      ...opts,
      pagesPerRun: Math.max(2, Math.ceil(opts.pagesPerRun / 2)),
      pageIntervalMs: opts.pageIntervalMs * 2,
    };

  const runId = store.startRun('crawl', 'kan');
  let loader: PageLoader | undefined = opts.loader;
  let pages = 0;
  let newEpisodes = 0;
  let artSaved = 0;
  let problems = 0;
  let stopped = false;
  /** Server errors in a row, per site (kan.org.il and kankids.org.il fail independently). */
  const serverErrors = new Map<string, number>();
  /**
   * Pages that answered a server error. Each is charged only once a page of the same site and kind loads
   * normally (show pages compare with show pages or the lobby, episode pages with episode pages: Kan's episode
   * pages can fail while the rest of the site works). At the end of a slice an open one is settled by loading a
   * comparable page; with nothing to compare against it stays uncharged and the run says so.
   */
  let suspects: { site: string; kind: Kind; charge: () => void }[] = [];
  const readShows: string[] = [];
  /** Shows whose page was read or failed without a block (a refresh of them is done either way). */
  const attemptedShows: string[] = [];
  let note = '';

  const origin = (url: string) => new URL(url).origin;
  /** Count a loaded page (and its images) against Cloudflare's bot check; two weeks of days are kept. */
  const tally = (r: LoadedPage) => {
    const day = new Date().toISOString().slice(0, 10);
    state.botCheck ??= {};
    const days = state.botCheck;
    days[day] ??= { pages: 0, challenged: 0, images: 0, imagesChallenged: 0 };
    const d = days[day];
    d.pages++;
    if (r.challenged || isChallenge(r.html)) {
      d.challenged++;
      state.lastChallengeAt = new Date().toISOString();
    }
    for (const img of [...(r.image ? [r.image] : []), ...(r.images ?? [])]) {
      d.images++;
      if (img.challenged) {
        d.imagesChallenged++;
        state.lastChallengeAt = new Date().toISOString();
      }
    }
    for (const k of Object.keys(days).sort().slice(0, -14)) delete days[k];
  };
  const warn = (seriesId: string | null | undefined, message: string) =>
    store.addWarnings(runId, seriesId ?? null, [{ code: 'source-note', message }]);
  /** Show images Kan refused in this slice, by reason: one line per reason at the end, not one per show. */
  const refusedArt = new Map<string, string[]>();
  const refuseArt = (key: string, why: string) => refusedArt.set(why, [...(refusedArt.get(why) ?? []), key]);
  const reportArt = () => {
    for (const [why, keys] of refusedArt) {
      const what = why === 'bot check' ? "refused by Kan's bot check (Cloudflare)" : `refused (${why})`;
      const sample = keys
        .slice(0, 3)
        .map((k) => new URL(k).pathname)
        .join(', ');
      warn(
        null,
        `Kan: ${keys.length} show ${keys.length === 1 ? 'image' : 'images'} ${what}; tried again within ${ART_RETRY_MS / 3_600_000} hours (e.g. ${sample})`,
      );
    }
    refusedArt.clear();
  };
  /** A server error: the first on a site may be that page's problem; two in a row mean the site is down. */
  const serverError = (url: string, message: string): never => {
    const site = origin(url);
    const n = (serverErrors.get(site) ?? 0) + 1;
    serverErrors.set(site, n);
    throw new KanLoadError(message, n >= 2 ? 'outage' : 'suspect');
  };
  /** The image fetched along with the last page that asked for one. */
  let lastImage: LoadedPage['image'];
  /** The images fetched along with the last page that asked for several (a lobby's posters). */
  let lastImages: LoadedPage['images'];
  const load = async (url: string, kind: Kind = 'listing', loadOpts?: LoadOptions) => {
    lastImage = undefined;
    lastImages = undefined;
    if (pages > 0) await sleep(opts.pageIntervalMs);
    pages++;
    let r: Awaited<ReturnType<PageLoader['load']>>;
    try {
      loader ??= await createChromeLoader(
        opts.browser as Extract<BrowserConfig, { type: 'chrome' }>,
        opts.proxy,
        opts.profileDir ? { profileDir: opts.profileDir } : {},
      );
    } catch (err) {
      // No browser: the slice fails, not any page.
      throw new KanLoadError(`browser did not start: ${firstLine(err)}`, 'outage');
    }
    try {
      r = await loader.load(url, loadOpts);
      lastImage = r.image;
      lastImages = r.images;
      tally(r);
    } catch (err) {
      const message = `${url}: ${firstLine(err)}`;
      // The proxy or this machine's network is down, or the browser died: back off, charge nobody.
      if (CONNECTION_DOWN.test(message)) throw new KanLoadError(message, 'outage');
      // Anything else (a timeout, a redirect loop, an empty response) may be this page's own problem: treat it
      // like a server error, so it is compared with other pages of its site before anyone is charged.
      return serverError(url, message);
    }
    // Challenges and proxy refusals: the slice stops and backs off, and no page is charged for them.
    if (r.challenged || r.status === 403 || r.status === 407) {
      const why = r.challenged ? BOT_CHECK : `HTTP ${r.status}`;
      throw new KanLoadError(`${url}: ${why}`, 'outage');
    }
    if (r.status === 429 || r.status >= 500) return serverError(url, `${url}: HTTP ${r.status}`);
    // The site answered normally, so its pages of this kind that answered a server error are broken by themselves.
    const site = origin(url);
    serverErrors.delete(site);
    const proven: (() => void)[] = [];
    suspects = suspects.filter((x) => {
      if (x.site !== site || x.kind !== kind) return true;
      proven.push(x.charge);
      return false;
    });
    for (const charge of proven) charge();
    if (r.status >= 400) throw new KanLoadError(`${url}: HTTP ${r.status}`, 'page');
    return r.html;
  };
  /**
   * A failed show or episode page: an outage stops the slice (no one charged); a possible server-side problem
   * becomes a suspect, charged once a comparable page loads; anything else is the page's own problem, charged now.
   */
  const triage = (err: unknown, url: string, kind: Kind, charge: () => void): 'suspect' | 'charged' => {
    const failure = failureOf(err);
    if (failure === 'outage') throw err;
    if (failure === 'suspect') {
      suspects.push({ site: origin(url), kind, charge });
      return 'suspect';
    }
    charge();
    return 'charged';
  };
  const noteSubtitles = (url: string, sub: unknown) => {
    const sample = JSON.stringify(sub).slice(0, 400);
    if (!state.subtitles) log(`kan: subtitles offered on ${url}: ${sample}`);
    state.subtitles = {
      n: (state.subtitles?.n ?? 0) + 1,
      url: state.subtitles?.url ?? url,
      sample: state.subtitles?.sample ?? sample,
    };
  };
  const rethrowOutage = (err: unknown) => {
    if (failureOf(err) === 'outage') throw err;
  };

  // Kan's app API (docs/decisions.md "Kan's app API"): a show's whole episode list in one request. Used only to
  // name episodes the crawl would read anyway, in the same order; ids, seasons and numbers come out as the pages give.
  const useApp = opts.appApi !== false;
  /** JSON from the app API through the same session and pacing as a page; undefined when it is not usable. */
  const loadJson = async (url: string): Promise<unknown> => {
    if (!useApp) return undefined;
    if (pages > 0) await sleep(opts.pageIntervalMs);
    try {
      loader ??= await createChromeLoader(
        opts.browser as Extract<BrowserConfig, { type: 'chrome' }>,
        opts.proxy,
        opts.profileDir ? { profileDir: opts.profileDir } : {},
      );
    } catch (err) {
      throw new KanLoadError(`browser did not start: ${firstLine(err)}`, 'outage');
    }
    if (!loader.text) return undefined;
    pages++;
    let r: Awaited<ReturnType<NonNullable<PageLoader['text']>>>;
    try {
      r = await loader.text(url);
    } catch (err) {
      const message = `${url}: ${firstLine(err)}`;
      if (CONNECTION_DOWN.test(message)) throw new KanLoadError(message, 'outage');
      appProblems.push(message);
      return undefined;
    }
    tally({ status: r.status, html: '', challenged: r.challenged });
    if (r.challenged || r.status === 403 || r.status === 407)
      throw new KanLoadError(`${url}: ${r.challenged ? BOT_CHECK : `HTTP ${r.status}`}`, 'outage');
    if (r.status !== 200) {
      appProblems.push(`${url}: HTTP ${r.status}`);
      return undefined;
    }
    try {
      return JSON.parse(r.body);
    } catch {
      appProblems.push(`${url}: not JSON`);
      return undefined;
    }
  };
  /** Problems with the app API in this slice (the crawl falls back to pages; one warning at the end). */
  const appProblems: string[] = [];
  /** Episodes named from the app API in this slice (no page read). */
  let fromApp = 0;
  /** Stream checks made in this slice (each one small GET of a master playlist on Kan's CDN). */
  let streamChecks = 0;
  const geo = opts.streamPlays ? undefined : createGeoFetch(opts.proxy ? [opts.proxy] : []);
  /** A Redge master playlist that answers: the proof that the app's entry is the stream the page would play. */
  const streamPlays =
    opts.streamPlays ??
    (async (url: string) => {
      try {
        const r = await (geo as NonNullable<typeof geo>)(url, { signal: AbortSignal.timeout(20_000) });
        if (r.status !== 200) {
          await r.body?.cancel();
          return false;
        }
        const body = await r.text();
        return body.startsWith('#EXTM3U');
      } catch {
        return false;
      }
    });
  /** A show's episodes in the app API by Kan's page id (all pages of the list), or undefined. */
  const appFeed = async (key: string, s: ShowState): Promise<Map<string, AppItem> | undefined> => {
    const programId = appProgramId(key, s);
    if (!programId || !useApp) return undefined;
    const items = new Map<string, AppItem>();
    for (let from = 1, n = 0; n < 10; n++) {
      const json = await loadJson(appProgramUrl(programId, from));
      if (json === undefined) return items.size > 0 ? items : undefined;
      let page: ReturnType<typeof parseAppProgram>;
      try {
        page = parseAppProgram(json);
      } catch (err) {
        appProblems.push(`${appProgramUrl(programId, from)}: ${firstLine(err)}`);
        return undefined;
      }
      for (const item of page.items) items.set(item.id, item);
      if (!page.full) break;
      from += page.items.length;
    }
    return items;
  };

  try {
    // 1. Lobbies, once a day — and whenever a show's poster has no saved copy yet (copies are made from the
    // lobby, which shows them all: Kan refuses its share images).
    const artDue = (poster: string, s: ShowState | undefined) =>
      !!opts.artworkDir &&
      s?.art?.from !== poster &&
      (!s?.artTriedAt || now - Date.parse(s.artTriedAt) > ART_RETRY_MS);
    const missingArt = Object.values(state.shows).some((s) => s.lobbyPoster && artDue(s.lobbyPoster, s));
    if (!state.lobbiesAt || !state.lobbyPosters || missingArt || now - Date.parse(state.lobbiesAt) > DAY_MS) {
      const byUrl = new Map<string, string>();
      const captured = new Map<string, NonNullable<LoadedPage['images']>[number]>();
      let lobbyEmpty = false;
      for (const l of KAN_LOBBIES) {
        if (!byUrl.has(l.url) && pages >= opts.pagesPerRun) break;
        let html = byUrl.get(l.url);
        if (html === undefined) {
          try {
            const lobby = l;
            html = await load(
              l.url,
              'listing',
              opts.artworkDir
                ? {
                    images: (page) =>
                      [...parseLobbyPosters(page)]
                        .filter(([path, u]) =>
                          artDue(new URL(u, lobby.origin).toString(), state.shows[`${lobby.origin}${path}`]),
                        )
                        .map(([, u]) => new URL(u, lobby.origin).toString()),
                  }
                : undefined,
            );
            for (const img of lastImages ?? []) captured.set(img.url, img);
          } catch (err) {
            // One lobby failing (its site down, or the page moved) must not stop the other site or the known
            // shows: note it, keep going, and read the lobbies again next slice.
            rethrowOutage(err);
            problems++;
            lobbyEmpty = true;
            warn(null, `Kan lobby ${l.url}: ${(err as Error).message}`);
            byUrl.set(l.url, '');
            continue;
          }
          byUrl.set(l.url, html);
        }
        if (html === '') continue; // this lobby failed above
        const paths = parseLobby(html, l.origin, l.channelPath);
        const posters = parseLobbyPosters(html);
        if (paths.length === 0) {
          // A lobby that loads but lists no shows is a layout change: say so and try again next slice.
          problems++;
          lobbyEmpty = true;
          warn(null, `Kan lobby ${l.url} (${l.channelPath}) lists no shows`);
        }
        for (const path of paths) {
          const key = `${l.origin}${path}`;
          // A show that appears after the first lobby read is a premiere: airing from the start, so its next
          // episodes are picked up within hours, not on the weekly re-read.
          state.shows[key] ??= {
            origin: l.origin,
            catalog: l.catalog,
            pending: [],
            failed: [],
            ...(state.lobbiesAt ? { lastNewAt: new Date(now).toISOString() } : {}),
          };
          const poster = posters.get(path);
          const show = state.shows[key];
          if (poster && show) {
            show.lobbyPoster = new URL(poster, l.origin).toString();
            show.image = show.lobbyPoster;
            const img = captured.get(show.lobbyPoster);
            if (img && opts.artworkDir && saveArtwork(show, key, img, opts.artworkDir, refuseArt)) artSaved++;
          }
        }
      }
      if (!lobbyEmpty && byUrl.size === new Set(KAN_LOBBIES.map((l) => l.url)).size) {
        state.lobbiesAt = new Date(now).toISOString();
        state.lobbyPosters = true;
        // Shows whose poster could not be copied this time (or is no longer on a lobby) wait ART_RETRY_MS, so a missing
        // copy never makes every slice read the lobbies.
        for (const show of Object.values(state.shows))
          if (show.lobbyPoster && artDue(show.lobbyPoster, show))
            show.artTriedAt = new Date(now).toISOString();
      }
      log(`kan: ${Object.keys(state.shows).length} shows known`);
      // Shows whose address has no numeric id (kankids slugs) get their app id from the app's category lists.
      const slugs = Object.entries(state.shows).filter(([k, s]) => !/\/p-\d+\/$/.test(k) && !s.appId);
      if (slugs.length > 0)
        for (const category of KAN_APP_CATEGORIES) {
          if (pages >= opts.pagesPerRun) break;
          const json = await loadJson(appCategoryUrl(category));
          if (json === undefined) continue;
          try {
            const { shows } = parseAppCategory(json);
            for (const [k, s] of slugs) {
              const id = shows.get(k);
              if (id) s.appId = id;
            }
          } catch (err) {
            appProblems.push(`${appCategoryUrl(category)}: ${firstLine(err)}`);
          }
        }
    }

    // 1b. One live-guide page per slice when one is due: today's and tomorrow's schedule of each Kan channel.
    if (opts.guide !== false && pages < opts.pagesPerRun) {
      const today = zonedDay(now, 'Asia/Jerusalem');
      const days = [today, nextDay(today)];
      const at = state.guideAt ?? {};
      for (const k of Object.keys(at)) if (!days.includes(k.split('|')[1] ?? '')) delete at[k];
      const due = Object.entries(KAN_GUIDE_CHANNELS)
        .flatMap(([id, ch]) => days.map((day) => ({ id, ch, day })))
        .find(
          (x) => !at[`${x.id}|${x.day}`] || now - Date.parse(at[`${x.id}|${x.day}`] ?? '') > GUIDE_EVERY_MS,
        );
      if (due) {
        const [y, m, d] = due.day.split('-');
        const url = `https://www.kan.org.il/tv-guide/?channelId=${due.ch}&day=${d}-${m}-${y}`;
        // Recorded first: a guide page that fails waits its turn like one that loads, and never stops the crawl
        // (the guide is an extra; shows and episodes go on, and a real outage shows on the next page anyway).
        at[`${due.id}|${due.day}`] = new Date(now).toISOString();
        state.guideAt = at;
        try {
          const rows = parseKanGuide(await load(url, 'listing'));
          if (rows.length > 0) storeGuide(store, due.id, rows, now);
          else warn(null, `Kan guide ${url}: no programmes on the page (layout changed?)`);
        } catch (err) {
          warn(null, `Kan guide ${url}: ${(err as Error).message}`);
        }
      }
    }

    // 2. Show pages that are due (never read, airing, or a week old). While episode pages are waiting,
    //    at most half the slice goes to show pages, so both make progress.
    const waiting = Object.values(state.shows).some((s) => s.pending.length > 0);
    const showBudget = waiting ? Math.ceil(opts.pagesPerRun / 2) : opts.pagesPerRun;
    // Refresh requests first, made due now; then everything else in order.
    const prio = new Set((opts.priority ?? []).filter((k) => state.shows[k]));
    // The archive's show pages come after the other rows' due ones (they are read once, then weekly), but they
    // never wait for the other rows' whole backlog: that starved the archive row for days (0 of 171 shows).
    const rest = Object.keys(state.shows).filter((k) => !prio.has(k));
    const later = (k: string) => KAN_LATER.has(state.shows[k]?.catalog ?? '');
    const order = [...prio, ...rest.filter((k) => !later(k)), ...rest.filter(later)];
    for (const key of order) {
      const s = state.shows[key];
      if (!s) continue;
      if (pages >= showBudget && !prio.has(key)) break;
      if (!prio.has(key) && !showDue(s, now, opts.airingWindowDays)) continue;
      const id = store.findSeriesId('kan', key);
      const firstRead = !s.checkedAt;
      const path = new URL(key).pathname;
      let page: ReturnType<typeof parseShowPage>;
      // A broken show page is that show's problem only: note it and try again next week. A show never read
      // successfully keeps "first read" status, so its backlog is not mistaken for new episodes later. A show
      // we already have keeps its data and shows as failing on /status.
      const chargeShow = (message: string) => {
        if (s.checkedAt) s.checkedAt = new Date().toISOString();
        else s.failedAt = new Date().toISOString();
        warn(id, `Kan ${key}: ${message}`);
        if (id) {
          problems++;
          store.markShowFailed(id, `kept last good data: ${message}`);
        }
      };
      try {
        page = parseShowPage(
          await load(
            key,
            'listing',
            opts.artworkDir
              ? { image: (html) => s.lobbyPoster ?? absolute(parseShowPage(html, path).image, s.origin) }
              : undefined,
          ),
          path,
        );
      } catch (err) {
        rethrowOutage(err);
        attemptedShows.push(key);
        const message = (err as Error).message;
        triage(err, key, 'listing', () => chargeShow(message));
        continue;
      }
      s.checkedAt = new Date().toISOString();
      if (opts.artworkDir && lastImage && saveArtwork(s, key, lastImage, opts.artworkDir, refuseArt))
        artSaved++;
      readShows.push(key);
      attemptedShows.push(key);
      if (page.title) s.title = page.title;
      if (page.description) s.description = page.description;
      const image = s.lobbyPoster ?? absolute(page.image, s.origin);
      if (image) s.image = image;
      const known = new Set(
        id ? (store.getShow(id)?.show.seasons.flatMap((x) => x.episodes.map((e) => e.key)) ?? []) : [],
      );
      const seenBefore = new Set([
        ...s.pending,
        ...s.failed,
        ...(s.skipped ?? []),
        ...(s.removed ?? []),
        ...(s.notVideo ?? []),
      ]);
      const dated = new Set(
        id
          ? (store
              .getShow(id)
              ?.show.seasons.flatMap((x) => x.episodes.filter((e) => e.airDate).map((e) => e.key)) ?? [])
          : [],
      );
      const pageKey = (u: string) => kanEpisodeKey({ id: String(/(\d+)\/$/.exec(u)?.[1]) });
      s.undated = page.episodes
        .map((e) => `${s.origin}${e.path}`)
        .filter((u) => known.has(pageKey(u)) && !dated.has(pageKey(u)));
      if (s.undated.length === 0) delete s.undated;
      // Pages given up on (after several tries) stay given up: they never re-enter the ordered queue, where
      // they would hold back newer episodes and, if they ever loaded, be numbered after them.
      const gaveUp = new Set([
        ...s.failed,
        ...(s.skipped ?? []),
        ...(s.removed ?? []),
        ...(s.notVideo ?? []),
      ]);
      s.pending = page.episodes
        .map((e) => `${s.origin}${e.path}`)
        .filter((u) => !known.has(kanEpisodeKey({ id: String(/(\d+)\/$/.exec(u)?.[1]) })) && !gaveUp.has(u));
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
        warn(id, `Kan ${key}: show page lists no episodes`);
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
    const queue = episodeQueue(store, state.shows, Date.now(), retryAfter);
    for (const [key, s] of queue) {
      const seriesId = store.findSeriesId('kan', key);
      const batch: BatchItem[] = [];
      // The show's app list, read once (only when it has episodes waiting and the slice has room for it).
      const listed = s.pending.length > 0 && pages < opts.pagesPerRun ? await appFeed(key, s) : undefined;
      // Trusted only where it agrees with what the pages gave this show (measured: the app's season differs from
      // the page player's for some shows, e.g. "s8" in the app where the page has no season, stored as 1).
      const verdict = () =>
        listed
          ? appVerdict(
              store,
              seriesId,
              listed,
              batch.map((b) => ({ ...b.episode, season: b.season ?? 1 })),
            )
          : 'unknown';
      const trusted = () => verdict() === 'agrees';
      if (!listed && !appProgramId(key, s)) s.app = 'unlisted';
      const storedCount = episodeCount(store, seriesId);
      // A show still giving its evidence reads only APP_AGREEMENT pages in this phase, so every show gets its turn.
      const evidencePhase = !s.app && storedCount < APP_AGREEMENT;
      try {
        while (s.pending.length > 0) {
          const url = s.pending[0] as string;
          // Kan episodes are numbered in reading order (page-id order), so never read past a gap: a failing page
          // stays first, the show pauses, and the page is tried again later; only after several tries is it
          // given up. Returns whether reading this show may go on.
          const chargeEpisode = (message: string): boolean => {
            problems++;
            const tries = (s.retry?.[url]?.n ?? 0) + 1;
            const goOn = tries >= MAX_EPISODE_TRIES;
            if (goOn) {
              delete s.retry?.[url];
              s.failed.push(url);
              s.pending = s.pending.filter((u) => u !== url);
              if (s.fresh) s.fresh = s.fresh.filter((u) => u !== url);
            } else s.retry = { ...(s.retry ?? {}), [url]: { n: tries, at: new Date().toISOString() } };
            const outcome = goOn
              ? `gave up after ${tries} tries`
              : `try ${tries} of ${MAX_EPISODE_TRIES}; the show waits for it`;
            warn(seriesId, `Kan episode ${url}: ${message} (${outcome})`);
            return goOn;
          };
          // Named by the app: its Kaltura entry gives the page's Redge stream when that stream answers (where the
          // page plays another asset, the derived address answers 404: measured), else the page is read as before.
          const item = listed?.get(/(\d+)\/$/.exec(url)?.[1] ?? '');
          const named =
            item?.stream.kind === 'redge' &&
            !!item.title &&
            streamChecks < (opts.maxStreamChecks ?? MAX_STREAM_CHECKS) &&
            trusted();
          if (named) streamChecks++;
          if (named && item?.stream.kind === 'redge' && (await streamPlays(item.stream.url))) {
            const e = appEpisode({ ...item, stream: item.stream });
            delete s.retry?.[url];
            s.pending.shift();
            if (isTrailer(e.title)) {
              s.skipped = [...new Set([...(s.skipped ?? []), url])];
              if (s.fresh) s.fresh = s.fresh.filter((u) => u !== url);
              continue;
            }
            batch.push({ episode: toEpisode(e), season: e.seasonNumber, url });
            fromApp++;
            continue;
          }
          // Only a page read costs the slice's page budget.
          if (pages >= opts.pagesPerRun) break;
          if (evidencePhase && storedCount + batch.length >= APP_AGREEMENT) break;
          let page: ReturnType<typeof classifyEpisodePage>;
          try {
            page = classifyEpisodePage(await load(url, 'episode'), origin(url), url);
          } catch (err) {
            const message = (err as Error).message;
            const charged = { goOn: false };
            if (triage(err, url, 'episode', () => (charged.goOn = chargeEpisode(message))) === 'suspect')
              break;
            if (!charged.goOn) break; // the show waits for this page
            continue;
          }
          // The bot check is never the page's fault (the loader normally reports it; this catches a variant).
          if (page.kind === 'challenge') throw new KanLoadError(`${url}: ${BOT_CHECK}`, 'outage');
          // Taken down by Kan (rights ended) or not a video at all: nothing to wait for or retry. Kept, counted
          // on /status, never queued again.
          if (page.kind === 'removed' || page.kind === 'not-video') {
            delete s.retry?.[url];
            const list = page.kind === 'removed' ? 'removed' : 'notVideo';
            s[list] = [...new Set([...(s[list] ?? []), url])];
            if (s.fresh) s.fresh = s.fresh.filter((u) => u !== url);
            s.pending.shift();
            continue;
          }
          if (page.kind === 'unknown') {
            if (!chargeEpisode('the page has no video player and no sign why (layout changed?)')) break;
            continue;
          }
          const e = page.episode;
          if (e.subtitles !== undefined) noteSubtitles(url, e.subtitles);
          // A trailer is not an episode: remembered, so its page never re-enters the queue as "new".
          if (isTrailer(e.title)) {
            delete s.retry?.[url];
            s.skipped = [...new Set([...(s.skipped ?? []), url])];
            if (s.fresh) s.fresh = s.fresh.filter((u) => u !== url);
            s.pending.shift();
            continue;
          }
          batch.push({ episode: toEpisode(e), season: e.seasonNumber, url });
          state.goodEpisode = { ...(state.goodEpisode ?? {}), [origin(url)]: url };
          delete s.retry?.[url];
          s.pending.shift();
        }
      } finally {
        if (listed) {
          const v = verdict();
          if (v === 'agrees') s.app = 'trusted';
          else if (v === 'disagrees') s.app = 'disagrees';
        }
        // Episodes read before a block are kept, never re-read.
        if (batch.length > 0) newEpisodes += saveEpisodes(store, key, s, batch, runId);
      }
      if (pages >= opts.pagesPerRun) break;
    }
    // 3b. With pages left in the slice, the air dates of episodes read before dates were kept. Low priority: a
    //     page that fails is dropped from this list (no retries, no warnings); an outage still stops the slice.
    for (const [key, s] of Object.entries(state.shows)) {
      if (pages >= opts.pagesPerRun) break;
      const dates = new Map<string, string>();
      while (s.undated?.length && pages < opts.pagesPerRun) {
        const url = s.undated.shift() as string;
        try {
          const r = classifyEpisodePage(await load(url, 'episode'), origin(url), url);
          const e = r.kind === 'episode' ? r.episode : undefined;
          if (e?.published) dates.set(kanEpisodeKey(e), e.published);
          if (e?.subtitles !== undefined) noteSubtitles(url, e.subtitles);
        } catch (err) {
          rethrowOutage(err);
        }
      }
      if (s.undated?.length === 0) delete s.undated;
      if (dates.size > 0) dateEpisodes(store, key, dates);
    }

    // 4. Settle pages that answered a server error with nothing comparable loading after them.
    for (const { site, kind } of [...new Map(suspects.map((x) => [`${x.site} ${x.kind}`, x])).values()]) {
      const yardstick =
        kind === 'episode' ? state.goodEpisode?.[site] : KAN_LOBBIES.find((l) => l.origin === site)?.url;
      if (!yardstick) continue;
      try {
        await load(yardstick, kind);
      } catch (err) {
        rethrowOutage(err);
      }
    }
    const unsettled = suspects.length;
    const shows = Object.values(state.shows);
    const pendingTotal = shows.reduce((n, s) => n + s.pending.length, 0);
    // Shows paused on an episode page that failed: visible on /status for as long as they wait.
    const waitingShows = shows.filter((s) => s.pending[0] && s.retry?.[s.pending[0]]).length;
    note = `${pages} pages${calm ? ' (calm pace: a bot check in the last day)' : ''}, +${newEpisodes} episodes (${fromApp} named by the app API), ${pendingTotal} episode pages still to read`;
    if (appProblems.length > 0)
      warn(
        null,
        `Kan app API: ${appProblems.length} ${appProblems.length === 1 ? 'request' : 'requests'} not usable, read from the pages instead (e.g. ${appProblems[0]})`,
      );
    const issues = [
      ...(problems > 0 ? [`${problems} Kan pages could not be read`] : []),
      ...(waitingShows > 0 ? [`${waitingShows} Kan shows wait to retry an episode page`] : []),
      ...(unsettled > 0
        ? [`${unsettled} Kan pages answered a server error (not yet known whose fault)`]
        : []),
    ];
    // Pages that could not be read, shows waiting to retry one, and open suspects make the slice partial, so
    // they show on /status.
    store.finishRun(runId, {
      status: issues.length > 0 ? 'partial' : 'ok',
      requests: pages,
      newEpisodes,
      ...(issues.length > 0
        ? { showsFailed: problems + waitingShows, error: `${issues.join('; ')} (see warnings)` }
        : {}),
    });
  } catch (err) {
    // An outage (challenge, proxy refusal, connection down, no browser, a site answering server errors): stop
    // and wait well before trying again.
    stopped = true;
    state.backoffUntil = new Date(Date.now() + 45 * 60_000).toISOString();
    note = `stopped: ${(err as Error).message}; next try after ${state.backoffUntil}`;
    store.finishRun(runId, {
      status: newEpisodes > 0 ? 'partial' : 'failed',
      requests: pages,
      newEpisodes,
      error: note,
    });
  } finally {
    reportArt();
    store.setState(STATE_KEY, state);
    if (!opts.loader) await loader?.close();
  }
  log(`kan: ${note}`);
  return {
    pages,
    newEpisodes,
    artSaved,
    note,
    readShows,
    attemptedShows,
    ...(stopped ? { failed: true } : {}),
  };
}

export interface KanRowProgress {
  /** Shows the lobbies list for this row. */
  known: number;
  /** Of them, shows with at least one episode stored (in the catalog). */
  inCatalog: number;
  /** Episode pages of the first fill still to read (not counting newly published ones). */
  backlog: number;
}

/**
 * How far the first fill of each Kan row has come: the crawl reads lobby by lobby, show by show, over days. A row
 * whose shows are not all in yet says so (/status, and a ⏳ item first in the row).
 */
export function kanRowProgress(
  store: Pick<Store, 'getState' | 'findSeriesId' | 'getShow'>,
): Record<string, KanRowProgress> {
  const state = store.getState<CrawlState>(STATE_KEY);
  const out: Record<string, KanRowProgress> = {};
  for (const [key, s] of Object.entries(state?.shows ?? {})) {
    const row = out[s.catalog] ?? { known: 0, inCatalog: 0, backlog: 0 };
    out[s.catalog] = row;
    row.known++;
    const id = store.findSeriesId('kan', key);
    const eps = id ? (store.getShow(id)?.show.seasons.reduce((n, x) => n + x.episodes.length, 0) ?? 0) : 0;
    // A show whose page lists no episodes at all (or was given up on) is not waited for.
    if (eps > 0 || (s.pending.length === 0 && s.checkedAt)) row.inCatalog++;
    const fresh = new Set(s.fresh ?? []);
    row.backlog += s.pending.filter((u) => !fresh.has(u)).length;
  }
  return out;
}

/** A row still filling: some of its shows have nothing in the catalog yet. */
export function stillFilling(p: KanRowProgress | undefined): boolean {
  return !!p && p.inCatalog < p.known;
}

/**
 * The order shows get their episode pages read in: newly published episodes first (an airing show stays current);
 * then shows with the fewest episodes so far, so the first fill makes every show watchable before it completes any
 * long back catalogue (Tehran waited behind shows with 100 pages); the archive row breaks ties. Ties keep the lobby order.
 */
/**
 * Where a show stands in the queue (after newly published episodes): 0 its first APP_AGREEMENT pages, the evidence
 * that unlocks the app API for it; 1 shows the app is trusted for (filled from the app in bulk, outside the page
 * budget) or not judged yet; 2 shows that read every page (the app disagrees with their pages, or does not list them).
 */
function appTier(s: ShowState, have: number): number {
  if (s.app === 'disagrees' || s.app === 'unlisted') return 2;
  if (s.app === 'trusted') return 1;
  return have < APP_AGREEMENT ? 0 : 1;
}

export function episodeQueue(
  store: Pick<Store, 'findSeriesId' | 'getShow'>,
  shows: Record<string, ShowState>,
  now: number,
  retryAfter: (s: ShowState) => number,
): [string, ShowState][] {
  const have = (key: string) => {
    const id = store.findSeriesId('kan', key);
    return id ? (store.getShow(id)?.show.seasons.reduce((n, x) => n + x.episodes.length, 0) ?? 0) : 0;
  };
  const ready = Object.entries(shows).filter(([, s]) => s.pending.length > 0 && retryAfter(s) <= now);
  const rank = new Map(
    ready.map(([key, s], i) => [
      key,
      [
        s.fresh?.length ? 0 : 1,
        appTier(s, have(key)),
        have(key),
        KAN_LATER.has(s.catalog) ? 1 : 0,
        i,
      ] as const,
    ]),
  );
  const cmp = (a: string, b: string) => {
    const x = rank.get(a) ?? [0, 0, 0, 0, 0];
    const y = rank.get(b) ?? [0, 0, 0, 0, 0];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  };
  // Every row fills side by side: a show with fewer episodes comes first whatever its row (the archive only breaks
  // ties), so each archive show gets watchable early instead of after the other rows' whole backlog.
  return ready.sort(([a], [b]) => cmp(a, b));
}

function saveEpisodes(store: Store, key: string, s: ShowState, batch: BatchItem[], runId: number): number {
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
  if (numbering.warnings.length) store.addWarnings(runId, seriesId, numbering.warnings);
  // Newly published episodes move the show up "newest first"; the first fill's backlog does not.
  const fresh = batch.some((b) => s.fresh?.includes(b.url));
  if (s.fresh) s.fresh = s.fresh.filter((u) => !batch.some((b) => b.url === u));
  return store.saveShow(seriesId, clean, numbering.added, latestAirDate(clean), fresh);
}

/** A stored show's name, changed in place. */
function renameShow(store: Store, key: string, title: string): void {
  const seriesId = store.findSeriesId('kan', key);
  const row = seriesId ? store.getShow(seriesId) : undefined;
  if (!seriesId || !row || row.show.title === title) return;
  const show = { ...row.show, title };
  store.saveShow(seriesId, show, { seasons: [], episodes: [] }, latestAirDate(show), false);
}

/** Add air dates to episodes we already have (numbers and everything else unchanged). */
function dateEpisodes(store: Store, key: string, dates: Map<string, string>): void {
  const seriesId = store.findSeriesId('kan', key);
  const row = seriesId ? store.getShow(seriesId) : undefined;
  if (!seriesId || !row) return;
  const show: ScrapedShow = {
    ...row.show,
    seasons: row.show.seasons.map((x) => ({
      ...x,
      episodes: x.episodes.map((e) => {
        const d = dates.get(e.key);
        return d && !e.airDate ? { ...e, airDate: d } : e;
      }),
    })),
  };
  store.saveShow(seriesId, show, { seasons: [], episodes: [] }, latestAirDate(show), false);
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
    artworkDir: kanArtworkDir(config),
    // One profile per proxy exit: Cloudflare's clearance is tied to the exit's address.
    profileDir: join(
      dirname(config.store.path),
      `kan-browser${proxy ? `-${new URL(proxy.server).hostname.split('.')[0]}` : ''}`,
    ),
    // Kan's live channels' guide comes through this browser too (epg.ts).
    guide: config.sources.live,
    log,
  };
}

/** Where Kan show images are kept (next to the catalog database). */
export function kanArtworkDir(config: Config): string {
  return join(dirname(config.store.path), 'artwork');
}

/** An image path from a Kan page, made absolute against its site. */
function absolute(src: string | undefined, origin: string): string | undefined {
  return src ? new URL(src, origin).toString() : undefined;
}

/** The file name of a Kan show's saved image (from its page URL, which never changes). */
export function kanArtworkFile(key: string): string {
  return `kan-${createHash('sha256').update(key).digest('hex').slice(0, 16)}.jpg`;
}

/** Keep a copy of the show's image; a failure is noted and tried again the next day. */
function saveArtwork(
  s: ShowState,
  key: string,
  image: NonNullable<LoadedPage['image']>,
  dir: string,
  refused: (key: string, why: string) => void,
): boolean {
  s.artTriedAt = new Date().toISOString();
  if (!image.jpeg || image.jpeg.length < 1000) {
    refused(key, image.challenged ? 'bot check' : (image.error ?? `HTTP ${image.status}`));
    return false;
  }
  mkdirSync(dir, { recursive: true });
  const file = kanArtworkFile(key);
  writeFileSync(join(dir, file), image.jpeg);
  s.art = { from: image.url, file };
  return true;
}

/** Saved images by Kan show page URL (for rendering). */
export function kanArtwork(store: Store, dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, s] of Object.entries(store.getState<CrawlState>(STATE_KEY)?.shows ?? {})) {
    if (s.art && existsSync(join(dir, s.art.file))) out.set(key, join(dir, s.art.file));
  }
  return out;
}

/** Pages and images loaded per day and how many met Kan's bot check (newest last). */
export function kanBotCheck(store: Pick<Store, 'getState'>): Record<string, BotCheckDay> {
  return store.getState<CrawlState>(STATE_KEY)?.botCheck ?? {};
}

/** A show's id in Kan's app API: its page id, or the id the app's category lists gave a slug address. */
function appProgramId(key: string, s: ShowState): string | undefined {
  return /\/p-(\d+)\/$/.exec(key)?.[1] ?? s.appId;
}

/** Episodes stored for a show. */
function episodeCount(store: Pick<Store, 'getShow'>, seriesId: string | undefined): number {
  return seriesId
    ? (store.getShow(seriesId)?.show.seasons.reduce((n, x) => n + x.episodes.length, 0) ?? 0)
    : 0;
}

/** Stored episodes of a show that must agree with its app list before the app names any of its new episodes. */
export const APP_AGREEMENT = 2;

/**
 * Whether a show's app list says what its pages said: at least APP_AGREEMENT of its stored episodes are listed, and
 * every listed one has the same title, season and stream (and day, when both have one). A show without that evidence (new,
 * or the app disagrees) reads its pages, as before.
 */
export function appAgrees(
  store: Pick<Store, 'getShow'>,
  seriesId: string | undefined,
  feed: Map<string, AppItem>,
  /** Episodes read from pages in this slice, not stored yet. */
  read: {
    key: string;
    title: string;
    season: number;
    airDate?: string | undefined;
    streams: { url: string }[];
  }[] = [],
): boolean {
  return appVerdict(store, seriesId, feed, read) === 'agrees';
}

/** appAgrees, with the reason when it does not: the app contradicts the pages, or there is not enough evidence yet. */
export function appVerdict(
  store: Pick<Store, 'getShow'>,
  seriesId: string | undefined,
  feed: Map<string, AppItem>,
  read: Parameters<typeof appAgrees>[3] = [],
): 'agrees' | 'disagrees' | 'unknown' {
  const show = seriesId ? store.getShow(seriesId)?.show : undefined;
  const stored = (show?.seasons ?? []).flatMap((x) =>
    x.episodes.map((e) => ({ ...e, season: Number(/\|s(\d+)$/.exec(x.key)?.[1] ?? Number.NaN) })),
  );
  let agree = 0;
  for (const e of [...stored, ...read]) {
    const item = feed.get(e.key.replace(/^kan:/, ''));
    if (!item) continue;
    // Where the app names a stream, it must be the one the page played (some shows' pages play other assets).
    const same =
      item.title === e.title &&
      (item.seasonNumber ?? 1) === e.season &&
      (!item.published || !e.airDate || item.published === e.airDate) &&
      (item.stream.kind !== 'redge' || item.stream.url === e.streams[0]?.url);
    if (!same) return 'disagrees';
    agree++;
  }
  return agree >= APP_AGREEMENT ? 'agrees' : 'unknown';
}

/** Episode pages skipped because Kan took the video down (rights ended) or the page holds no video. */
export function kanSkippedPages(store: Pick<Store, 'getState'>): { removed: number; notVideo: number } {
  const shows = Object.values(store.getState<CrawlState>(STATE_KEY)?.shows ?? {});
  return {
    removed: shows.reduce((n, s) => n + (s.removed?.length ?? 0), 0),
    notVideo: shows.reduce((n, s) => n + (s.notVideo?.length ?? 0), 0),
  };
}

/** The Kan crawl's progress, for the dashboard: episode pages still to read, shows known, back-off. */
export function kanProgress(
  store: Store,
): { pending: number; shows: number; showsDone: number; backoffUntil?: string } | undefined {
  const st = store.getState<CrawlState>(STATE_KEY);
  if (!st) return undefined;
  const shows = Object.values(st.shows);
  const pending = shows.reduce((n, s) => n + s.pending.length, 0);
  return {
    pending,
    shows: shows.length,
    showsDone: shows.filter((s) => s.pending.length === 0).length,
    ...(st.backoffUntil ? { backoffUntil: st.backoffUntil } : {}),
  };
}
