// "On the air next" from airings.json (the programme guide in short, published with the site): a show page's next
// airings, a line on library tiles of shows airing soon, and upcoming programmes on the search page. Read in the
// browser, so these pages do not change every time the guide does. Nothing is shown until the answer is known.
(() => {
  const d = document;
  const block = d.getElementById('airs');
  const tiles = d.querySelectorAll('a.tile[href^="/show/"]');
  const soon = d.getElementById('soon');
  if (!block && !tiles.length && !soon) return;
  const TZ = 'Asia/Jerusalem';
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const clockFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const hourOf = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' });
  const weekday = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'long' });
  const clock = (ms) => clockFmt.format(ms);
  /** "היום", "הערב", "מחר", "יום שלישי": the day of a moment, as said in Israel. */
  const dayWord = (ms, now) => {
    const days = Math.round((Date.parse(dayKey.format(ms)) - Date.parse(dayKey.format(now))) / 864e5);
    if (days === 0) return +hourOf.format(ms) >= 17 ? 'הערב' : 'היום';
    if (days === 1) return 'מחר';
    return weekday.format(ms);
  };
  const el = (tag, cls, text) => {
    const e = d.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  fetch('/airings.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((data) => {
      const now = Date.now();
      const rows = data.r
        .map(([c, s, e, title, show]) => ({ ch: data.ch[c], s: s * 6e4, e: e * 6e4, title, show }))
        .filter((r) => r.e > now);
      const byShow = new Map();
      for (const r of rows) if (r.show) byShow.set(r.show, [...(byShow.get(r.show) || []), r]);
      const when = (r) => (r.s <= now ? 'עכשיו' : `${dayWord(r.s, now)} ${clock(r.s)}`);

      // A show page: its next airings (three at most).
      if (block) {
        const list = (byShow.get(block.dataset.show) || []).slice(0, 3);
        if (list.length) {
          const ul = block.querySelector('ul');
          for (const r of list) {
            const li = el('li', r.s <= now ? 'now' : '');
            const w = el(
              'span',
              r.s <= now ? 'when on-air' : 'when',
              r.s <= now ? 'עכשיו בשידור' : dayWord(r.s, now),
            );
            const ch = el('a', 'ch', r.ch[1]);
            ch.href = `/live/#${r.ch[0]}`;
            ch.dir = 'auto';
            const extra = el('span', 'pt', r.title);
            extra.dir = 'auto';
            // A time range reads left to right also in a Hebrew line ("21:00–22:00").
            const range = el(
              'span',
              'until',
              r.s <= now ? `עד ${clock(r.e)}` : `${clock(r.s)}–${clock(r.e)}`,
            );
            if (r.s > now) range.dir = 'ltr';
            li.append(w, range, ch, extra);
            ul.append(li);
          }
          block.hidden = false;
        }
      }

      // Library tiles: "הערב 21:00 · קשת 12" under a show airing in the next two days.
      for (const a of tiles) {
        const id = a.getAttribute('href').split('/')[2];
        const next = (byShow.get(id) || [])[0];
        if (!next || next.s - now > 2 * 864e5) continue;
        const line = el('span', next.s <= now ? 'air on' : 'air', `${when(next)} · ${next.ch[1]}`);
        a.append(line);
      }

      // The search page: upcoming programmes whose title matches, grouped by day.
      if (soon) {
        const { normalize, score } = window.iltvMatch;
        const input = d.getElementById('q');
        const list = soon.querySelector('.soon-list');
        const more = soon.querySelector('.soon-more');
        const keyed = rows.map((r) => [normalize(r.title), r]);
        const run = () => {
          const q = normalize(input.value);
          if (!q) {
            soon.hidden = true;
            return;
          }
          const words = q.split(' ');
          const hits = keyed.filter(([k]) => score(k, words)).map(([, r]) => r);
          soon.hidden = hits.length === 0;
          list.replaceChildren();
          let day = '';
          let ol = null;
          for (const r of hits.slice(0, 30)) {
            const w = r.s <= now ? 'עכשיו' : dayWord(r.s, now);
            const label = w === 'הערב' ? 'היום' : w;
            if (label !== day) {
              day = label;
              list.append(el('h3', '', label));
              ol = el('ol', 'airs-list');
              list.append(ol);
            }
            const li = el('li', r.s <= now ? 'now' : '');
            li.append(el('span', 'when', r.s <= now ? `עד ${clock(r.e)}` : clock(r.s)));
            const ch = el('a', 'ch', r.ch[1]);
            ch.href = `/live/#${r.ch[0]}`;
            ch.dir = 'auto';
            const t = el('span', 'pt', r.title);
            t.dir = 'auto';
            li.append(ch, t);
            if (r.show) {
              const go = el('a', 'go', 'צפייה בפרקים קודמים');
              go.href = `/show/${r.show}/`;
              li.append(go);
            }
            ol.append(li);
          }
          more.href = `/live/guide/?q=${encodeURIComponent(input.value)}`;
        };
        input.addEventListener('input', run);
        run();
      }
    })
    .catch(() => {});
})();
