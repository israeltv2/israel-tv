// Text as viewers see it: HTML entities decoded (sources double-encode some: "&amp;nbsp;"), every kind of space
// one plain space, and episode titles without what the app already shows next to them.

const ENTITIES: Record<string, string> = {
  amp: '&',
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  shy: '',
  zwj: '',
  zwnj: '',
  lrm: '',
  rlm: '',
};

function entity(whole: string, name: string): string {
  if (name[0] === '#') {
    const code =
      name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  }
  return ENTITIES[name.toLowerCase()] ?? whole;
}

/** Decode entities — named and numeric (`&#x27;`, `&#39;`) — twice, for double-encoded text, and collapse spaces. */
export function tidyText(s: string): string {
  let t = s;
  for (let i = 0; i < 2; i++) t = t.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, entity);
  return t.replace(/[\s ​]+/g, ' ').trim();
}

const SEP = String.raw`\s*[,|:\-–]\s*`;
/** A site's own name at the very end of a title, after a separator or sentence end ("… ישירה. makoTV"). */
const SITE_SIGNATURE = /\s*[.|·]\s*(?:makoTV|mako|N12|13TV)\s*$|\s+makoTV\s*$/i;
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
    // Filler endings: "the full episode/programme" ("פרק 1 המלא" → "פרק 1").
    // A site's name signing off a title ("… לצפייה ישירה. makoTV", measured on Mako's page titles).
    .replace(SITE_SIGNATURE, '')
    // A trailing "| … לצפייה ישירה …" segment is the page's search-engine line, not part of the title.
    .replace(/\s*\|[^|]*לצפייה ישירה[^|]*$/, '')
    .replace(/\s*[-–]?\s*(?:הפרק המלא|(?:ה)?(?:תכנית|תוכנית) המלאה|המלאה|המלא)\s*$/, '')
    .replace(/\s*[-–,]?\s*לצפייה ישירה[.!]?\s*$/, '')
    .replace(/\s*[|\-–·:,]+\s*$/, '')
    .replace(/^\s*[|\-–·:,]+\s*/, '')
    .trim();
  return t || raw;
}

/**
 * A page title's search-engine tail after a show's name (measured on the live catalog, 2026-11-08: 57 names):
 * "| תוכניות מלאות", "| פרקים", "– פרקים מלאים לצפייה", "| תכניות לצפיה ישירה", "| הפרקים המלאים", "| כתבות מלאות",
 * "| סרטים מלאים". Only a kind of item, "full", "to watch" and "live" words: "| דרמה בשני חלקים" is the show's own.
 */
const LISTING_TAIL =
  /\s*[|\-–]\s*(?:ה)?(?:תוכניות|תכניות|תוכנית|תכנית|פרקים|כתבות|סרטים)(?:\s+(?:ה)?(?:מלאים|מלאות|מלאה|מלא))?(?:\s+(?:לצפייה|לצפיה))?(?:\s+ישירה)?\s*$/;
/** "| באדיבות כאן חינוכית": who lent the show, not its name. */
const COURTESY_TAIL = /\s*\|\s*באדיבות\s.*$/;
/** A site section in front of the name ("כאן ארכיון | איפה היינו"). */
const SECTION_PREFIX = /^כאן ארכיון\s*\|\s*/;

/**
 * A show's name without the page-title boilerplate sources leave on it, for every source and also for names stored
 * before this rule (applied when shows are read). A subtitle after a separator stays ("ארץ זרה | סרטו התיעודי של
 * …", "בילו"יים | דרמה בשני חלקים"). Never empty: the tidied original when nothing would be left.
 */
export function cleanShowTitle(title: string): string {
  const raw = tidyText(title);
  let t = raw;
  for (let i = 0; i < 2; i++) t = t.replace(COURTESY_TAIL, '').replace(LISTING_TAIL, '');
  t = t.replace(SECTION_PREFIX, '').trim();
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
    // A closing pointer to another page of the site ("… בעמוד כאן תסריטים >>"): the link is not here. Only ">>"
    // (a closing » ends quoted names: "הסדרה החדשה של «כאן»").
    .replace(/(?:^|(?<=[.!?:]))\s*[^.!?:]*>>\s*$/, '')
    .replace(/\s*\|[^|]*לצפייה ישירה[^|]*$/, '')
    .replace(/\s*[-–,]?\s*(?:פרקים מלאים\s*)?לצפייה ישירה\s*$/, '')
    .trim();
  if (t.length < 10 || BOILERPLATE.some((r) => r.test(t))) return undefined;
  return t;
}

/** RIGHT-TO-LEFT MARK (an earlier way of marking lines; removed when a line is wrapped). */
export const RLM = '\u200F';
/** RIGHT-TO-LEFT EMBEDDING … POP DIRECTIONAL FORMATTING: the text between is laid out right to left. */
export const RLE = '\u202B';
export const PDF = '\u202C';

/**
 * Text for apps that lay every line out left to right. Nuvio on iPhone showed "פספורט TV" as "TV פספורט" and
 * "רשת 13 · 720p" as "720 · 13 pרשת" — also with a right-to-left mark in front, which a forced left-to-right
 * paragraph ignores. A right-to-left embedding works whatever the paragraph's direction: a line whose first
 * letter is Hebrew and that holds Latin letters or digits is wrapped in RLE … PDF. Only where needed, never twice;
 * Latin-first and pure-Hebrew lines stay as they are.
 */
export function rtl(s: string): string;
export function rtl(s: string | undefined): string | undefined;
export function rtl(s: string | undefined): string | undefined {
  if (!s || s.startsWith(RLE)) return s;
  const t = s.startsWith(RLM) ? s.slice(RLM.length) : s;
  const firstLetter = /\p{L}/u.exec(t)?.[0];
  if (!firstLetter || !/[\u0590-\u05FF]/.test(firstLetter)) return t;
  return /[A-Za-z0-9]/.test(t) ? `${RLE}${t}${PDF}` : t;
}

const TRAILER =
  /(?:^|[|\-–:·]\s*)(?:ה)?(?:טריילר|פרומו|טיזר)(?:\s+(?:ה?רשמי|ה?רשמית|ל?עונה\s*\d+))?\s*$|^(?:ה)?(?:טריילר|פרומו|טיזר)\s*[-–:|]/;

/** A trailer, teaser or promo ("טריילר", "… | טריילר", "טריילר - עונה 2"): not an episode. */
export function isTrailer(title: string): boolean {
  return TRAILER.test(tidyText(title));
}

/**
 * A Kaltura image-service address at a given size (unchanged when it is not one, or already sized). Without a size
 * the service answers 120×90 (Reshet's episode stills, measured 2026-11-07).
 */
export function kalturaImage(url: string, width: number, height: number): string {
  if (/\/Service\.svc\/GetImage\//i.test(url) && !/\/width\/\d+/i.test(url))
    return `${url.replace(/\/+$/, '')}/width/${width}/height/${height}`;
  return url;
}
