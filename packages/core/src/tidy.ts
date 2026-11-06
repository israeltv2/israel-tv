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

/** A site's own generic blurb, used by some show pages as their description: not about the show. */
const BOILERPLATE = [/^ערוץ רשת 13, כל תוכניות הטלוויזיה/];

/**
 * A show or episode description without what sites add for search engines (measured on the live data): template
 * placeholders ("%%excerpt%%"), a site-section prefix ("חדשות 13 | …"), a trailing "| …, לצפייה ישירה" segment or
 * "לצפייה ישירה" ending; a site's generic blurb is no description at all. Ordinary sentences stay as written.
 */
export function cleanDescription(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  let t = tidyText(raw).replace(/%%[a-z_]+%%/gi, ' ');
  t = tidyText(t)
    .replace(/^(?:חדשות 13|רשת 13|ערוץ 13|קשת 12|N12)\s*\|\s*/, '')
    .replace(/\s*\|[^|]*לצפייה ישירה[^|]*$/, '')
    .replace(/\s*[-–,]?\s*(?:פרקים מלאים\s*)?לצפייה ישירה\s*$/, '')
    .trim();
  if (t.length < 10 || BOILERPLATE.some((r) => r.test(t))) return undefined;
  return t;
}
