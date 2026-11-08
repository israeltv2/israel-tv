// Publish: render the site from the store, write only changed files, then hand the folder to the
// configured publisher (local: nothing more to do; cloudflare: wrangler deploy with an API token).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  apiWorkerName,
  CATALOGS,
  type Config,
  enabledSources,
  freshnessStamp,
  type Health,
  HOUR_MS,
  LIVE_CHANNELS,
  ORIGIN_TOKEN,
  type PublisherConfig,
  type Source,
  STALE_PUBLISH_HOURS,
  type StatusFile,
  type StatusNote,
  type StatusParams,
  sitePaths,
  type TmdbDetails,
} from '@israel-tv/core';
import {
  publicStatus,
  type RenderShow,
  renderSite,
  renderStatusHtml,
  type SiteFiles,
} from '@israel-tv/render';
import { brandImage, channelLogo, channelLogoSite } from '@israel-tv/resolver';
import { RELEASE_VERSION, scrub, secretValues } from '@israel-tv/runtime';
import type { RunKind, ShowRow, Store } from '@israel-tv/store';
import { auditSite } from './catalog-audit.ts';
import { guideFile } from './epg.ts';
import { indexNowEnabled, indexNowKey, keyFile, submitIndexNow } from './indexnow.ts';
import {
  KAN_LATER,
  kanArtwork,
  kanArtworkDir,
  kanBotCheck,
  kanFullLists,
  kanRowProgress,
  kanSkippedPages,
  MAX_EPISODE_TRIES,
  RETRY_GAP_MS,
  stillFilling,
} from './kan.ts';
import { LIVE_CHECK_KEY, type LiveCheck, liveRender } from './live.ts';
import { checkNumbering } from './numbering-guard.ts';
import {
  imageSize,
  isStockImage,
  localPoster,
  measurePosters,
  posterDir,
  reachableAbroad,
  remotePoster,
} from './posters.ts';
import { publicStatusExtras } from './public-status.ts';
import {
  BLOCK_RETRIES,
  type BlockedRetry,
  type BotCheckDay,
  botCheckKey,
  emptyShowsKey,
  episodeCount,
  offeredCount,
  retryKey,
} from './runner.ts';
import { siteImages } from './site-images.ts';
import { probeResults } from './stream-probe.ts';
import { ALIASES_KEY, DETAILS_KEY } from './tmdb.ts';

/** The details fields of a stored TMDB record (without its bookkeeping). */
const tmdbOnly = ({ genres, overview, firstYear, lastYear }: TmdbDetails): TmdbDetails => ({
  ...(genres ? { genres } : {}),
  ...(overview ? { overview } : {}),
  ...(firstYear ? { firstYear } : {}),
  ...(lastYear ? { lastYear } : {}),
});

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** How each source is read, for judging its health. Kan is read in small crawl slices that may back off. */
const READS: Record<Source, { kind: RunKind; failedIs: Health; lastGood: 'latest' | 'any' }> = {
  mako: { kind: 'full', failedIs: 'error', lastGood: 'latest' },
  reshet: { kind: 'full', failedIs: 'error', lastGood: 'latest' },
  kan: { kind: 'crawl', failedIs: 'warn', lastGood: 'any' },
  live: { kind: 'full', failedIs: 'error', lastGood: 'latest' },
};

/** A warning's stored values (JSON), or nothing when they cannot be read. */
function parseParams(json: string): StatusParams | undefined {
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as StatusParams) : undefined;
  } catch {
    return undefined;
  }
}

