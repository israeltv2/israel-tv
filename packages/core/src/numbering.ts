// Season and episode numbering.
//
// Viewer apps key watch progress by series id + season + episode, so a number, once published, must never
// change. Numbering is therefore stateful: `assignNumbers` takes the numbers already given out (from the
// home database) and only adds numbers for things it has not seen. When the source later disagrees with a
// stored number, the stored number wins and a warning is recorded.

import type { ScrapedSeason, ScrapedShow } from './model.ts';

export type SeasonKind = 'numbered' | 'year' | 'named' | 'single';

/** Named seasons ("VIP 5", "נבחרת החלומות") get numbers from here up, clear of real season numbers. */
export const NAMED_SEASON_BASE = 101;

export interface SeasonAssignment {
  key: string;
  number: number;
  kind: SeasonKind;
}

export interface EpisodeAssignment {
  key: string;
  season: number;
  episode: number;
}

export interface Assignments {
  seasons: SeasonAssignment[];
  episodes: EpisodeAssignment[];
}

export interface NumberingWarning {
  code: 'season-number-taken' | 'episode-number-taken' | 'source-renumbered' | 'numbers-reversed';
  message: string;
}

export interface NumberingResult extends Assignments {
  /** Only the assignments added by this run. */
  added: Assignments;
  warnings: NumberingWarning[];
}

/** Read a season title: "עונה 12" → 12 numbered; "עונה 2025" / "2025" → 2025 year; anything else named. */
export function parseSeasonTitle(title: string): { kind: SeasonKind; number?: number } {
  const t = title.trim();
  if (t === '') return { kind: 'single' };
  const m = /^(?:עונה\s*)?(\d{1,4})$/.exec(t);
  if (!m) return { kind: 'named' };
  const n = Number(m[1]);
  if (n >= 1900 && n <= 2100) return { kind: 'year', number: n };
  if (n >= 1 && n < NAMED_SEASON_BASE) return { kind: 'numbered', number: n };
  return { kind: 'named' };
}

/** Read an episode number from text like "פרק 5", "פרק 5@05.11.26" or "פרק 12 - הגמר". */
export function parseEpisodeHint(text: string | undefined | null): number | undefined {
  const m = /פרק\s*(\d{1,4})(?!\d)/.exec(text ?? '');
  const n = m ? Number(m[1]) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function nextFree(used: Set<number>, from: number): number {
  let n = from;
  while (used.has(n)) n++;
  return n;
}

/**
 * Episodes without a stored number, oldest first: by air date when every one has a date, otherwise in
 * source order, reversed when the source lists newest first (daily shows).
 */
function chronological(season: ScrapedSeason): ScrapedSeason['episodes'] {
  const eps = season.episodes;
  const dated = eps.filter((e) => e.airDate);
  if (dated.length === eps.length && eps.length > 0) {
    return [...eps]
      .map((e, i) => ({ e, i }))
      .sort((a, b) => (a.e.airDate ?? '').localeCompare(b.e.airDate ?? '') || a.i - b.i)
      .map(({ e }) => e);
  }
  if (dated.length >= 2) {
    const first = dated[0]?.airDate ?? '';
    const last = dated[dated.length - 1]?.airDate ?? '';
    if (first > last) return [...eps].reverse();
  }
  return eps;
}

/** True when, among dated episodes with printed numbers, higher numbers mostly have earlier dates. */
export function hintsRunBackwards(eps: ScrapedSeason['episodes']): boolean {
  const pts = eps
    .filter((e) => e.numberHint !== undefined && e.airDate)
    .sort((a, b) => (a.numberHint ?? 0) - (b.numberHint ?? 0));
  if (pts.length < 3) return false;
  let up = 0;
  let down = 0;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]?.airDate ?? '';
    const cur = pts[i]?.airDate ?? '';
    if (cur > prev) up++;
    else if (cur < prev) down++;
  }
  return down > up * 2;
}

