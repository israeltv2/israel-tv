// What the public pages (landing, status) share: the head (icons, share cards, theme), one stylesheet, the header
// and footer, and the few lines of script that make times relative and remember the chosen theme. Everything is
// inline: two small pages, no extra requests, no framework, and they read the same without the script.
import { ORIGIN_TOKEN, sitePaths } from '@israel-tv/core';
import { script, style } from './assets.ts';
import { type Child, type Html, html, raw } from './html.ts';

export const PROJECT_URL = 'https://github.com/israeltv2/israel-tv';
export const ISSUES_URL = `${PROJECT_URL}/issues/new/choose`;
export const DOCS_URL = `${PROJECT_URL}/tree/main/docs`;
export const LICENSE_URL = `${PROJECT_URL}/blob/main/LICENSE`;

export type Lang = 'en' | 'he';

/** HTML-escaped text (attributes too). */

/** A Hebrew name inside English text (or the other way round), isolated so its direction cannot leak. */
export const bdi = (s: string) => html`<bdi dir="auto">${s}</bdi>`;

/** Numbers as people write them (1,234). */
export const num = (n: number, lang: Lang = 'en') => n.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US');

/** The page's absolute address (filled in at publish time, or by the server when it serves the page). */
export const absolute = (path: string) => `${ORIGIN_TOKEN}/${path.replace(/^\//, '')}`;

