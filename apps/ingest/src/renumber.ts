// Recorded one-time renumbers: the only way a published episode number may move (see numbering-guard.ts).
// Each runs once per database, after a backup, in one transaction, logged, and re-takes the guard's history.
//
// kan-titles+reshet-years-2026-11-06 (owner-approved before going public, while there were almost no viewers):
// - Kan: episodes take the number in Kan's own title ("פרק 4 - …"); ones without are numbered by air date after
//   them; never two in one season (a clash is a warning on /status).
// - Reshet: an untitled season among several becomes one season per air year, numbered by position (oldest = 1),
//   episodes by air date within the year (packages/reshet untitledSeasonsByYear).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Assignments,
  assignNumbers,
  chronological,
  datesTellOrder,
  dropRepeatedVideos,
  hintsRunBackwards,
  parseEpisodeHint,
  printedStartsOver,
  type ScrapedShow,
  startOverOrder,
} from '@israel-tv/core';
import { dropCollidingHints, splitKeys, untitledSeasonsByYear } from '@israel-tv/reshet';
import type { Store } from '@israel-tv/store';
import { sanctionNumbering, sanctionShow } from './numbering-guard.ts';
import { latestAirDate } from './runner.ts';

export const MIGRATIONS_KEY = 'numbering:migrations';
export const KAN_RESHET_2026_11 = 'kan-titles+reshet-years-2026-11-06';

export interface RenumberReport {
  id: string;
  backup?: string;
  kan: { shows: number; episodes: number; moved: number };
  reshet: { shows: number; seasons: number; episodes: number; moved: number };
  conflicts: number;
}

const key = (a: Assignments) => new Map(a.episodes.map((e) => [e.key, `${e.season}:${e.episode}`]));

function withKanNumbers(show: ScrapedShow): ScrapedShow {
  return {
    ...show,
    seasons: show.seasons.map((s) => ({
      ...s,
      episodes: s.episodes.map((e) => {
        const n = parseEpisodeHint(e.title);
        return n ? { ...e, numberHint: n } : e;
      }),
    })),
  };
}

const hasUntitledAmongSeveral = (show: ScrapedShow) =>
  show.seasons.length > 1 && show.seasons.some((s) => s.title.trim() === '');

/** Run the Kan/Reshet renumber once on this database; undefined when it already ran. */
export function renumberKanReshet(store: Store, backupDir: string): RenumberReport | undefined {
  const done = store.getState<string[]>(MIGRATIONS_KEY) ?? [];
  if (done.includes(KAN_RESHET_2026_11)) return undefined;
  const report: RenumberReport = {
    id: KAN_RESHET_2026_11,
    kan: { shows: 0, episodes: 0, moved: 0 },
    reshet: { shows: 0, seasons: 0, episodes: 0, moved: 0 },
    conflicts: 0,
  };
  const kan = store.listShows({ source: 'kan' });
  const reshet = store.listShows({ source: 'reshet' }).filter((r) => hasUntitledAmongSeveral(r.show));
  if (kan.length + reshet.length > 0) {
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    report.backup = join(backupDir, `before-${KAN_RESHET_2026_11}.sqlite`);
    store.backupTo(report.backup);
  }
  const runId = store.startRun('show', 'renumber');
  store.transaction(() => {
    for (const row of kan) {
      const show = withKanNumbers(row.show);
      const prev = store.assignments(row.seriesId);
      const r = assignNumbers(show, { seasons: prev.seasons, episodes: [] });
      const before = key(prev);
      report.kan.shows++;
      report.kan.episodes += r.episodes.length;
      report.kan.moved += r.episodes.filter((e) => before.get(e.key) !== `${e.season}:${e.episode}`).length;
      const clashes = r.warnings.filter((w) => w.code === 'episode-number-taken');
      report.conflicts += clashes.length;
      store.addWarnings(runId, row.seriesId, clashes);
      store.replaceAssignments(row.seriesId, { seasons: r.seasons, episodes: r.episodes });
      store.saveShow(row.seriesId, show, { seasons: [], episodes: [] }, latestAirDate(show), false);
    }
    for (const row of reshet) {
      const show = untitledSeasonsByYear(row.show);
      const prev = store.assignments(row.seriesId);
      const kept = new Set(show.seasons.map((s) => s.key));
      const keptSeasons = prev.seasons.filter((s) => kept.has(s.key));
      const keptNumbers = new Set(keptSeasons.map((s) => s.number));
      const r = assignNumbers(show, {
        seasons: keptSeasons,
        episodes: prev.episodes.filter((e) => keptNumbers.has(e.season)),
      });
      const before = key(prev);
      report.reshet.shows++;
      report.reshet.seasons += r.added.seasons.length;
      report.reshet.episodes += r.added.episodes.length;
      report.reshet.moved += r.episodes.filter(
        (e) => before.get(e.key) !== `${e.season}:${e.episode}`,
      ).length;
      const clashes = r.warnings.filter(
        (w) => w.code === 'episode-number-taken' || w.code === 'season-number-taken',
      );
      report.conflicts += clashes.length;
      store.addWarnings(runId, row.seriesId, clashes);
      store.replaceAssignments(row.seriesId, { seasons: r.seasons, episodes: r.episodes });
      store.saveShow(row.seriesId, show, { seasons: [], episodes: [] }, latestAirDate(show), false);
    }
    store.setState(MIGRATIONS_KEY, [...done, KAN_RESHET_2026_11]);
    store.setState(`${MIGRATIONS_KEY}:${KAN_RESHET_2026_11}`, { ...report, at: new Date().toISOString() });
    sanctionNumbering(store);
  });
  store.finishRun(runId, {
    status: 'ok',
    showsOk: report.kan.shows + report.reshet.shows,
    requests: 0,
    ...(report.conflicts ? { error: `${report.conflicts} numbering clashes (see warnings)` } : {}),
  });
  return report;
}

