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
import { script, style } from './assets.ts';
import { type Child, type Html, html, raw } from './html.ts';
import { CATALOG_MARK } from './names.ts';
import {
  absolute,
  externalLinks,
  footer,
  head,
  ICONS,
  logoTile,
  num,
  PROJECT_URL,
  siteNav,
  sized,
  topBar,
} from './page.ts';

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

/** A row's first fill, as a short line with a progress bar. */
export function fillChip(f: { inCatalog: number; known: number }, lang: 'he' | 'en'): Html {
  const pct = f.known ? Math.min(100, Math.round((f.inCatalog / f.known) * 100)) : 0;
  const text =
    lang === 'he'
      ? `נטען לראשונה: ${num(f.inCatalog, 'he')} מתוך ${num(f.known, 'he')}`
      : `First load: ${num(f.inCatalog)} of ${num(f.known)}`;
  return html`<span class="chip-fill"><span>${text}</span><span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${f.known}" aria-valuenow="${f.inCatalog}" aria-label="${text}"><i style="width:${pct}%"></i></span></span>`;
}

/** Where each source plays, in a sentence. */
const WHERE: Record<string, string> = {
  mako: 'הפרקים של קשת 12 מתנגנים דרך העוזר הביתי שלכם, בארץ ובחו״ל.',
  reshet: 'מתנגן בארץ, ורוב הפרקים מתנגנים גם בחו״ל.',
  kan: 'מתנגן בארץ. בחו״ל מתנגנות התוכניות שכאן מתירה לצפייה מחוץ לישראל.',
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
): Html {
  const name = plain(m.name);
  const w = opts.width ?? 342;
  const loading = opts.first ? raw(' fetchpriority="high"') : opts.eager ? '' : raw(' loading="lazy"');
  const img = m.poster
    ? html`<img class="poster" src="${sized(m.poster, w)}" alt="" width="${w}" height="${Math.round(w * 1.5)}"${loading} decoding="async"${
        opts.morph ? html` style="view-transition-name:${vtName(m.id)}"` : ''
      }>`
    : html`<span class="poster blank" aria-hidden="true">${name.slice(0, 1)}</span>`;
  const genres = (m.genres ?? []).map(plain).join('|');
  return html`<a class="tile" href="${showHref(m.id)}"${genres ? html` data-g="${genres}"` : ''}>${img}<span class="t" dir="auto">${name}</span>${
    m.releaseInfo ? html`<span class="y">${m.releaseInfo}</span>` : ''
  }</a>`;
}

/**
 * A channel's programmes for a day and a half from the guide's start (it is refreshed daily). Cut by the guide's own start,
 * never by the moment of rendering: a page changes only when the guide does, and the page's script shows what is on.
 */
export const GUIDE_WINDOW_MS = 36 * 3_600_000;
const GUIDE_STEP_MS = 12 * 3_600_000;
export function channelGuide(guide: GuideFile | undefined, id: string): GuideRow[] {
  const firsts = Object.values(guide ?? {})
    .map((rows) => rows[0]?.[0])
    .filter((x): x is number => typeof x === 'number');
  if (!firsts.length) return [];
  // The guide file drops programmes a few hours after they end, so its first start moves on every refresh: the
  // window starts at the 12-hour mark before it instead, and the pages change only twice a day.
  const from = Math.floor(Math.min(...firsts) / GUIDE_STEP_MS) * GUIDE_STEP_MS;
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
export function guideList(rows: GuideRow[], shown = 2): Child {
  if (rows.length === 0) return '';
  return html`<ol class="guide" data-guide="${shown}">${rows.map(
    (r, i) =>
      html`<li data-s="${r[0]}" data-e="${r[1]}"${i >= shown ? raw(' hidden') : ''}><span class="at">${clock(r[0])}</span><span class="pg" dir="auto">${plain(r[2])}</span></li>`,
  )}</ol>`;
}

const LIBRARY_CSS = style('library.css');

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
  /** "noindex" for a page search engines should not keep (the not-found page). */
  robots?: string;
}

/** A library page: Hebrew, right to left, the site's header and footer. */
function page(o: PageOpts, body: Html): string {
  return externalLinks(
    html`${head(
      {
        lang: 'he',
        title: o.title,
        description: o.description,
        path: o.path,
        ...(o.jsonLd ? { jsonLd: o.jsonLd } : {}),
        ...(o.image ? { image: o.image } : {}),
        ...(o.ogType ? { ogType: o.ogType } : {}),
        ...(o.robots ? { robots: o.robots } : {}),
      },
      LIBRARY_CSS + (o.css ?? ''),
    )}<body>
${topBar('he', siteNav('he', o.section), { over: o.over ?? false })}
<main id="main">${body}</main>
${footer('he')}${o.script ? html`<script>${raw(o.script)}</script>` : ''}
</body></html>
`,
    'he',
  );
}

