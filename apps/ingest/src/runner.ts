// Ingest runs: full (whole index), airing (shows with a recent episode, current season only) and single show.
// Rules: a failed or thin result never replaces the last good data; it is recorded and shown on /status.
import { assignNumbers, daysAgo, type ScrapedShow } from '@israel-tv/core';
import type { Store } from '@israel-tv/store';
import type { ShowEntry, SourceAdapter } from './sources.ts';

export interface RunOptions {
  /** Stop after this many shows (testing / measuring). */
  limit?: number;
  /** A full run that lists fewer than this share of the previously listed shows is rejected. */
  minShareOfPrevious: number;
  log?: (line: string) => void;
}

export interface RunSummary {
  runId: number;
  status: 'ok' | 'partial' | 'failed';
  showsOk: number;
  showsFailed: number;
  newEpisodes: number;
  requests: number;
  ms: number;
  error?: string;
}

/** A failure that means the site is refusing us (bot wall, rate limit), not a problem with one show. */
export function isBlock(err: unknown): boolean {
  const e = err as { name?: string; status?: number; message?: string };
  return (
    e.name === 'BlockedError' ||
    e.status === 403 ||
    e.status === 429 ||
    /blocked by|HTTP 403|HTTP 429|no __NEXT_DATA__/.test(e.message ?? '')
  );
}

/** ok when nothing failed, failed when nothing succeeded, partial otherwise. */
export function runStatus(ok: number, failed: number): 'ok' | 'partial' | 'failed' {
  return failed === 0 ? 'ok' : ok === 0 ? 'failed' : 'partial';
}

export function latestAirDate(show: ScrapedShow): string | undefined {
  let max: string | undefined;
  for (const s of show.seasons)
    for (const e of s.episodes) if (e.airDate && (!max || e.airDate > max)) max = e.airDate;
  return max;
}

/** Sources sometimes list the same episode twice (same key); keep its first appearance only. */
export function dedupeEpisodes(show: ScrapedShow): ScrapedShow {
  const seen = new Set<string>();
  return {
    ...show,
    seasons: show.seasons.map((s) => ({
      ...s,
      episodes: s.episodes.filter((e) => {
        if (seen.has(e.key)) return false;
        seen.add(e.key);
        return true;
      }),
    })),
  };
}

export const episodeCount = (s: ScrapedShow) => s.seasons.reduce((n, x) => n + x.episodes.length, 0);

/**
 * A partial (current-season-only) scrape keeps the previous episodes of seasons it did not fetch, and of
 * seasons that the source no longer lists (so nothing published disappears because of a partial read).
 */
export function mergePartial(
  prev: ScrapedShow | undefined,
  next: ScrapedShow,
  fetched: Set<string>,
): ScrapedShow {
  if (!prev) return next;
  const prevByKey = new Map(prev.seasons.map((s) => [s.key, s]));
  const seasons = next.seasons.map((s) => (fetched.has(s.key) ? s : (prevByKey.get(s.key) ?? s)));
  for (const s of prev.seasons) if (!seasons.some((x) => x.key === s.key)) seasons.push(s);
  return { ...next, seasons };
}

/** Why a scrape should not replace the last good data, or undefined when it is fine. */
export function thinReason(prev: ScrapedShow | undefined, next: ScrapedShow): string | undefined {
  const n = episodeCount(next);
  if (n === 0) return 'no episodes found';
  if (prev) {
    const p = episodeCount(prev);
    if (p >= 10 && n < p * 0.5) return `episodes dropped from ${p} to ${n}`;
  }
  return undefined;
}

export type IngestResult =
  | { kind: 'saved'; seriesId: string; newEpisodes: number }
  /** The source lists the show but it has no episodes yet; nothing is published or allocated. */
  | { kind: 'empty' };