// named-seasons-lowest-free-2026-11-06 (approved the same day, before going public): named seasons were numbered
// from 101 (apps showed "Season 101"). Each one with episodes takes the lowest number no other season of its show
// uses, in the show's list order — the rule new seasons now follow; "עונת 2023" titles become year seasons. Only
// season numbers move: episode numbers within a season stay. Empty named seasons (Reshet lists empty duplicates)
// lose their number; they get one if they ever have episodes.
export const NAMED_LOWEST_FREE_2026_11 = 'named-seasons-lowest-free-2026-11-06';

export interface NamedRenumberReport {
  id: string;
  backup?: string;
  shows: number;
  seasons: number;
  episodes: number;
  emptyDropped: number;
}

export function renumberNamedSeasons(store: Store, backupDir: string): NamedRenumberReport | undefined {
  const done = store.getState<string[]>(MIGRATIONS_KEY) ?? [];
  if (done.includes(NAMED_LOWEST_FREE_2026_11)) return undefined;
  const report: NamedRenumberReport = {
    id: NAMED_LOWEST_FREE_2026_11,
    shows: 0,
    seasons: 0,
    episodes: 0,
    emptyDropped: 0,
  };
  const rows = store
    .listShows()
    .filter((r) => store.assignments(r.seriesId).seasons.some((s) => s.kind === 'named' && s.number >= 101));
  if (rows.length > 0) {
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    report.backup = join(backupDir, `before-${NAMED_LOWEST_FREE_2026_11}.sqlite`);
    store.backupTo(report.backup);
  }
  const runId = store.startRun('show', 'renumber');
  store.transaction(() => {
    for (const row of rows) {
      const prev = store.assignments(row.seriesId);
      const withEpisodes = new Set(prev.episodes.map((e) => e.season));
      const old = prev.seasons.filter((s) => s.kind === 'named' && s.number >= 101);
      const empty = old.filter((s) => !withEpisodes.has(s.number));
      const moving = old.filter((s) => withEpisodes.has(s.number));
      const base = prev.seasons.filter((s) => !old.includes(s));
      // The new rule decides the moving seasons' numbers (the others keep theirs).
      const r = assignNumbers(row.show, { seasons: base, episodes: [] });
      const fresh = new Map(r.seasons.map((s) => [s.key, s]));
      const used = new Set(base.map((s) => s.number));
      const moved = new Map<number, number>();
      const seasons = [...base];
      for (const s of moving) {
        let next = fresh.get(s.key);
        if (!next || used.has(next.number)) {
          // Not in the show's current data (or taken): the lowest free number.
          let n = 1;
          while (used.has(n)) n++;
          next = { key: s.key, number: n, kind: 'named' };
        }
        used.add(next.number);
        moved.set(s.number, next.number);
        seasons.push({ key: s.key, number: next.number, kind: next.kind });
      }
      const episodes = prev.episodes.map((e) =>
        moved.has(e.season) ? { ...e, season: moved.get(e.season) as number } : e,
      );
      report.shows++;
      report.seasons += moving.length;
      report.episodes += prev.episodes.filter((e) => moved.has(e.season)).length;
      report.emptyDropped += empty.length;
      store.replaceAssignments(row.seriesId, { seasons, episodes });
    }
    store.setState(MIGRATIONS_KEY, [
      ...(store.getState<string[]>(MIGRATIONS_KEY) ?? []),
      NAMED_LOWEST_FREE_2026_11,
    ]);
    store.setState(`${MIGRATIONS_KEY}:${NAMED_LOWEST_FREE_2026_11}`, {
      ...report,
      at: new Date().toISOString(),
    });
    sanctionNumbering(store);
  });
  store.finishRun(runId, { status: 'ok', showsOk: report.shows, requests: 0 });
  return report;
}

// reshet-split-repair-2026-11-06: an airing check during the deploy read two-season daily shows as one untitled
// season, which (then) was not split, so their episodes moved back into it in the stored data (numbers unchanged)
// and it took an empty season number. Re-split those shows' data and drop that empty number. Moves no episode.
export const RESHET_SPLIT_REPAIR = 'reshet-split-repair-2026-11-06';

