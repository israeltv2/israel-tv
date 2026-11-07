// Search normalization that makes Hebrew titles match how people type them.
const FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };

/** Lowercase, drop niqqud/cantillation, quotes, geresh/gershayim and punctuation, unify final letters. */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c] ?? c)
    .toLowerCase()
    .replace(/[׳״'"`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Letters Hebrew attaches to the front of a word: "the", "and", "in", "to", "from", "that", "as". */
const PREFIXES = 'הובלמשכ';

/**
 * A word without the one-letter prefix Hebrew attaches to it ("לצהל" → "צהל", "השפ" → "שפ"), also after "and"
 * ("והשפ" → "שפ"). Undefined when the word has no such prefix or too little would be left (two letters at least).
 */
export function stripPrefix(word: string): string | undefined {
  const n = word.startsWith('ו') && word.length > 3 && PREFIXES.includes(word[1] ?? '') ? 2 : 1;
  if (word.length - n < 2 || !PREFIXES.includes(word[0] ?? '')) return undefined;
  return word.slice(n);
}

/**
 * A normalized search key with each prefixed Hebrew word also present without its prefix, so a search finds
 * "משחקי השף" by "שף" and "לצה״ל" by "צה״ל". Build once per index; match with `searchMatches`.
 */
export function expandSearchKey(key: string): string {
  const extra = key
    .split(' ')
    .map(stripPrefix)
    .filter((w): w is string => !!w);
  return extra.length ? `${key} | ${extra.join(' ')}` : key;
}

/**
 * How a normalized query matches an expanded key: 1 for whole words from their start ("kan" finds "Kan 11", not
 * the middle of another word), 2 only through a Hebrew prefix letter (the key's — "שף" finds "השף" — or the
 * query's own — "לצהל" finds "צה״ל"), 0 not at all. Prefix-only matches are listed after the others: מ/ש/כ also
 * begin many plain words ("אסטר" matches "מאסטר" that way).
 */
export function searchMatches(expandedKey: string, query: string): 0 | 1 | 2 {
  if (!query) return 0;
  const hay = ` ${expandedKey}`;
  const sep = hay.indexOf(' | ');
  const own = sep < 0 ? hay : hay.slice(0, sep);
  if (own.includes(` ${query}`)) return 1;
  if (hay.includes(` ${query}`)) return 2;
  const [first = '', ...rest] = query.split(' ');
  const bare = stripPrefix(first);
  return bare && hay.includes(` ${[bare, ...rest].join(' ')}`) ? 2 : 0;
}
