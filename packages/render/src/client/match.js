// Title matching for the pages' searches (the search page, the programme guide), with the same rules as the apps'
// search (Hebrew without vowel points and final letters, a word's one-letter prefix optional), simplified.
window.iltvMatch = (() => {
  const FINALS = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
  const PREFIXES = 'הובלמשכ';
  const normalize = (s) =>
    s
      .normalize('NFKD')
      .replace(/[֑-ׇ]/g, '')
      .replace(/[ךםןףץ]/g, (c) => FINALS[c])
      .toLowerCase()
      .replace(/[׳״'"`]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  /** A word without its one-letter prefix ("השף" → "שף"), or '' when it has none or too little would be left. */
  const unprefixed = (w) => {
    const n = w[0] === 'ו' && w.length > 3 && PREFIXES.includes(w[1]) ? 2 : 1;
    return w.length - n >= 2 && PREFIXES.includes(w[0]) ? w.slice(n) : '';
  };
  /** 1: every query word starts a title word; 2: only through a prefix letter; 0: no match. */
  const score = (key, words) => {
    const titleWords = key.split(' ');
    const bare = titleWords.map(unprefixed).filter(Boolean);
    let best = 1;
    for (const w of words) {
      if (titleWords.some((k) => k.startsWith(w))) continue;
      const w2 = unprefixed(w);
      if (bare.some((k) => k.startsWith(w)) || (w2 && titleWords.some((k) => k.startsWith(w2)))) {
        best = 2;
        continue;
      }
      return 0;
    }
    return best;
  };
  /** Text without the direction marks the apps need. */
  const plain = (s) => s.replace(/[‎‏‪-‮⁦-⁩]/g, '');
  return { normalize, score, plain };
})();