export function repairReshetSplit(store: Store): { id: string; shows: number; dropped: number } | undefined {
  const done = store.getState<string[]>(MIGRATIONS_KEY) ?? [];
  if (done.includes(RESHET_SPLIT_REPAIR)) return undefined;
  const report = { id: RESHET_SPLIT_REPAIR, shows: 0, dropped: 0 };
  store.transaction(() => {
    for (const row of store.listShows({ source: 'reshet' })) {
      const keys = splitKeys(row.show);
      if (keys.size === 0) continue;
      const show = untitledSeasonsByYear(row.show, keys);
      const a = store.assignments(row.seriesId);
      const withEpisodes = new Set(a.episodes.map((e) => e.season));
      const stray = a.seasons.filter((s) => keys.has(s.key) && !withEpisodes.has(s.number));
      const changed = JSON.stringify(show.seasons) !== JSON.stringify(row.show.seasons);
      if (!changed && stray.length === 0) continue;
      report.shows++;
      report.dropped += stray.length;
      if (stray.length)
        store.replaceAssignments(row.seriesId, {
          seasons: a.seasons.filter((s) => !stray.includes(s)),
          episodes: a.episodes,
        });
      if (changed)
        store.saveShow(row.seriesId, show, { seasons: [], episodes: [] }, latestAirDate(show), false);
    }
    store.setState(MIGRATIONS_KEY, [
      ...(store.getState<string[]>(MIGRATIONS_KEY) ?? []),
      RESHET_SPLIT_REPAIR,
    ]);
    store.setState(`${MIGRATIONS_KEY}:${RESHET_SPLIT_REPAIR}`, { ...report, at: new Date().toISOString() });
  });
  return report;
}

// kan-printed-numbers-2026-11-07 / reshet-printed-numbers-2026-11-07 (round 10, owner-approved: "accepting the one-time
// watch-progress move"): seasons whose stored numbers disagree with the numbers the broadcaster prints on the
// episodes. Causes, measured on the live database 2026-11-07:
// - Reshet: Kaltura's EpisodeNumber field was taken over the title's "פרק N" and is sometimes a placeholder (every
//   episode 1) or a list position; the episodes were then numbered in list order (שבוע סוף season 2: "פרק 14" was
//   S2E1). The reader now prefers the title's number and drops numbers two episodes claim (packages/reshet).
// - Kan: the crawl reads a show over several slices; an episode without a printed number read before its printed
//   siblings took their number (מלכת השכונה: "מה לא עובד?" took 2, "פרק 2" became 5), or a page Kan re-published
//   under a new id found its number held by the withdrawn one (השופטים). Unnumbered episodes now wait for their
//   show's other pages (kan.ts).
// Per season (never year seasons, never one whose printed numbers run against the air dates — the rules number those
// by date): every episode with a printed number takes it; the others keep theirs unless a printed number claims it,
// then take the next free number after the season's highest. Reshet runs right after a full read with the fixed
// reader (only shows that read did read), Kan at start-up from the stored titles. Backup first, one pass in one
// transaction, every moved episode in the report (a parity list: show, season, episode, from → to).
export const KAN_PRINTED = 'kan-printed-numbers-2026-11-07';
export const RESHET_PRINTED = 'reshet-printed-numbers-2026-11-07';

export interface PrintedMove {
  seriesId: string;
  show: string;
  season: number;
  key: string;
  title: string;
  from: number;
  to: number;
}

export interface PrintedReport {
  id: string;
  backup?: string;
  /** Shows and seasons whose numbers moved. */
  shows: number;
  seasons: number;
  moves: PrintedMove[];
}

/** New numbers for one season's stored rows (only the ones that change), or undefined when nothing moves. */
export function printedSeason(
  season: ScrapedShow['seasons'][number],
  seasonNumber: number,
  rows: readonly { key: string; season: number; episode: number }[],
): Map<string, number> | undefined {
  if (hintsRunBackwards(season.episodes)) return undefined;
  const inSeason = rows.filter((r) => r.season === seasonNumber);
  const stored = new Map(inSeason.map((r) => [r.key, r.episode]));
  const hinted = season.episodes.filter((e) => e.numberHint !== undefined && stored.has(e.key));
  const uses = new Map<number, number>();
  for (const e of hinted) uses.set(e.numberHint as number, (uses.get(e.numberHint as number) ?? 0) + 1);
  const printed = new Map(
    hinted.filter((e) => uses.get(e.numberHint as number) === 1).map((e) => [e.key, e.numberHint as number]),
  );
  if ([...printed].every(([k, n]) => stored.get(k) === n)) return undefined;
  const used = new Set(printed.values());
  const target = new Map(printed);
  const rest = inSeason.filter((r) => !printed.has(r.key)).sort((a, b) => a.episode - b.episode);
  const bumped: typeof rest = [];
  for (const r of rest) {
    if (used.has(r.episode)) bumped.push(r);
    else {
      used.add(r.episode);
      target.set(r.key, r.episode);
    }
  }
  let max = Math.max(0, ...used);
  for (const r of bumped) {
    max++;
    while (used.has(max)) max++;
    used.add(max);
    target.set(r.key, max);
  }
  const changed = new Map([...target].filter(([k, n]) => stored.get(k) !== n));
  return changed.size > 0 ? changed : undefined;
}

