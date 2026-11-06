/** Parse Mako-style `dd.mm.yy` or `dd.mm.yyyy` into `yyyy-mm-dd`; undefined when not a real date. */
export function parseDottedDate(s: string | undefined | null): string | undefined {
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\b/.exec(s ?? '');
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
