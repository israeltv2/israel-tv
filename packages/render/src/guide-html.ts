// The full programme guide (/live/guide/ in Hebrew, /en/live/guide/ in English): every channel with a guide, a
// broadcast day at a time (05:00 to 05:00 Israel time), as a time grid on wide screens and a list per channel on
// phones, with a search over the programmes. A programme that is a show in the catalog links to the show's page.
// Rendered with the site from epg.json, so it changes only when the guide does; its script marks what is on now.
// Also `airings.json`: the same programmes in a compact form, for the pages that show "on the air next" in the
// browser (show pages, library tiles, search), so those pages need not change when the guide does.

import { type GuideFile, type GuideRow, nextDay, zonedDay, zonedTime } from '@israel-tv/core';
import { script, style } from './assets.ts';
import { type Html, html, raw } from './html.ts';
import { GUIDE_PATH, guideHref, plain } from './library-html.ts';
import { absolute, externalLinks, footer, head, type Lang, logoTile, num, siteNav, topBar } from './page.ts';

const TZ = 'Asia/Jerusalem';
/** A broadcast day starts at this time (late-night programmes belong to the evening before). */
export const DAY_STARTS = '05:00';

export interface GuideChannel {
  id: string;
  name: string;
  logo: boolean;
  helper: boolean;
}

export interface GuidePageInput {
  live: GuideChannel[];
  guide: GuideFile;
  /** The show a programme is (core guide-match.ts), by channel and title. */
  showFor: (channel: string, title: string) => string | undefined;
}

/** Channel names in English (the apps show the Hebrew ones). */
const CHANNEL_EN: Record<string, string> = {
  iltv_live_kan11: 'Kan 11',
  iltv_live_keshet12: 'Keshet 12',
  iltv_live_reshet13: 'Reshet 13',
  iltv_live_ch14: 'Now 14',
  iltv_live_ch24: 'Channel 24',
  iltv_live_kanedu: 'Kan Educational',
  iltv_live_makan33: 'Makan 33',
  iltv_live_knesset: 'Knesset Channel',
  iltv_live_ch10: 'Calcala 10',
  iltv_live_ch9: 'Channel 9',
  iltv_live_r13comedy: 'Reshet 13 Comedy',
  iltv_live_r13nofesh: 'Reshet 13 Vacation',
  iltv_live_r13reality: 'Reshet 13 Reality',
  iltv_live_k12comedy: 'Keshet Comedy',
  iltv_live_k12drama: 'Keshet Drama',
  iltv_live_k12music: 'Keshet Music',
  iltv_live_k12food: 'Keshet Food',
  iltv_live_erets: 'Eretz Nehederet',
  iltv_live_savri: 'Savri Maranan',
};
export const channelName = (c: { id: string; name: string }, lang: Lang) =>
  lang === 'en' ? (CHANNEL_EN[c.id] ?? plain(c.name)) : plain(c.name);

/** The broadcast day (yyyy-mm-dd) a moment belongs to. */
export function broadcastDay(ms: number): string {
  const day = zonedDay(ms, TZ);
  return ms < zonedTime(day, DAY_STARTS, TZ) ? nextDay(day, -1) : day;
}
export const dayBounds = (day: string) => ({
  from: zonedTime(day, DAY_STARTS, TZ),
  to: zonedTime(nextDay(day), DAY_STARTS, TZ),
});

const MIN = 60_000;
const clockFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const clock = (ms: number) => clockFmt.format(ms);
const weekday: Record<Lang, Intl.DateTimeFormat> = {
  he: new Intl.DateTimeFormat('he-IL', { weekday: 'long', timeZone: 'UTC' }),
  en: new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }),
};
const longDay: Record<Lang, Intl.DateTimeFormat> = {
  he: new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
  en: new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
};
/** A day tab: "ראשון 8.11" / "Sun 8 Nov". */
function tabLabel(day: string, lang: Lang): string {
  const at = Date.parse(`${day}T12:00:00Z`);
  const [, m, d] = day.split('-').map(Number);
  if (lang === 'he') return `${weekday.he.format(at).replace(/^יום\s+/, '')} ${d}.${m}`;
  return `${weekday.en.format(at)} ${d} ${new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(at)}`;
}