/** Kan's printed numbers come from its titles: refreshed, so a hint an older reader stored ("מתוך פרק 1") goes. */
function kanHintsFromTitles(show: ScrapedShow): ScrapedShow {
  return {
    ...show,
    seasons: show.seasons.map((s) => ({
      ...s,
      episodes: s.episodes.map((e) => {
        const { numberHint: _, ...rest } = e;
        const n = parseEpisodeHint(e.title);
        return n ? { ...rest, numberHint: n } : rest;
      }),
    })),
  };
}

/**
 * Run one of the printed-number migrations once (undefined when it already ran). `dryRun` reports the moves without
 * a backup or any change. Reshet: only shows read successfully since `readSince` (the full read with the fixed reader).
 */
export function renumberPrinted(
  store: Store,
  backupDir: string,
  source: 'kan' | 'reshet',
  opts: { readSince?: string; dryRun?: boolean; fetched?: Record<string, string[]> } = {},
): PrintedReport | undefined {
  const id = source === 'kan' ? KAN_PRINTED : RESHET_PRINTED;
  const done = store.getState<string[]>(MIGRATIONS_KEY) ?? [];
  if (done.includes(id)) return undefined;
  const report: PrintedReport = { id, shows: 0, seasons: 0, moves: [] };
  const plans: { seriesId: string; show: ScrapedShow; next: Assignments; refreshed: boolean }[] = [];
  for (const row of store.listShows({ source })) {
    if (opts.readSince && row.lastOkAt < opts.readSince) continue;
    // Only seasons the read returned: a season kept from the stored data still has the old reader's numbers.
    const fresh = opts.fetched ? new Set(opts.fetched[row.seriesId] ?? []) : undefined;
    const show = source === 'kan' ? kanHintsFromTitles(row.show) : row.show;
    const a = store.assignments(row.seriesId);
    const seasonOf = new Map(a.seasons.map((s) => [s.key, s]));
    const moved = new Map<string, number>();
    let seasons = 0;
    for (const season of show.seasons) {
      const sa = seasonOf.get(season.key);
      if (!sa || sa.kind === 'year' || (fresh && !fresh.has(season.key))) continue;
      const m = printedSeason(season, sa.number, a.episodes);
      if (!m) continue;
      seasons++;
      const titles = new Map(season.episodes.map((e) => [e.key, e.title]));
      for (const [key, to] of m) {
        moved.set(key, to);
        const from = a.episodes.find((e) => e.key === key)?.episode ?? 0;
        report.moves.push({
          seriesId: row.seriesId,
          show: row.title,
          season: sa.number,
          key,
          title: titles.get(key) ?? '(no longer listed by the source)',
          from,
          to,
        });
      }
    }
    const refreshed = JSON.stringify(show) !== JSON.stringify(row.show);
    if (moved.size === 0 && !refreshed) continue;
    if (moved.size > 0) {
      report.shows++;
      report.seasons += seasons;
    }
    plans.push({
      seriesId: row.seriesId,
      show,
      next: {
        seasons: a.seasons,
        episodes: a.episodes.map((e) =>
          moved.has(e.key) ? { ...e, episode: moved.get(e.key) as number } : e,
        ),
      },
      refreshed,
    });
  }
  if (opts.dryRun) return report;
  if (report.moves.length > 0) {
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    report.backup = join(backupDir, `before-${id}.sqlite`);
    store.backupTo(report.backup);
  }
  const runId = store.startRun('show', 'renumber');
  store.transaction(() => {
    for (const p of plans) {
      if (report.moves.some((m) => m.seriesId === p.seriesId)) {
        store.replaceAssignments(p.seriesId, p.next);
        // The read's "now פרק N at the source" / "collides" notes are what this move resolves.
        store.clearWarnings(p.seriesId, ['source-renumbered', 'episode-number-taken']);
      }
      if (p.refreshed) {
        const row = store.getShow(p.seriesId);
        store.saveShow(p.seriesId, p.show, { seasons: [], episodes: [] }, latestAirDate(p.show), false);
        // A data refresh is not a new read: keep the show's own read times.
        if (row) store.restoreShowState(p.seriesId, row);
      }
    }
    store.setState(MIGRATIONS_KEY, [...(store.getState<string[]>(MIGRATIONS_KEY) ?? []), id]);
    store.setState(`${MIGRATIONS_KEY}:${id}`, { ...report, at: new Date().toISOString() });
    sanctionNumbering(store);
  });
  if (report.backup)
    writeFileSync(report.backup.replace(/\.sqlite$/, '.moves.json'), JSON.stringify(report.moves, null, 1), {
      mode: 0o600,
    });
  store.finishRun(runId, { status: 'ok', showsOk: report.shows, requests: 0 });
  return report;
}

/** One line for the service log; the full list is in the report file and the database. */
export function printedLine(r: PrintedReport): string {
  const sample = r.moves
    .slice(0, 5)
    .map((m) => `${m.seriesId} S${m.season}E${m.from}→E${m.to} "${m.title}"`)
    .join('; ');
  return `one-time renumber ${r.id}: ${r.moves.length} episodes moved in ${r.seasons} seasons of ${r.shows} shows to the broadcaster's printed numbers${sample ? ` (e.g. ${sample})` : ''}; backup ${r.backup ?? 'none (nothing to move)'}`;
}

