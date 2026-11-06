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