export async function ingestShow(
  store: Store,
  adapter: SourceAdapter,
  entry: ShowEntry,
  currentSeasonOnly: boolean,
  runId: number,
): Promise<IngestResult> {
  const knownId = store.findSeriesId(adapter.source, entry.key);
  const prev = knownId ? store.getShow(knownId) : undefined;
  let scraped: ScrapedShow;
  try {
    scraped = await adapter.fetchShow(entry, { currentSeasonOnly: currentSeasonOnly && prev !== undefined });
  } catch (err) {
    if (knownId && prev) {
      store.markShowFailed(knownId, (err as Error).message);
      throw err;
    }
    // Listed by the source but its page is gone, and we never had it: nothing to publish or keep.
    if ((err as { status?: number }).status === 404) {
      store.addWarnings(runId, null, [
        { code: 'source-note', message: `${entry.title}: listed, but its page is gone (404)` },
      ]);
      return { kind: 'empty' };
    }
    throw err;
  }
  // A season that comes back empty (not fetched in an airing check, or a dead page) keeps its last good
  // episodes: a published episode never disappears because of one bad read.
  const fetched = new Set(scraped.seasons.filter((s) => s.episodes.length > 0).map((s) => s.key));
  const show = dedupeEpisodes(mergePartial(prev?.show, scraped, fetched));
  if (!prev && episodeCount(show) === 0) {
    if (scraped.notes?.length) {
      store.addWarnings(
        runId,
        null,
        scraped.notes.map((message) => ({ code: 'source-note', message: `${entry.title}: ${message}` })),
      );
    }
    return { kind: 'empty' };
  }
  const thin = thinReason(prev?.show, show);
  if (thin) {
    if (knownId && prev) store.markShowFailed(knownId, `kept last good data: ${thin}`);
    store.addWarnings(runId, knownId ?? null, [{ code: 'thin-result', message: `${entry.title}: ${thin}` }]);
    throw new Error(thin);
  }
  const seriesId = knownId ?? store.seriesIdFor(adapter.source, entry.key);
  if (scraped.notes?.length) {
    store.addWarnings(
      runId,
      seriesId,
      scraped.notes.map((message) => ({ code: 'source-note', message: `${entry.title}: ${message}` })),
    );
  }
  const numbering = assignNumbers(show, store.assignments(seriesId));
  if (numbering.warnings.length) store.addWarnings(runId, seriesId, numbering.warnings);
  // A show's first save is not "new episodes": only later additions move it up the newest-first order.
  const newEpisodes = store.saveShow(
    seriesId,
    show,
    numbering.added,
    latestAirDate(show),
    prev !== undefined,
  );
  return { kind: 'saved', seriesId, newEpisodes };
}

async function runShows(
  store: Store,
  adapter: SourceAdapter,
  kind: 'full' | 'airing' | 'show',
  entries: ShowEntry[],
  opts: RunOptions,
  currentSeasonOnly: boolean,
  runId: number,
  t0: number,
): Promise<RunSummary> {
  const log = opts.log ?? (() => {});
  let showsOk = 0;
  let showsFailed = 0;
  let newEpisodes = 0;
  let empty = 0;
  let consecutiveBlocks = 0;
  const errors: string[] = [];
  const list = opts.limit ? entries.slice(0, opts.limit) : entries;
  for (const [i, entry] of list.entries()) {
    try {
      const r = await ingestShow(store, adapter, entry, currentSeasonOnly, runId);
      showsOk++;
      consecutiveBlocks = 0;
      if (r.kind === 'empty') {
        empty++;
        continue;
      }
      newEpisodes += r.newEpisodes;
      if (r.newEpisodes > 0) log(`[${i + 1}/${list.length}] ${entry.title}: +${r.newEpisodes} episodes`);
    } catch (err) {
      showsFailed++;
      const msg = `${entry.title}: ${(err as Error).message}`;
      errors.push(msg);
      log(`[${i + 1}/${list.length}] FAILED ${msg}`);
      // A blocking site keeps blocking: after three blocks in a row, stop instead of hammering it.
      consecutiveBlocks = isBlock(err) ? consecutiveBlocks + 1 : 0;
      if (consecutiveBlocks >= 3) {
        errors.push(
          `stopped after ${consecutiveBlocks} blocked requests in a row; the rest waits for the next run`,
        );
        log(`stopping ${adapter.source}: blocked ${consecutiveBlocks} times in a row`);
        break;
      }
    }
  }
  const status = runStatus(showsOk, showsFailed);
  const summary: RunSummary = {
    runId,
    status,
    showsOk,
    showsFailed,
    newEpisodes,
    requests: adapter.requests,
    ms: Date.now() - t0,
    ...(errors.length
      ? { error: errors.slice(0, 5).join(' | ') + (errors.length > 5 ? ` | +${errors.length - 5} more` : '') }
      : {}),
  };
  store.finishRun(runId, {
    status,
    requests: summary.requests,
    showsOk,
    showsFailed,
    newEpisodes,
    ...(summary.error ? { error: summary.error } : {}),
  });
  log(
    `${kind} ${adapter.source}: ${status}, ${showsOk} ok (${empty} without episodes), ${showsFailed} failed, +${newEpisodes} episodes, ${summary.requests} requests, ${Math.round(summary.ms / 1000)} s`,
  );
  return summary;
}

