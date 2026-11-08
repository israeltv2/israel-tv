// The public status page, in English (/status) and Hebrew (/he/status): for viewers first, in plain words — is
// everything working, and what does it mean for watching — then a card per row, the live channels and, folded away,
// the details contributors need. Rendered from the status file alone (the same data as /status.json), pre-rendered; a
// few lines of script only make the times relative. Every sentence is worded here from the status fields and the
// notes' codes (status-words.ts), in either language; nothing is translated from the run's English text.

import { type Health, type StatusCatalog, type StatusFile, sitePaths } from '@israel-tv/core';
import { style } from './assets.ts';
import { type Child, type Html, html, join, raw } from './html.ts';
import { fillChip } from './library-html.ts';
import { CATALOG_MARK, catalogAppName, catalogName, sourceName } from './names.ts';
import {
  absolute,
  bdi,
  externalLinks,
  footer,
  head,
  israelTime,
  type Lang,
  logoTile,
  num,
  siteNav,
  topBar,
  when,
} from './page.ts';
import { type PublicTextOptions, publicStatus } from './public-text.ts';
import {
  asEnglish,
  auditCheck,
  enCount,
  heCount,
  noteText,
  publishText,
  tmdbText,
  viewerNotes,
  warningHe,
  warningWord,
} from './status-words.ts';

export type Level = Health | 'info';
type Source = StatusFile['sources'][number];

/** Names in a sentence: "A, B and C" / "א, ב ו-ג". */
const list = (names: string[], lang: Lang = 'en') =>
  lang === 'he'
    ? new Intl.ListFormat('he', { type: 'conjunction' }).format(names)
    : names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** Kan's archive is a long back catalogue read last: still filling is expected there, not a problem. */
const LATER = new Set(['iltv_kanarchive']);

/** How one row stands, in a word and a sentence. */
export function rowState(
  c: StatusCatalog,
  s: Source | undefined,
  status: StatusFile,
  lang: Lang = 'en',
): { level: Level; label: string; line: string } {
  const he = lang === 'he';
  if (c.source === 'live') {
    const ch = status.live?.channels ?? [];
    const down = ch.filter((x) => x.state === 'down');
    const checked = ch.filter((x) => x.state !== 'unchecked');
    if (s?.health === 'error' && down.length === 0)
      return he
        ? {
            level: 'error',
            label: 'לא נבדק לאחרונה',
            line: 'הבדיקה היומית של הערוצים בשידור חי לא רצה לאחרונה. בדרך כלל הם מתנגנים בכל זאת.',
          }
        : {
            level: 'error',
            label: 'Not checked lately',
            line: 'The daily check of the live channels has not run lately. They usually play anyway.',
          };
    if (checked.length > 0 && down.length === checked.length)
      return he
        ? { level: 'error', label: 'לא מתנגנים', line: 'אף ערוץ בשידור חי לא התנגן בבדיקה האחרונה.' }
        : {
            level: 'error',
            label: 'Not playing',
            line: 'None of the live channels played in the last check.',
          };
    if (down.length)
      return he
        ? {
            level: 'warn',
            label: down.length === 1 ? 'ערוץ אחד לא מתנגן' : `${num(down.length, 'he')} לא מתנגנים`,
            line: `${num(checked.length - down.length, 'he')} מתוך ${num(checked.length, 'he')} הערוצים שנבדקו התנגנו בבדיקה האחרונה.`,
          }
        : {
            level: 'warn',
            label: `${down.length} not playing`,
            line: `${checked.length - down.length} of ${checked.length} checked channels played in the last check.`,
          };
    return he
      ? {
          level: 'ok',
          label: 'מתנגנים',
          line: checked.length
            ? `כל ${num(checked.length, 'he')} הערוצים שנבדקו התנגנו בבדיקה האחרונה.`
            : 'כל שידור חי מנוגן פעם ביום, כדי לוודא שהוא עובד.',
        }
      : {
          level: 'ok',
          label: 'Playing',
          line: checked.length
            ? `All ${checked.length} checked channels played in the last check.`
            : 'Every live stream is played once a day to make sure it works.',
        };
  }
  if (!s)
    return he
      ? { level: 'info', label: 'כבוי', line: 'השרת הזה לא קורא את הערוץ הזה.' }
      : { level: 'info', label: 'Off', line: 'This instance does not read this channel.' };
  if (s.health === 'error')
    return he
      ? {
          level: 'error',
          label: 'לא מתעדכן',
          line: 'הקריאה מאתר הערוץ נכשלת. כל מה שכבר כאן ממשיך להתנגן, אבל ייתכן שהפרקים החדשים ביותר יחסרו עד שזה יתוקן.',
        }
      : {
          level: 'error',
          label: 'Not refreshing',
          line: 'Reading the channel’s site is failing. Everything already here still plays; the newest episodes may be missing until it is fixed.',
        };
  if (c.filling)
    return he
      ? {
          level: LATER.has(c.id) ? 'info' : 'warn',
          label: 'עדיין מתמלא',
          line:
            c.filling.inCatalog > 0
              ? `${num(c.filling.inCatalog, 'he')} מתוך ${num(c.filling.known, 'he')} התוכניות כבר כאן, והשאר יגיעו בימים הקרובים. התוכניות שכבר כאן מתנגנות כרגיל.`
              : `השורה מתחילה להתמלא: ${num(c.filling.known, 'he')} תוכניות יגיעו בימים הקרובים.`,
        }
      : {
          level: LATER.has(c.id) ? 'info' : 'warn',
          label: 'Still filling',
          line: `${num(c.filling.inCatalog)} of ${num(c.filling.known)} shows are in so far; the rest arrive over the next days.${c.filling.inCatalog > 0 ? ' Shows already here play normally.' : ''}`,
        };
  // A Kan row whose source is amber only because another Kan row is still filling is fine.
  const fillingElsewhere =
    s.source === 'kan' && (status.catalogs ?? []).some((x) => x.source === 'kan' && x.filling);
  // A read that failed outright but is retried soon (Kan's slices: a bot check, the browser not starting).
  if (s.health === 'warn' && s.lastFullRun?.status === 'failed')
    return he
      ? {
          level: 'warn',
          label: 'מושהה',
          line: `הקריאה ${s.source === 'kan' ? 'מהאתר של כאן' : 'מאתר הערוץ'} מושהית כרגע, וננסה שוב בקרוב. כל מה שכבר כאן מתנגן.`,
        }
      : {
          level: 'warn',
          label: 'Paused',
          line: `Reading ${s.source === 'kan' ? 'Kan’s' : 'the channel’s'} site is paused for now and is tried again shortly. Everything here still plays.`,
        };
  if (s.health === 'warn' && !fillingElsewhere)
    return he
      ? {
          level: 'warn',
          label: 'עודכן חלקית',
          line: 'בעדכון האחרון חלק מהתוכניות לא נקראו, וננסה שוב. כל מה שכבר כאן מתנגן.',
        }
      : {
          level: 'warn',
          label: 'Partly refreshed',
          line: 'The last refresh missed some shows; they are tried again. Everything here still plays.',
        };
  return he
    ? {
        level: 'ok',
        label: 'מעודכן',
        line:
          c.source === 'mako'
            ? 'התוכניות והפרקים מעודכנים. הפרקים מתנגנים דרך העוזר הביתי שלכם.'
            : 'התוכניות והפרקים מעודכנים.',
      }
    : {
        level: 'ok',
        label: 'Up to date',
        line:
          c.source === 'mako'
            ? 'Shows and episodes are up to date. Episodes play through your own home helper.'
            : 'Shows and episodes are up to date.',
      };
}