export function buildStatus(
  store: Store,
  sources: Source[],
  now = Date.now(),
  all: ShowRow[] = store.listShows(),
): StatusFile {
  const out: StatusFile['sources'] = [];
  for (const source of sources) {
    const read = READS[source];
    const shows = all.filter((s) => s.source === source && s.state === 'listed');
    const episodes = shows.reduce((n, s) => n + offeredCount(s.show), 0);
    // A run stopped for a restart is neither good nor bad: health is judged on the last run that ended by itself.
    const last = store.lastRun(read.kind, source, { settled: true });
    const airing = store.lastRun('airing', source, { settled: true });
    const notes: string[] = [];
    const noteCodes: StatusNote[] = [];
    /** A note in English and as a code with its values (the status page words it in either language). */
    const note = (code: string, text: string, params?: StatusNote['params']) => {
      notes.push(text);
      noteCodes.push(params ? { code, params } : { code });
    };
    let health: Health = 'ok';
    const lastGood =
      read.lastGood === 'any'
        ? store.lastGoodRun(read.kind, source)
        : last && last.status !== 'failed'
          ? last
          : undefined;
    if (!last) {
      health = 'warn';
      const limited = store.lastRun(read.kind, `${source}:limited`, { settled: true });
      if (limited)
        note(
          'limited-run-only',
          'only a limited test run (--limit) so far; the full run follows at schedule.fullRun',
        );
      else note('no-full-run', 'no full run yet');
    } else if (last.status === 'failed') {
      health = read.failedIs;
      note('last-run-failed', `last full run failed: ${last.error ?? 'unknown error'}`, {
        error: last.error ?? '',
      });
    }
    // Shows refused by the site's bot protection (in the full run or a later airing read) wait for a retry with their
    // last good data kept: only shows still refused after every retry, or failures of another kind, make it amber.
    const retryState = store.getState<BlockedRetry | null>(retryKey(source));
    const r = last && retryState?.runId === last.id ? retryState : undefined;
    if (r) {
      const names = (list: string[]) =>
        list.slice(0, 5).join(', ') + (list.length > 5 ? ` +${list.length - 5} more` : '');
      const total = r.pending.length + r.recovered.length;
      const titles = r.pending.map((p) => p.title);
      if (r.pending.length === 0)
        note(
          'blocked-recovered',
          `${total} ${total === 1 ? 'show was' : 'shows were'} refused by the site's bot protection and read on a retry`,
          { count: total },
        );
      else if (r.nextAt)
        note(
          'blocked-retrying',
          `${r.pending.length} ${r.pending.length === 1 ? 'show' : 'shows'} refused by the site's bot protection, retry ${r.attempts + 1} of ${BLOCK_RETRIES} at ${r.nextAt.slice(11, 16)} UTC: ${names(titles)}`,
          { count: r.pending.length, attempt: r.attempts + 1, of: BLOCK_RETRIES, at: r.nextAt, titles },
        );
      else {
        health = 'warn';
        note(
          'blocked-still',
          `${r.pending.length} ${r.pending.length === 1 ? 'show' : 'shows'} still refused by the site's bot protection after ${r.attempts} retries: ${names(titles)}`,
          { count: r.pending.length, attempts: r.attempts, titles },
        );
      }
    }
    if (last?.status === 'partial') {
      health = 'warn';
      if (r && r.others > 0)
        note(
          'run-partial-failed',
          `last full run: ${r.others} ${r.others === 1 ? 'show' : 'shows'} failed (not blocked)`,
          { count: r.others },
        );
      else if (last.showsFailed > 0)
        note(
          'run-partial-failed',
          `last full run partial: ${last.showsFailed} ${last.showsFailed === 1 ? 'show' : 'shows'} failed`,
          { count: last.showsFailed },
        );
      else
        note('run-partial', `last run partial: ${last.error ?? 'stopped early'}`, {
          error: last.error ?? '',
        });
    }
    // The bot check's answer rate today, measured: said plainly, never a warning by itself.
    const bot = store.getState<Record<string, BotCheckDay>>(botCheckKey(source))?.[
      new Date(now).toISOString().slice(0, 10)
    ];
    if (bot?.pages)
      note(
        'bot-check-rate',
        `the site's bot check answered ${bot.pages} of ${bot.requests} requests today (${((100 * bot.pages) / Math.max(1, bot.requests)).toFixed(1)}%); ${bot.cleared} read on a quick retry, ${bot.delayed} ${bot.delayed === 1 ? 'show' : 'shows'} delayed to a later retry`,
        { pages: bot.pages, requests: bot.requests, cleared: bot.cleared, delayed: bot.delayed },
      );
    // Time since the last good run; for a source that never had one, since its first attempt.
    const everGood = store.lastGoodRun(read.kind, source);
    const ref = everGood ?? (last ? store.firstRun(read.kind, source) : undefined);
    if (last && ref && now - Date.parse(ref.startedAt) > 36 * HOUR_MS) {
      health = 'error';
      if (lastGood) note('no-success-36h', 'no successful run in 36 hours');
      else note('never-succeeded-36h', 'never succeeded, first tried over 36 hours ago');
    }
    if (source === 'live') {
      if (last)
        note(
          'live-answering',
          `${last.showsOk} channels answering (every stream played daily; Mako channels through the home helper)`,
          { count: last.showsOk },
        );
    } else if (shows.length === 0 && last) {
      health = 'error';
      note('no-shows', 'no shows');
    }
    // The same facts as some notes, as fields: the status page words them itself (in either language).
    let skippedPages: { noLongerOffered: number; notVideo: number } | undefined;
    let botCheck: { challenged: number; pages: number } | undefined;
    // Kan fills over days: until every listed show is in, the source is not "ok" (its rows say so too).
    if (source === 'kan') {
      for (const [catalog, p] of Object.entries(kanRowProgress(store))) {
        if (!stillFilling(p)) continue;
        const name = CATALOGS.find((c) => c.id === catalog)?.name ?? catalog;
        // The archive is a long back catalogue read last: noted, not a warning.
        if (!KAN_LATER.has(catalog) && health === 'ok') health = 'warn';
        note(
          'first-fill',
          `first fill of ${catalog} (${name}) in progress: ${p.inCatalog} of ${p.known} shows in the catalog, ${p.backlog} episode pages to read`,
          { catalog, inCatalog: p.inCatalog, known: p.known, pagesToRead: p.backlog },
        );
      }
      // Pages Kan lists as episodes with nothing to play: expected, explained, not a warning.
      const skipped = kanSkippedPages(store);
      skippedPages = { noLongerOffered: skipped.removed, notVideo: skipped.notVideo };
      if (skipped.removed > 0)
        note(
          'kan-no-longer-offered',
          `${skipped.removed} Kan episodes are no longer offered by Kan (their broadcast rights ended), so they are not in the catalog`,
          { count: skipped.removed },
        );
      // Kan's bot check, measured: any page it stopped today is said plainly (the crawl waits and tries again).
      const today = kanBotCheck(store)[new Date().toISOString().slice(0, 10)];
      if (today?.pages) botCheck = { challenged: today.challenged, pages: today.pages };
      if (today?.challenged)
        note(
          'kan-bot-check',
          `Kan's bot check stopped ${today.challenged} of ${today.pages} page loads today; the crawl waits and tries again`,
          { challenged: today.challenged, pages: today.pages },
        );
      if (skipped.notVideo > 0)
        note(
          'kan-not-video',
          `${skipped.notVideo} pages Kan lists among episodes are articles or promos without video (skipped)`,
          { count: skipped.notVideo },
        );
      if (skipped.waiting > 0)
        note(
          'kan-waiting-retry',
          `${skipped.waiting} Kan ${skipped.waiting === 1 ? 'show waits' : 'shows wait'} to read an episode page again that failed to load (tried up to ${MAX_EPISODE_TRIES} times, ${RETRY_GAP_MS / HOUR_MS} hours apart; the show's later episodes follow it)`,
          { count: skipped.waiting, tries: MAX_EPISODE_TRIES, hours: RETRY_GAP_MS / HOUR_MS },
        );
      // Kan's full episode lists (kan.ts FULL_LISTS): the backfill's progress, and what the lists cannot give.
      const lists = kanFullLists(store);
      if (lists.waiting > 0 || lists.toRead > 0)
        note(
          'kan-full-lists',
          `reading Kan's full episode lists: ${lists.shows - lists.waiting} of ${lists.shows} shows done, ${lists.toRead} older episode pages found in them still to read`,
          { done: lists.shows - lists.waiting, shows: lists.shows, pages: lists.toRead },
        );
      if (lists.pagesOnly > 0)
        note(
          'kan-pages-only',
          `${lists.pagesOnly} Kan ${lists.pagesOnly === 1 ? 'show is' : 'shows are'} not in Kan's app, so only the episodes ${lists.pagesOnly === 1 ? 'its page links' : 'their pages link'} are read (a long show's older episodes may be missing)`,
          { count: lists.pagesOnly },
        );
      if (lists.noPage > 0)
        note(
          'kan-no-web-page',
          `${lists.noPage} Kan ${lists.noPage === 1 ? 'episode plays' : 'episodes play'} only from YouTube, so ${lists.noPage === 1 ? 'it is' : 'they are'} not in the catalog`,
          { count: lists.noPage },
        );
      if (skipped.gaveUp > 0)
        note(
          'kan-gave-up',
          `${skipped.gaveUp} Kan episode pages failed to load ${MAX_EPISODE_TRIES} times and were skipped`,
          { count: skipped.gaveUp, tries: MAX_EPISODE_TRIES },
        );
    }
    // Reshet episodes past their availability window: kept with their numbers, not in the catalog (render.ts).
    if (source === 'reshet') {
      const past = shows.reduce((n, s) => n + episodeCount(s.show) - offeredCount(s.show), 0);
      if (past > 0) {
        skippedPages = { noLongerOffered: past, notVideo: 0 };
        note(
          'reshet-past-window',
          `${past} Reshet ${past === 1 ? 'episode is' : 'episodes are'} past their availability window, so ${past === 1 ? 'it is' : 'they are'} not in the catalog`,
          { count: past },
        );
      }
    }
    // Listed by the site with nothing to watch: a count here, the titles in `emptyShows` (an expandable list).
    const empty = store.getState<string[]>(emptyShowsKey(source)) ?? [];
    if (empty.length > 0)
      note(
        'empty-shows',
        `${empty.length} ${empty.length === 1 ? 'show' : 'shows'} listed by the site with nothing to watch (not in the catalog)`,
        { count: empty.length },
      );
    const retry = store.getState<BlockedRetry | null>(retryKey(source));
    out.push({
      source,
      health,
      shows: source === 'live' ? (last?.showsOk ?? 0) : shows.length,
      episodes,
      ...(last
        ? {
            lastFullRun: {
              at: last.startedAt,
              status: last.status,
              ...(last.error ? { error: last.error } : {}),
            },
          }
        : {}),
      ...(airing ? { lastAiringRun: { at: airing.startedAt, status: airing.status } } : {}),
      notes,
      ...(noteCodes.length ? { noteCodes } : {}),
      ...(skippedPages && (skippedPages.noLongerOffered || skippedPages.notVideo)
        ? { skipped: skippedPages }
        : {}),
      ...(botCheck ? { botCheck } : {}),
      ...(empty.length ? { emptyShows: empty } : {}),
      ...(retry && retry.runId === last?.id
        ? {
            blocked: {
              pending: retry.pending.map((p) => p.title),
              recovered: retry.recovered,
              attempts: retry.attempts,
              ...(retry.nextAt ? { nextAt: retry.nextAt } : {}),
            },
          }
        : {}),
    });
  }
  const lastMatch = store.lastRun('match', 'tmdb', { settled: true });
  const matchNote =
    lastMatch?.status === 'failed'
      ? `last TMDB matching failed (${lastMatch.startedAt}): ${lastMatch.error ?? ''}`
      : undefined;
  const matchCode: StatusNote | undefined =
    lastMatch?.status === 'failed'
      ? { code: 'tmdb-failed', params: { at: lastMatch.startedAt, error: lastMatch.error ?? '' } }
      : undefined;
  const lastPublish =
    store.lastRun('publish', 'cloudflare', { settled: true }) ??
    store.lastRun('publish', 'local', { settled: true });
  const lastGoodPublish = store.lastGoodRun('publish', 'cloudflare') ?? store.lastGoodRun('publish', 'local');
  const failing = failedPublishes(store);
  const publishNote =
    lastPublish?.status === 'failed' && failing.alert
      ? `last publish failed (${lastPublish.startedAt})${failing.inRow > 1 ? `, ${failing.inRow} in a row` : ''}: ${(lastPublish.error ?? '').split('\n')[0]}`
      : lastGoodPublish && now - Date.parse(lastGoodPublish.startedAt) > STALE_PUBLISH_HOURS * HOUR_MS
        ? `the catalog has not been published since ${lastGoodPublish.startedAt}`
        : undefined;
  const publishCode: StatusNote | undefined =
    lastPublish?.status === 'failed' && failing.alert
      ? {
          code: 'publish-failed',
          params: {
            at: lastPublish.startedAt,
            inRow: failing.inRow,
            error: (lastPublish.error ?? '').split('\n')[0] ?? '',
          },
        }
      : publishNote && lastGoodPublish
        ? { code: 'publish-stale', params: { since: lastGoodPublish.startedAt } }
        : undefined;
  const failingShows = all
    .filter((s) => s.lastError && s.state === 'listed')
    .map((s) => ({ id: s.seriesId, title: s.title, error: s.lastError ?? '', lastOkAt: s.lastOkAt }));
  const warnings = store.recentWarnings(50).map((w) => {
    const params = w.params ? parseParams(w.params) : undefined;
    return {
      at: w.createdAt,
      code: w.code,
      message: w.message,
      ...(w.seriesId ? { id: w.seriesId } : {}),
      ...(params ? { params } : {}),
    };
  });
  const worst: Health =
    out.some((s) => s.health === 'error') || publishNote
      ? 'error'
      : out.some((s) => s.health === 'warn') || failingShows.length > 0 || matchNote
        ? 'warn'
        : 'ok';
  // The status is published: no secret may be in it, whatever an error message carried.
  return cleanSecrets({
    generatedAt: new Date(now).toISOString(),
    health: worst,
    ...(publishNote ? { publish: publishNote } : {}),
    ...(matchNote ? { tmdb: matchNote } : {}),
    ...(publishCode ? { publishNote: publishCode } : {}),
    ...(matchCode ? { tmdbNote: matchCode } : {}),
    sources: out,
    failingShows,
    warnings,
  });
}