const rowName = (id: string) => CATALOGS.find((c) => c.id === id)?.name ?? id;
const countShows = (n: number) => (n === 1 ? 'תוכנית אחת' : `${num(n, 'he')} תוכניות`);
const countEpisodes = (n: number) => (n === 1 ? 'פרק אחד' : `${num(n, 'he')} פרקים`);
const episodesOf = (m: Meta) => (m.videos ?? []).length;

const channelLogo = (c: LibraryChannel, size = 56) => logoTile(c.logo ? { logo: c.id } : undefined, size);

function channelCard(c: LibraryChannel, input: LibraryInput, heading: 'h2' | 'h3', full: boolean): Html {
  const rows = channelGuide(input.guide, c.id);
  const site = LIVE_PAGES[c.id];
  const h = raw(heading);
  return html`<article class="chan" id="${c.id}">${channelLogo(c)}
<${h} dir="auto">${plain(c.name)}${c.helper ? raw('<span class="tag">עוזר ביתי</span>') : ''}</${h}>
<div>${rows.length ? html`<span class="on-air small">בשידור</span>${guideList(rows)}` : raw('<span class="small muted">אין לוח שידורים לערוץ הזה</span>')}</div>
${
  full
    ? html`<div class="acts"><a class="btn btn-primary" href="${stremioDetail('tv', c.id)}">${ICONS.play}צפייה ב-Stremio</a>${
        site ? html`<a class="btn btn-plain" href="${site}" rel="noopener">${ICONS.out}באתר הערוץ</a>` : ''
      }</div>`
    : ''
}</article>`;
}