export interface Overall {
  level: Level;
  title: string;
  detail: string;
}

/** The one line at the top: is everything working, and what it means for watching. */
export function overall(raw: StatusFile, lang: Lang = 'en'): Overall {
  const he = lang === 'he';
  const status = raw;
  const bySource = new Map(status.sources.map((s) => [s.source, s]));
  const rows = (status.catalogs ?? []).map((c) => ({ c, st: rowState(c, bySource.get(c.source), status) }));
  const down = (status.live?.channels ?? []).filter((x) => x.state === 'down');
  const liveLine = !down.length
    ? ''
    : he
      ? ` ${down.length === 1 ? 'ערוץ אחד בשידור חי לא מתנגן' : `${num(down.length, 'he')} ערוצים בשידור חי לא מתנגנים`} כרגע.`
      : ` ${down.length === 1 ? 'One live channel is' : `${down.length} live channels are`} not playing right now.`;
  const names = (sources: string[]) => list([...new Set(sources.map((s) => sourceName(s, lang)))], lang);
  if (status.publish)
    return he
      ? {
          level: 'error',
          title: 'הקטלוג לא מתעדכן כרגע',
          detail: `כל מה שכבר נמצא בו ממשיך להתנגן. פרקים חדשים יופיעו כשהעדכון יחזור לעבוד.${liveLine}`,
        }
      : {
          level: 'error',
          title: 'The catalog is not being updated right now',
          detail: `Everything already in it still plays. New episodes will show up once updating works again.${liveLine}`,
        };
  const failing = [
    ...new Set(
      rows.length
        ? rows.filter((r) => r.st.level === 'error' && r.c.source !== 'live').map((r) => r.c.source)
        : status.sources.filter((s) => s.health === 'error' && s.source !== 'live').map((s) => s.source),
    ),
  ];
  if (failing.length)
    return he
      ? {
          level: 'error',
          title: `העדכונים של ${names(failing)} נעצרו`,
          detail: `התוכניות שכבר בקטלוג ממשיכות להתנגן, אבל ייתכן שהפרקים החדשים ביותר יחסרו עד שזה יתוקן.${liveLine}`,
        }
      : {
          level: 'error',
          title: `${names(failing)} ${failing.length === 1 ? 'is' : 'are'} not being refreshed`,
          detail: `Shows already in the catalog still play; the newest episodes may be missing until it is fixed.${liveLine}`,
        };
  const filling = rows.filter((r) => r.c.filling && !LATER.has(r.c.id));
  const warn = rows.filter((r) => r.st.level === 'warn' && !r.c.filling);
  if (warn.length || down.length || (!rows.length && status.health === 'warn' && !filling.length)) {
    const missed = warn.filter((r) => r.c.source !== 'live').map((r) => r.c.source);
    return he
      ? {
          level: 'warn',
          title: 'כמעט הכול עובד',
          detail: `אפשר לצפות כרגיל.${missed.length ? ` בעדכון האחרון של ${names(missed)} חסרו כמה תוכניות, וננסה שוב.` : ''}${liveLine}`,
        }
      : {
          level: 'warn',
          title: 'Mostly working',
          detail: `You can watch as usual.${missed.length ? ` The last refresh of ${names(missed)} missed a few shows; they are tried again.` : ''}${liveLine}`,
        };
  }
  if (filling.length)
    return he
      ? {
          level: 'info',
          title: `התוכניות של ${names(filling.map((r) => r.c.source))} עדיין נכנסות`,
          detail: 'כל השאר מעודכן. שורה חדשה מתמלאת במשך כמה ימים, והתוכניות שכבר נמצאות בה מתנגנות כרגיל.',
        }
      : {
          level: 'info',
          title: `${names(filling.map((r) => r.c.source))} shows are still being added`,
          detail:
            'Everything else is up to date. A new row fills over a few days; the shows already in it play normally.',
        };
  return he
    ? { level: 'ok', title: 'הכול עובד', detail: 'כל הערוצים מעודכנים, והשידורים החיים מתנגנים.' }
    : {
        level: 'ok',
        title: 'Everything is working',
        detail: 'All channels are up to date and the live channels are playing.',
      };
}

