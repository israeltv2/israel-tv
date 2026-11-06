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
import { untitledSeasonsByYear } from '@israel-tv/reshet';
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
