// Ingest runs: full (whole index), airing (shows with a recent episode, current season only) and single show.
// Rules: a failed or thin result never replaces the last good data; it is recorded and shown on /status.
import { assignNumbers, cleanShow, daysAgo, type ScrapedShow } from '@israel-tv/core';
import type { Store } from '@israel-tv/store';
import type { ShowEntry, SourceAdapter } from './sources.ts';

export interface RunOptions {
  /** Stop after this many shows (testing / measuring). */
  limit?: number;
  /** A full run that lists fewer than this share of the previously listed shows is rejected. */
  minShareOfPrevious: number;
  log?: (line: string) => void;
  /** The clock (tests). */
  now?: number;
}

export interface RunSummary {
  runId: number;
  /**
   * Shows the site refused us (bot wall, rate limit) or that a stop after repeated blocks never reached. They are
   * deferred to a later retry with their last good data kept; on their own they never make a run partial or failed.
   */
  blocked?: BlockedShow[];
  /** Shows that failed for any other reason. */
  otherFailures?: number;
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
    scraped = await adapter.fetchShow(entry, {
      currentSeasonOnly: currentSeasonOnly && prev !== undefined,
      ...(prev ? { stored: prev.show } : {}),
    });
  } catch (err) {
    if (knownId && prev) {
      // A bot-check refusal only delays the show (it is retried later, see deferBlocked); anything else marks it.
      if (!isBlock(err)) store.markShowFailed(knownId, (err as Error).message);
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
  // A show we have that suddenly reads as having no seasons at all is a failed read (layout change, block
  // page), not a show without VOD: keep its data and say so.
  if (prev && scraped.seasons.length === 0) {
    const why = `no seasons on the show page${scraped.notes?.length ? ` (${scraped.notes.join('; ')})` : ''}`;
    store.markShowFailed(knownId as string, `kept last good data: ${why}`);
    throw new Error(why);
  }
  const fetched = new Set(scraped.seasons.filter((s) => s.episodes.length > 0).map((s) => s.key));
  // Same for a full read in which every listed season came back empty (e.g. the episode markup changed):
  // in an airing check that can be a new season with nothing yet, in a full read it cannot.
  if (prev && !currentSeasonOnly && fetched.size === 0 && episodeCount(prev.show) > 0) {
    const why = 'every season read empty (layout change?)';
    store.markShowFailed(knownId as string, `kept last good data: ${why}`);
    throw new Error(why);
  }
  const raw = dedupeEpisodes(mergePartial(prev?.show, scraped, fetched));
  const show = cleanShow(raw);
  // A new show with only a trailer so far (cleanShow leaves trailers out): nothing to watch yet, not a failed read.
  // A show we have whose re-read finds only a trailer is a failed read (thinReason below), kept and flagged; so is
  // one stored before trailers were left out, until a real episode comes.
  if (
    episodeCount(show) === 0 &&
    episodeCount(raw) > 0 &&
    (!prev || episodeCount(cleanShow(prev.show)) === 0)
  ) {
    store.addWarnings(runId, knownId ?? null, [
      {
        code: 'source-note',
        message: `${entry.title}: only a trailer so far (not in the catalog until an episode)`,
      },
    ]);
    return { kind: 'empty' };
  }
  if (!prev && episodeCount(show) === 0) {
    // Listed by the source but with nothing to watch: not in the catalog, and always said so.
    const notes = scraped.notes?.length ? scraped.notes : ['listed, but its page has no episodes'];
    store.addWarnings(
      runId,
      null,
      notes.map((message) => ({ code: 'source-note', message: `${entry.title}: ${message}` })),
    );
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
  let newEpisodes = 0;
  const empty: string[] = [];
  let stoppedEarly = false;
  let consecutiveBlocks = 0;
  const errors: string[] = [];
  const blocked: BlockedShow[] = [];
  let otherFailures = 0;
  const list = opts.limit ? entries.slice(0, opts.limit) : entries;
  for (const [i, entry] of list.entries()) {
    try {
      const r = await ingestShow(store, adapter, entry, currentSeasonOnly, runId);
      showsOk++;
      consecutiveBlocks = 0;
      if (r.kind === 'empty') {
        empty.push(entry.title);
        continue;
      }
      newEpisodes += r.newEpisodes;
      if (r.newEpisodes > 0) log(`[${i + 1}/${list.length}] ${entry.title}: +${r.newEpisodes} episodes`);
    } catch (err) {
      const msg = `${entry.title}: ${(err as Error).message}`;
      // A blocking site keeps blocking: after three blocks in a row, stop instead of hammering it.
      consecutiveBlocks = isBlock(err) ? consecutiveBlocks + 1 : 0;
      if (isBlock(err)) {
        blocked.push({ ...entry, error: (err as Error).message.slice(0, 200) });
        log(`[${i + 1}/${list.length}] DELAYED ${msg}`);
      } else {
        otherFailures++;
        errors.push(msg);
        log(`[${i + 1}/${list.length}] FAILED ${msg}`);
      }
      if (consecutiveBlocks >= 3) {
        errors.push(
          `stopped after ${consecutiveBlocks} blocked requests in a row; the rest waits for a retry`,
        );
        log(`stopping ${adapter.source}: blocked ${consecutiveBlocks} times in a row`);
        stoppedEarly = true;
        for (const rest of list.slice(i + 1))
          blocked.push({ ...rest, error: 'not reached (stopped after blocks)' });
        break;
      }
    }
  }
  // Blocked shows wait for a retry (deferBlocked), so they do not count against the run. Only a wall (stopped after
  // blocks in a row) does: partial when something was read, failed when nothing was.
  const showsFailed = otherFailures + (stoppedEarly ? blocked.length : 0);
  const status = runStatus(showsOk, showsFailed);
  // A complete full read knows every listed show without episodes; /status lists them (see buildStatus).
  if (kind === 'full' && !opts.limit && !stoppedEarly) store.setState(emptyShowsKey(adapter.source), empty);
  recordBlocks(store, adapter, blocked.length);
  const summary: RunSummary = {
    runId,
    ...(blocked.length ? { blocked } : {}),
    ...(otherFailures ? { otherFailures } : {}),
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
    `${kind} ${adapter.source}: ${status}, ${showsOk} ok (${empty.length} without episodes), ${showsFailed} failed, ${blocked.length} delayed by the bot check, +${newEpisodes} episodes, ${summary.requests} requests, ${Math.round(summary.ms / 1000)} s`,
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
  if (!opts.limit) {
    // A new full run starts the source's retry list afresh.
    store.setState(retryKey(adapter.source), null);
    deferBlocked(store, adapter.source, runId, summary, opts);
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
  const summary = await runShows(store, adapter, 'airing', entries, opts, true, runId, t0);
  deferBlocked(store, adapter.source, runId, summary, opts);
  return summary;
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
  const summary = await runShows(store, adapter, 'show', [entry], opts, false, runId, t0);
  deferBlocked(store, adapter.source, runId, summary, opts);
  return summary;
}

/** A show a full run could not read because the site refused us. */
export interface BlockedShow extends ShowEntry {
  error: string;
}

/**
 * Shows a source's bot check refused (after the fetcher's own quick retries), retried later with growing pauses and
 * their last good data kept. Started by each full run; airing and single-show runs add to it.
 */
export interface BlockedRetry {
  /** The source's latest full run (the one /status reports), or the run that started the list when there is none. */
  runId: number;
  pending: BlockedShow[];
  recovered: string[];
  /** Retries done so far. */
  attempts: number;
  /** Shows of that run that failed for other reasons (those are not retried). */
  others: number;
  /** When the next retry is due; absent once retries are over. */
  nextAt?: string;
}

/** Retries per full run, and the pause before each (30 min, 1 h, 2 h). */
export const BLOCK_RETRIES = 3;
export function retryDelayMs(attempt: number): number {
  return 30 * 60_000 * 2 ** attempt;
}

export function retryKey(source: string): string {
  return `blocked-retry:${source}`;
}

/** Retry the shows a full run was blocked on (once; the daemon calls it again at `nextAt`). */
export async function runBlockedRetry(
  store: Store,
  adapter: SourceAdapter,
  opts: RunOptions,
): Promise<BlockedRetry | undefined> {
  const state = store.getState<BlockedRetry | null>(retryKey(adapter.source));
  // Not due yet (a timer that fired early, or a job queued twice): nothing to do.
  if (!state?.pending.length || !state.nextAt || Date.parse(state.nextAt) > (opts.now ?? Date.now()))
    return state ?? undefined;
  const t0 = Date.now();
  const runId = store.startRun('show', `${adapter.source}:retry`);
  const summary = await runShows(store, adapter, 'show', state.pending, opts, false, runId, t0);
  // A show that now fails for another reason is no longer a block: it shows on /status as a failing show.
  const pending = summary.blocked ?? [];
  const still = new Set(pending.map((b) => b.key));
  const recovered = state.pending.filter((p) => !still.has(p.key)).map((p) => p.title);
  const attempts = state.attempts + 1;
  const { nextAt: _due, ...rest } = state;
  const next: BlockedRetry = {
    ...rest,
    pending,
    recovered: [...state.recovered, ...recovered],
    attempts,
    others: state.others + (summary.otherFailures ?? 0),
    ...(pending.length && attempts < BLOCK_RETRIES
      ? { nextAt: new Date((opts.now ?? Date.now()) + retryDelayMs(attempts)).toISOString() }
      : {}),
  };
  store.setState(retryKey(adapter.source), next);
  // Out of retries: the show keeps its last good data and is listed as failing until a later run reads it.
  if (!next.nextAt)
    for (const p of pending) {
      const id = store.findSeriesId(adapter.source, p.key);
      if (id)
        store.markShowFailed(
          id,
          `kept last good data: refused by the site's bot check on ${attempts} retries (${p.error})`,
        );
    }
  return next;
}

const SOURCE_NAMES: Record<string, string> = { mako: 'Mako', reshet: 'Reshet', kan: 'Kan' };
const sourceName = (source: string) => SOURCE_NAMES[source] ?? source;

/**
 * Put the shows a run's bot check refused on the source's retry list (runBlockedRetry reads them later), and record a
 * labelled note. The run itself stays ok: a block delays a show, it never drops it.
 */
export function deferBlocked(
  store: Store,
  source: string,
  runId: number,
  summary: RunSummary,
  opts: Pick<RunOptions, 'now'>,
): BlockedRetry | undefined {
  const blocked = summary.blocked ?? [];
  if (blocked.length === 0) return undefined;
  const now = opts.now ?? Date.now();
  const fullId = store.lastRun('full', source)?.id ?? runId;
  const prev = store.getState<BlockedRetry | null>(retryKey(source));
  const base: BlockedRetry =
    prev && prev.runId === fullId
      ? prev
      : { runId: fullId, pending: [], recovered: [], attempts: 0, others: 0 };
  const keys = new Set(base.pending.map((p) => p.key));
  const pending = [...base.pending, ...blocked.filter((b) => !keys.has(b.key))];
  // A list whose retries were over starts counting again for the newly delayed shows.
  const attempts = base.nextAt ? base.attempts : 0;
  const next: BlockedRetry = {
    ...base,
    pending,
    recovered: base.recovered.filter((t) => !blocked.some((b) => b.title === t)),
    attempts,
    others: base.others + (runId === fullId ? (summary.otherFailures ?? 0) : 0),
    nextAt: base.nextAt ?? new Date(now + retryDelayMs(attempts)).toISOString(),
  };
  store.setState(retryKey(source), next);
  const names = blocked.map((b) => b.title);
  store.addWarnings(runId, null, [
    {
      code: 'bot-check',
      message: `${sourceName(source)}'s bot check delayed ${blocked.length} ${blocked.length === 1 ? 'show' : 'shows'}; retried at ${next.nextAt?.slice(11, 16)} UTC (last good data kept): ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` +${names.length - 5} more` : ''}`,
    },
  ]);
  return next;
}

/** Bot-check pages a source met per day (UTC), for /status. */
export interface BotCheckDay {
  requests: number;
  /** Responses that were a bot-check page. */
  pages: number;
  /** Addresses read on a quick retry after a bot-check page. */
  cleared: number;
  /** Shows delayed to a later retry. */
  delayed: number;
}

export function botCheckKey(source: string): string {
  return `bot-check:${source}`;
}

/** Add one run's bot-check counts to the source's daily tally (last 14 days kept). */
function recordBlocks(store: Store, adapter: SourceAdapter, delayed: number): void {
  const b = adapter.blocks;
  if (!b) return;
  const days = store.getState<Record<string, BotCheckDay>>(botCheckKey(adapter.source)) ?? {};
  const day = new Date().toISOString().slice(0, 10);
  const d = days[day] ?? { requests: 0, pages: 0, cleared: 0, delayed: 0 };
  days[day] = {
    requests: d.requests + adapter.requests,
    pages: d.pages + b.pages,
    cleared: d.cleared + b.cleared,
    delayed: d.delayed + delayed,
  };
  const keep = Object.keys(days).sort().slice(-14);
  store.setState(botCheckKey(adapter.source), Object.fromEntries(keep.map((k) => [k, days[k]])));
}

/** Store key of the titles a source lists without any episodes (from the last complete full read). */
export function emptyShowsKey(source: string): string {
  return `empty-shows:${source}`;
}