/** The page's own words that do not depend on the data. */
const WORDS = {
  en: {
    day: { ok: 'all good', warn: 'some problems', error: 'failed', none: 'no refresh' },
    legend: ['All good', 'Some problems', 'Failed', 'No refresh', 'One bar per day'],
    channels: 'Channels',
    lastChecked: 'Last checked',
    shows: 'Shows',
    episodes: 'Episodes',
    lastRead: 'Last read',
    lastFull: 'Last full refresh',
    runningNow: 'running now',
    airingChecked: 'New episodes checked',
    kanPace: 'A few pages at a time, all day long.',
    live: { up: 'Playing', down: 'Not playing', unchecked: 'Not checked' },
    liveH: 'Live channels',
    helperTag: 'home helper',
    israelOnly: 'Israel only',
    detailsH: 'Details for contributors',
  },
  he: {
    day: { ok: 'הכול תקין', warn: 'היו בעיות', error: 'נכשל', none: 'לא היה עדכון' },
    legend: ['הכול תקין', 'היו בעיות', 'נכשל', 'לא היה עדכון', 'פס אחד לכל יום'],
    channels: 'ערוצים',
    lastChecked: 'נבדקו לאחרונה',
    shows: 'תוכניות',
    episodes: 'פרקים',
    lastRead: 'נקרא לאחרונה',
    lastFull: 'עדכון מלא אחרון',
    runningNow: 'רץ עכשיו',
    airingChecked: 'בדיקת פרקים חדשים',
    kanPace: 'כמה דפים בכל פעם, לאורך כל היום.',
    live: { up: 'מתנגן', down: 'לא מתנגן', unchecked: 'לא נבדק' },
    liveH: 'ערוצים בשידור חי',
    helperTag: 'עוזר ביתי',
    israelOnly: 'רק בישראל',
    detailsH: 'פרטים למי שעוזר לתקן',
  },
} as const;