const T = {
  he: {
    title: 'לוח שידורים: מה משודר היום ומחר בערוצי הטלוויזיה בישראל | Israel TV',
    h1: 'לוח שידורים',
    description: (n: number) =>
      `לוח השידורים המלא של ${num(n, 'he')} ערוצים ישראליים: כאן 11, קשת 12, רשת 13, עכשיו 14, ערוץ הכנסת ועוד, היום ובימים הקרובים, עם חיפוש תוכניות.`,
    lead: (n: number) =>
      `${num(n, 'he')} ערוצים, מהיום ועד שלושה ימים קדימה, לפי שעון ישראל. תוכנית שיש לה פרקים בספרייה מקושרת לדף שלה.`,
    live: 'שידור חי',
    days: 'ימים',
    search: 'חיפוש תוכנית בלוח השידורים',
    placeholder: 'שם התוכנית',
    noGuide: 'ערוצים בלי לוח שידורים',
    noGuideWhy: 'הערוצים האלה לא מפרסמים לוח שידורים, או שמשדרים לולאה של תוכניות כל היום.',
    noscript: 'בלי JavaScript מוצגים כל הימים זה אחר זה, והחיפוש לא עובד.',
    channel: 'לערוץ',
  },
  en: {
    title: 'TV guide: what is on Israeli TV today and tomorrow | Israel TV',
    h1: 'TV guide',
    description: (n: number) =>
      `The full programme guide of ${n} Israeli channels: Kan 11, Keshet 12, Reshet 13, Now 14, the Knesset Channel and more, today and the days ahead, with programme search.`,
    lead: (n: number) =>
      `${n} channels, from today up to three days ahead, in Israel time. A programme that has episodes in the library links to its page.`,
    live: 'Live',
    days: 'Days',
    search: 'Search the TV guide',
    placeholder: 'Programme title',
    noGuide: 'Channels without a guide',
    noGuideWhy: 'These channels publish no schedule, or loop their shows all day.',
    noscript: 'Without JavaScript every day is listed one after another, and search does not work.',
    channel: 'Channel',
  },
} as const;

const GUIDE_CSS = style('guide.css');
const LIBRARY_CSS = style('library.css');
const GUIDE_SCRIPT = `${script('match.js')}\n${script('guide.js')}`;

/** Ruler marks every hour of a broadcast day. */
function ruler(from: number, len: number): Html {
  const marks: Html[] = [];
  for (let m = 0; m < len; m += 60) marks.push(html`<span style="--s:${m}">${clock(from + m * MIN)}</span>`);
  return html`<div class="gruler" aria-hidden="true"><span class="gcorner"></span><div>${marks}</div></div>`;
}

function programme(r: GuideRow, from: number, len: number, show: string | undefined, lang: Lang): Html {
  const s = Math.max(0, Math.round((r[0] - from) / MIN));
  const e = Math.min(len, Math.round((r[1] - from) / MIN));
  const title = plain(r[2]);
  const tip = `${clock(r[0])}–${clock(r[1])} ${title}`;
  const name = show
    ? html`<a class="pt" href="/show/${show}/" dir="auto">${title}</a>`
    : html`<span class="pt" dir="auto">${title}</span>`;
  return html`<li data-s="${r[0]}" data-e="${r[1]}" style="--s:${s};--d:${Math.max(1, e - s)}" title="${tip}"><time datetime="${new Date(r[0]).toISOString()}" data-abs>${clock(r[0])}</time>${name}${
    show
      ? html`<span class="sr">${lang === 'he' ? ' (יש פרקים בספרייה)' : ' (episodes in the library)'}</span>`
      : ''
  }</li>`;
}

/** The days the guide covers, in order. */
export function guideDays(guide: GuideFile, channels: string[]): string[] {
  const days = new Set<string>();
  for (const id of channels) for (const r of guide[id] ?? []) days.add(broadcastDay(r[0]));
  return [...days].sort();
}

export function renderGuidePage(input: GuidePageInput, lang: Lang): string {
  const t = T[lang];
  const he = lang === 'he';
  const withGuide = input.live.filter((c) => (input.guide[c.id]?.length ?? 0) > 0);
  const without = input.live.filter((c) => !(input.guide[c.id]?.length ?? 0));
  const days = guideDays(
    input.guide,
    withGuide.map((c) => c.id),
  );
  const sections = days.map((day, k) => {
    const { from, to } = dayBounds(day);
    const len = Math.round((to - from) / MIN);
    const rows = withGuide
      .map((c) => ({ c, rows: (input.guide[c.id] ?? []).filter((r) => r[1] > from && r[0] < to) }))
      .filter((x) => x.rows.length > 0);
    return html`<section class="gday" id="d-${day}" data-from="${from}" data-to="${to}" aria-labelledby="h-${day}">
<h2 class="gday-h" id="h-${day}">${longDay[lang].format(Date.parse(`${day}T12:00:00Z`))}</h2>
<div class="gscroll"><div class="ggrid" style="--len:${len}">${ruler(from, len)}${rows.map(
      ({ c, rows: list }) =>
        html`<section class="gch" data-ch="${c.id}"${k === 0 ? html` id="${c.id}"` : ''} aria-label="${channelName(c, lang)}">
<h3 class="gch-h"><a href="/live/#${c.id}">${logoTile(c.logo ? { logo: c.id } : undefined, 32)}<span dir="auto">${channelName(c, lang)}</span></a></h3>
<ol class="gpr">${list.map((r) => programme(r, from, len, input.showFor(c.id, r[2]), lang))}</ol></section>`,
    )}<i class="nowline" aria-hidden="true" hidden></i></div></div></section>`;
  });
  const tabs = days.map(
    (day) => html`<a class="chip" href="#d-${day}" data-day="${day}">${tabLabel(day, lang)}</a>`,
  );
  const title = t.h1;
  const page = html`${head(
    {
      lang,
      title: t.title,
      description: t.description(withGuide.length),
      path: GUIDE_PATH[lang],
      alternates: { he: GUIDE_PATH.he, en: GUIDE_PATH.en },
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebPage',
            name: title,
            inLanguage: lang,
            url: absolute(GUIDE_PATH[lang]),
            about: withGuide.map((c) => ({
              '@type': 'BroadcastService',
              name: channelName(c, lang),
              broadcastDisplayName: plain(c.name),
              url: absolute(`live/#${c.id}`),
            })),
          },
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: t.live, item: absolute('live/') },
              { '@type': 'ListItem', position: 2, name: title },
            ],
          },
        ],
      },
    },
    LIBRARY_CSS + GUIDE_CSS,
  )}<body>