/**
 * Hook after a source's full run: the Reshet printed-number migration runs once, on the shows that full read
 * (the fixed reader's numbers). Returns the log line, if it ran.
 */
export function afterFullRun(
  store: Store,
  backupDir: string,
  source: string,
  run: {
    status: string;
    startedAt: string;
    limited?: boolean;
    blocked?: unknown[];
    fetched?: Record<string, string[]>;
  },
): string | undefined {
  // Only after a complete read (every show read, none delayed): the migration runs once, so a show this read missed
  // would never be migrated. Otherwise it waits for the next full run.
  if (source !== 'reshet' || run.status !== 'ok' || run.limited || run.blocked?.length) return undefined;
  const r = renumberPrinted(store, backupDir, 'reshet', {
    readSince: run.startedAt,
    ...(run.fetched ? { fetched: run.fetched } : {}),
  });
  return r ? printedLine(r) : undefined;
}

// numbering-right-2026-11-08 (owner decision 2026-11-08: "dont leave anything, i dont mind if it will discard my
// watching progress all good"): the numbering freeze broken once, so that every season's numbers are right.
// Every season of every show is numbered again from what the source says (seasonTargets):
// - printed numbers that start over (several cycles listed as one season, Kan's זמן אמת): air-date order 1..n;
// - printed numbers that run against air dates that can order the season: positions, air-date order (kept);
// - printed numbers for at least half the episodes: each number its first episode by air date; a number printed
//   twice goes to the first, the other one with the unnumbered episodes: these keep their number when no printed
//   number claims it, otherwise go after the season's highest, in air-date order;
// - printed numbers for fewer than half, and air dates that can order the season: air-date order around them
//   (the printed ones keep their numbers); with bulk-upload dates they are treated as above;
// - no printed numbers: air-date order when the dates can order the season, else the numbers stay.
// Episodes no longer listed keep their number unless a listed one now has it (then after the highest).
// Backup first, one transaction, every move in the report and in a .moves.json next to the backup; the numbering
// warnings of every show are re-derived (the old ones described numbers this pass re-decided).
export const NUMBERING_RIGHT = 'numbering-right-2026-11-08';

export type SeasonRule = 'printed' | 'sparse' | 'starts-over' | 'by-date' | 'kept';

/** Where a season's numbers come from, and its stored rows' numbers (all of them, moved or not). */
export function seasonTargets(
  season: ScrapedShow['seasons'][number],
  seasonNumber: number,
  rows: readonly { key: string; season: number; episode: number }[],
): { rule: SeasonRule; numbers: Map<string, number> } {
  const inSeason = rows.filter((r) => r.season === seasonNumber);
  const current = new Map(inSeason.map((r) => [r.key, r.episode]));
  const eps = season.episodes.filter((e) => current.has(e.key));
  const view = { ...season, episodes: eps };
  const listed = new Set(eps.map((e) => e.key));
  const unlisted = inSeason.filter((r) => !listed.has(r.key)).sort((a, b) => a.episode - b.episode);
  const target = new Map<string, number>();
  const used = new Set<number>();
  const take = (key: string, n: number) => {
    target.set(key, n);
    used.add(n);
  };
  const highest = () => Math.max(0, ...used);
  /**
   * The rest keep their number when it is free, else take the lowest free number above the highest printed one
   * (`from`), in the order given.
   */
  const keepOrAfter = (keys: string[], claimed: Set<number>, from: () => number) => {
    const bumped: string[] = [];
    for (const k of keys) {
      const n = current.get(k) as number;
      if (claimed.has(n) || used.has(n)) bumped.push(k);
      else take(k, n);
    }
    for (const k of bumped) {
      let n = from();
      while (claimed.has(n) || used.has(n)) n++;
      take(k, n);
    }
  };
  const hinted = eps.filter((e) => e.numberHint !== undefined);
  let rule: SeasonRule;
  if (printedStartsOver(eps)) {
    rule = 'starts-over';
    for (const [i, e] of startOverOrder(view).entries()) take(e.key, i + 1);
  } else if (hintsRunBackwards(eps) || hinted.length === 0) {
    const order = chronological(view);
    if (eps.length > 0 && eps.every((e) => e.airDate) && datesTellOrder(eps)) {
      // Air-date order on the numbers these episodes hold (a gap left by an episode no longer listed stays).
      rule = 'by-date';
      const held = eps.map((e) => current.get(e.key) as number).sort((a, b) => a - b);
      for (const [i, e] of order.entries()) take(e.key, held[i] as number);
    } else {
      rule = 'kept';
      for (const e of eps) take(e.key, current.get(e.key) as number);
    }
  } else {
    const known = evidenceOrder(view);
    const order = known ?? chronological(view);
    const owner = new Map<number, string>();
    for (const e of order)
      if (e.numberHint !== undefined && !owner.has(e.numberHint)) owner.set(e.numberHint, e.key);
    const claimed = new Set(owner.keys());
    for (const [n, k] of owner) take(k, n);
    const others = order.filter((e) => target.get(e.key) === undefined).map((e) => e.key);
    // Few printed numbers are anchors in the season's order, when something gives one (dates, or the source's
    // list order where the printed numbers follow it).
    if (owner.size * 2 >= eps.length || !known) {
      rule = 'printed';
      // Unnumbered episodes ahead of the first printed one, when the numbers below it are free for them, are the
      // season's first episodes (טעם של חו"ל: "פריז" before "פרק 2"; Keshet's seasons that started at 2).
      // Only by air date, and aired before it: a list's opening clip or preview ("פתיח", "הצצה") is not one.
      const byDate = eps.every((e) => e.airDate) && datesTellOrder(eps);
      const firstAt = byDate ? order.findIndex((e) => owner.get(e.numberHint as number) === e.key) : -1;
      const first = firstAt > 0 ? (order[firstAt]?.numberHint as number) : 0;
      const firstDay = order[firstAt]?.airDate ?? '';
      if (firstAt > 0 && firstAt <= first - 1) {
        const lead = order.slice(0, firstAt);
        if (lead.every((e) => (e.airDate ?? '') < firstDay))
          lead.forEach((e, i) => {
            const n = first - firstAt + i;
            if (!claimed.has(n) && !used.has(n)) take(e.key, n);
          });
      }
      keepOrAfter(
        others.filter((k) => !target.has(k)),
        claimed,
        () => Math.max(0, ...claimed) + 1,
      );
    } else {
      rule = 'sparse';
      let cursor = 0;
      for (const k of others) {
        let n = cursor + 1;
        while (claimed.has(n) || used.has(n)) n++;
        take(k, n);
        cursor = n;
      }
    }
  }
  keepOrAfter(
    unlisted.map((r) => r.key),
    new Set(),
    () => highest() + 1,
  );
  return { rule, numbers: target };
}

