// The library on the website, in Hebrew: every row (/library/), a page per row (/library/<row>/), a page per show
// (/show/<series id>/) with its seasons and episodes, the live channels with what is on now and next (/live/), and
// search (/search/). Pre-rendered with the site from the same data the apps get, so search engines and link
// previews see everything; the pages link to the apps ("Watch in Stremio") and to the broadcaster's own player.
// No video plays here (docs/decisions.md, "No playback on the website").
import {
  CATALOGS,
  type GuideFile,
  type GuideRow,
  type Meta,
  type MetaPreview,
  sitePaths,
} from '@israel-tv/core';
import { CATALOG_LOGO } from './names.ts';
import { absolute, esc, footer, head, ICONS, num, PROJECT_URL, siteNav, sized, topBar } from './page.ts';

export interface LibraryShow {
  meta: Meta;
  source: string;
}

export interface LibraryRow {
  id: string;
  source: string;
  /** In the apps' order (newest first). */
  shows: LibraryShow[];
  /** A row still in its first fill. */
  filling?: { inCatalog: number; known: number };
}

export interface LibraryChannel {
  id: string;
  name: string;
  /** The channel has a logo file (`logos/<id>.png`). */
  logo: boolean;
  /** Plays only through the viewer's own home helper. */
  helper: boolean;
}

export interface LibraryInput {
  /** The show rows, in the apps' order. */
  rows: LibraryRow[];
  live: LibraryChannel[];
  guide?: GuideFile;
}

/** A row's address: its catalog id without the prefix (`iltv_keshet12` → `keshet12`). */
export const rowSlug = (catalogId: string) => catalogId.replace(/^iltv_/, '');
export const rowHref = (catalogId: string) => `/library/${rowSlug(catalogId)}/`;
export const showHref = (seriesId: string) => `/show/${seriesId}/`;

/** Text without the direction marks the apps need (`rtl()`): a page sets direction itself. */
export const plain = (s: string | undefined) => (s ?? '').replace(/[‎‏‪-‮⁦-⁩]/g, '').trim();

/** What a show's page calls its broadcaster, and its site (for "watch on the broadcaster's site"). */
const BROADCASTER: Record<string, string> = { mako: 'קשת 12', reshet: 'רשת 13', kan: 'כאן' };

/** The channels' own live pages, where the broadcaster plays them (only addresses known to be theirs). */
const LIVE_PAGES: Record<string, string> = {
  iltv_live_kan11: 'https://www.kan.org.il/live/',
  iltv_live_keshet12: 'https://www.mako.co.il/mako-vod-live-tv/VOD-6540b8dcb64fd31006.htm',
  iltv_live_reshet13: 'https://13tv.co.il/live/',
  iltv_live_ch14: 'https://www.now14.co.il/live/',
  iltv_live_ch10: 'https://www.ch10.co.il/live/',
  iltv_live_i24he: 'https://www.i24news.tv/he/tv/live',
  iltv_live_i24en: 'https://www.i24news.tv/en/tv/live',
  iltv_live_i24fr: 'https://www.i24news.tv/fr/tv/live',
  iltv_live_i24ar: 'https://www.i24news.tv/ar/tv/live',
};

/** Where each source plays, in a sentence. */
const WHERE: Record<string, string> = {
  mako: 'הפרקים של קשת 12 מתנגנים דרך העוזר הביתי שלכם, בארץ ובחו״ל.',
  reshet: 'מתנגן בארץ, ורוב הפרקים מתנגנים גם בחו״ל.',
  kan: 'מתנגן בארץ; בחו״ל, התוכניות שכאן מתירה לצפייה מחוץ לישראל.',
};

const HELPER_DOC = `${PROJECT_URL}/blob/main/docs/setup/home-helper.md`;

/** Episodes listed per season on a show page (the newest, for long-running daily shows); the apps have them all. */
export const EPISODES_PER_SEASON = 60;
/** Seasons listed with their episodes on a show page; older ones are named with their counts. */
const SEASONS_IN_FULL = 8;
/** Shows in each row's strip on the library's front page. */
const STRIP = 18;

const stremioDetail = (type: string, id: string, video?: string) =>
  `stremio:///detail/${type}/${encodeURIComponent(id)}${video ? `/${encodeURIComponent(video)}` : ''}`;

