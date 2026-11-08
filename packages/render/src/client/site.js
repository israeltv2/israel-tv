// The script every public page shares (inlined at the end of the page). The pages read complete without it: it only
// remembers the theme, turns times into "3 hours ago", copies the addon link, fills in install links when the address
// was not known at render time, runs the "on air" ticker and keeps the live guide current.
(() => {
  const d = document;
  const root = d.documentElement;
  const lang = root.lang || 'en';

  // The theme button: dark by default, light on request, remembered in this browser only.
  d.getElementById('theme')?.addEventListener('click', () => {
    // Decide the new theme now and remember that value: the view transition applies it a moment later, so reading
    // it back from the page here would remember the old one (and the next page would open in the other theme).
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    const apply = () => {
      root.dataset.theme = next;
    };
    if (d.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches)
      d.startViewTransition(apply);
    else apply();
    try {
      localStorage.setItem('iltv-theme', next);
    } catch {}
  });

  // Times: "3 hours ago" in the reader's language, the full date on hover.
  const relative = window.Intl?.RelativeTimeFormat
    ? new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
    : null;
  const full = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  const UNITS = [
    [60, 'second', 1],
    [3600, 'minute', 60],
    [86400, 'hour', 3600],
    [2592000, 'day', 86400],
    [Number.POSITIVE_INFINITY, 'month', 2592000],
  ];
  const ago = (t) => {
    const s = (t - Date.now()) / 1000;
    const unit = UNITS.find(([limit]) => Math.abs(s) < limit);
    return relative.format(Math.round(s / unit[2]), unit[1]);
  };
  for (const el of d.querySelectorAll('time[datetime]')) {
    if (el.hasAttribute('data-abs')) continue;
    let t = Date.parse(el.getAttribute('datetime'));
    if (Number.isNaN(t)) continue;
    if (el.hasAttribute('data-daily')) while (t < Date.now()) t += 864e5;
    if (el.hasAttribute('data-future') && t < Date.now()) {
      el.textContent = lang === 'he' ? 'בקרוב' : 'soon';
      continue;
    }
    el.title = full.format(t);
    if (relative) el.textContent = ago(t);
  }

  // Copy buttons: copy the named element's text and say so for a moment.
  for (const btn of d.querySelectorAll('[data-copy]')) {
    btn.addEventListener('click', () => {
      const source = d.getElementById(btn.dataset.copy);
      const label = btn.querySelector('span');
      const done = () => {
        const before = btn.dataset.label || label.textContent;
        btn.dataset.label = before;
        label.textContent = btn.dataset.done;
        setTimeout(() => {
          label.textContent = before;
        }, 1800);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(source.textContent.trim()).then(done, () => {});
      else {
        const range = d.createRange();
        range.selectNodeContents(source);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      }
    });
  }

  // Install links, when the page was rendered without the addon's address.
  const manifest = `${location.origin}/manifest.json`;
  for (const a of d.querySelectorAll('[data-stremio]'))
    if (!a.getAttribute('href').startsWith('stremio://')) a.href = `stremio://${location.host}/manifest.json`;
  for (const a of d.querySelectorAll('[data-stremio-web]'))
    if (!a.href.includes('?addon='))
      a.href = `https://web.stremio.com/#/addons?addon=${encodeURIComponent(manifest)}`;
  for (const el of d.querySelectorAll('[data-origin]'))
    if (el.textContent.startsWith('{{') || !/^https?:/.test(el.textContent)) el.textContent = manifest;

  // The "on air" ticker: a second copy (hidden from screen readers and the keyboard) makes the loop seamless.
  for (const tick of d.querySelectorAll('.tick')) {
    const copy = tick.firstElementChild.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    for (const a of copy.querySelectorAll('a')) a.tabIndex = -1;
    tick.appendChild(copy);
    tick.classList.add('on');
  }

  // The live guide: hide what ended, mark what is on (with its progress), show the next few.
  const air = () => {
    const now = Date.now();
    for (const guide of d.querySelectorAll('[data-guide]')) {
      let shown = 0;
      for (const item of guide.querySelectorAll('[data-s]')) {
        const start = +item.dataset.s;
        const end = +item.dataset.e;
        const ended = end <= now;
        const on = !ended && start <= now;
        item.hidden = ended || shown >= (+guide.dataset.guide || 2);
        item.classList.toggle('now', on);
        if (!item.hidden) shown++;
        if (on) item.style.setProperty('--p', Math.min(1, (now - start) / (end - start)).toFixed(3));
      }
      guide.classList.toggle('empty', !shown);
    }
  };
  air();
  setInterval(air, 30000);
})();
