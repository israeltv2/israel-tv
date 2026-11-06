// Numbers, sizes, durations and times as the owner reads them. Times are shown in the dashboard's time zone (the
// daemon's schedule.timezone, Israel by default); the exact UTC time is in each element's title.

let zone = 'UTC';
/** Set once from /session. */
export function setTimeZone(tz: string): void {
  zone = tz;
}

const nf = new Intl.NumberFormat('en-US');
export const num = (n: number | undefined): string => (n === undefined ? '—' : nf.format(n));

export function compact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function pct(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function mb(n: number): string {
  return n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n < 10 ? n.toFixed(1) : Math.round(n)} MB`;
}

export function ms(n: number | undefined): string {
  if (n === undefined) return '—';
  return n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(n < 10_000 ? 2 : 1)} s`;
}

export function duration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${Math.round(sec % 60)}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });

/** "5 min. ago", "in 2 hr." */
export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const diff = (Date.parse(iso) - now) / 1000;
  const a = Math.abs(diff);
  if (a < 45) return diff < 0 ? 'just now' : 'in a moment';
  if (a < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (a < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86_400), 'day');
}

const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `${zone}|${key}`;
  let f = fmts.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...opts });
    fmts.set(k, f);
  }
  return f;
}

/** "7 Nov, 01:02" in the dashboard's zone. */
export function when(iso: string | undefined): string {
  if (!iso) return '—';
  return fmt('when', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(Date.parse(iso));
}

/** "01:02:03" in the dashboard's zone. */
export function clock(iso: string): string {
  return fmt('clock', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(
    Date.parse(iso),
  );
}

/** A calendar day (yyyy-mm-dd) as "Sat 7" / "7 Nov". */
export function dayLabel(day: string, style: 'short' | 'weekday' = 'short'): string {
  const d = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    ...(style === 'weekday' ? { weekday: 'short', day: 'numeric' } : { day: 'numeric', month: 'short' }),
  }).format(d);
}

export function utcTitle(iso: string | undefined): string | undefined {
  return iso ? `${iso.replace('T', ' ').slice(0, 19)} UTC` : undefined;
}