const vtName = (id: string) => `p-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

/** A show's poster tile, linking to its page. */
export function tile(
  m: MetaPreview,
  opts: { morph?: boolean; eager?: boolean; first?: boolean; width?: number } = {},
): string {
  const name = plain(m.name);
  const w = opts.width ?? 342;
  const img = m.poster
    ? `<img class="poster" src="${esc(sized(m.poster, w))}" alt="" width="${w}" height="${Math.round(w * 1.5)}"${opts.first ? ' fetchpriority="high"' : opts.eager ? '' : ' loading="lazy"'} decoding="async"${opts.morph ? ` style="view-transition-name:${vtName(m.id)}"` : ''}>`
    : `<span class="poster blank" aria-hidden="true">${esc(name.slice(0, 1))}</span>`;
  const genres = (m.genres ?? []).map(plain).join('|');
  return `<a class="tile" href="${showHref(m.id)}"${genres ? ` data-g="${esc(genres)}"` : ''}>${img}<span class="t" dir="auto">${esc(name)}</span>${
    m.releaseInfo ? `<span class="y">${esc(m.releaseInfo)}</span>` : ''
  }</a>`;
}

/**
 * A channel's programmes for the guide's first day and a half (it is refreshed daily). Cut by the guide's own start,
 * never by the moment of rendering: a page changes only when the guide does, and the page's script shows what is on.
 */
export const GUIDE_WINDOW_MS = 36 * 3_600_000;
export function channelGuide(guide: GuideFile | undefined, id: string): GuideRow[] {
  const firsts = Object.values(guide ?? {})
    .map((rows) => rows[0]?.[0])
    .filter((x): x is number => typeof x === 'number');
  if (!firsts.length) return [];
  const from = Math.min(...firsts);
  return (guide?.[id] ?? []).filter((r) => r[1] > from && r[0] < from + GUIDE_WINDOW_MS);
}

const clockFmt = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const clock = (ms: number) => clockFmt.format(ms);

/**
 * A channel's guide as a list the page's script keeps current: every programme carries its start and end; the
 * script hides the ones that ended, marks the one on the air (with a progress bar) and shows `shown` at a time.
 */
export function guideList(rows: GuideRow[], shown = 2): string {
  if (rows.length === 0) return '';
  return `<ol class="guide" data-guide="${shown}">${rows
    .map(
      (r, i) =>
        `<li data-s="${r[0]}" data-e="${r[1]}"${i >= shown ? ' hidden' : ''}><span class="at">${clock(r[0])}</span><span class="pg" dir="auto">${esc(plain(r[2]))}</span></li>`,
    )
    .join('')}</ol>`;
}

const LIBRARY_CSS = `
.page-head{padding-block:40px 8px}
.page-head h1{font-size:clamp(3rem,9vw,5.6rem);margin:0}
.page-head .lead{color:var(--muted);max-width:44rem;font-size:1.05rem;margin:.4em 0 0}
.crumbs{display:flex;flex-wrap:wrap;gap:6px;font-size:.9rem;color:var(--muted);margin-bottom:10px}
.crumbs a{color:var(--muted)}
.crumbs li{list-style:none}.crumbs ol{display:contents}
.crumbs li+li::before{content:"‹";margin-inline-end:6px;color:var(--muted)}
.searchbox{display:flex;gap:8px;margin-top:22px;max-width:34rem}
.searchbox input{flex:1;min-width:0;font:inherit;color:var(--fg);background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:12px 18px;min-height:48px}
.searchbox input:focus{outline:2px solid var(--accent);outline-offset:1px}
.shelf{padding-block:26px 6px}
.shelf-head{display:flex;align-items:baseline;gap:14px;margin-bottom:12px}
.shelf-head h2{margin:0;font-size:clamp(2rem,4.4vw,2.7rem)}
.shelf-head .count{color:var(--muted);font-size:.9rem}
.shelf-head a.all{margin-inline-start:auto;font-weight:600;white-space:nowrap}
.strip{display:grid;grid-auto-flow:column;grid-auto-columns:clamp(118px,15vw,168px);gap:14px;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;padding:4px 2px 14px;scrollbar-width:thin}
.strip>*{scroll-snap-align:start}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(42vw,150px),1fr));gap:22px 14px}
@media (min-width:720px){.tiles{grid-template-columns:repeat(auto-fill,minmax(168px,1fr))}}
.tile{display:flex;flex-direction:column;gap:6px;color:var(--fg);text-decoration:none;min-width:0}
.tile .poster{transition:transform .25s var(--ease-out),box-shadow .25s var(--ease-out);box-shadow:0 0 0 1px var(--border)}
.tile .blank{display:grid;place-items:center;font:700 3rem/1 var(--display);color:var(--muted)}
.tile .t{font-weight:600;font-size:.95rem;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tile .y{font-size:.8rem;color:var(--muted)}
@media (hover:hover){.tile:hover .poster{transform:translateY(-4px);box-shadow:0 0 0 2px var(--accent),var(--shadow)}}
.tile:focus-visible{outline:none}.tile:focus-visible .poster{box-shadow:0 0 0 3px var(--accent)}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 26px}
.chip{font:inherit;font-size:.9rem;padding:6px 14px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--fg);cursor:pointer;text-decoration:none;transition:background-color .15s var(--ease-out),border-color .15s var(--ease-out)}
.chip:hover{border-color:var(--accent)}
.chip[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
.note{border-inline-start:3px solid var(--accent);background:var(--accent-soft);border-radius:10px;padding:10px 14px;margin:14px 0;max-width:46rem}
.channels-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(min(100%,290px),1fr))}
.chan{display:grid;grid-template-columns:56px 1fr;gap:4px 14px;align-items:start;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
.chan>img,.chan>.logo-blank{grid-row:span 2;width:56px;height:56px;border-radius:12px;background:var(--surface-2);object-fit:contain}
.chan h2,.chan h3{margin:0;font:600 1.1rem/1.3 var(--body)}
.chan .acts{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.chan .acts .btn{min-height:40px;padding:6px 14px;font-size:.9rem}
.tag{display:inline-block;font-size:.72rem;font-weight:600;color:var(--warn);border:1px solid currentColor;border-radius:6px;padding:0 6px;margin-inline-start:6px;vertical-align:2px}
.guide{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:6px;font-size:.92rem}
.guide li{display:grid;grid-template-columns:3.2em 1fr;gap:8px;color:var(--muted)}
.guide li.now{color:var(--fg)}
.guide li.now .pg{font-weight:600}
.guide li.now::after{content:"";grid-column:1/-1;height:3px;border-radius:3px;background:linear-gradient(to left,var(--surface-2) calc((1 - var(--p,0))*100%),var(--on-air) 0)}
[dir=ltr] .guide li.now::after{background:linear-gradient(to right,var(--on-air) calc(var(--p,0)*100%),var(--surface-2) 0)}
.guide .at{font-variant-numeric:tabular-nums}
.guide.empty{display:none}
.strip.live{grid-auto-columns:clamp(220px,26vw,280px)}
.strip.live .chan{height:100%}
.show-hero{position:relative;isolation:isolate;overflow:hidden;color:var(--hero-fg);background:#0b0a10}
.show-hero .bg{position:absolute;inset:0;z-index:-2;width:100%;height:100%;object-fit:cover;opacity:.5}
.show-hero::after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(to top,var(--bg) 2%,rgb(13 12 18/80%) 40%,rgb(13 12 18/45%)),linear-gradient(to left,rgb(13 12 18/85%),transparent 75%)}
.show-hero .wrap{display:grid;gap:22px;padding-block:96px 36px;align-items:end}
@media (min-width:760px){.show-hero .wrap{grid-template-columns:260px 1fr;padding-block:120px 48px;gap:36px}}
.show-hero .poster{max-width:220px;box-shadow:0 20px 50px rgb(0 0 0/55%)}
@media (min-width:760px){.show-hero .poster{max-width:none}}
.show-hero h1{font-size:clamp(3rem,9vw,6rem);margin:0}
.show-hero .crumbs,.show-hero .crumbs a{color:var(--hero-muted)}
.facts{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0;padding:0;list-style:none}
.facts li{font-size:.85rem;padding:3px 12px;border-radius:999px;background:rgb(255 255 255/9%);border:1px solid rgb(255 255 255/16%);color:var(--hero-fg)}
.show-hero .desc{max-width:44rem;color:var(--hero-muted);font-size:1.05rem;margin:16px 0 0;white-space:pre-line}
.show-hero .acts{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.show-hero .small{color:var(--hero-muted);margin:14px 0 0;max-width:44rem}
.show-hero .small a{color:var(--hero-fg)}
:root[data-theme=light] .show-hero::after{background:linear-gradient(to top,#0d0c12 2%,rgb(13 12 18/80%) 40%,rgb(13 12 18/45%)),linear-gradient(to left,rgb(13 12 18/85%),transparent 75%)}
.seasons{padding-block:32px 8px}
.seasons>.wrap>h2{margin-bottom:14px}
.season>summary{font-size:1.05rem}
.season>summary .count{margin-inline-start:auto;color:var(--muted);font-weight:400;font-size:.9rem}
.eps{list-style:none;margin:0;padding:0 12px 12px;display:grid;gap:4px}
.ep{display:grid;grid-template-columns:minmax(0,128px) 1fr;gap:4px 14px;padding:10px 6px;border-radius:12px;align-items:start}
@media (min-width:720px){.ep{grid-template-columns:200px 1fr}}
.ep:hover{background:var(--surface-2)}
.ep .still{grid-row:span 3;aspect-ratio:16/9;width:100%;height:auto;object-fit:cover;border-radius:8px;background:var(--surface-2)}
.ep .still.blank{display:grid;place-items:center;font:700 2rem/1 var(--display);color:var(--muted)}
.ep h3{margin:0;font-size:1rem}
.ep h3 a{color:var(--fg);text-decoration:none}
.ep h3 a:hover{color:var(--accent)}
.ep .meta{font-size:.82rem;color:var(--muted)}
.ep p{margin:0;font-size:.9rem;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.more{padding:4px 18px 16px;color:var(--muted);font-size:.9rem;margin:0}
.older{columns:2 12rem;margin:8px 0 0;padding-inline-start:20px;color:var(--muted)}
.how{padding-block:28px 8px}
.results-info{color:var(--muted);min-height:1.6em;margin:18px 0}
`;

interface PageOpts {
  title: string;
  description: string;
  path: string;
  section?: 'library' | 'live' | 'search';
  jsonLd?: unknown;
  image?: string;
  ogType?: string;
  over?: boolean;
  css?: string;
  script?: string;
}

/** A library page: Hebrew, right to left, the site's header and footer. */
function page(o: PageOpts, body: string): string {
  return `${head(
    {
      lang: 'he',
      title: o.title,
      description: o.description,
      path: o.path,
      ...(o.jsonLd ? { jsonLd: o.jsonLd } : {}),
      ...(o.image ? { image: o.image } : {}),
      ...(o.ogType ? { ogType: o.ogType } : {}),
    },
    LIBRARY_CSS + (o.css ?? ''),
  )}<body>
${topBar('he', siteNav('he', o.section), { over: o.over ?? false })}
<main id="main">${body}</main>
${footer('he')}${o.script ? `<script>${o.script}</script>` : ''}
</body></html>
`;
}

const rowName = (id: string) => CATALOGS.find((c) => c.id === id)?.name ?? id;
const countShows = (n: number) => (n === 1 ? 'תוכנית אחת' : `${num(n, 'he')} תוכניות`);
const countEpisodes = (n: number) => (n === 1 ? 'פרק אחד' : `${num(n, 'he')} פרקים`);
const episodesOf = (m: Meta) => (m.videos ?? []).length;

const channelLogo = (c: LibraryChannel, size = 56) =>
  c.logo
    ? `<img src="/${esc(sitePaths.channelLogo(c.id))}" alt="" width="${size}" height="${size}" loading="lazy">`
    : '<span class="logo-blank" aria-hidden="true"></span>';

function channelCard(c: LibraryChannel, input: LibraryInput, heading: 'h2' | 'h3', full: boolean): string {
  const rows = channelGuide(input.guide, c.id);
  const site = LIVE_PAGES[c.id];
  return `<article class="chan" id="${esc(c.id)}">${channelLogo(c)}
<${heading} dir="auto">${esc(plain(c.name))}${c.helper ? '<span class="tag">עוזר ביתי</span>' : ''}</${heading}>
<div>${rows.length ? `<span class="on-air small">בשידור</span>${guideList(rows)}` : '<span class="small muted">אין לוח שידורים לערוץ הזה</span>'}</div>
${
  full
    ? `<div class="acts"><a class="btn btn-primary" href="${esc(stremioDetail('tv', c.id))}">${ICONS.play}צפייה ב-Stremio</a>${
        site ? `<a class="btn btn-plain" href="${esc(site)}" rel="noopener">${ICONS.out}באתר הערוץ</a>` : ''
      }</div>`
    : ''
}</article>`;
}

function libraryHome(input: LibraryInput): string {
  const total = input.rows.reduce((n, r) => n + r.shows.length, 0);
  const episodes = input.rows.reduce((n, r) => n + r.shows.reduce((k, s) => k + episodesOf(s.meta), 0), 0);
  const shelves = input.rows
    .filter((r) => r.shows.length > 0)
    .map(
      (r) => `<section class="shelf" aria-labelledby="h-${rowSlug(r.id)}"><div class="wrap">
<div class="shelf-head"><h2 id="h-${rowSlug(r.id)}">${esc(rowName(r.id))}</h2><span class="count">${countShows(r.shows.length)}</span><a class="all" href="${rowHref(r.id)}">לכל התוכניות</a></div>
<div class="strip">${r.shows
        .slice(0, STRIP)
        .map((s) => tile(s.meta, { width: 220 }))
        .join('')}</div>
</div></section>`,
    )
    .join('');
  const live = input.live.length
    ? `<section class="shelf" aria-labelledby="h-live"><div class="wrap">
<div class="shelf-head"><h2 id="h-live">שידור חי</h2><span class="count">${num(input.live.length, 'he')} ערוצים</span><a class="all" href="/live/">לוח השידורים</a></div>
<div class="strip live">${input.live.map((c) => channelCard(c, input, 'h3', false)).join('')}</div>
</div></section>`
    : '';
  return page(
    {
      title: 'הספרייה של Israel TV: כל התוכניות של קשת 12, רשת 13 וכאן',
      description: `${countShows(total)} ו-${countEpisodes(episodes)} מקשת 12, רשת 13 וכאן, וערוצים בשידור חי. צפייה ב-Stremio וב-Nuvio, בחינם.`,
      path: 'library/',
      section: 'library',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'הספרייה של Israel TV',
        inLanguage: 'he',
        url: absolute('library/'),
        hasPart: input.rows.map((r) => ({
          '@type': 'CollectionPage',
          name: rowName(r.id),
          url: absolute(rowHref(r.id)),
        })),
      },
    },
    `<div class="wrap page-head"><h1>הספרייה</h1>
<p class="lead">${countShows(total)} ו-${countEpisodes(episodes)} מקשת 12, רשת 13 וכאן, הפרקים החדשים ראשונים. לוחצים על תוכנית, ומשם ישר לאפליקציה.</p>
<form class="searchbox" action="/search/" method="get" role="search"><input type="search" name="q" placeholder="חיפוש תוכנית" aria-label="חיפוש תוכנית"><button class="btn btn-primary" type="submit">${ICONS.search}חיפוש</button></form>
</div>${live}${shelves}`,
  );
}

/** The genre filter's script: show only the tiles of the chosen genre (all of them without the script). */
const FILTER_SCRIPT = `(function(){var bs=document.querySelectorAll('.filters .chip'),ts=document.querySelectorAll('.tiles .tile');
bs.forEach(function(b){b.addEventListener('click',function(){var g=b.dataset.g;bs.forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});
ts.forEach(function(t){t.hidden=!!g&&('|'+(t.dataset.g||'')+'|').indexOf('|'+g+'|')<0})})});
document.querySelector('.filters')&&document.querySelector('.filters').removeAttribute('hidden')})();`;

function rowPage(r: LibraryRow): string {
  const name = rowName(r.id);
  const counts = new Map<string, number>();
  for (const s of r.shows)
    for (const g of s.meta.genres ?? []) counts.set(plain(g), (counts.get(plain(g)) ?? 0) + 1);
  const genres = [...counts]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'he'))
    .slice(0, 24)
    .map(([g]) => g);
  const episodes = r.shows.reduce((n, s) => n + episodesOf(s.meta), 0);
  const logo = CATALOG_LOGO[r.id];
  return page(
    {
      title: `${name}: כל התוכניות לצפייה | Israel TV`,
      description: `${countShows(r.shows.length)} ו-${countEpisodes(episodes)} של ${name}, הפרקים החדשים ראשונים. צפייה ב-Stremio וב-Nuvio, בחינם.`,
      path: rowHref(r.id).slice(1),
      section: 'library',
      ...(genres.length ? { script: FILTER_SCRIPT } : {}),
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name,
        numberOfItems: r.shows.length,
        itemListElement: r.shows.slice(0, 100).map((s, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: absolute(showHref(s.meta.id)),
          name: plain(s.meta.name),
        })),
      },
    },
    `<div class="wrap page-head">
<nav aria-label="מיקום"><ol class="crumbs"><li><a href="/library/">ספרייה</a></li><li>${esc(name)}</li></ol></nav>
<h1>${logo ? `<img src="/${esc(sitePaths.channelLogo(logo))}" alt="" width="64" height="64" style="vertical-align:-8px;border-radius:14px;margin-inline-end:14px">` : ''}${esc(name)}</h1>
<p class="lead">${countShows(r.shows.length)} ו-${countEpisodes(episodes)}, הפרקים החדשים ראשונים. ${esc(WHERE[r.source] ?? '')}</p>
${
  r.filling
    ? `<p class="note">השורה עדיין מתמלאת: ${num(r.filling.inCatalog, 'he')} מתוך ${num(r.filling.known, 'he')} התוכניות כבר כאן, השאר יגיעו בימים הקרובים.</p>`
    : ''
}
${
  genres.length
    ? `<div class="filters" role="group" aria-label="סינון לפי סוגה" hidden><button class="chip" type="button" data-g="" aria-pressed="true">הכול</button>${genres
        .map(
          (g) =>
            `<button class="chip" type="button" data-g="${esc(g)}" aria-pressed="false">${esc(g)}</button>`,
        )
        .join('')}</div>`
    : ''
}
<div class="tiles">${r.shows.map((s, i) => tile(s.meta, { morph: true, eager: i < 6, first: i === 0 })).join('')}</div>
</div>`,
  );
}

function seasonName(season: number, videos: Meta['videos']): string {
  if (season === 0) return 'מיוחדים';
  // A named season says its name in its episodes' titles ("VIP 5 · פרק 3").
  const named = season > 100 ? plain(videos?.[0]?.title).split(' · ')[0] : '';
  return named && named !== plain(videos?.[0]?.title) ? named : `עונה ${num(season, 'he')}`;
}

const dateFmt = new Intl.DateTimeFormat('he-IL', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function episodeItem(m: Meta, v: NonNullable<Meta['videos']>[number], named: boolean): string {
  const title = plain(v.title);
  const shown = named ? title.split(' · ').slice(1).join(' · ') || title : title;
  const still = v.thumbnail
    ? `<img class="still" src="${esc(sized(v.thumbnail, 400))}" alt="" width="200" height="113" loading="lazy" decoding="async">`
    : `<span class="still blank" aria-hidden="true">${v.episode ?? ''}</span>`;
  const date = v.released ? dateFmt.format(Date.parse(v.released)) : '';
  return `<li class="ep">${still}<h3><a href="${esc(stremioDetail('series', m.id, v.id))}" dir="auto">${esc(shown)}</a></h3>
<span class="meta">פרק ${num(v.episode ?? 0, 'he')}${date ? ` · <time datetime="${esc(v.released ?? '')}" data-abs>${esc(date)}</time>` : ''}</span>${
    v.overview ? `<p dir="auto">${esc(plain(v.overview))}</p>` : ''
  }</li>`;
}

function showPage(s: LibraryShow, row: LibraryRow): string {
  const m = s.meta;
  const name = plain(m.name);
  const description = plain(m.description);
  const bySeason = new Map<number, NonNullable<Meta['videos']>>();
  for (const v of m.videos ?? []) {
    const k = v.season ?? 1;
    bySeason.set(k, [...(bySeason.get(k) ?? []), v]);
  }
  // Newest season first; named seasons (101+) are newer than numbered ones only by their episodes' dates.
  const lastDate = (vs: NonNullable<Meta['videos']>) =>
    vs.reduce((d, v) => (v.released && v.released > d ? v.released : d), '');
  const seasons = [...bySeason].sort((a, b) => lastDate(b[1]).localeCompare(lastDate(a[1])) || b[0] - a[0]);
  const total = episodesOf(m);
  const broadcaster = BROADCASTER[s.source];
  const site = m.links?.find((l) => l.category === 'Website')?.url;
  const years = m.releaseInfo;
  const facts = [
    rowName(row.id),
    years,
    m.status === 'Ended' ? 'הסתיימה' : m.status ? 'עדיין משודרת' : undefined,
    bySeason.size > 1 ? `${num(bySeason.size, 'he')} עונות` : undefined,
    countEpisodes(total),
    ...(m.genres ?? []).map(plain),
  ].filter((x): x is string => !!x);
  const list = seasons
    .slice(0, SEASONS_IN_FULL)
    .map(([n, vs], i) => {
      const named = n > 100;
      const long = vs.length > 40;
      const sorted = [...vs].sort((a, b) => (long ? -1 : 1) * ((a.episode ?? 0) - (b.episode ?? 0)));
      const shown = sorted.slice(0, EPISODES_PER_SEASON);
      return `<details class="season"${i === 0 ? ' open' : ''}><summary><span dir="auto">${esc(seasonName(n, vs))}</span><span class="count">${countEpisodes(vs.length)}${long ? ', החדשים ראשונים' : ''}</span></summary>
<ol class="eps">${shown.map((v) => episodeItem(m, v, named)).join('')}</ol>${
        vs.length > shown.length
          ? `<p class="more">ועוד ${countEpisodes(vs.length - shown.length)} באפליקציה.</p>`
          : ''
      }</details>`;
    })
    .join('');
  const older = seasons.slice(SEASONS_IN_FULL);
  const poster = m.poster ? sized(m.poster, 520) : undefined;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TVSeries',
        name,
        url: absolute(showHref(m.id)),
        inLanguage: 'he',
        ...(description ? { description } : {}),
        ...(poster ? { image: poster } : {}),
        ...(m.genres?.length ? { genre: m.genres.map(plain) } : {}),
        ...(years ? { startDate: years.slice(0, 4) } : {}),
        ...(m.lastAirDate && m.status === 'Ended' ? { endDate: m.lastAirDate } : {}),
        numberOfSeasons: bySeason.size,
        numberOfEpisodes: total,
        ...(broadcaster ? { productionCompany: { '@type': 'Organization', name: broadcaster } } : {}),
        ...(site ? { sameAs: site } : {}),
        ...(m.imdb_id ? { sameAs: [site, `https://www.imdb.com/title/${m.imdb_id}/`].filter(Boolean) } : {}),
        containsSeason: seasons.slice(0, SEASONS_IN_FULL).map(([n, vs]) => ({
          '@type': 'TVSeason',
          name: seasonName(n, vs),
          seasonNumber: n,
          numberOfEpisodes: vs.length,
          episode: vs.slice(-10).map((v) => ({
            '@type': 'TVEpisode',
            episodeNumber: v.episode,
            name: plain(v.title),
            ...(v.released ? { datePublished: v.released.slice(0, 10) } : {}),
          })),
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'ספרייה', item: absolute('library/') },
          { '@type': 'ListItem', position: 2, name: rowName(row.id), item: absolute(rowHref(row.id)) },
          { '@type': 'ListItem', position: 3, name },
        ],
      },
    ],
  };
  const summary = description
    ? description.length > 150
      ? `${description.slice(0, 147).replace(/\s+\S*$/, '')}…`
      : description
    : `${name}: ${countEpisodes(total)} של ${broadcaster ?? rowName(row.id)}.`;
  return page(
    {
      title: `${name}: לצפייה בכל הפרקים | Israel TV`,
      description: summary,
      path: showHref(m.id).slice(1),
      section: 'library',
      over: true,
      ogType: 'video.tv_show',
      jsonLd,
      ...(poster ? { image: poster } : {}),
    },
    `<header class="show-hero">${m.background ? `<img class="bg" src="${esc(sized(m.background, 1280))}" alt="" fetchpriority="low" decoding="async">` : ''}<div class="wrap">
${poster ? `<img class="poster" src="${esc(poster)}" alt="" width="260" height="390" style="view-transition-name:${vtName(m.id)}">` : '<span></span>'}
<div>
<nav aria-label="מיקום"><ol class="crumbs"><li><a href="/library/">ספרייה</a></li><li><a href="${rowHref(row.id)}">${esc(rowName(row.id))}</a></li></ol></nav>
<h1 dir="auto">${esc(name)}</h1>
<ul class="facts">${facts.map((f) => `<li dir="auto">${esc(f)}</li>`).join('')}</ul>
${description ? `<p class="desc" dir="auto">${esc(description)}</p>` : ''}
<div class="acts"><a class="btn btn-primary" href="${esc(stremioDetail('series', m.id))}">${ICONS.play}צפייה ב-Stremio</a>${
      site
        ? `<a class="btn btn-ghost" href="${esc(site)}" rel="noopener">${ICONS.out}לצפייה באתר של ${esc(broadcaster ?? 'הערוץ')}</a>`
        : ''
    }</div>
<p class="small">${
      s.source === 'mako' ? `הפרקים של קשת 12 מתנגנים דרך <a href="${HELPER_DOC}">העוזר הביתי</a> שלכם. ` : ''
    }הכפתור פותח את התוכנית ב-Stremio, אם Israel TV כבר מותקן שם (<a href="/he/#install">התקנה בדקה</a>). ב-Nuvio: מוסיפים את Israel TV ומחפשים „${esc(name)}”.</p>
</div></div></header>
<section class="seasons" aria-labelledby="eps-h"><div class="wrap">
<h2 id="eps-h">פרקים</h2>
${list}${
  older.length
    ? `<p class="muted">עונות קודמות, באפליקציה:</p><ul class="older">${older
        .map(([n, vs]) => `<li dir="auto">${esc(seasonName(n, vs))}: ${countEpisodes(vs.length)}</li>`)
        .join('')}</ul>`
    : ''
}
</div></section>`,
  );
}

function livePage(input: LibraryInput): string {
  return page(
    {
      title: 'שידור חי: ערוצי הטלוויזיה הישראליים ומה משודר עכשיו | Israel TV',
      description: `${num(input.live.length, 'he')} ערוצים ישראליים בשידור חי, עם מה משודר עכשיו ומה הבא: כאן 11, קשת 12, רשת 13, עכשיו 14, ערוץ הכנסת ועוד. ב-Stremio וב-Nuvio, בחינם.`,
      path: 'live/',
      section: 'live',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'שידור חי',
        itemListElement: input.live.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: {
            '@type': 'BroadcastService',
            name: plain(c.name),
            broadcastDisplayName: plain(c.name),
            inLanguage: 'he',
            url: absolute(`live/#${c.id}`),
            ...(c.logo ? { logo: absolute(sitePaths.channelLogo(c.id)) } : {}),
            ...(LIVE_PAGES[c.id] ? { sameAs: LIVE_PAGES[c.id] } : {}),
          },
        })),
      },
    },
    `<div class="wrap page-head"><h1>שידור חי</h1>
<p class="lead">${num(input.live.length, 'he')} ערוצים, עם מה משודר עכשיו ומה הבא (שעון ישראל). הכפתור פותח את הערוץ ב-Stremio; באפליקציות עם מסך לוח שידורים מופיע הלוח המלא. ערוצים שמסומנים „עוזר ביתי” מתנגנים רק דרך <a href="${HELPER_DOC}">העוזר הביתי</a> שלכם.</p>
</div>
<section style="padding-top:24px"><div class="wrap"><div class="channels-grid">${input.live.map((c) => channelCard(c, input, 'h2', true)).join('')}</div></div></section>`,
  );
}