/** A run stopped by a restart (deploys restart the service): not a failure of the thing it was doing. */
const STOPPED = /^interrupted|stopped for restart/i;

/**
 * Failed publishes in a row, newest first (runs stopped by a restart are skipped), and whether that is a problem
 * yet: a setup problem (token, account) at once; Cloudflare's own outages only after PUBLISH_ALERT_AFTER failed
 * publishes in a row (each already tried again with pauses). Until then the public copy is the last good one, a
 * publish behind; a catalog not published for STALE_PUBLISH_HOURS is said either way.
 */
export function failedPublishes(store: Store): { inRow: number; alert: boolean } {
  let inRow = 0;
  let outagesOnly = true;
  for (const r of store.runsOfKind('publish', PUBLISH_ALERT_AFTER + 10)) {
    if (r.status === 'running' || (r.status === 'failed' && STOPPED.test(r.error ?? ''))) continue;
    if (r.status !== 'failed') break;
    inRow++;
    outagesOnly &&= CLOUDFLARE_OUTAGE.test((r.error ?? '').split('\n')[0] ?? '');
  }
  return { inRow, alert: inRow > 0 && (!outagesOnly || inRow >= PUBLISH_ALERT_AFTER) };
}

/** Remove every secret from text (or strings inside a value): `.env` values, and Cloudflare account paths. */
export function cleanSecrets<T>(value: T, env: NodeJS.ProcessEnv = process.env): T {
  const scrubbed = scrub(value, secretValues(env));
  const accounts = (v: unknown): unknown =>
    typeof v === 'string'
      ? v.replace(/\/accounts\/[0-9a-f]{32}/gi, '/accounts/[redacted]')
      : Array.isArray(v)
        ? v.map(accounts)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, accounts(x)]))
          : v;
  return accounts(scrubbed) as T;
}

export function catalogWarnings(status: StatusFile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of status.sources) {
    if (s.health !== 'error') continue;
    const day = s.lastFullRun?.at.slice(0, 10) ?? '';
    for (const c of CATALOGS.filter((x) => x.source === s.source).map((x) => x.id)) {
      out[c] = `עדכון ${s.source} נכשל ${day} · ${s.notes[0] ?? ''}`.trim();
    }
  }
  return out;
}

