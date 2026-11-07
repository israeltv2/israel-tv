// The search page: matches titles from search.json in the browser, with the same rules as the apps' search
// (Hebrew without vowel points and final letters, a word's one-letter prefix optional), simplified. What is typed
// never leaves the browser. Results are built as elements, never as markup from data.
(() => {
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
  const plain = (s) => s.replace(/[‎‏‪-‮⁦-⁩]/g, '');
  const sized = (u) =>
    /^https:\/\/media\d*\.reshet\.tv\/image\/upload\//.test(u) && !/\/upload\/[a-z]_/.test(u)
      ? u.replace('/image/upload/', '/image/upload/w_220,c_limit,f_auto,q_auto/')
      : u;

  const d = document;
  const input = d.getElementById('q');
  const results = d.getElementById('results');
  const info = d.getElementById('info');
  const empty = d.getElementById('empty');
  let rows = null;

  const tile = ([id, type, , name, , poster]) => {
    const live = type === 'tv';
    const a = d.createElement('a');
    a.className = 'tile';
    a.href = live ? `/live/#${id}` : `/show/${id}/`;
    const image = poster ? sized(poster.replace('{{israel-tv-origin}}', '')) : '';
    if (image) {
      const img = d.createElement('img');
      Object.assign(img, {
        className: 'poster',
        src: image,
        alt: '',
        loading: 'lazy',
        width: 220,
        height: 330,
      });
      if (live) img.style.cssText = 'object-fit:contain;padding:18%';
      a.append(img);
    } else {
      const blank = d.createElement('span');
      blank.className = 'poster blank';
      blank.setAttribute('aria-hidden', 'true');
      a.append(blank);
    }
    const title = d.createElement('span');
    title.className = 't';
    title.dir = 'auto';
    title.textContent = plain(name);
    a.append(title);
    return a;
  };

  const run = () => {
    const q = normalize(input.value);
    history.replaceState(null, '', q ? `?q=${encodeURIComponent(input.value)}` : location.pathname);
    empty.hidden = true;
    if (!q) {
      results.replaceChildren();
      info.textContent = '';
      return;
    }
    if (!rows) {
      info.textContent = 'טוען…';
      return;
    }
    const words = q.split(' ');
    const hits = rows
      .map((r) => [score(r[4], words), r])
      .filter(([s]) => s)
      .sort((a, b) => a[0] - b[0]);
    info.textContent = hits.length
      ? hits.length === 1
        ? 'נמצאה תוכנית אחת'
        : `נמצאו ${hits.length} תוצאות`
      : 'לא נמצא כלום. נסו לחפש בעברית, כמו שהשם כתוב באתר הערוץ.';
    results.replaceChildren(...hits.slice(0, 120).map(([, r]) => tile(r)));
    empty.hidden = hits.length > 0;
  };

  input.addEventListener('input', run);
  input.value = new URLSearchParams(location.search).get('q') || '';
  fetch('/search.json')
    .then((r) => r.json())
    .then(
      (json) => {
        rows = json;
        run();
      },
      () => {
        info.textContent = 'החיפוש לא נטען. נסו לרענן את הדף.';
      },
    );
  input.focus();
  run();
})();
