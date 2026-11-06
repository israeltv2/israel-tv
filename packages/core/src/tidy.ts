// Text as viewers see it: HTML entities decoded (sources double-encode some: "&amp;nbsp;"), every kind of space
// one plain space, and episode titles without what the app already shows next to them.

const ENTITIES: Record<string, string> = {
  amp: '&',
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  '#39': "'",
};

/** Decode entities (twice, for double-encoded text) and collapse spaces, including non-breaking ones. */
export function tidyText(s: string): string {
  let t = s;
  for (let i = 0; i < 2; i++)
    t = t.replace(/&(amp|nbsp|quot|apos|lt|gt|#39);/g, (_, e: string) => ENTITIES[e] ?? _);
  return t.replace(/[\s ​]+/g, ' ').trim();
}

const SEP = String.raw`\s*[,|:\-–]\s*`;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * An episode title without the show's name, "עונה N" and "התכנית המלאה" around it ("מקום לדאגה, עונה 1, פרק 1" →
 * "פרק 1"; "המועדון עם שחר חסון | עונה 2 | דדו מילמן" → "דדו מילמן"). Never empty: the original when nothing is left.
 */
export function tidyEpisodeTitle(title: string, showTitle: string): string {
  const raw = tidyText(title);
  const show = tidyText(showTitle);
  let t = raw;
  // The show's name, before a separator, a date (daily shows: "… 06.11.26"), or nothing.
  if (show) t = t.replace(new RegExp(`^${escapeRegExp(show)}(?:${SEP}|\\s+(?=\\d{1,2}[./]\\d{1,2})|$)`), '');
  t = t
    .replace(new RegExp(`^עונה\\s*\\d+(?:${SEP}|$)`), '')
    .replace(/\s*[-–]?\s*(?:ה)?(?:תכנית|תוכנית) המלאה\s*$/, '')
    .trim();
  return t || raw;
}