/** Rows still filling (Kan's first fill): a ⏳ item first in the row, in the viewer's words. */
export function catalogFilling(
  store: Store,
  config: Pick<Config, 'sources' | 'browser'>,
): Record<string, string> {
  if (!config.sources.kan || config.browser.type === 'none') return {};
  const out: Record<string, string> = {};
  for (const [catalog, p] of Object.entries(kanRowProgress(store)))
    if (stillFilling(p))
      out[catalog] =
        `עדיין בטעינה: ${p.inCatalog} מתוך ${p.known} התוכניות כבר כאן, השאר יופיעו בימים הקרובים`;
  return out;
}

export function renderFromStore(store: Store, config: Config): SiteFiles {
  const hiddenShows = new Set(config.hide.shows);
  const hiddenSources = new Set<string>(config.hide.sources);
  // Hidden shows and sources are left out of everything published (see config `hide`).
  const rows = store
    .listShows()
    .filter((r) => !hiddenShows.has(r.seriesId) && !hiddenSources.has(r.show.source));
  const shown = activeSources(config).filter((src) => !hiddenSources.has(src));
  // What the public status page adds: rows, a day-by-day history, the live channels, the schedule (public-status.ts).
  const status = {
    ...buildStatus(store, activeSources(config), Date.now(), rows),
    ...publicStatusExtras(store, config, shown, rows),
  };
  const registry = store.registry();
  const seasonsBy = groupBy(registry.seasons, (x) => x.seriesId);
  const episodesBy = groupBy(registry.episodes, (x) => x.seriesId);
  const assets = new Map<string, Uint8Array>();
  // Artwork that is refused outside Israel (Kan's) is served from our own copy, and never linked to.
  const kanArt = config.sources.kan ? kanArtwork(store, kanArtworkDir(config)) : new Map<string, string>();
  const postersAt = posterDir(config);
  const placeholder = `${ORIGIN_TOKEN}/${sitePaths.posterPlaceholder}`;
  const reachable = (u: string | undefined) => (u && reachableAbroad(u) && !isStockImage(u) ? u : undefined);
  const withArtwork = (r: (typeof rows)[number]) => {
    const file = r.show.source === 'kan' ? kanArt.get(r.show.key) : undefined;
    const own = file ? `${ORIGIN_TOKEN}/${sitePaths.artwork(r.seriesId)}` : undefined;
    const body = file ? readFileSync(file) : undefined;
    if (body) assets.set(sitePaths.artwork(r.seriesId), body);
    // Our copy stands in for the show's backdrop and episode stills, unless it is a square tile (Kan kids' lobby
    // images: stretched over a backdrop, or as every episode's still, worse than none).
    const size = body ? imageSize(body) : undefined;
    const wide = own && size && !(size.w / size.h > 0.8 && size.w / size.h < 1.25) ? own : undefined;
    const show = {
      ...r.show,
      seasons: r.show.seasons.map((s) => ({
        ...s,
        episodes: s.episodes.map((e) => {
          const { thumbnail, ...rest } = e;
          const t = wide ?? reachable(thumbnail);
          return t ? { ...rest, thumbnail: t } : rest;
        }),
      })),
    };
    // No backdrop of its own (most Reshet shows): its newest episode's still, which is the show and is landscape.
    const newest = show.seasons
      .flatMap((s) => s.episodes)
      .map((e) => ({ at: e.airDate ?? '', still: 'thumbnail' in e ? e.thumbnail : undefined }))
      .filter((e) => e.still)
      .sort((a, b) => b.at.localeCompare(a.at))[0]?.still;
    // With a copy of ours, the source's own backdrop is that same image: the copy decides.
    const background = wide ?? (file ? undefined : reachable(r.show.background)) ?? newest;
    if (background) show.background = background;
    else delete show.background;
    // The poster: portrait, and reachable from anywhere.
    let poster: string | undefined;
    if (file) {
      const body = localPoster(file, postersAt);
      if (body === 'same') poster = own;
      else if (body) {
        assets.set(sitePaths.poster(r.seriesId), body);
        poster = `${ORIGIN_TOKEN}/${sitePaths.poster(r.seriesId)}`;
      }
    } else if (r.show.poster) {
      const p = remotePoster(store, postersAt, r.show.poster);
      if ('url' in p) poster = p.url;
      else if ('file' in p) {
        assets.set(sitePaths.poster(r.seriesId), readFileSync(p.file));
        poster = `${ORIGIN_TOKEN}/${sitePaths.poster(r.seriesId)}`;
      }
    }
    return { ...show, poster: poster ?? placeholder };
  };
  const aliases = store.getState<Record<string, string[]>>(ALIASES_KEY) ?? {};
  const tmdbDetails = store.getState<Record<string, TmdbDetails & { tmdbId: number }>>(DETAILS_KEY) ?? {};
  const shows: RenderShow[] = rows.map((r) => ({
    seriesId: r.seriesId,
    catalog: r.catalog,
    title: r.title,
    show: withArtwork(r),
    seasons: (seasonsBy.get(r.seriesId) ?? []).map(({ key, number, kind }) => ({ key, number, kind })),
    episodes: (episodesBy.get(r.seriesId) ?? []).map(({ key, season, episode }) => ({
      key,
      season,
      episode,
    })),
    latestAirDate: r.latestAirDate,
    latestEpisodeSeenAt: r.latestEpisodeSeenAt,
    state: r.state,
    tmdbId: r.tmdbId,
    imdbId: r.imdbId,
    ...(aliases[r.seriesId]?.length ? { aliases: aliases[r.seriesId] } : {}),
    // Only for the show TMDB is matched to now (a match can be dropped or moved).
    ...(r.tmdbId && tmdbDetails[r.seriesId]?.tmdbId === r.tmdbId
      ? { tmdb: tmdbOnly(tmdbDetails[r.seriesId] as TmdbDetails) }
      : {}),
  }));
  for (const [path, name] of [
    [sitePaths.logo, 'logo'],
    [sitePaths.background, 'background'],
    // Always: shows without an image of their own and the rows' notices use it.
    [sitePaths.posterPlaceholder, 'poster-placeholder'],
  ] as const) {
    const img = brandImage(config.branding.dir, name);
    if (img) assets.set(path, img.body);
  }
  // The public pages' icons and share image.
  for (const [path, body] of siteImages(config.branding.dir)) assets.set(path, body);
  // Live channel logos are served from here (their sources are not ours to hotlink).
  const logos = new Set<string>();
  if (config.sources.live && !hiddenSources.has('live')) {
    for (const c of LIVE_CHANNELS) {
      const png = channelLogo(c.id);
      const webp = channelLogoSite(c.id);
      // The pages show the small copy; the apps get the PNG. A logo is shown only with both.
      if (png && webp) {
        assets.set(sitePaths.channelLogo(c.id), png);
        assets.set(sitePaths.channelLogoSite(c.id), webp);
        logos.add(c.id);
      }
    }
  }
  const live =
    config.sources.live && !hiddenSources.has('live')
      ? liveRender(logos, store.getState<LiveCheck>(LIVE_CHECK_KEY))
      : [];
  const files = renderSite({
    version: RELEASE_VERSION,
    assets,
    ...(config.addon.stremioAddonsConfig ? { stremioAddonsConfig: config.addon.stremioAddonsConfig } : {}),
    probes: probeResults(store),
    guide: guideFile(store),
    sources: activeSources(config).filter((src) => !hiddenSources.has(src)),
    shows,
    live,
    status,
    registry,
    freshness: {
      publishedAt: freshnessStamp(),
      sources: Object.fromEntries(
        activeSources(config)
          .filter((src) => !hiddenSources.has(src))
          .map((src) => {
            const good = store.lastGoodRun(src === 'kan' ? 'crawl' : 'full', src);
            // Rounded down like publishedAt, so this file does not change (and force an upload) on every run.
            const at = good ? freshnessStamp(Date.parse(good.finishedAt ?? good.startedAt)) : undefined;
            return [src, { cadenceHours: 24, ...(at ? { lastGoodAt: at } : {}) }];
          }),
      ),
      catalogs: Object.fromEntries(CATALOGS.map((c) => [c.id, c.source])),
    },
    catalogWarnings: catalogWarnings(status),
    catalogFilling: catalogFilling(store, config),
    ...(publicBase(config, store) ? { publicUrl: publicBase(config, store) as string } : {}),
  });
  // The publisher's own audit of these files, published on /status with them.
  const audit = auditSite(files, store);
  store.setState('catalog:audit', audit);
  const published = JSON.parse(String(files.get(sitePaths.status))) as StatusFile;
  // Only the public addon's own address may be named besides the broadcasters' (never a Worker, tunnel or helper).
  const own = publicBase(config, store);
  const origins = own ? { origins: [own] } : {};
  const audited = publicStatus({ ...published, audit }, origins);
  files.set(sitePaths.status, JSON.stringify(audited));
  files.set(sitePaths.statusPage, renderStatusHtml(audited, origins));
  files.set(sitePaths.statusPageHe, renderStatusHtml(audited, origins, 'he'));
  // With the public address known, write it into every file now: no file then needs the Worker for it.
  const base = publicBase(config, store);
  if (base) {
    for (const [path, content] of files) {
      if (typeof content === 'string' && content.includes(ORIGIN_TOKEN))
        files.set(path, content.replaceAll(ORIGIN_TOKEN, base));
    }
  }
  // The IndexNow key file (public by design), so the search engines can check the key a submission names.
  if (indexNowEnabled(config)) {
    const key = indexNowKey(store, config);
    files.set(keyFile(key), key);
  }
  return files;
}