const ISRAEL = 'Asia/Jerusalem';
const fmt = (lang: Lang, timeZone: string, withDay: boolean) =>
  new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', {
    timeZone,
    ...(withDay ? { day: 'numeric', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

/**
 * A moment, readable without the script ("7 Nov, 03:30 Israel time"); the script turns it into "3 hours ago" in the
 * reader's own time. `<time>` elements are also what the publisher ignores when it compares status files.
 */
export function when(iso: string | undefined, lang: Lang = 'en', opts: { future?: boolean } = {}): Html {
  if (!iso || Number.isNaN(Date.parse(iso))) return html`${lang === 'he' ? 'לא ידוע' : 'unknown'}`;
  const text = `${fmt(lang, ISRAEL, true).format(Date.parse(iso))} ${lang === 'he' ? 'שעון ישראל' : 'Israel time'}`;
  return html`<time datetime="${iso}"${opts.future ? raw(' data-future') : ''}>${text}</time>`;
}

/** A plain time of day in Israel ("03:30"), for schedules. */
export const israelTime = (iso: string, lang: Lang = 'en') =>
  fmt(lang, ISRAEL, false).format(Date.parse(iso));

/**
 * Colours. The logo's own (navy frame, sky-blue screen, pale star) stay in the logo; the pages take theirs from the
 * branding's night picture: the night sky, and the lamp-lit stone of Jerusalem's walls as the one accent. Red is kept
 * for one meaning only: on the air now.
 */
export const BRAND = {
  navy: '#0d1f3c',
  sky: '#2aa9ee',
  pale: '#c9eeff',
  night: '#0d0c12',
  stone: '#e8b96a',
  onAir: '#ff5141',
} as const;

/**
 * The shared stylesheet (styles/site.css; fonts and their stand-ins, colours, components), the shared browser script
 * (client/site.js) and the one that sets a remembered theme before the page paints (client/theme-first.js).
 */
const CSS = style('site.css');
const SCRIPT = script('site.js');
const THEME_FIRST = script('theme-first.js');

const SVG = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  out: '<svg class="flip" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  github:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>',
} as const;

/** The pages' icons (decorative: hidden from screen readers; the label says what the control does). */
export const ICONS = Object.fromEntries(Object.entries(SVG).map(([k, v]) => [k, raw(v)])) as Record<
  keyof typeof SVG,
  Html
>;

export interface PageHead {
  lang: Lang;
  title: string;
  description: string;
  /** Site path of this page ("" for the home page). */
  path: string;
  /** Other language versions: lang → site path. */
  alternates?: Partial<Record<Lang, string>>;
  /** JSON-LD structured data. */
  jsonLd?: unknown;
  /** Preloaded image (the landing page's header). */
  preload?: string;
  /** The share card's picture (default: the site's share image). */
  image?: string;
  /** Open Graph type (default "website"). */
  ogType?: string;
  /** The robots rule (default "index,follow"). */
  robots?: string;
}

/** The fonts a page needs before its first paint: its language's reading face and the headline face. */
const preloadFonts = (files: string[]) =>
  files.map(
    (f) => html`<link rel="preload" as="font" type="font/woff2" href="/fonts/${f}.woff2" crossorigin>`,
  );
const FONT_PRELOAD: Record<Lang, Html[]> = {
  en: preloadFonts(['plex-latin-400', 'karantina-latin-700']),
  // Hebrew text carries digits and app names (Latin letters): the Latin reading face too, or lines rewrap on load.
  he: preloadFonts(['plex-he-400', 'plex-latin-400', 'karantina-he-700']),
};

/**
 * The browser tab's title. A Hebrew title is set right to left whatever the browser's own direction, and the Latin
 * name in it is isolated, so "Israel TV" stays in one piece ("שישי | Israel TV", not "TV | שישי … Israel").
 */
const tabTitle = (h: PageHead) =>
  h.lang === 'he'
    ? `\u200f${h.title.replace(/[A-Za-z][A-Za-z0-9 .-]*[A-Za-z0-9]/g, (m) => `\u2066${m}\u2069`)}`
    : h.title;

/** The document head: title, description, canonical address, icons, share cards, theme colour, styles. */
export function head(h: PageHead, extraCss = ''): Html {
  const url = absolute(h.path);
  const image = h.image ?? absolute(sitePaths.shareImage);
  const ld = h.jsonLd
    ? html`<script type="application/ld+json">${raw(JSON.stringify(h.jsonLd).replace(/</g, '\\u003c'))}</script>`
    : '';
  return html`<!doctype html><html lang="${h.lang}" dir="${h.lang === 'he' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${tabTitle(h)}</title>
<meta name="description" content="${h.description}">
<link rel="canonical" href="${url}">${Object.entries(h.alternates ?? {}).map(
    ([l, p]) => html`<link rel="alternate" hreflang="${l}" href="${absolute(p)}">`,
  )}${h.alternates?.en !== undefined ? html`<link rel="alternate" hreflang="x-default" href="${absolute(h.alternates.en)}">` : ''}
<meta name="robots" content="${h.robots ?? 'index,follow'}">
<meta name="theme-color" content="${BRAND.night}">
<link rel="icon" href="/${sitePaths.favicon}" sizes="32x32"><link rel="icon" href="/${sitePaths.faviconSvg}" type="image/svg+xml">
<link rel="apple-touch-icon" href="/${sitePaths.appleTouchIcon}"><link rel="manifest" href="/${sitePaths.webManifest}">
${FONT_PRELOAD[h.lang]}${h.preload ? html`<link rel="preload" as="image" href="${h.preload}" fetchpriority="high">` : ''}
<meta property="og:type" content="${h.ogType ?? 'website'}"><meta property="og:site_name" content="Israel TV">
<meta property="og:title" content="${h.title}"><meta property="og:description" content="${h.description}">
<meta property="og:url" content="${url}"><meta property="og:image" content="${image}">
${h.image ? '' : raw('<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">')}
<meta property="og:image:alt" content="${h.image ? h.title : 'Israel TV: Israeli TV in Stremio and Nuvio'}">
<meta property="og:locale" content="${h.lang === 'he' ? 'he_IL' : 'en_US'}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${h.title}">
<meta name="twitter:description" content="${h.description}"><meta name="twitter:image" content="${image}">
${ld}<script>${raw(THEME_FIRST)}</script>
<style>${raw(CSS + extraCss)}</style></head>`;
}

export interface NavLink {
  href: string;
  label: string;
  /** Hidden on narrow screens. */
  optional?: boolean;
  /** For a link to the other language. */
  hreflang?: Lang;
  /** This page (marked for screen readers and drawn in the accent). */
  current?: boolean;
}

export type Section = 'home' | 'library' | 'live' | 'search' | 'status';

/** The status page in a language. */
export const statusHref = (lang: Lang) => (lang === 'he' ? '/he/status' : '/status');

/**
 * The site's own links: the library, live channels, status, and the other language: this page's own other version
 * when it has one (`other`), else the other language's home page.
 */
export function siteNav(lang: Lang, current?: Section, extra: NavLink[] = [], other?: string): NavLink[] {
  const he = lang === 'he';
  return [
    ...extra,
    { href: '/library/', label: he ? 'ספרייה' : 'Library', current: current === 'library' },
    { href: '/live/', label: he ? 'שידור חי' : 'Live', current: current === 'live' },
    {
      href: statusHref(lang),
      label: he ? 'מצב' : 'Status',
      current: current === 'status',
      optional: current !== 'status',
    },
    he
      ? { href: other ?? '/', label: 'English', hreflang: 'en', optional: true }
      : { href: other ?? '/he/', label: 'עברית', hreflang: 'he', optional: true },
  ];
}

/** The top bar: logo and name, links, search, the theme button. `over`: drawn over a page's dark header picture. */
export function topBar(lang: Lang, links: NavLink[], opts: { over?: boolean; home?: string } = {}): Html {
  const he = lang === 'he';
  const label = he ? 'החלפת מצב כהה/בהיר' : 'Switch between dark and light';
  const search = he ? 'חיפוש תוכנית' : 'Search for a show';
  return html`<a class="skip" href="#main">${he ? 'דילוג לתוכן' : 'Skip to content'}</a>
<header class="top${opts.over ? ' over' : ''}"><div class="wrap">
<a class="brand" href="${opts.home ?? (he ? '/he/' : '/')}"><img src="/${sitePaths.faviconSvg}" alt="" width="30" height="30">Israel TV</a>
<nav class="nav" aria-label="${he ? 'ראשי' : 'Main'}">${links.map(navLink)}</nav>
<a class="icon-btn" href="/search/" aria-label="${search}" title="${search}">${ICONS.search}</a>
<button class="icon-btn" id="theme" type="button" aria-label="${label}" title="${label}"><span class="theme-dark">${ICONS.sun}</span><span class="theme-light">${ICONS.moon}</span></button>
</div></header>`;
}

const navLink = (l: NavLink) =>
  html`<a href="${l.href}"${l.optional ? raw(' class="opt"') : ''}${l.current ? raw(' aria-current="page"') : ''}${
    l.hreflang ? html` hreflang="${l.hreflang}" lang="${l.hreflang}"` : ''
  }>${l.label}</a>`;

export function footer(lang: Lang, extra: Child = ''): Html {
  const he = lang === 'he';
  return html`<footer><div class="wrap">
<nav aria-label="${he ? 'קישורים' : 'Links'}">
<a href="${he ? '/he/' : '/'}">${he ? 'דף הבית' : 'Home'}</a>
<a href="/library/">${he ? 'ספרייה' : 'Library'}</a>
<a href="/live/">${he ? 'שידור חי' : 'Live channels'}</a>
<a href="${statusHref(lang)}">${he ? 'מצב השירות' : 'Status'}</a>
<a href="${PROJECT_URL}">${he ? 'קוד המקור ב-GitHub' : 'Source code on GitHub'}</a>
<a href="${DOCS_URL}">${he ? 'תיעוד' : 'Documentation'}</a>
<a href="${ISSUES_URL}">${he ? 'דיווח על בעיה' : 'Report a problem'}</a>
<a href="${PROJECT_URL}/blob/main/docs/privacy.md">${he ? 'פרטיות' : 'Privacy'}</a>
</nav>${extra}
<p class="fine">${
    he
      ? html`קוד פתוח, ברישיון <a href="${LICENSE_URL}">AGPL-3.0</a>. אין כאן אחסון של וידאו: האפליקציה מנגנת ישירות מהשירותים החינמיים של הערוצים. בלי חשבונות ובלי מעקב.`
      : html`Open source under the <a href="${LICENSE_URL}">AGPL-3.0</a> license. Israel TV hosts no video: your app plays it straight from the broadcasters' own free services. No accounts, no tracking.`
  }</p>
</div></footer>
<script>${raw(SCRIPT)}</script>`;
}

/**
 * A logo in the site's one logo tile: the same box, padding and corner for every channel and row, the logo contained
 * in it. A lettered mark (a row without a channel of its own) gets the same box.
 */
export function logoTile(
  mark: { logo: string } | { text: string; over: string } | undefined,
  size: number,
): Html {
  const style = `--s:${size}px`;
  if (!mark) return html`<span class="logo-tile" style="${style}" aria-hidden="true"></span>`;
  if ('text' in mark)
    return html`<span class="logo-tile" style="${style}" aria-hidden="true"><span class="lt-over">${mark.over}</span><span class="lt-text">${mark.text}</span></span>`;
  return html`<span class="logo-tile" style="${style}"><img src="/${sitePaths.channelLogo(mark.logo)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async"></span>`;
}

/** The small "opens another site" arrow after a text link (mirrored in right-to-left text). */
const EXT_ICON =
  '<svg class="ext ico-dir" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 16 16 8M9 8h7v7"/></svg>';

/**
 * Every link that leaves the site opens in a new tab, says so to screen readers, and (a text link) shows the arrow;
 * links within the site and app links (stremio://) stay as they are. Applied to each finished page.
 */
export function externalLinks(page: Html | string, lang: Lang): string {
  const note = lang === 'he' ? ' (נפתח בכרטיסייה חדשה)' : ' (opens in a new tab)';
  return String(page).replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/g, (all, attrs: string, body: string) => {
    const href = /\shref="([^"]*)"/.exec(attrs)?.[1] ?? '';
    if (!/^https?:\/\//.test(href) || href.startsWith(ORIGIN_TOKEN)) return all;
    const rest = attrs.replace(/\s(target|rel)="[^"]*"/g, '');
    const button = /\sclass="[^"]*\bbtn\b/.test(attrs);
    // A word joiner keeps the arrow on the line of the link's last word.
    return `<a${rest} target="_blank" rel="noopener noreferrer">${body}${button ? '' : `\u2060${EXT_ICON}`}<span class="sr">${note}</span></a>`;
  });
}

/**
 * A picture at a sensible size for where it is shown: the image services the broadcasters use resize on request
 * (Reshet's Cloudinary, Kan's own sites); other images are used as they are.
 */
export function sized(url: string, width: number): string {
  // Our own copies (art/…) are on this site: a same-site address works before the public address is known.
  if (url.startsWith(`${ORIGIN_TOKEN}/`)) return url.slice(ORIGIN_TOKEN.length);
  if (/^https:\/\/media\d*\.reshet\.tv\/image\/upload\//.test(url) && !/\/upload\/[a-z]_/.test(url))
    return url.replace('/image/upload/', `/image/upload/w_${width},c_limit,f_auto,q_auto/`);
  if (/^https:\/\/(?:www\.)?kan(?:kids)?\.org\.il\/media\//.test(url)) {
    const u = new URL(url);
    u.searchParams.set('width', String(width));
    u.searchParams.delete('height');
    u.searchParams.set('rmode', 'max');
    return u.toString();
  }
  return url;
}