/**
 * The order something says a season's episodes aired in: air dates that can order it (datesTellOrder; undated
 * episodes in list order, as `chronological`), else the source's list order when its printed numbers are the
 * places in it (טקסי דרייבר: "פרק 3" third, "פרק 12" twelfth; also listed newest first), else nothing.
 */
export function evidenceOrder(
  season: ScrapedShow['seasons'][number],
): ScrapedShow['seasons'][number]['episodes'] | undefined {
  const eps = season.episodes;
  if (datesTellOrder(eps)) return chronological(season);
  // Every printed number sits where the list puts it: number = place in the list (+ the same gap for all, for
  // episodes missing before them), in one direction or the other.
  const fits = (list: typeof eps) => {
    const gaps = new Set<number>();
    list.forEach((e, i) => {
      if (e.numberHint !== undefined) gaps.add(e.numberHint - (i + 1));
    });
    return gaps.size === 1 && [...gaps][0] !== undefined && ([...gaps][0] as number) >= 0;
  };
  if (eps.filter((e) => e.numberHint !== undefined).length < 2) return undefined;
  if (fits(eps)) return eps;
  const reversed = [...eps].reverse();
  return fits(reversed) ? reversed : undefined;
}

export interface RightMove extends PrintedMove {
  source: string;
  rule: SeasonRule;
}

export interface RightReport {
  id: string;
  backup?: string;
  /** Per source and rule: seasons whose numbers moved, and episodes moved. */
  counts: Record<string, Record<string, { seasons: number; episodes: number }>>;
  shows: number;
  seasons: number;
  moves: RightMove[];
  /** Episodes left out as a second listing of the same video. */
  repeats: { seriesId: string; key: string; title: string }[];
  /** Numbering warnings removed (re-derived), and the ones the stored numbers still give. */
  warningsCleared: number;
  warningsLeft: number;
}

/** A Reshet daily show's year season (untitledSeasonsByYear): numbered by date, printed numbers ignored. */
const splitYear = (s: ScrapedShow['seasons'][number]) => /^\d{4}$/.test(s.title) && /\|\d{4}$/.test(s.key);

/**
 * The stored data as today's readers give it: Kan's numbers from its titles, Reshet's title numbers over Kaltura's
 * (dropCollidingHints), and no video listed twice (dropRepeatedVideos).
 */
function refreshed(show: ScrapedShow): ScrapedShow {
  if (show.source === 'kan') return dropRepeatedVideos(kanHintsFromTitles(show));
  if (show.source !== 'reshet') return dropRepeatedVideos(show);
  const seasons = show.seasons.map((s) =>
    splitYear(s) ? s : { ...s, episodes: dropCollidingHints(s.episodes) },
  );
  const next = JSON.stringify(seasons) === JSON.stringify(show.seasons) ? show : { ...show, seasons };
  return dropRepeatedVideos(next);
}

const NUMBERING_CODES = ['source-renumbered', 'episode-number-taken', 'numbers-reversed'] as const;