function historyBar(days: string[], values: (Health | null)[] | undefined, lang: Lang): Child {
  if (!values?.length) return '';
  const he = lang === 'he';
  const w = WORDS[lang];
  const count = (h: Health | null) => values.filter((v) => v === h).length;
  const label = he
    ? `${num(values.length, 'he')} הימים האחרונים: ${num(count('ok'), 'he')} תקינים, ${num(count('warn'), 'he')} עם בעיות, ${num(count('error'), 'he')} נכשלו, ${num(count(null), 'he')} בלי עדכון`
    : `Last ${values.length} days: ${count('ok')} good, ${count('warn')} with problems, ${count('error')} failed, ${count(null)} without a refresh`;
  const dayFormat = new Intl.DateTimeFormat(he ? 'he-IL' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const dayLabel = (d: string) => dayFormat.format(Date.parse(`${d}T12:00:00Z`));
  const fine = values.length - count(null);
  return html`<div class="hist-wrap"><div class="hist" role="img" aria-label="${label}">${values.map(
    (v, i) =>
      html`<span class="d ${v ?? 'none'}" title="${`${dayLabel(days[i] ?? '')}: ${w.day[v ?? 'none']}`}"></span>`,
  )}</div><div class="hist-legend small muted">${
    he
      ? html`<span>לפני ${num(values.length, 'he')} ימים</span><span>${num(count('ok'), 'he')} מתוך ${num(fine, 'he')} ימים תקינים</span><span>היום</span>`
      : html`<span>${values.length} days ago</span><span>${count('ok')} of ${fine} days fine</span><span>Today</span>`
  }</div></div>`;
}

function card(c: StatusCatalog, status: StatusFile, logos: boolean, lang: Lang): Html {
  const he = lang === 'he';
  const w = WORDS[lang];
  const s = status.sources.find((x) => x.source === c.source);
  const st = rowState(c, s, status, lang);
  const live = c.source === 'live';
  // The live row has no single channel: the site's own icon, in the same tile.
  const tile = live
    ? html`<span class="logo-tile" style="--s:44px"><img src="/${sitePaths.faviconSvg}" alt="" width="44" height="44"></span>`
    : logos
      ? logoTile(CATALOG_MARK[c.id], 44)
      : '';
  const sched = status.schedule;
  const facts: Html[] = [];
  if (live) {
    const ch = status.live?.channels ?? [];
    facts.push(html`<li><span>${w.channels}</span><strong>${num(ch.length || c.shows, lang)}</strong></li>`);
    if (status.live) facts.push(html`<li><span>${w.lastChecked}</span>${when(status.live.at, lang)}</li>`);
  } else {
    facts.push(
      c.filling && c.shows === 0
        ? html`<li class="wide">${fillChip(c.filling, lang)}</li>`
        : html`<li><span>${w.shows}</span><strong>${num(c.shows, lang)}</strong></li><li><span>${w.episodes}</span><strong>${num(c.episodes, lang)}</strong></li>`,
    );
    const last = s?.lastFullRun;
    if (last)
      facts.push(
        html`<li><span>${c.source === 'kan' ? w.lastRead : w.lastFull}</span>${
          last.status === 'running' && c.source !== 'kan' ? w.runningNow : when(last.at, lang)
        }</li>`,
      );
    if (s?.lastAiringRun)
      facts.push(html`<li><span>${w.airingChecked}</span>${when(s.lastAiringRun.at, lang)}</li>`);
  }
  // Notes a viewer can use as they are (plain words, no ids): Kan's bot check, episodes Kan no longer offers.
  const said = viewerNotes(s, lang);
  let next: Child = '';
  if (c.source === 'kan') next = w.kanPace;
  else if (sched?.nextFullRun) {
    const at = sched.fullRunTime ?? israelTime(sched.nextFullRun, lang);
    const perDay = sched.airingChecksPerDay ?? 0;
    const time = html`<time datetime="${sched.nextFullRun}" data-daily data-future>${he ? `ב-${at} שעון ישראל` : `at ${at} Israel time`}</time>`;
    next = he
      ? html`${live ? 'הבדיקה הבאה' : 'העדכון המלא הבא'} ${time}${
          !live && perDay
            ? `. תוכניות שמשודרות עכשיו נבדקות לפרקים חדשים ${perDay >= 24 ? 'בערך פעם בשעה, ובערב לעתים קרובות יותר' : `${heCount(perDay, 'פעם אחת', 'פעמים')} ביום`}.`
            : '.'
        }`
      : html`${live ? 'Next check' : 'Next full refresh'} ${time}${
          !live && perDay
            ? `; shows on the air are checked for new episodes about ${perDay >= 24 ? 'every hour, more often in the evening' : `${perDay} times a day`}.`
            : '.'
        }`;
  }
  return html`<article class="card row-card" aria-labelledby="row-${c.id}">
<div class="row-head">${tile}
<div class="row-title"><h3 id="row-${c.id}">${catalogName(c.id, lang)}</h3>${
    he ? '' : html`<span class="muted small"><bdi lang="he" dir="rtl">${catalogAppName(c.id)}</bdi></span>`
  }</div>
<span class="pill ${st.level}">${st.label}</span></div>
<p class="row-line">${st.line}</p>
<ul class="facts">${facts}</ul>
${next ? html`<p class="small muted next">${next}</p>` : ''}
${said.length ? html`<ul class="small muted said">${said.map((n) => html`<li>${n}</li>`)}</ul>` : ''}
${historyBar(status.history?.days ?? [], status.history?.sources[c.source], lang)}
</article>`;
}

function liveGrid(status: StatusFile, logos: boolean, lang: Lang): Child {
  const live = status.live;
  if (!live?.channels.length) return '';
  const he = lang === 'he';
  const w = WORDS[lang];
  const cls = { up: 'ok', down: 'error', unchecked: 'info' } as const;
  return html`<section aria-labelledby="live-h" class="live"><div class="wrap">
<h2 id="live-h">${w.liveH}</h2>
<p class="muted">${
    he
      ? html`כל שידור חי מנוגן פעם ביום. הבדיקה האחרונה: ${when(live.at, 'he')}${live.abroad ? ', מחוץ לישראל' : ''}. ערוצים שמסומנים <strong>${w.helperTag}</strong> מתנגנים רק דרך <a href="/he/#helper">העוזר הביתי</a> שלכם.`
      : html`Every live stream is played once a day. Last check: ${when(live.at)}${live.abroad ? ', from outside Israel' : ''}. Channels marked <strong>${w.helperTag}</strong> play only through your own <a href="/#helper">home helper</a>.`
  }</p>
<ul class="channels">${live.channels.map(
    (ch) => html`<li class="ch">${logoTile(logos ? { logo: ch.id } : undefined, 40)}
<span class="ch-name">${bdi(ch.name)}${ch.helper ? html`<span class="tag">${w.helperTag}</span>` : ''}${ch.israelOnly ? html`<span class="tag">${w.israelOnly}</span>` : ''}</span>
<span class="pill ${cls[ch.state]}">${w.live[ch.state]}</span></li>`,
  )}</ul></div></section>`;
}

function detailsBlock(summary: Child, body: Child, open = false): Html {
  return html`<details${open ? raw(' open') : ''}><summary>${summary}</summary><div class="body">${body}</div></details>`;
}

/**
 * An English line that quotes Hebrew (a show's or an episode's title): each Hebrew run is isolated, so its words and
 * the punctuation around it keep their places ("\"פרק 4\" collides", not "\"4 פרק\" collides").
 */
function mixed(text: string): Html {
  const parts = text.split(/([֐-׿][֐-׿0-9 ׳״'\-–.,!?]*[֐-׿0-9]|[֐-׿])/);
  return html`${parts.map((part, i) => (i % 2 ? html`<bdi dir="rtl">${part}</bdi>` : part))}`;
}

/** Warnings listed per kind on the page; status.json has them all. */
const WARNINGS_SHOWN = 10;

/** A series id in a warning, linked to its page (contributors can see the show it is about). */
const showLink = (id: string) =>
  /^iltv_[a-z]+_\d+$/.test(id)
    ? html`<a href="/show/${id}/"><code>${id}</code></a>`
    : html`<code>${id}</code>`;

/** A warning's text: in English its message; in Hebrew worded from its values, else the message marked as English. */
function warningLine(w: StatusFile['warnings'][number], lang: Lang): Html {
  if (lang === 'he') {
    const said = warningHe(w);
    if (said !== undefined) return html`<span>${said}</span>`;
    return html`<span dir="ltr" lang="en" class="en-text">${mixed(w.message)}</span>`;
  }
  return html`<span dir="ltr">${mixed(w.message)}</span>`;
}

/** The details contributors need, each folded away, all worded from the status fields. */
function contributorDetails(status: StatusFile, lang: Lang): Html[] {
  const he = lang === 'he';
  const parts: Html[] = [];
  const name = (src: string) => sourceName(src, lang);
  const rowLabel = (c: StatusCatalog) =>
    he
      ? html`${catalogName(c.id, 'he')}`
      : html`${catalogName(c.id, 'en')} <bdi lang="he" dir="rtl" class="muted">${catalogAppName(c.id)}</bdi>`;
  const publish = publishText(status, lang);
  const tmdb = tmdbText(status, lang);
  if (publish || tmdb)
    parts.push(
      detailsBlock(
        he ? 'פרסום והתאמה ל-TMDB' : 'Publishing and matching',
        html`<ul>${publish ? html`<li>${publish}</li>` : ''}${tmdb ? html`<li>${tmdb}</li>` : ''}</ul>`,
        true,
      ),
    );
  const filling = (status.catalogs ?? []).filter((c) => c.filling);
  if (filling.length)
    parts.push(
      detailsBlock(
        html`${he ? 'שורות שעדיין נטענות' : 'Rows still loading'} <span class="count">${filling.length}</span>`,
        html`<p class="small muted">${
          he
            ? 'שורה חדשה נקראת כמה דפים בכל פעם, והתוכניות שלה מתנגנות מהרגע שהן נכנסות.'
            : 'A new row is read a few pages at a time; its shows play as soon as they are in.'
        }</p><ul class="progress">${filling.map((c) => {
          const f = c.filling as NonNullable<StatusCatalog['filling']>;
          const pct = f.known ? Math.min(100, Math.round((f.inCatalog / f.known) * 100)) : 0;
          const text = he
            ? html`${num(f.inCatalog, 'he')} מתוך ${num(f.known, 'he')} תוכניות${
                f.pagesToRead ? html`, עוד ${num(f.pagesToRead, 'he')} דפי פרקים לקריאה` : ''
              }`
            : html`${num(f.inCatalog)} of ${num(f.known)} shows${
                f.pagesToRead ? html`, ${num(f.pagesToRead)} episode pages to go` : ''
              }`;
          const aria = he
            ? `${catalogName(c.id, 'he')}: ${f.inCatalog} מתוך ${f.known} תוכניות`
            : `${catalogName(c.id, 'en')}: ${f.inCatalog} of ${f.known} shows`;
          return html`<li><span class="p-name">${rowLabel(c)}</span><span class="p-text">${text}</span><span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${f.known}" aria-valuenow="${f.inCatalog}" aria-label="${aria}"><i style="width:${pct}%"></i></span></li>`;
        })}</ul>`,
      ),
    );
  parts.push(
    detailsBlock(
      html`${he ? 'תוכניות שלא הצלחנו לעדכן' : 'Shows that could not be refreshed'} <span class="count">${status.failingShows.length}</span>`,
      status.failingShows.length
        ? html`<p class="small muted">${
            he
              ? 'הפרקים מהקריאה המוצלחת האחרונה שלהן עדיין בקטלוג.'
              : 'Their last good episodes are still in the catalog.'
          }</p><div class="table-scroll"><table><thead><tr><th>${he ? 'תוכנית' : 'Show'}</th><th>${he ? 'הבעיה' : 'Problem'}</th><th>${he ? 'קריאה מוצלחת אחרונה' : 'Last good read'}</th></tr></thead><tbody>${status.failingShows.map(
            (f) =>
              html`<tr><td>${bdi(f.title)}</td><td>${asEnglish(f.error, lang)}</td><td>${when(f.lastOkAt, lang)}</td></tr>`,
          )}</tbody></table></div>`
        : html`<p class="muted">${he ? 'אין. כל התוכניות נקראו בעדכון האחרון שלהן.' : 'None: every show was read in its last refresh.'}</p>`,
    ),
  );
  // Runs that did not finish cleanly, pages a site lists that are not played, and the notes said nowhere else.
  const runs = status.sources.flatMap((s) => {
    const lines: Html[] = [];
    const who = html`<strong>${name(s.source)}:</strong>`;
    const r = s.lastFullRun;
    if (r && r.status !== 'ok' && r.status !== 'running')
      lines.push(
        he
          ? html`<li>${who} הקריאה המלאה האחרונה ${r.status === 'partial' ? 'הסתיימה בלי חלק מהתוכניות' : 'נכשלה'}${r.error ? html` (<span class="muted">${asEnglish(r.error, lang)}</span>)` : ''}.</li>`
          : html`<li>${who} the last full read ${r.status === 'partial' ? 'finished with some shows missing' : 'failed'}${r.error ? html` (<span class="muted">${r.error}</span>)` : ''}.</li>`,
      );
    if (s.skipped?.notVideo)
      lines.push(
        he
          ? html`<li>${who} ${num(s.skipped.notVideo, 'he')} דפים שמופיעים ברשימת הפרקים הם כתבות או פרומואים בלי וידאו, ולכן מדלגים עליהם.</li>`
          : html`<li>${who} ${num(s.skipped.notVideo)} pages listed among the episodes are articles or promos without video, and are skipped.</li>`,
      );
    for (const n of viewerNotes(s, lang)) lines.push(html`<li>${who} ${n}</li>`);
    (s.noteCodes ?? []).forEach((note, i) => {
      const said = noteText(note, s.notes[i], lang);
      if (said !== undefined) lines.push(html`<li>${who} ${said}</li>`);
    });
    return lines;
  });
  if (runs.length)
    parts.push(
      detailsBlock(he ? 'מהריצות האחרונות' : 'From the last runs', html`<ul class="runs">${runs}</ul>`),
    );
  const blocked = status.sources.filter(
    (s) => s.blocked && (s.blocked.pending.length || s.blocked.recovered.length),
  );
  if (blocked.length)
    parts.push(
      detailsBlock(
        he ? 'נחסמו על ידי הגנה מפני בוטים' : 'Refused by a site’s bot protection',
        blocked.map((s) => {
          const b = s.blocked as NonNullable<Source['blocked']>;
          const waiting = b.pending.length
            ? html`${he ? 'עדיין ממתינות' : 'Still waiting'} (${b.pending.length}): ${join(b.pending.map(bdi), ', ')}${he ? '.' : ''}`
            : he
              ? 'אין תוכניות שממתינות.'
              : 'Nothing waiting.';
          return html`<h3>${name(s.source)}</h3><p>${waiting}${
            b.nextAt
              ? he
                ? html` הניסיון הבא ${when(b.nextAt, 'he', { future: true })}.`
                : html` Next try ${when(b.nextAt, 'en', { future: true })}.`
              : ''
          }</p>${b.recovered.length ? html`<p class="small muted">${he ? 'נקראו בניסיון חוזר' : 'Read on a retry'}: ${join(b.recovered.map(bdi), ', ')}</p>` : ''}`;
        }),
      ),
    );
  const empty = status.sources.filter((s) => s.emptyShows?.length);
  if (empty.length)
    parts.push(
      detailsBlock(
        html`${he ? 'מופיעות באתר הערוץ בלי שום דבר לצפייה' : 'Listed by a channel with nothing to watch'} <span class="count">${empty.reduce((n, s) => n + (s.emptyShows?.length ?? 0), 0)}</span>`,
        html`<p class="small muted">${
          he
            ? 'אתר הערוץ מציג אותן, אבל אין בהן פרקים לצפייה. הן יישארו מחוץ לקטלוג עד שיהיו.'
            : 'The channel’s site lists these, but has no episodes to play; they stay out of the catalog until it does.'
        }</p>${empty.map(
          (s) =>
            html`<h3>${name(s.source)} <span class="count">${s.emptyShows?.length ?? 0}</span></h3><ul class="name-chips">${(s.emptyShows ?? []).map((t) => html`<li dir="auto">${t}</li>`)}</ul>`,
        )}`,
      ),
    );
  const a = status.audit;
  parts.push(
    detailsBlock(
      he ? 'בדיקת הקטלוג' : 'Catalog check',
      a
        ? html`<p>${
            he
              ? html`${heCount(a.metas, 'תוכנית אחת נבדקה', 'תוכניות נבדקו')} ${when(a.at, 'he')}: ${a.problems.length ? `${heCount(a.problems.length, 'סוג אחד של בעיה', 'סוגים של בעיות')}.` : 'לא נמצאו בעיות.'}`
              : html`${num(a.metas)} shows checked ${when(a.at)}: ${a.problems.length ? `${enCount(a.problems.length, 'kind', 'kinds')} of problem.` : 'no problems.'}`
          }</p>${
            a.problems.length
              ? html`<div class="table-scroll"><table><thead><tr><th>${he ? 'בדיקה' : 'Check'}</th><th>${he ? 'כמה' : 'Count'}</th><th>${he ? 'דוגמאות' : 'Examples'}</th></tr></thead><tbody>${a.problems.map(
                  (p) =>
                    html`<tr><td>${auditCheck(p.check, lang)}</td><td>${num(p.count, lang)}</td><td>${join(
                      p.examples.map((x) => html`<code>${x}</code>`),
                      ' ',
                    )}</td></tr>`,
                )}</tbody></table></div>`
              : ''
          }${
            a.gaps?.length
              ? html`<h3>Show details the sources do not give</h3><p class="small muted">Shows published without genres, a description or a year line. They are filled only from the channel’s own pages and, for shows matched to TMDB, from TMDB; never made up.</p><div class="table-scroll"><table><thead><tr><th>Source</th><th>Shows</th><th>No genres</th><th>No description</th><th>No year</th></tr></thead><tbody>${a.gaps.map(
                  (g) =>
                    html`<tr><td>${name(g.source)}</td><td>${num(g.shows)}</td><td>${num(g.noGenre)}</td><td>${num(g.noDescription)}</td><td>${num(g.noYear)}</td></tr>`,
                )}</tbody></table></div>`
              : ''
          }`
        : html`<p class="muted">${he ? 'עוד לא רצה.' : 'Not run yet.'}</p>`,
    ),
  );
  const groups = new Map<string, StatusFile['warnings']>();
  for (const w of status.warnings) groups.set(w.code, [...(groups.get(w.code) ?? []), w]);
  parts.push(
    detailsBlock(
      html`${he ? 'אזהרות אחרונות' : 'Recent warnings'} <span class="count">${status.warnings.length}</span>`,
      status.warnings.length
        ? html`<p class="small muted">${
            he
              ? 'כפי שהמפרסם רשם אותן, מהחדשה לישנה, לפי סוג.'
              : 'As the publisher logged them, newest first, grouped by kind.'
          }</p>${[...groups].map(
            ([code, ws]) =>
              html`<details class="inner"><summary>${warningWord(code, lang)} <span class="count">${ws.length}</span></summary><div class="body"><ul class="warn-list">${ws
                .slice(0, WARNINGS_SHOWN)
                .map(
                  (w) =>
                    html`<li><span class="small muted">${when(w.at, lang)}${w.id ? html` · ${showLink(w.id)}` : ''}</span><br>${warningLine(w, lang)}</li>`,
                )}</ul>${
                ws.length > WARNINGS_SHOWN
                  ? he
                    ? html`<p class="small muted">ועוד ${num(ws.length - WARNINGS_SHOWN, 'he')} מהסוג הזה, ב-<a href="/${sitePaths.status}">status.json</a>.</p>`
                    : html`<p class="small muted">And ${num(ws.length - WARNINGS_SHOWN)} more of this kind, in <a href="/${sitePaths.status}">status.json</a>.</p>`
                  : ''
              }</div></details>`,
          )}`
        : html`<p class="muted">${he ? 'אין.' : 'None.'}</p>`,
    ),
  );
  return parts;
}

const STATUS_CSS = style('status.css');

const LEVEL_ICON: Record<Level, string> = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 7v6M12 17h.01"/><circle cx="12" cy="12" r="9.5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

/** The rows to show: the status file's own, or (an older file without them) one per source. */
function rowsOf(status: StatusFile): StatusCatalog[] {
  if (status.catalogs?.length) return status.catalogs;
  return status.sources.map((s) => ({
    id: s.source === 'live' ? 'iltv_live' : s.source,
    name: sourceName(s.source),
    source: s.source,
    shows: s.shows,
    episodes: s.episodes,
  }));
}

/** The status page's address in each language (the language switch, hreflang, the sitemap). */
export const STATUS_PATHS: Record<Lang, string> = { en: 'status', he: 'he/status' };

/** The public status page, in English or Hebrew. */
export function renderStatusHtml(file: StatusFile, opts: PublicTextOptions = {}, lang: Lang = 'en'): string {
  const he = lang === 'he';
  const status = publicStatus(file, opts);
  const o = overall(status, lang);
  // The channel tiles are published with the live row.
  const logos = !!status.live;
  const rows = rowsOf(status);
  const w = WORDS[lang];
  const title = he ? 'מצב השירות של Israel TV: הכול עובד?' : 'Israel TV status: is everything working?';
  const description = he
    ? `${o.title}. המצב העדכני של Israel TV, התוסף החינמי ל-Stremio ול-Nuvio לקשת 12, רשת 13, כאן ולערוצים ישראליים בשידור חי: מה מעודכן, מה מתנגן, ואיך היו 30 הימים האחרונים.`
    : `${o.title}. Live status of Israel TV, the free Stremio and Nuvio addon for Keshet 12, Reshet 13, Kan and Israeli live channels: what is up to date, what is playing, and the last 30 days.`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url: absolute(STATUS_PATHS[lang]),
    inLanguage: lang,
    dateModified: status.generatedAt,
    isPartOf: { '@type': 'WebSite', name: 'Israel TV', url: absolute(he ? 'he/' : '') },
  };
  const other = he ? 'en' : 'he';
  return externalLinks(
    html`${head(
      {
        lang,
        title,
        description,
        path: STATUS_PATHS[lang],
        alternates: { en: STATUS_PATHS.en, he: STATUS_PATHS.he },
        jsonLd,
      },
      STATUS_CSS,
    )}<body>
${topBar(
  lang,
  siteNav(
    lang,
    'status',
    [{ href: he ? '/he/#install' : '/#install', label: he ? 'התקנה' : 'Install', optional: true }],
    `/${STATUS_PATHS[other]}`,
  ),
)}
<main id="main">
<div class="wrap hero-status">
<div class="overall ${o.level}" role="status"><div class="dot">${raw(LEVEL_ICON[o.level])}</div>
<div><h1>${o.title}</h1><p>${o.detail}</p></div></div>
<p class="updated">${
      he
        ? html`עודכן ${when(status.generatedAt, 'he')}. משהו לא מתנגן? <a href="https://github.com/israeltv2/israel-tv/issues/new?template=broken-source.yml">ספרו לנו</a>.`
        : html`Updated ${when(status.generatedAt)}. Something not playing? <a href="https://github.com/israeltv2/israel-tv/issues/new?template=broken-source.yml">Tell us</a>.`
    }</p>
</div>
<section class="rows" aria-labelledby="rows-h"><div class="wrap">
<h2 id="rows-h">${w.channels}</h2>
<div class="grid two three">${rows.map((c) => card(c, status, logos, lang))}</div>
${status.history ? html`<div class="legend" aria-hidden="true"><span><i style="background:var(--ok)"></i>${w.legend[0]}</span><span><i style="background:var(--warn)"></i>${w.legend[1]}</span><span><i style="background:var(--error)"></i>${w.legend[2]}</span><span><i style="background:var(--none)"></i>${w.legend[3]}</span><span>${w.legend[4]}</span></div>` : ''}
</div></section>
${liveGrid(status, logos, lang)}
<section aria-labelledby="details-h"><div class="wrap">
<h2 id="details-h">${w.detailsH}</h2>
<p class="muted">${
      he
        ? html`מה שהריצות האחרונות מצאו, למי שעוזר לתקן דברים. אותם נתונים בפורמט למכונות: <a href="/${sitePaths.status}">status.json</a> (<a href="https://github.com/israeltv2/israel-tv/blob/main/docs/operations.md#the-public-status-page">מה כל שדה אומר</a>, באנגלית).`
        : html`What the last runs found, for anyone helping to fix things. The same data, machine-readable: <a href="/${sitePaths.status}">status.json</a> (<a href="https://github.com/israeltv2/israel-tv/blob/main/docs/operations.md#the-public-status-page">what the fields mean</a>).`
    }</p>
${contributorDetails(status, lang)}
</div></section>
</main>
${footer(lang)}
</body></html>
`,
    lang,
  );
}
