export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** `yyyy-mm-dd` of `days` days ago. */
export function daysAgo(days: number, now = Date.now()): string {
  return new Date(now - days * DAY_MS).toISOString().slice(0, 10);
}

/** Parse `dd.mm.yy`, `dd.mm.yyyy` or `dd/mm/yyyy` into `yyyy-mm-dd`; undefined when not a real date. */
export function parseDottedDate(s: string | undefined | null): string | undefined {
  const m = /(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})\b/.exec(s ?? '');
  if (!m) return undefined;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day)
    return undefined;
  return d.toISOString().slice(0, 10);
}

const dayFormat = new Map<string, Intl.DateTimeFormat>();

/** The calendar day (yyyy-mm-dd) a moment falls on in a time zone (e.g. Asia/Jerusalem). */
export function zonedDay(ms: number, timeZone = 'UTC'): string {
  let f = dayFormat.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormat.set(timeZone, f);
  }
  return f.format(ms);
}

/** Minutes a time zone is ahead of UTC at a moment. */
const partsFormat = new Map<string, Intl.DateTimeFormat>();
function offsetMinutes(ms: number, timeZone: string): number {
  let f = partsFormat.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    partsFormat.set(timeZone, f);
  }
  const parts = f.formatToParts(ms);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'));
  return Math.round((local - Math.floor(ms / 60_000) * 60_000) / 60_000);
}

/** The first moment (epoch ms) of a calendar day in a time zone. */
export function zonedDayStart(day: string, timeZone = 'UTC'): number {
  const midnightUtc = Date.parse(`${day}T00:00:00Z`);
  // Guess with the offset at UTC midnight, then correct once (a change of clocks near midnight).
  let start = midnightUtc - offsetMinutes(midnightUtc, timeZone) * 60_000;
  start = midnightUtc - offsetMinutes(start, timeZone) * 60_000;
  return start;
}

/** The day after / before a calendar day (yyyy-mm-dd). */
export function nextDay(day: string, by = 1): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);
}
