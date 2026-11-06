// Recorded one-time renumbers: the only way a published episode number may move (see numbering-guard.ts).
// Each runs once per database, after a backup, in one transaction, logged, and re-takes the guard's history.
//
// kan-titles+reshet-years-2026-11-06 (owner-approved before going public, while there were almost no viewers):
// - Kan: episodes take the number in Kan's own title ("פרק 4 - …"); ones without are numbered by air date after
//   them; never two in one season (a clash is a warning on /status).
// - Reshet: an untitled season among several becomes one season per air year, numbered by position (oldest = 1),
//   episodes by air date within the year (packages/reshet untitledSeasonsByYear).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Assignments, assignNumbers, parseEpisodeHint, type ScrapedShow } from '@israel-tv/core';
import { splitKeys, untitledSeasonsByYear } from '@israel-tv/reshet';
import type { Store } from '@israel-tv/store';
import { sanctionNumbering } from './numbering-guard.ts';
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
