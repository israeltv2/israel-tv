// Hebrew-aware search normalization (spike copy; moves to packages/core in milestone 2).
const FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };

export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[֑-ׇ]/g, '') // niqqud and cantillation
    .replace(/[ךםןףץ]/g, (c) => FINALS[c] ?? c)
    .toLowerCase()
    .replace(/[׳״'"`׳״]/g, '') // geresh, gershayim, quotes
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