function libraryHome(input: LibraryInput): string {
  const total = input.rows.reduce((n, r) => n + r.shows.length, 0);
  const episodes = input.rows.reduce((n, r) => n + r.shows.reduce((k, s) => k + episodesOf(s.meta), 0), 0);
  // The first strip is on screen when the page opens: its first posters load at once, the very first one first.
  const shelves = input.rows
    .filter((r) => r.shows.length > 0)
    .map(
      (r, k) => html`<section class="shelf" aria-labelledby="h-${rowSlug(r.id)}"><div class="wrap">
<div class="shelf-head"><h2 id="h-${rowSlug(r.id)}">${rowName(r.id)}</h2><span class="count">${countShows(r.shows.length)}</span><a class="all" href="${rowHref(r.id)}">לכל התוכניות</a></div>
<div class="strip">${r.shows
        .slice(0, STRIP)
        .map((s, i) =>
          tile(s.meta, { width: 220, eager: k === 0 && i < 2, first: k === 0 && i === 0 }),
        )}</div>
</div></section>`,
    );
  const live = input.live.length
    ? html`<section class="shelf" aria-labelledby="h-live"><div class="wrap">
<div class="shelf-head"><h2 id="h-live">שידור חי</h2><span class="count">${num(input.live.length, 'he')} ערוצים</span><a class="all" href="/live/">לוח השידורים</a></div>
<div class="strip live">${input.live.map((c) => channelCard(c, input, 'h3', false))}</div>
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
    html`<div class="wrap page-head"><h1>הספרייה</h1>
<p class="lead">${countShows(total)} ו-${countEpisodes(episodes)} מקשת 12, רשת 13 וכאן. בחרו תוכנית ופתחו אותה באפליקציה.</p>
<form class="searchbox" action="/search/" method="get" role="search"><input type="search" name="q" placeholder="חיפוש תוכנית" aria-label="חיפוש תוכנית"><button class="btn btn-primary" type="submit">${ICONS.search}חיפוש</button></form>
</div>${live}${shelves}`,
  );
}

/** The genre filter's script: show only the tiles of the chosen genre (all of them without the script). */
const FILTER_SCRIPT = script('genre-filter.js');

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
  const mark = CATALOG_MARK[r.id];
  return page(
    {
      title: `${name}: כל התוכניות לצפייה | Israel TV`,
      description: `${countShows(r.shows.length)} ו-${countEpisodes(episodes)} של ${name}. לצפייה ב-Stremio וב-Nuvio, בחינם.`,
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
    html`<div class="wrap page-head">
<nav aria-label="מיקום"><ol class="crumbs"><li><a href="/library/">ספרייה</a></li><li>${name}</li></ol></nav>
<h1 class="row-title">${mark ? logoTile(mark, 64) : ''}<span>${name}</span></h1>
<p class="lead">${countShows(r.shows.length)} ו-${countEpisodes(episodes)}. ${WHERE[r.source] ?? ''}</p>
${r.filling ? html`<p>${fillChip(r.filling, 'he')}</p>` : ''}
${
  genres.length
    ? html`<nav class="filters" aria-label="סינון לפי סוגה" hidden><a class="chip" href="${rowHref(r.id)}" data-g="" aria-current="true">הכול</a>${genres.map(
        (g) =>
          html`<a class="chip" href="${rowHref(r.id)}?g=${encodeURIComponent(g)}" data-g="${g}">${g}</a>`,
      )}</nav>`
    : ''
}
<div class="tiles">${r.shows.map((s, i) => tile(s.meta, { morph: true, eager: i < 6, first: i === 0 }))}</div>
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

function episodeItem(m: Meta, v: NonNullable<Meta['videos']>[number], named: boolean): Html {
  const title = plain(v.title);
  const shown = named ? title.split(' · ').slice(1).join(' · ') || title : title;
  const still = v.thumbnail
    ? html`<img class="still" src="${sized(v.thumbnail, 400)}" alt="" width="200" height="113" loading="lazy" decoding="async">`
    : html`<span class="still blank" aria-hidden="true">${v.episode ?? ''}</span>`;
  const date = v.released ? dateFmt.format(Date.parse(v.released)) : '';
  return html`<li class="ep">${still}<h3><a href="${stremioDetail('series', m.id, v.id)}" dir="auto">${shown}</a></h3>
<span class="meta">פרק ${num(v.episode ?? 0, 'he')}${date ? html` · <time datetime="${v.released ?? ''}" data-abs>${date}</time>` : ''}</span>${
    v.overview ? html`<p dir="auto">${plain(v.overview)}</p>` : ''
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
  const site = m.links?.find((l) => l.category === 'Website' && /^https?:\/\//.test(l.url))?.url;
  const years = m.releaseInfo;
  // The channel and the genres are links (the row, and the row filtered by that genre); the rest is plain text.
  const facts: { text: string; href?: string }[] = [
    { text: rowName(row.id), href: rowHref(row.id) },
    { text: years ?? '' },
    { text: m.status === 'Ended' ? 'הסתיימה' : m.status ? 'עדיין משודרת' : '' },
    { text: bySeason.size > 1 ? `${num(bySeason.size, 'he')} עונות` : '' },
    { text: countEpisodes(total) },
    ...(m.genres ?? [])
      .map(plain)
      .map((g) => ({ text: g, href: `${rowHref(row.id)}?g=${encodeURIComponent(g)}` })),
  ].filter((f) => !!f.text);
  const list = seasons.slice(0, SEASONS_IN_FULL).map(([n, vs], i) => {
    const named = n > 100;
    const long = vs.length > 40;
    const sorted = [...vs].sort((a, b) => (long ? -1 : 1) * ((a.episode ?? 0) - (b.episode ?? 0)));
    const shown = sorted.slice(0, EPISODES_PER_SEASON);
    return html`<details class="season"${i === 0 ? raw(' open') : ''}><summary><span dir="auto">${seasonName(n, vs)}</span><span class="count">${countEpisodes(vs.length)}</span></summary>
<ol class="eps">${shown.map((v) => episodeItem(m, v, named))}</ol>${
      vs.length > shown.length
        ? html`<p class="more">ועוד ${countEpisodes(vs.length - shown.length)} באפליקציה.</p>`
        : ''
    }</details>`;
  });
  const older = seasons.slice(SEASONS_IN_FULL);
  const poster = m.poster ? sized(m.poster, 520) : undefined;
  // Our own artwork is served from this site: share cards and structured data need its full address.
  const posterUrl = poster?.startsWith('/') ? absolute(poster) : poster;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TVSeries',
        name,
        url: absolute(showHref(m.id)),
        inLanguage: 'he',
        ...(description ? { description } : {}),
        ...(posterUrl ? { image: posterUrl } : {}),
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
      ...(posterUrl ? { image: posterUrl } : {}),
    },
    html`<header class="show-hero">${m.background ? html`<img class="bg" src="${sized(m.background, 1280)}" alt="" fetchpriority="low" decoding="async">` : ''}<div class="wrap">
${poster ? html`<img class="poster" src="${poster}" alt="" width="260" height="390" fetchpriority="high" style="view-transition-name:${vtName(m.id)}">` : raw('<span></span>')}
<div>
<nav aria-label="מיקום"><ol class="crumbs"><li><a href="/library/">ספרייה</a></li><li><a href="${rowHref(row.id)}">${rowName(row.id)}</a></li></ol></nav>
<h1 dir="auto">${name}</h1>
<ul class="facts">${facts.map((f) => html`<li dir="auto">${f.href ? html`<a href="${f.href}">${f.text}</a>` : f.text}</li>`)}</ul>
${description ? html`<p class="desc" dir="auto">${description}</p>` : ''}
<div class="acts"><a class="btn btn-primary" href="${stremioDetail('series', m.id)}">${ICONS.play}צפייה ב-Stremio</a>${
      site
        ? html`<a class="btn btn-ghost" href="${site}" rel="noopener">${ICONS.out}לצפייה באתר של ${broadcaster ?? 'הערוץ'}</a>`
        : ''
    }</div>
<p class="small">${
      s.source === 'mako'
        ? html`הפרקים של קשת 12 מתנגנים דרך <a href="${HELPER_DOC}">העוזר הביתי</a> שלכם. `
        : ''
    }הכפתור פותח את התוכנית ב-Stremio, אם Israel TV מותקן שם (<a href="/he/#install">איך מתקינים</a>). ב-Nuvio, אחרי ההתקנה, חפשו "<bdi>${name}</bdi>".</p>
</div></div></header>
<section class="seasons" aria-labelledby="eps-h"><div class="wrap">
<h2 id="eps-h">פרקים</h2>
${list}${
  older.length
    ? html`<p class="muted">עונות קודמות, באפליקציה:</p><ul class="older">${older.map(
        ([n, vs]) => html`<li dir="auto">${seasonName(n, vs)}: ${countEpisodes(vs.length)}</li>`,
      )}</ul>`
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
    html`<div class="wrap page-head"><h1>שידור חי</h1>
<p class="lead">${num(input.live.length, 'he')} ערוצים ומה משודר בהם עכשיו, לפי שעון ישראל. ערוצים שמסומנים "עוזר ביתי" מתנגנים רק דרך <a href="${HELPER_DOC}">העוזר הביתי</a>.</p>
</div>
<section style="padding-top:24px"><div class="wrap"><div class="channels-grid">${input.live.map((c) => channelCard(c, input, 'h2', true))}</div></div></section>`,
  );
}

/** Search over search.json, in the browser (the same matching rules as the apps' search, simplified). */
const SEARCH_SCRIPT = script('search.js');

function searchPage(): string {
  return page(
    {
      title: 'חיפוש תוכנית | Israel TV',
      description: 'חיפוש בכל התוכניות והערוצים של Israel TV: קשת 12, רשת 13, כאן ושידור חי.',
      path: 'search/',
      section: 'search',
      script: SEARCH_SCRIPT,
    },
    html`<div class="wrap page-head"><h1>חיפוש</h1>
<form class="searchbox" action="/search/" method="get" role="search" onsubmit="return false"><input id="q" type="search" name="q" placeholder="שם התוכנית או הערוץ" aria-label="שם התוכנית או הערוץ" autocomplete="off"></form>
<p class="results-info" id="info" role="status" aria-live="polite"></p>
<noscript><p class="note">החיפוש עובד רק עם JavaScript. אפשר לדפדף ב<a href="/library/">ספרייה</a>.</p></noscript>
<div class="tiles" id="results"></div>
<p class="empty-hint" id="empty" hidden>אפשר גם לדפדף ב<a href="/library/">ספרייה</a>, או לראות <a href="/live/">מה משודר עכשיו</a>.</p>
</div>`,
  );
}

/** The page for an address that does not exist: in both languages, with the ways back in. */
function notFoundPage(): string {
  return page(
    {
      title: 'הדף לא נמצא | Israel TV',
      description: 'הכתובת הזאת לא קיימת ב-Israel TV.',
      path: '404.html',
      section: 'library',
      robots: 'noindex',
    },
    html`<div class="wrap page-head not-found"><h1>הדף לא נמצא</h1>
<p class="lead">אולי התוכנית הוסרה, או שהכתובת השתנתה. אפשר לחפש אותה, או להתחיל מהספרייה.</p>
<p class="lead" lang="en" dir="ltr">This page does not exist. Search for the show, or start from the library.</p>
<form class="searchbox" action="/search/" method="get" role="search"><input type="search" name="q" placeholder="חיפוש תוכנית" aria-label="חיפוש תוכנית"><button class="btn btn-primary" type="submit">${ICONS.search}חיפוש</button></form>
<p class="browse"><a class="btn btn-plain" href="/library/">לספרייה</a><a class="btn btn-plain" href="/he/">לדף הבית</a><a class="btn btn-plain" href="/" lang="en" hreflang="en">Home (English)</a></p>
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
  files.set(sitePaths.notFound, notFoundPage());
  return files;
}

/** The library's page addresses for the sitemap (search is a tool, not a page to find). */
export function libraryUrls(files: Iterable<string>): string[] {
  return [...files]
    .filter((p) => /^(library|show|live)\//.test(p) && p.endsWith('/index.html'))
    .map((p) => p.replace(/index\.html$/, ''));
}