function groupBy<T>(list: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** The addon's data, not pages: kept out of search results (robots.txt asks the same). */
const NOINDEX = [
  ...['status', 'search', 'epg', 'airings', 'ext-ids', 'registry', 'freshness', 'resolver-contract'].map(
    (f) => `/${f}.json`,
  ),
  ...['meta', 'play', 'catalog'].map((d) => `/${d}/*`),
];

/**
 * Cloudflare's static-asset headers. Every matching rule applies, values added up, so a rule that sets its own
 * Cache-Control first detaches the one from `/*` (`! Cache-Control`): one value per response.
 * Files that do not change are kept by browsers: the fonts for a year (a changed font gets a new file name), channel
 * logos for a week and show artwork for a day, each re-checked in the background after that.
 */
export const HEADERS_FILE = `/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=600
/manifest.json
  ! Cache-Control
  Cache-Control: public, max-age=300
  X-Robots-Tag: noindex
/streams/*
  ! Cache-Control
  Cache-Control: public, max-age=300
  X-Robots-Tag: noindex
/status*
  ! Cache-Control
  Cache-Control: no-store
/he/status*
  ! Cache-Control
  Cache-Control: no-store
/fonts/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/logos/*
  ! Cache-Control
  Cache-Control: public, max-age=604800, stale-while-revalidate=2592000
/art/*
  ! Cache-Control
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800
${NOINDEX.map((p) => `${p}\n  X-Robots-Tag: noindex`).join('\n')}
`;

function* walk(dir: string): Generator<string> {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const MARKER = '.israel-tv-site';

/** Status files carry timestamps (the page as `<time>` elements); compare them without, so a quiet run changes nothing. */
export const comparable = (content: string) =>
  content.replace(/<time [^>]*>[^<]*<\/time>/g, '').replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '');

/**
 * Write the site to `dir`, touching only files whose content changed, and delete files no longer
 * rendered. The folder is marked as ours on first write; a non-empty folder without the mark is never
 * cleaned (so a misconfigured `publisher.dir` cannot delete other files).
 */
export function writeSite(
  dir: string,
  files: SiteFiles,
): { written: number; deleted: number; total: number; changed: string[]; removed: string[] } {
  mkdirSync(dir, { recursive: true });
  const marked = existsSync(join(dir, MARKER));
  if (!marked && readdirSync(dir).length > 0) {
    throw new Error(
      `${dir} is not empty and was not created by israel-tv; set publisher.dir to an empty or new folder`,
    );
  }
  if (!marked)
    writeFileSync(join(dir, MARKER), 'Rendered addon files. Everything here is replaced on each publish.\n');
  const all = new Map(files);
  all.set('_headers', HEADERS_FILE);
  all.set('.assetsignore', `${MARKER}\n`);
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [path, content] of all) {
    const p = join(dir, path);
    let same = false;
    try {
      const old = readFileSync(p);
      same =
        path === sitePaths.status || path === sitePaths.statusPage || path === sitePaths.statusPageHe
          ? comparable(old.toString()) === comparable(String(content))
          : old.equals(Buffer.from(content));
    } catch {}
    if (!same) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
      changed.push(path);
    }
  }
  for (const p of walk(dir)) {
    const rel = relative(dir, p).split('\\').join('/');
    if (rel !== MARKER && !all.has(rel)) {
      rmSync(p);
      removed.push(rel);
    }
  }
  return { written: changed.length, deleted: removed.length, total: all.size, changed, removed };
}

/** A publishing problem the user can fix (credentials, permissions); printed without a stack trace. */
export class PublishError extends Error {
  override name = 'PublishError';
  /** Cloudflare's own trouble (an outage), not a setup problem: worth trying again. */
  readonly outage: boolean;
  constructor(message: string, outage = false) {
    super(message);
    this.outage = outage;
  }
}

