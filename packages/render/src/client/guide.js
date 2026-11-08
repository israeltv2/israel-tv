// The programme guide page: one day at a time (its tab), what has ended dimmed and what is on marked, a line at
// the present moment (scrolled into view on wide screens), on phones each channel's next few programmes with a
// button for the rest, and a search over every programme. Without the script, every day is listed in full.
(() => {
  const d = document;
  const wrap = d.querySelector('.guide-wrap');
  if (!wrap) return;
  const he = wrap.dataset.lang === 'he';
  const days = [...d.querySelectorAll('.gday')];
  const tabs = [...d.querySelectorAll('.gdays a')];
  const input = d.getElementById('gq');
  const info = d.getElementById('ginfo');
  const results = d.getElementById('gresults');
  const phone = matchMedia('(max-width: 899px)');
  const SHOWN = 6;
  const TZ = 'Asia/Jerusalem';
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const longDay = new Intl.DateTimeFormat(he ? 'he-IL' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: TZ,
  });
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const W = he
    ? {
        today: 'היום',
        tomorrow: 'מחר',
        more: (n) => `עוד ${n} תוכניות`,
        less: 'פחות',
        found: (n) => (n === 1 ? 'נמצאה תוכנית אחת' : `נמצאו ${n} שידורים`),
        none: 'אין שידור קרוב בשם הזה. נסו מילה אחרת מהשם.',
        now: 'עכשיו',
        go: 'צפייה בפרקים קודמים',
        until: 'עד',
      }
    : {
        today: 'Today',
        tomorrow: 'Tomorrow',
        more: (n) => `${n} more`,
        less: 'Fewer',
        found: (n) => (n === 1 ? 'One airing found' : `${n} airings found`),
        none: 'Nothing coming up by that name. Try another word from the title.',
        now: 'Now',
        go: 'Watch earlier episodes',
        until: 'until',
      };

  let active = null;

  const select = (day, scroll) => {
    active = day;
    for (const s of days) s.hidden = s !== day;
    for (const a of tabs) {
      const on = a.dataset.day === day.id.slice(2);
      if (on) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
    tick();
    if (scroll) toNow();
  };

  /** Mark what ended and what is on; on phones keep each channel to its next few. */
  const tick = () => {
    const now = Date.now();
    for (const day of days) {
      const line = day.querySelector('.nowline');
      const from = +day.dataset.from;
      const to = +day.dataset.to;
      const today = from <= now && now < to;
      line.hidden = !today;
      if (today) line.style.setProperty('--s', ((now - from) / 6e4).toFixed(1));
      for (const ch of day.querySelectorAll('.gch')) {
        let upcoming = 0;
        for (const li of ch.querySelectorAll('li[data-s]')) {
          const s = +li.dataset.s;
          const e = +li.dataset.e;
          const past = e <= now;
          li.classList.toggle('past', past);
          li.classList.toggle('now', !past && s <= now);
          li.classList.toggle('cut', !past && upcoming++ >= SHOWN);
        }
        let btn = ch.querySelector('.gmore');
        const cut = ch.querySelectorAll('li.cut').length;
        if (cut && !btn) {
          btn = d.createElement('button');
          btn.type = 'button';
          btn.className = 'gmore btn btn-plain';
          btn.addEventListener('click', () => {
            ch.classList.toggle('open');
            label(ch, btn);
          });
          ch.append(btn);
        }
        if (btn) {
          btn.hidden = !cut;
          label(ch, btn);
        }
      }
    }
  };
  const label = (ch, btn) => {
    btn.textContent = ch.classList.contains('open') ? W.less : W.more(ch.querySelectorAll('li.cut').length);
    btn.setAttribute('aria-expanded', String(ch.classList.contains('open')));
  };

  /** On wide screens, bring the present moment (or the day's start) into view. */
  const toNow = () => {
    if (phone.matches || !active) return;
    const scroller = active.querySelector('.gscroll');
    const line = active.querySelector('.nowline');
    if (!scroller || line.hidden) return;
    const ppm = parseFloat(getComputedStyle(active.querySelector('.ggrid')).getPropertyValue('--ppm')) || 4;
    const x = Math.max(0, +line.style.getPropertyValue('--s') * ppm - 90);
    scroller.scrollLeft = he ? -x : x;
  };

  // Day tabs: the past ones go; today (or the first day to come) is chosen; "today" and "tomorrow" by name.
  const now = Date.now();
  const todayKey = dayKey.format(now);
  const tomorrowKey = dayKey.format(now + 864e5);
  for (const s of days) {
    if (+s.dataset.to <= now) {
      s.remove();
      tabs.find((a) => a.dataset.day === s.id.slice(2))?.remove();
    }
  }
  days.splice(0, days.length, ...d.querySelectorAll('.gday'));
  tabs.splice(0, tabs.length, ...d.querySelectorAll('.gdays a'));
  for (const a of tabs) {
    const s = d.getElementById(`d-${a.dataset.day}`);
    const from = +s.dataset.from;
    const to = +s.dataset.to;
    if (from <= now && now < to) a.textContent = W.today;
    else if (dayKey.format(from + 6 * 36e5) === tomorrowKey && dayKey.format(now) === todayKey)
      a.textContent = W.tomorrow;
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      select(s, true);
      history.replaceState(null, '', `#${s.id}`);
    });
  }
  for (const s of days) s.querySelector('.gday-h').classList.add('sr');
  const hash = decodeURIComponent(location.hash.slice(1));
  const first =
    days.find((s) => s.id === `d-${hash}` || s.id === hash) ||
    days.find((s) => +s.dataset.to > now) ||
    days[0];
  if (first) select(first, true);
  // A link to a channel (/live/guide/#<channel id>): that channel's row on the chosen day.
  if (active && /^iltv_live_/.test(hash)) {
    const row = active.querySelector(`.gch[data-ch="${CSS.escape(hash)}"]`);
    if (row) requestAnimationFrame(() => row.scrollIntoView({ block: 'start' }));
  }
  setInterval(tick, 30000);
  phone.addEventListener?.('change', () => toNow());

  // Search: every programme still to come whose title matches, by day, with its channel and time.
  const { normalize, score, plain } = window.iltvMatch;
  const index = [];
  for (const s of days)
    for (const ch of s.querySelectorAll('.gch'))
      for (const li of ch.querySelectorAll('li[data-s]')) {
        const t = li.querySelector('.pt');
        index.push({
          s: +li.dataset.s,
          e: +li.dataset.e,
          title: plain(t.textContent),
          key: normalize(t.textContent),
          href: t.getAttribute('href'),
          ch: ch.getAttribute('aria-label'),
          chId: ch.dataset.ch,
        });
      }
  // A programme crossing 05:00 is in two days: once is enough.
  const seen = new Set();
  const programmes = index.filter((p) => {
    const k = `${p.chId}|${p.s}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const el = (tag, cls, text) => {
    const e = d.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const search = () => {
    const q = normalize(input.value);
    history.replaceState(
      null,
      '',
      q ? `?q=${encodeURIComponent(input.value)}${location.hash}` : location.pathname + location.hash,
    );
    const nav = d.querySelector('.gdays');
    if (!q) {
      results.hidden = true;
      results.replaceChildren();
      info.textContent = '';
      nav.hidden = false;
      if (active) for (const s of days) s.hidden = s !== active;
      return;
    }
    const at = Date.now();
    const words = q.split(' ');
    const hits = programmes.filter((p) => p.e > at && score(p.key, words)).sort((a, b) => a.s - b.s);
    info.textContent = hits.length ? W.found(hits.length) : W.none;
    nav.hidden = true;
    for (const s of days) s.hidden = true;
    results.hidden = false;
    results.replaceChildren();
    let day = '';
    let ol = null;
    for (const p of hits.slice(0, 150)) {
      const k = dayKey.format(p.s);
      if (k !== day) {
        day = k;
        const name = k === todayKey ? W.today : k === tomorrowKey ? W.tomorrow : longDay.format(p.s);
        results.append(el('h2', 'gres-day', name));
        ol = el('ol', 'airs-list');
        results.append(ol);
      }
      const on = p.s <= at;
      const li = el('li', on ? 'now' : '');
      li.append(
        el(
          'span',
          on ? 'when on-air' : 'when',
          on ? `${W.now} · ${W.until} ${clock.format(p.e)}` : clock.format(p.s),
        ),
      );
      const ch = el('a', 'ch', p.ch);
      ch.href = `#${p.chId}`;
      ch.addEventListener('click', (ev) => {
        ev.preventDefault();
        input.value = '';
        search();
        const target = days.find((s) => +s.dataset.from <= p.s && p.s < +s.dataset.to);
        if (target) select(target, false);
        target?.querySelector(`.gch[data-ch="${CSS.escape(p.chId)}"]`)?.scrollIntoView({ block: 'start' });
      });
      ch.dir = 'auto';
      const t = el('span', 'pt', p.title);
      t.dir = 'auto';
      li.append(ch, t);
      if (p.href) {
        const go = el('a', 'go', W.go);
        go.href = p.href;
        li.append(go);
      }
      ol.append(li);
    }
  };
  input.addEventListener('input', search);
  input.value = new URLSearchParams(location.search).get('q') || '';
  if (input.value) search();
})();