/** Search over search.json, in the browser (the same matching rules as the apps' search, simplified). */
const SEARCH_SCRIPT = `(function(){var F={'ך':'כ','ם':'מ','ן':'נ','ף':'פ','ץ':'צ'},P='הובלמשכ';
function norm(s){return s.normalize('NFKD').replace(/[\\u0591-\\u05C7]/g,'').replace(/[ךםןףץ]/g,function(c){return F[c]}).toLowerCase().replace(/[׳״'"\`]/g,'').replace(/[^\\p{L}\\p{N}]+/gu,' ').trim()}
function strip(w){var n=w[0]==='ו'&&w.length>3&&P.indexOf(w[1])>=0?2:1;return w.length-n>=2&&P.indexOf(w[0])>=0?w.slice(n):''}
function score(key,q){var ws=key.split(' '),ex=ws.map(strip).filter(Boolean),best=1;
for(var i=0;i<q.length;i++){var w=q[i],hit=ws.some(function(k){return k.indexOf(w)===0});if(hit)continue;
var w2=strip(w);if(ex.some(function(k){return k.indexOf(w)===0})||(w2&&ws.some(function(k){return k.indexOf(w2)===0}))){best=2;continue}return 0}return best}
var d=document,f=d.getElementById('q'),out=d.getElementById('results'),info=d.getElementById('info'),rows=null,
esc=function(s){return s.replace(/[&<>"']/g,function(c){return '&#'+c.charCodeAt(0)+';'})},
clean=function(s){return s.replace(/[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]/g,'')};
function sized(u){return /^https:\\/\\/media\\d*\\.reshet\\.tv\\/image\\/upload\\//.test(u)&&!/\\/upload\\/[a-z]_/.test(u)?u.replace('/image/upload/','/image/upload/w_220,c_limit,f_auto,q_auto/'):u}
function run(){var q=norm(f.value);history.replaceState(null,'',q?'?q='+encodeURIComponent(f.value):location.pathname);
if(!q){out.innerHTML='';info.textContent='';return}if(!rows){info.textContent='טוען…';return}
var ws=q.split(' '),hits=[];rows.forEach(function(r){var s=score(r[4],ws);if(s)hits.push([s,r])});hits.sort(function(a,b){return a[0]-b[0]});
info.textContent=hits.length?(hits.length===1?'נמצאה תוכנית אחת':'נמצאו '+hits.length+' תוצאות'):'לא נמצא כלום. נסו בעברית, כמו שהערוץ כותב את השם.';
out.innerHTML=hits.slice(0,120).map(function(h){var r=h[1],live=r[1]==='tv',href=live?'/live/#'+r[0]:'/show/'+r[0]+'/',img=r[5]?sized(r[5].replace('{{israel-tv-origin}}','')):'';
return '<a class="tile" href="'+href+'">'+(img?'<img class="poster" src="'+esc(img)+'" alt="" loading="lazy" width="220" height="330"'+(live?' style="object-fit:contain;padding:18%"':'')+'>':'<span class="poster blank" aria-hidden="true"></span>')+'<span class="t" dir="auto">'+esc(clean(r[3]))+'</span></a>'}).join('')}
f.addEventListener('input',run);f.value=new URLSearchParams(location.search).get('q')||'';
fetch('/search.json').then(function(r){return r.json()}).then(function(j){rows=j;run()},function(){info.textContent='החיפוש לא נטען. נסו לרענן את הדף.'});
f.focus();run()})();`;