/**
 * Cloudflare's own trouble (5xx, "no healthy upstream", a malformed API answer, timeouts, a dropped connection):
 * measured 2026-11-06, 9 publishes in 8 minutes failed with "malformed response … no healthy upstream" and the next
 * one went through.
 */
export const CLOUDFLARE_OUTAGE =
  /no healthy upstream|malformed response|(?:status|HTTP|code)[:\s]+5\d\d\b|\b5\d\d (?:Internal|Bad Gateway|Service Unavailable|Gateway Timeout)|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up|service unavailable|bad gateway/i;

/** How a publish retries Cloudflare's outages: tries in all, and the pause before each retry (grows, with jitter). */
export interface PublishRetry {
  attempts: number;
  baseMs: number;
  maxMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}
export const PUBLISH_RETRY: PublishRetry = { attempts: 4, baseMs: 15_000, maxMs: 180_000 };

/** Failed publishes in a row (each after its own retries) before /status calls it a problem. */
export const PUBLISH_ALERT_AFTER = 3;

/** The pause before retry `n` (1 = the first retry): ×4 each time up to the cap, then 50–100% of it (jitter). */
export function retryDelay(n: number, r: PublishRetry = PUBLISH_RETRY): number {
  const full = Math.min(r.maxMs, r.baseMs * 4 ** (n - 1));
  return Math.round(full * (0.5 + 0.5 * (r.random ?? Math.random)()));
}

/** Terminal colour codes (wrangler prints them even with NO_COLOR). */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** wrangler's own error line, e.g. "Authentication failed (status: 400) [code: 9106]", first; then a hint. */
export function publishError(
  out: string,
  code: number | null,
  p: { apiTokenEnv: string; accountIdEnv: string },
): PublishError {
  const lines = cleanSecrets(out)
    .replace(ANSI, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const at = lines.findIndex((l) => /^✘|\[ERROR\]/.test(l));
  const head = at >= 0 ? (lines[at] ?? '').replace(/^✘\s*/, '').replace(/^\[ERROR\]\s*/, '') : undefined;
  // The line after the error usually carries the cause ("Authentication failed (status: 400) …").
  const next = at >= 0 ? lines[at + 1] : undefined;
  const reason = head
    ? `${head}${next && /^[A-Za-z]/.test(next) ? ` ${next}` : ''}`
    : (lines.at(-1) ?? `wrangler exited with ${code}`);
  // Cloudflare's own trouble is not a setup problem: say so (it is retried); the token hint is for the rest.
  const outage = CLOUDFLARE_OUTAGE.test(reason);
  const hint = outage
    ? "This looks like a problem on Cloudflare's side, not your setup; it is tried again.\n"
    : `Check ${p.apiTokenEnv} and ${p.accountIdEnv} in .env, that the token may edit Workers scripts, and that ` +
      `your workers.dev subdomain exists (docs/setup/host.md).\n`;
  return new PublishError(
    `Cloudflare deploy failed: ${reason}\n${hint}wrangler said:\n${lines.slice(-12).join('\n')}`,
    outage,
  );
}

export interface DeployResult {
  ms: number;
  detail: string;
  url?: string;
  /** The Worker version the deploy made (Cloudflare). */
  versionId?: string;
}

/** Where the last deployed Worker versions are kept (shown on the dashboard). */
export const DATA_VERSION = 'cloudflare:data-version';
export const API_VERSION = 'cloudflare:api-version';

/** The data Worker's code fingerprint: a new version is deployed when its router or config changes. */
const WORKER_DEPLOYED = 'publish:worker-fingerprint';
/** What the data Worker is built from: only the router and its contract (the rest is the API Worker). */
const ROUTER_SOURCES = ['apps/catalog/src/router.ts', 'packages/core/src/router-contract.ts'];

/** A fingerprint of the data Worker's code and config, to deploy a new version even when no data changed. */
export function workerFingerprint(
  p: Extract<PublisherConfig, { type: 'cloudflare' }>,
  originKnown = false,
): string {
  const h = createHash('sha256');
  h.update(JSON.stringify(workerConfig(p, join(REPO_ROOT, 'apps/catalog'), originKnown)));
  for (const f of ROUTER_SOURCES) {
    const abs = join(REPO_ROOT, f);
    if (existsSync(abs)) h.update(f).update(readFileSync(abs));
  }
  return h.digest('hex');
}

function readJsonc(path: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n'),
  ) as Record<string, unknown>;
}

/** Paths the data Worker's router runs for; everything else is served as static assets, without any code. */
/** Paths the router script runs for (the rest are plain files). Live meta pages carry "now / next" (epg). */
export const ROUTER_PATHS = ['/catalog/*', '/stream/*', '/status*', '/meta/tv/*'];

/**
 * The public data Worker's wrangler config: the catalog as static assets, the router for the dynamic paths, and
 * the service binding to the private API Worker. Cloudflare's own invocation logs stay off (they would keep
 * request metadata); the API Worker logs its own events without addresses.
 */
export function workerConfig(
  p: Extract<PublisherConfig, { type: 'cloudflare' }>,
  catalogDir: string,
  /** The publish wrote absolute image URLs (it knew the addon's address), so only dynamic paths need code. */
  originKnown = false,
): unknown {
  const base = readJsonc(join(catalogDir, 'wrangler.jsonc')) as {
    assets: Record<string, unknown>;
    main: string;
  };
  return {
    ...base,
    name: p.workerName,
    main: join(catalogDir, base.main),
    assets: {
      ...base.assets,
      directory: p.dir,
      // Only before the addon's address is known do the files carrying image URLs also go through the API, which
      // fills the address in.
      run_worker_first: originKnown ? ROUTER_PATHS : [...ROUTER_PATHS, '/manifest.json', '/meta/*'],
    },
    services: [{ binding: 'API', service: apiWorkerName(p) }],
    observability: { enabled: true, head_sampling_rate: 1, logs: { enabled: true, invocation_logs: false } },
  };
}

/**
 * The private API Worker's wrangler config: no public URL, the per-client limits, Analytics Engine (when the
 * account has it on) and its own logs.
 */
export function apiWorkerConfig(
  p: Extract<PublisherConfig, { type: 'cloudflare' }>,
  catalogDir: string,
  analytics = true,
): unknown {
  const base = readJsonc(join(catalogDir, 'wrangler.api.jsonc')) as { main: string };
  return {
    ...base,
    name: apiWorkerName(p),
    main: join(catalogDir, base.main),
    workers_dev: false,
    preview_urls: false,
    observability: { enabled: true, head_sampling_rate: 1, logs: { enabled: true, invocation_logs: false } },
    // One data point per stream request, counted by Cloudflare (read back once a day; see public-usage.ts).
    // Analytics Engine must be enabled once on the account; until it is, the Worker deploys without it.
    ...(analytics ? { analytics_engine_datasets: [{ binding: 'USAGE', dataset: 'israel_tv_usage' }] } : {}),
    // Per-client limits on search and streams (see apps/catalog/src/limit.ts for the numbers and the fallback).
    ratelimits: [
      { name: 'RATE_STREAM', namespace_id: '1001', simple: { limit: 120, period: 60 } },
      { name: 'RATE_SEARCH', namespace_id: '1002', simple: { limit: 60, period: 60 } },
    ],
  };
}