${topBar(lang, siteNav(lang, 'live', [], guideHref(he ? 'en' : 'he')))}
<main id="main"><div class="wrap page-head">
<nav aria-label="${he ? 'מיקום' : 'Breadcrumb'}"><ol class="crumbs"><li><a href="/live/">${t.live}</a></li><li>${title}</li></ol></nav>
<h1>${title}</h1>
<p class="lead">${t.lead(withGuide.length)}</p>
<form class="searchbox" action="${guideHref(lang)}" method="get" role="search" onsubmit="return false"><input id="gq" type="search" name="q" placeholder="${t.placeholder}" aria-label="${t.search}" autocomplete="off"></form>
<p class="results-info" id="ginfo" role="status" aria-live="polite"></p>
<noscript><p class="note">${t.noscript}</p></noscript>
</div>
<div class="wrap guide-wrap" data-lang="${lang}">
<div id="gresults" class="gresults" hidden></div>
<nav class="gdays" aria-label="${t.days}">${tabs}</nav>
${sections}
${
  without.length
    ? html`<section class="gnone" aria-labelledby="h-none"><h2 id="h-none">${t.noGuide}</h2><p class="muted">${t.noGuideWhy}</p><ul>${without.map(
        (c) =>
          html`<li><a href="/live/#${c.id}">${logoTile(c.logo ? { logo: c.id } : undefined, 28)}<span dir="auto">${channelName(c, lang)}</span></a></li>`,
      )}</ul></section>`
    : ''
}
</div></main>
${footer(lang)}<script>${raw(GUIDE_SCRIPT)}</script>
</body></html>
`;
  return externalLinks(page, lang);
}

/**
 * airings.json: channels [id, Hebrew name] and programmes [channel index, start, end (minutes since 1970), title,
 * show id when the programme is a show in the catalog]. About a tenth of epg.json: no descriptions or pictures.
 */
export interface AiringsFile {
  ch: [id: string, name: string][];
  r: ([ch: number, start: number, end: number, title: string] | [number, number, number, string, string])[];
}

export function airingsFile(input: GuidePageInput): AiringsFile {
  const channels = input.live.filter((c) => (input.guide[c.id]?.length ?? 0) > 0);
  const r: AiringsFile['r'] = [];
  channels.forEach((c, i) => {
    for (const row of input.guide[c.id] ?? []) {
      const show = input.showFor(c.id, row[2]);
      const base: [number, number, number, string] = [
        i,
        Math.round(row[0] / MIN),
        Math.round(row[1] / MIN),
        plain(row[2]),
      ];
      r.push(show ? [...base, show] : base);
    }
  });
  r.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return { ch: channels.map((c) => [c.id, plain(c.name)]), r };
}

/** A show's airings in the guide, from now on (for the apps' show page line). */
export function showAirings(
  guide: GuideFile,
  showFor: GuidePageInput['showFor'],
  now: number,
): Map<string, { channel: string; row: GuideRow }[]> {
  const out = new Map<string, { channel: string; row: GuideRow }[]>();
  for (const [channel, rows] of Object.entries(guide))
    for (const row of rows) {
      if (row[1] <= now) continue;
      const id = showFor(channel, row[2]);
      if (!id) continue;
      out.set(id, [...(out.get(id) ?? []), { channel, row }]);
    }
  for (const list of out.values()) list.sort((a, b) => a.row[0] - b.row[0]);
  return out;
}

const metaDay = new Intl.DateTimeFormat('he-IL', { weekday: 'long', timeZone: TZ });
/** "8.11": a day as Israelis write it. */
const shortDate = (ms: number) => {
  const [, m, d] = zonedDay(ms, TZ).split('-').map(Number);
  return `${d}.${m}`;
};

/**
 * The line an app's show page starts with: the next airing, in absolute terms (the file is published every half
 * hour and cached by apps, so "today" or "now" could be wrong by the time it is read): "בשידור הבא: יום ראשון 8.11
 * בשעה 21:00 · קשת 12". A programme on the air when the file was written keeps its own start time.
 */
export function airingLine(a: { channel: string; row: GuideRow }, channelNames: Map<string, string>): string {
  const [s] = a.row;
  const name = channelNames.get(a.channel) ?? '';
  return `בשידור הבא: ${metaDay.format(s)} ${shortDate(s)} בשעה ${clock(s)}${name ? ` · ${name}` : ''}`;
}