/** One show's numbers by the numbering-right rules (seasonTargets): what moves, and its data as today's readers give it. */
function planRight(
  store: Pick<Store, 'assignments'>,
  row: { seriesId: string; title: string; show: ScrapedShow },
): {
  show: ScrapedShow;
  next: Assignments;
  moves: RightMove[];
  /** Per season that moved: its rule and how many episodes. */
  seasonMoves: { rule: SeasonRule; count: number }[];
  repeats: RightReport['repeats'];
  dataChanged: boolean;
} {
  const show = refreshed(row.show);
  const a = store.assignments(row.seriesId);
  const seasonOf = new Map(a.seasons.map((s) => [s.key, s]));
  const before = new Map(row.show.seasons.flatMap((s) => s.episodes.map((e) => [e.key, e.title])));
  for (const s of show.seasons) for (const e of s.episodes) before.delete(e.key);
  const repeats = [...before].map(([key, title]) => ({ seriesId: row.seriesId, key, title }));
  const moved = new Map<string, number>();
  const moves: RightMove[] = [];
  const seasonMoves: { rule: SeasonRule; count: number }[] = [];
  for (const season of show.seasons) {
    const sa = seasonOf.get(season.key);
    if (!sa) continue;
    const { rule, numbers } = seasonTargets(season, sa.number, a.episodes);
    const titles = new Map(season.episodes.map((e) => [e.key, e.title]));
    let count = 0;
    for (const r of a.episodes) {
      const to = r.season === sa.number ? numbers.get(r.key) : undefined;
      if (to === undefined || to === r.episode) continue;
      count++;
      moved.set(r.key, to);
      moves.push({
        seriesId: row.seriesId,
        source: row.show.source,
        rule,
        show: row.title,
        season: sa.number,
        key: r.key,
        title: titles.get(r.key) ?? '(no longer listed by the source)',
        from: r.episode,
        to,
      });
    }
    if (count > 0) seasonMoves.push({ rule, count });
  }
  return {
    show,
    next: {
      seasons: a.seasons,
      episodes: a.episodes.map((e) => (moved.has(e.key) ? { ...e, episode: moved.get(e.key) as number } : e)),
    },
    moves,
    seasonMoves,
    repeats,
    dataChanged: JSON.stringify(show) !== JSON.stringify(row.show),
  };
}

/** Run numbering-right-2026-11-08 once (undefined when it already ran); `dryRun` changes nothing. */
export function renumberRight(
  store: Store,
  backupDir: string,
  opts: { dryRun?: boolean } = {},
): RightReport | undefined {
  const done = store.getState<string[]>(MIGRATIONS_KEY) ?? [];
  if (done.includes(NUMBERING_RIGHT)) return undefined;
  const report: RightReport = {
    id: NUMBERING_RIGHT,
    counts: {},
    shows: 0,
    seasons: 0,
    moves: [],
    repeats: [],
    warningsCleared: 0,
    warningsLeft: 0,
  };
  const plans: {
    seriesId: string;
    show: ScrapedShow;
    next: Assignments;
    moved: boolean;
    dataChanged: boolean;
  }[] = [];
  for (const row of store.listShows()) {
    const plan = planRight(store, row);
    report.repeats.push(...plan.repeats);
    report.moves.push(...plan.moves);
    for (const { rule, count } of plan.seasonMoves) {
      const bySource = report.counts[row.show.source] ?? {};
      report.counts[row.show.source] = bySource;
      const c = bySource[rule] ?? { seasons: 0, episodes: 0 };
      bySource[rule] = c;
      c.seasons++;
      c.episodes += count;
    }
    if (plan.moves.length > 0) {
      report.shows++;
      report.seasons += plan.seasonMoves.length;
    }
    plans.push({
      seriesId: row.seriesId,
      show: plan.show,
      next: plan.next,
      moved: plan.moves.length > 0,
      dataChanged: plan.dataChanged,
    });
  }
  // What the numbering rules still say about the new numbers (expected: nothing).
  const left = new Map(
    plans.map((p) => [
      p.seriesId,
      assignNumbers(p.show, p.next).warnings.filter((w) =>
        (NUMBERING_CODES as readonly string[]).includes(w.code),
      ),
    ]),
  );
  report.warningsLeft = [...left.values()].reduce((n, l) => n + l.length, 0);
  if (opts.dryRun) return report;
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  report.backup = join(backupDir, `before-${NUMBERING_RIGHT}.sqlite`);
  store.backupTo(report.backup);
  const runId = store.startRun('show', 'renumber');
  store.transaction(() => {
    for (const p of plans) {
      if (p.moved) store.replaceAssignments(p.seriesId, p.next);
      report.warningsCleared += store.clearWarnings(p.seriesId, NUMBERING_CODES);
      store.addWarnings(runId, p.seriesId, left.get(p.seriesId) ?? []);
      if (p.dataChanged) {
        const row = store.getShow(p.seriesId);
        store.saveShow(p.seriesId, p.show, { seasons: [], episodes: [] }, latestAirDate(p.show), false);
        if (row) store.restoreShowState(p.seriesId, row);
      }
    }
    store.setState(MIGRATIONS_KEY, [...(store.getState<string[]>(MIGRATIONS_KEY) ?? []), NUMBERING_RIGHT]);
    const { moves: _, ...summary } = report;
    store.setState(`${MIGRATIONS_KEY}:${NUMBERING_RIGHT}`, {
      ...summary,
      moved: report.moves.length,
      at: new Date().toISOString(),
    });
    sanctionNumbering(store);
  });
  writeFileSync(report.backup.replace(/\.sqlite$/, '.moves.json'), JSON.stringify(report.moves, null, 1), {
    mode: 0o600,
  });
  store.finishRun(runId, { status: 'ok', showsOk: report.shows, requests: 0 });
  return report;
}