interface Wrangler {
  bin: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  home: string;
  p: Extract<PublisherConfig, { type: 'cloudflare' }>;
}

/**
 * wrangler with the configured token and account only. Without them wrangler would fall back to any login stored
 * on this machine and act on that (possibly unrelated) account: refuse instead, and give it a home of its own so
 * it never sees a stored login.
 */
function wranglerFor(p: Extract<PublisherConfig, { type: 'cloudflare' }>, env: NodeJS.ProcessEnv): Wrangler {
  const token = env[p.apiTokenEnv];
  const account = env[p.accountIdEnv];
  if (!token || !account) {
    throw new PublishError(
      `Cloudflare deploy refused: ${p.apiTokenEnv} and ${p.accountIdEnv} must be set (see .env.example)`,
    );
  }
  const cwd = join(REPO_ROOT, 'apps/catalog');
  const home = join(dirname(p.dir), '.wrangler-home');
  mkdirSync(home, { recursive: true });
  return {
    bin: join(cwd, 'node_modules/.bin/wrangler'),
    cwd,
    home,
    p,
    env: {
      PATH: env.PATH,
      HOME: home,
      XDG_CONFIG_HOME: join(home, 'config'),
      CLOUDFLARE_ACCOUNT_ID: account,
      CLOUDFLARE_API_TOKEN: token,
      WRANGLER_SEND_METRICS: 'false',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
  };
}

/** Deploy the public data Worker: the router and the site folder as its static assets. */
async function deployCloudflare(
  p: Extract<PublisherConfig, { type: 'cloudflare' }>,
  env: NodeJS.ProcessEnv,
  originKnown = false,
): Promise<DeployResult> {
  const t0 = Date.now();
  const w = wranglerFor(p, env);
  const configPath = join(w.home, 'wrangler.json');
  writeFileSync(configPath, JSON.stringify(workerConfig(p, w.cwd, originKnown), null, 2));
  try {
    return await runWrangler(
      w,
      ['deploy', '--config', configPath, '--name', p.workerName, '--assets', p.dir],
      t0,
    );
  } catch (err) {
    // The service binding needs the API Worker to exist: a first publish before `deploy-api` says what to do.
    if (/service|binding|not found|does not exist|10143/i.test((err as Error).message))
      throw new PublishError(
        `${(err as Error).message}\nIs the API Worker (${apiWorkerName(p)}) deployed? Run \`pnpm israel-tv deploy-api\` once (and after each update).`,
      );
    throw err;
  }
}

/**
 * Deploy the private API Worker (code releases: `israel-tv deploy-api`, or `deploy`; never a catalog publish). The
 * client-hash salt goes up as its secret through a file only this user can read, removed after. Analytics Engine
 * is tried every time; while the account has not enabled it, the Worker deploys without it and /status says so.
 */
export async function deployApi(
  config: Config,
  store: Store,
  salt: string | undefined,
  log: (line: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DeployResult> {
  const p = config.publisher;
  if (p.type !== 'cloudflare') throw new PublishError('deploy-api is for the Cloudflare publisher');
  const t0 = Date.now();
  const w = wranglerFor(p, env);
  const secretsPath = join(w.home, 'api-secrets.json');
  const run = async (analytics: boolean) => {
    const configPath = join(w.home, 'wrangler.api.json');
    writeFileSync(configPath, JSON.stringify(apiWorkerConfig(p, w.cwd, analytics), null, 2));
    const args = ['deploy', '--config', configPath, '--name', apiWorkerName(p)];
    if (salt) {
      writeFileSync(secretsPath, JSON.stringify({ CLIENT_SALT: salt }), { mode: 0o600 });
      args.push('--secrets-file', secretsPath);
    }
    return runWrangler(w, args, t0);
  };
  try {
    try {
      const d = await run(true);
      store.setState(ANALYTICS_OFF, null);
      if (d.versionId) store.setState(API_VERSION, d.versionId);
      return d;
    } catch (err) {
      if (!/enable Analytics Engine/i.test((err as Error).message)) throw err;
      store.setState(ANALYTICS_OFF, { at: new Date().toISOString() });
      log('deploy-api: Analytics Engine is not enabled on the Cloudflare account; deploying without it');
      const d = await run(false);
      if (d.versionId) store.setState(API_VERSION, d.versionId);
      return d;
    }
  } finally {
    rmSync(secretsPath, { force: true });
  }
}

export type WorkerRole = 'data' | 'api';

/** The Worker's recent versions (newest first), as wrangler lists them. */
export async function workerVersions(config: Config, role: WorkerRole, env = process.env): Promise<string> {
  const p = config.publisher;
  if (p.type !== 'cloudflare') throw new PublishError('versions are for the Cloudflare publisher');
  const w = wranglerFor(p, env);
  const name = role === 'data' ? p.workerName : apiWorkerName(p);
  return (await runWrangler(w, ['versions', 'list', '--name', name], Date.now())).output;
}

/**
 * Roll one Worker back on its own: `data` (the catalog and router as published then) or `api` (the code). Without
 * a version id, to the one before the current.
 */
export async function rollbackWorker(
  config: Config,
  role: WorkerRole,
  versionId: string | undefined,
  env = process.env,
): Promise<string> {
  const p = config.publisher;
  if (p.type !== 'cloudflare') throw new PublishError('rollback is for the Cloudflare publisher');
  const w = wranglerFor(p, env);
  const name = role === 'data' ? p.workerName : apiWorkerName(p);
  const args = [
    'rollback',
    ...(versionId ? [versionId] : []),
    '--name',
    name,
    '--message',
    `israel-tv rollback ${role}`,
    '--yes',
  ];
  return (await runWrangler(w, args, Date.now())).output;
}

async function runWrangler(
  w: Wrangler,
  args: string[],
  t0: number,
): Promise<DeployResult & { output: string }> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(w.bin, args, { cwd: w.cwd, env: w.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(publishError(out, code, w.p))));
  });
  const url = /https:\/\/[^\s]+\.workers\.dev/.exec(output)?.[0];
  const uploaded = /Uploaded (\d+) files?/.exec(output)?.[0] ?? 'no asset changes';
  const versionId = /Version ID:\s*([0-9a-f-]{36})/i.exec(output)?.[1];
  return {
    ms: Date.now() - t0,
    detail: uploaded,
    output: cleanSecrets(output),
    ...(url ? { url } : {}),
    ...(versionId ? { versionId } : {}),
  };
}