export function assignNumbers(show: ScrapedShow, previous: Assignments): NumberingResult {
  const warnings: NumberingWarning[] = [];
  const seasons = new Map(previous.seasons.map((s) => [s.key, s]));
  const episodes = new Map(previous.episodes.map((e) => [e.key, e]));
  const added: Assignments = { seasons: [], episodes: [] };
  const usedSeasonNumbers = new Set(previous.seasons.map((s) => s.number));

  // Seasons: numbered and year titles take their own number; named ones are allocated in source order.
  const single = show.seasons.length === 1 && show.seasons[0]?.title.trim() === '';
  for (const season of show.seasons) {
    if (seasons.has(season.key)) continue;
    const parsed = single ? { kind: 'single' as const, number: 1 } : parseSeasonTitle(season.title);
    let kind: SeasonKind = parsed.kind === 'single' && !single ? 'named' : parsed.kind;
    let number = parsed.number;
    if (number !== undefined && usedSeasonNumbers.has(number)) {
      warnings.push({
        code: 'season-number-taken',
        message: `season "${season.title}" (${season.key}) wants ${number}, already used; numbered as named`,
      });
      number = undefined;
      kind = 'named';
    }
    if (number === undefined) number = nextFree(usedSeasonNumbers, NAMED_SEASON_BASE);
    const a: SeasonAssignment = { key: season.key, number, kind };
    seasons.set(season.key, a);
    usedSeasonNumbers.add(number);
    added.seasons.push(a);
  }

  // Episodes: keep stored numbers; new ones take the source's "פרק N" when free, otherwise the next free
  // number after the season's highest, in chronological order.
  const usedBySeason = new Map<number, Set<number>>();
  for (const e of episodes.values()) {
    const set = usedBySeason.get(e.season) ?? new Set<number>();
    set.add(e.episode);
    usedBySeason.set(e.season, set);
  }
  for (const season of show.seasons) {
    const seasonNumber = seasons.get(season.key)?.number;
    if (seasonNumber === undefined) continue;
    const used = usedBySeason.get(seasonNumber) ?? new Set<number>();
    usedBySeason.set(seasonNumber, used);
    let max = 0;
    for (const n of used) if (n > max) max = n;
    for (const ep of season.episodes) {
      const stored = episodes.get(ep.key);
      if (stored && ep.numberHint !== undefined && stored.episode !== ep.numberHint) {
        warnings.push({
          code: 'source-renumbered',
          message: `episode ${ep.key} is now "פרק ${ep.numberHint}" at the source; kept S${stored.season}E${stored.episode}`,
        });
      }
    }
    const fresh = chronological(season).filter((e) => !episodes.has(e.key));
    // Printed numbers that run against the air dates (the source counts newest = 1) are positions, not
    // episode numbers: number by date instead, and say so.
    const trustHints = !hintsRunBackwards(season.episodes);
    if (!trustHints) {
      warnings.push({
        code: 'numbers-reversed',
        message: `season "${season.title}" (${season.key}): printed numbers run against the air dates; numbered by date`,
      });
    }
    // First pass: episodes whose printed number is free, so a later duplicate cannot steal it.
    const pending: typeof fresh = [];
    for (const ep of fresh) {
      if (trustHints && ep.numberHint !== undefined && !used.has(ep.numberHint)) {
        const a = { key: ep.key, season: seasonNumber, episode: ep.numberHint };
        episodes.set(ep.key, a);
        used.add(ep.numberHint);
        if (ep.numberHint > max) max = ep.numberHint;
        added.episodes.push(a);
      } else {
        pending.push(ep);
      }
    }
    for (const ep of pending) {
      const n = nextFree(used, max + 1);
      max = n;
      if (trustHints && ep.numberHint !== undefined) {
        warnings.push({
          code: 'episode-number-taken',
          message: `episode ${ep.key} "פרק ${ep.numberHint}" collides in season ${seasonNumber}; numbered ${n}`,
        });
      }
      const a = { key: ep.key, season: seasonNumber, episode: n };
      episodes.set(ep.key, a);
      used.add(n);
      added.episodes.push(a);
    }
  }

  return { seasons: [...seasons.values()], episodes: [...episodes.values()], added, warnings };
}