/** Whole source: index, then every show with all seasons. */
export async function runFull(store: Store, adapter: SourceAdapter, opts: RunOptions): Promise<RunSummary> {
  const t0 = Date.now();
  // A run limited to a few shows (testing) is recorded apart, so it never counts as the source's full run.
  const runId = store.startRun('full', opts.limit ? `${adapter.source}:limited` : adapter.source);
  const fail = (error: string): RunSummary => {
    store.finishRun(runId, { status: 'failed', requests: adapter.requests, error });
    return {
      runId,
      status: 'failed',
      showsOk: 0,
      showsFailed: 0,
      newEpisodes: 0,
      requests: adapter.requests,
      ms: Date.now() - t0,
      error,
    };
  };
  let entries: ShowEntry[];
  try {
    entries = await adapter.listShows();
  } catch (err) {
    return fail(`index failed: ${(err as Error).message}`);
  }
  const previouslyListed = store.countShows(adapter.source, 'listed');
  if (!opts.limit && previouslyListed > 0 && entries.length < previouslyListed * opts.minShareOfPrevious) {
    return fail(`index lists ${entries.length} shows, previously ${previouslyListed}; kept last good data`);
  }
  const summary = await runShows(store, adapter, 'full', entries, opts, false, runId, t0);
  if (!opts.limit && summary.status !== 'failed') {
    const ids = entries.map((e) => store.findSeriesId(adapter.source, e.key)).filter((x): x is string => !!x);
    store.syncListed(adapter.source, ids);
  }
  return summary;
}

/** Shows with an episode in the last `windowDays` days: current season only (about one request each). */
export async function runAiring(
  store: Store,
  adapter: SourceAdapter,
  windowDays: number,
  opts: RunOptions,
): Promise<RunSummary> {
  const t0 = Date.now();
  const since = daysAgo(windowDays);
  const rows = store.airingShows(adapter.source, since);
  const runId = store.startRun('airing', adapter.source);
  const entries = rows.map((r) => ({
    key: r.show.key,
    title: r.title,
    ...(r.show.poster ? { poster: r.show.poster } : {}),
  }));
  return runShows(store, adapter, 'airing', entries, opts, true, runId, t0);
}

/** One show, all seasons. */
export async function runOne(
  store: Store,
  adapter: SourceAdapter,
  entry: ShowEntry,
  opts: RunOptions,
): Promise<RunSummary> {
  const t0 = Date.now();
  const runId = store.startRun('show', `${adapter.source}:${entry.key}`);
  return runShows(store, adapter, 'show', [entry], opts, false, runId, t0);
}