export async function deploy(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
  originKnown = false,
): Promise<DeployResult> {
  const p = config.publisher;
  if (p.type === 'local') return { ms: 0, detail: `served from ${p.dir} by the local server` };
  return deployCloudflare(p, env, originKnown);
}

/**
 * Deploy, trying again after Cloudflare's own outages (growing pauses with jitter). Each try resumes where the
 * last stopped: wrangler uploads static assets by content hash and Cloudflare answers which ones it still lacks,
 * so files a failed try already uploaded are not sent again. Setup problems (token, account) fail at once.
 */
export async function deployWithRetries(
  run: () => Promise<DeployResult>,
  log: (line: string) => void,
  retry: PublishRetry = PUBLISH_RETRY,
): Promise<DeployResult> {
  const sleep = retry.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof PublishError && err.outage) || attempt >= retry.attempts) {
        if (attempt > 1 && err instanceof Error)
          err.message = err.message.replace(/\n/, ` (${attempt} tries)\n`);
        throw err;
      }
      const wait = retryDelay(attempt, retry);
      log(
        `publish: Cloudflare outage (${(err as Error).message.split('\n')[0]}); try ${attempt + 1} of ${retry.attempts} in ${Math.round(wait / 1000)} s`,
      );
      await sleep(wait);
    }
  }
}

const PUBLISHED_URL = 'publish:url';

/**
 * The public addon's own address, when known: `publisher.publicUrl`, else the address the last successful
 * Cloudflare deploy reported. Image URLs are then written absolute at publish time, so metadata stays plain
 * static files. (The local server fills in its address per request instead.)
 */
export function publicBase(config: Config, store: Store): string | undefined {
  if (config.publisher.type !== 'cloudflare') return undefined;
  const url = config.publisher.publicUrl ?? store.getState<string>(PUBLISHED_URL) ?? undefined;
  return url?.replace(/\/+$/, '');
}

/** Set while Cloudflare refuses the Analytics Engine binding (not enabled on the account); cleared by a deploy-api with it. */
export const ANALYTICS_OFF = 'cloudflare:analytics-off';

/** Whether the last API deploy went without Analytics Engine (the account has not enabled it). */
export function analyticsOff(store: Store): boolean {
  return !!store.getState<{ at: string }>(ANALYTICS_OFF);
}

/**
 * Render, write the changed files and deploy them. A deploy that failed last time is retried even when
 * nothing changed since. Every attempt is recorded, so a failing publish shows on /status.
 */
export async function publishSite(
  store: Store,
  config: Config,
  log: (line: string) => void,
  retries: PublishRetry = PUBLISH_RETRY,
  /** Stand-ins for tests: the deploy and the fetch IndexNow submits with. */
  hooks: { deploy?: () => Promise<DeployResult>; fetch?: typeof fetch } = {},
): Promise<boolean> {
  const t0 = Date.now();
  const kind = config.publisher.type;
  let w: ReturnType<typeof writeSite>;
  let files: SiteFiles;
  // Published episode numbers never move: refuse to publish when one would (see numbering-guard.ts).
  const guard = checkNumbering(store);
  if (!guard.ok) {
    const runId = store.startRun('publish', kind);
    const error = `numbering guard: ${guard.moved} published episode numbers would move (${guard.examples.join('; ')}); nothing published — restore the database from the last backup, or record a migration`;
    store.finishRun(runId, { status: 'failed', error });
    log(`publish refused: ${error}`);
    return false;
  }
  // Posters not measured yet are fetched once each, so the render knows their shape.
  await measurePosters(
    store,
    posterDir(config),
    store
      .listShows()
      .map((r) => r.show.poster)
      .filter((u): u is string => !!u),
    { warn: log },
  );
  try {
    files = renderFromStore(store, config);
    w = writeSite(config.publisher.dir, files);
  } catch (err) {
    // Render/write problems (disk full, permissions) are publish failures too, visible on /status.
    const runId = store.startRun('publish', kind);
    store.finishRun(runId, {
      status: 'failed',
      error: `writing ${config.publisher.dir} failed: ${(err as Error).message}`,
    });
    log(`publish failed: writing ${config.publisher.dir}: ${(err as Error).message}`);
    return false;
  }
  // A deploy that failed, or that a restart cut short, is retried.
  const lastStatus = store.lastRun('publish', kind)?.status;
  const retry = lastStatus === 'failed' || lastStatus === 'stopped';
  // A new version of the data Worker (its router or config) is deployed even when no data changed.
  const originKnown = publicBase(config, store) !== undefined;
  const worker =
    config.publisher.type === 'cloudflare' ? workerFingerprint(config.publisher, originKnown) : undefined;
  const workerChanged = worker !== undefined && store.getState<string>(WORKER_DEPLOYED) !== worker;
  if (w.changed.length === 0 && w.deleted === 0 && !retry && !workerChanged) {
    log('publish: nothing changed');
    return true;
  }
  const runId = store.startRun('publish', kind);
  try {
    const d = await deployWithRetries(
      hooks.deploy ?? (() => deploy(config, process.env, originKnown)),
      log,
      retries,
    );
    store.finishRun(runId, { status: 'ok' });
    if (d.versionId) store.setState(DATA_VERSION, d.versionId);
    if (worker) store.setState(WORKER_DEPLOYED, worker);
    // The first deploy tells us the public address: the next publish writes it into the files.
    if (d.url && config.publisher.type === 'cloudflare' && !config.publisher.publicUrl)
      store.setState(PUBLISHED_URL, d.url);
    log(
      `publish: ${w.written} of ${w.total} files changed, ${w.deleted} removed; ${d.detail}${d.url ? ` → ${d.url}/manifest.json` : ''} (${Math.round((Date.now() - t0) / 1000)} s)`,
    );
    // Search engines hear about the new, changed and removed pages; a failure here never fails the publish.
    const base = publicBase(config, store);
    if (base && indexNowEnabled(config))
      await submitIndexNow(store, config, {
        base,
        changed: w.changed,
        removed: w.removed,
        all: files.keys(),
        log,
        ...(hooks.fetch ? { fetch: hooks.fetch } : {}),
      });
    return true;
  } catch (err) {
    store.finishRun(runId, { status: 'failed', error: (err as Error).message });
    log(`publish failed: ${(err as Error).message}`);
    return false;
  }
}

/** Sources that actually run: Kan needs a browser as well as `sources.kan`. */
export function activeSources(config: Config): Source[] {
  return enabledSources(config).filter((s) => s !== 'kan' || config.browser.type !== 'none');
}