function searchPage(): string {
  return page(
    {
      title: 'חיפוש תוכנית | Israel TV',
      description: 'חיפוש בכל התוכניות והערוצים של Israel TV: קשת 12, רשת 13, כאן ושידור חי.',
      path: 'search/',
      section: 'search',
      script: SEARCH_SCRIPT,
    },
    `<div class="wrap page-head"><h1>חיפוש</h1>
<form class="searchbox" action="/search/" method="get" role="search" onsubmit="return false"><input id="q" type="search" name="q" placeholder="שם התוכנית או הערוץ" aria-label="שם התוכנית או הערוץ" autocomplete="off"></form>
<p class="results-info" id="info" role="status" aria-live="polite"></p>
<noscript><p class="note">החיפוש צריך JavaScript. אפשר לדפדף ב<a href="/library/">ספרייה</a>.</p></noscript>
<div class="tiles" id="results"></div>
</div>`,
  );
}

/** Every library page, by site path. */
export function renderLibrary(input: LibraryInput): Map<string, string> {
  const files = new Map<string, string>();
  files.set(sitePaths.library, libraryHome(input));
  for (const r of input.rows) {
    if (r.shows.length === 0) continue;
    files.set(sitePaths.libraryRow(rowSlug(r.id)), rowPage(r));
    for (const s of r.shows) files.set(sitePaths.showPage(s.meta.id), showPage(s, r));
  }
  if (input.live.length) files.set(sitePaths.livePage, livePage(input));
  files.set(sitePaths.searchPage, searchPage());
  return files;
}

/** The library's page addresses for the sitemap (search is a tool, not a page to find). */
export function libraryUrls(files: Iterable<string>): string[] {
  return [...files]
    .filter((p) => /^(library|show|live)\//.test(p) && p.endsWith('/index.html'))
    .map((p) => p.replace(/index\.html$/, ''));
}