/** One line for the service log; the full list is in the report file and the database. */
export function rightLine(r: RightReport): string {
  const counts = Object.entries(r.counts)
    .map(
      ([source, rules]) =>
        `${source} ${Object.entries(rules)
          .map(([rule, c]) => `${rule} ${c.episodes} in ${c.seasons}`)
          .join(', ')}`,
    )
    .join('; ');
  const sample = r.moves
    .slice(0, 5)
    .map((m) => `${m.seriesId} S${m.season}E${m.from}→E${m.to} "${m.title}"`)
    .join('; ');
  return `one-time renumber ${r.id}: ${r.moves.length} episodes moved in ${r.seasons} seasons of ${r.shows} shows (${counts || 'none'})${sample ? `, e.g. ${sample}` : ''}; ${r.repeats.length} repeated listings left out; ${r.warningsCleared} numbering warnings re-derived, ${r.warningsLeft} left; backup ${r.backup ?? 'none (dry run)'}`;
}

// kan-full-lists-2026-11-08 (round of 2026-11-08, under the owner's "dont leave anything, i dont mind if it will
// discard my watching progress"): Kan shows were read from their show pages, which link only part of a long show
// (kan.ts FULL_LISTS); their older episodes are now read from Kan's full list. Extras and specials read before them
// (without a printed number) took the next numbers, which printed episodes read now need (קופה ראשית season 1: six
// extras at 17–23, while Kan's season 1 runs to "פרק 21"). So when a refilled show's backlog is all read, its seasons
// are numbered once more by the numbering-right rules (seasonTargets), that show only: printed numbers to their
// episodes, extras after them. A backup before the first such show, every move in the log, in the database and in a
// .moves.json next to the backup; the guard's history is re-taken for that show only.
export const KAN_FULL_LISTS = 'kan-full-lists-2026-11-08';

export interface ShowRenumber {
  seriesId: string;
  moves: RightMove[];
  backup?: string;
}

/** Number one refilled Kan show again by the numbering-right rules (see KAN_FULL_LISTS). */
export function renumberKanShow(store: Store, seriesId: string, backupDir: string): ShowRenumber {
  const row = store.getShow(seriesId);
  if (!row) return { seriesId, moves: [] };
  const plan = planRight(store, { seriesId, title: row.show.title, show: row.show });
  const result: ShowRenumber = { seriesId, moves: plan.moves };
  const backup = join(backupDir, `before-${KAN_FULL_LISTS}.sqlite`);
  if (plan.moves.length > 0 && !existsSync(backup)) {
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    store.backupTo(backup);
    result.backup = backup;
  }
  const runId = store.startRun('show', 'renumber');
  store.transaction(() => {
    if (plan.moves.length > 0) store.replaceAssignments(seriesId, plan.next);
    // The numbering notes of this show are re-derived from its new numbers.
    store.clearWarnings(seriesId, NUMBERING_CODES);
    store.addWarnings(
      runId,
      seriesId,
      assignNumbers(plan.show, plan.next).warnings.filter((w) =>
        (NUMBERING_CODES as readonly string[]).includes(w.code),
      ),
    );
    if (plan.dataChanged) {
      store.saveShow(seriesId, plan.show, { seasons: [], episodes: [] }, latestAirDate(plan.show), false);
      store.restoreShowState(seriesId, row);
    }
    const key = `${MIGRATIONS_KEY}:${KAN_FULL_LISTS}`;
    const so = store.getState<{ shows: number; moved: number; at?: string }>(key) ?? { shows: 0, moved: 0 };
    store.setState(key, {
      shows: so.shows + 1,
      moved: so.moved + plan.moves.length,
      at: new Date().toISOString(),
    });
    sanctionShow(store, seriesId);
  });
  if (plan.moves.length > 0) {
    const file = backup.replace(/\.sqlite$/, '.moves.json');
    const earlier: RightMove[] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
    writeFileSync(file, JSON.stringify([...earlier, ...plan.moves], null, 1), { mode: 0o600 });
  }
  store.finishRun(runId, { status: 'ok', showsOk: 1, requests: 0 });
  return result;
}

/** One line for the service log. */
export function showRenumberLine(r: ShowRenumber): string {
  const sample = r.moves
    .slice(0, 5)
    .map((m) => `S${m.season}E${m.from}→E${m.to} "${m.title}"`)
    .join('; ');
  return `one-time renumber ${KAN_FULL_LISTS} of ${r.seriesId}: ${r.moves.length} episodes moved${sample ? ` (${sample})` : ''}${r.backup ? `; backup ${r.backup}` : ''}`;
}
