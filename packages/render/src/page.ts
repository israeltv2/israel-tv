// What the public pages (landing, status) share: the head (icons, share cards, theme), one stylesheet, the header
// and footer, and the few lines of script that make times relative and remember the chosen theme. Everything is
// inline: two small pages, no extra requests, no framework, and they read the same without the script.
import { ORIGIN_TOKEN, sitePaths } from '@israel-tv/core';

export const PROJECT_URL = 'https://github.com/israeltv2/israel-tv';
export const ISSUES_URL = `${PROJECT_URL}/issues/new/choose`;
export const DOCS_URL = `${PROJECT_URL}/tree/main/docs`;
export const LICENSE_URL = `${PROJECT_URL}/blob/main/LICENSE`;

export type Lang = 'en' | 'he';

/** HTML-escaped text (attributes too). */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A Hebrew name inside English text (or the other way round), isolated so its direction cannot leak. */
export const bdi = (s: string) => `<bdi dir="auto">${esc(s)}</bdi>`;

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
export function when(iso: string | undefined, lang: Lang = 'en', opts: { future?: boolean } = {}): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return lang === 'he' ? 'לא ידוע' : 'unknown';
  const text = `${fmt(lang, ISRAEL, true).format(Date.parse(iso))} ${lang === 'he' ? 'שעון ישראל' : 'Israel time'}`;
  return `<time datetime="${esc(iso)}"${opts.future ? ' data-future' : ''}>${esc(text)}</time>`;
}

/** A plain time of day in Israel ("03:30"), for schedules. */
export const israelTime = (iso: string, lang: Lang = 'en') =>
  fmt(lang, ISRAEL, false).format(Date.parse(iso));

/** Logo colours (assets/branding/logo.png): navy frame, sky-blue screen, pale star. */
export const BRAND = { navy: '#0d1f3c', sky: '#2aa9ee', pale: '#c9eeff' } as const;

const CSS = `
:root{--bg:#f5f8fc;--surface:#fff;--surface-2:#eef3f9;--border:#d9e2ee;--fg:#0d1b2e;--muted:#4e5f77;--accent:#0a6fb5;--accent-fg:#fff;
--accent-soft:#e2f2fc;--ok:#137a52;--ok-bg:#e3f5ec;--warn:#9a5600;--warn-bg:#fdf1de;--error:#b8322a;--error-bg:#fbe6e4;--none:#c3ccd8;
--hero-fg:#fff;--hero-muted:#cfe3f4;--radius:14px;--shadow:0 1px 2px rgb(13 31 60/6%),0 4px 16px rgb(13 31 60/6%);color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#081224;--surface:#0f1d34;--surface-2:#15253f;--border:#22355a;--fg:#e8eef7;
--muted:#a3b3c9;--accent:#5cc3f5;--accent-fg:#06121f;--accent-soft:#12304d;--ok:#5bd39c;--ok-bg:#0f3327;--warn:#f2b54a;--warn-bg:#3a2a0e;
--error:#ff8a7d;--error-bg:#41191a;--none:#2c3d5c;--shadow:none;color-scheme:dark}}
:root[data-theme=dark]{--bg:#081224;--surface:#0f1d34;--surface-2:#15253f;--border:#22355a;--fg:#e8eef7;--muted:#a3b3c9;--accent:#5cc3f5;
--accent-fg:#06121f;--accent-soft:#12304d;--ok:#5bd39c;--ok-bg:#0f3327;--warn:#f2b54a;--warn-bg:#3a2a0e;--error:#ff8a7d;--error-bg:#41191a;
--none:#2c3d5c;--shadow:none;color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Hebrew","Arial Hebrew",Arial,sans-serif;
-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-underline-offset:2px}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:4px}
h1,h2,h3{line-height:1.2;margin:0 0 .5em;letter-spacing:-.01em}
h2{font-size:1.45rem;margin-top:0}
h3{font-size:1.05rem}
p{margin:0 0 .8em}
code{font:.9em ui-monospace,"SF Mono",Menlo,Consolas,monospace;background:var(--surface-2);padding:.1em .35em;border-radius:6px;overflow-wrap:anywhere}
.wrap{max-width:68rem;margin-inline:auto;padding-inline:16px}
.skip{position:absolute;inset-inline-start:-999px;top:8px}
.skip:focus{inset-inline-start:8px;z-index:9;background:var(--surface);padding:8px 12px}
.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.top.over{position:absolute;inset-inline:0;background:transparent;border-color:transparent;backdrop-filter:none}
.top .wrap{display:flex;align-items:center;gap:6px;min-height:56px}
.brand{display:flex;align-items:center;gap:10px;white-space:nowrap;font-weight:700;font-size:1.05rem;color:var(--fg);text-decoration:none;margin-inline-end:auto}
.brand img{width:32px;height:32px}
.over .brand,.over .nav a,.over .icon-btn{color:var(--hero-fg)}
.nav{display:flex;gap:0;align-items:center}
.nav a{color:var(--fg);text-decoration:none;padding:8px 7px;border-radius:8px;font-size:.92rem;white-space:nowrap}
@media (min-width:720px){.nav a{padding:6px 10px;font-size:.95rem}}
.nav a:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
.nav .opt{display:none}
@media (min-width:720px){.nav .opt{display:inline-block}}
.icon-btn{display:inline-grid;place-items:center;width:40px;height:40px;border-radius:10px;border:0;background:transparent;color:var(--fg);cursor:pointer}
.icon-btn:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
.icon-btn svg{width:20px;height:20px}
.theme-dark{display:none}
:root[data-theme=dark] .theme-dark{display:block}:root[data-theme=dark] .theme-light{display:none}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .theme-dark{display:block}:root:not([data-theme=light]) .theme-light{display:none}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px}
.muted{color:var(--muted)}
.small{font-size:.875rem}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:.8rem;font-weight:600;padding:3px 10px;border-radius:999px;white-space:nowrap}
.pill::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
.ok{color:var(--ok)}.pill.ok{background:var(--ok-bg)}
.warn{color:var(--warn)}.pill.warn{background:var(--warn-bg)}
.error{color:var(--error)}.pill.error{background:var(--error-bg)}
.pill.info{color:var(--muted);background:var(--surface-2)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:10px 18px;border-radius:12px;font-weight:650;
font-size:1rem;text-decoration:none;border:1px solid transparent;cursor:pointer;font-family:inherit}
.btn svg{width:18px;height:18px;flex:none}
.btn-primary{background:${BRAND.sky};color:#04182b}
.btn-primary:hover{background:#4dbaf3}
.btn-ghost{background:rgb(255 255 255/10%);color:#fff;border-color:rgb(255 255 255/35%)}
.btn-ghost:hover{background:rgb(255 255 255/18%)}
.btn-plain{background:var(--surface);color:var(--fg);border-color:var(--border)}
.btn-plain:hover{border-color:var(--accent)}
section{padding-block:40px}
.grid{display:grid;gap:14px}
@media (min-width:640px){.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:960px){.grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}}
details{border:1px solid var(--border);border-radius:12px;background:var(--surface);margin-block:10px}
details>summary{cursor:pointer;padding:14px 16px;font-weight:600;list-style:none;display:flex;gap:10px;align-items:center}
details>summary::-webkit-details-marker{display:none}
details>summary::before{content:"";width:8px;height:8px;border-inline-end:2px solid currentColor;border-block-end:2px solid currentColor;transform:rotate(-45deg);transition:transform .15s;flex:none}
:dir(rtl) details>summary::before,[dir=rtl] details>summary::before{transform:rotate(135deg)}
details[open]>summary::before{transform:rotate(45deg)}
details>.body{padding:0 16px 16px}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{text-align:start;padding:8px 6px;border-bottom:1px solid var(--border);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:.8rem}
.table-scroll{overflow-x:auto}
footer{border-top:1px solid var(--border);padding-block:28px;margin-top:24px;font-size:.92rem}
footer .wrap{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center}
footer nav{display:flex;flex-wrap:wrap;gap:6px 18px}
footer .fine{flex-basis:100%;color:var(--muted);font-size:.85rem;margin:0}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}}
`;

/** The few lines of script: the remembered theme, relative times, the copy button. */
const SCRIPT = `(function(){var d=document,r=d.documentElement,k='iltv-theme';
var b=d.getElementById('theme');if(b)b.addEventListener('click',function(){var dark=r.dataset.theme?r.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
r.dataset.theme=dark?'light':'dark';try{localStorage.setItem(k,r.dataset.theme)}catch(e){}});
var lang=r.lang||'en',rtf=window.Intl&&Intl.RelativeTimeFormat?new Intl.RelativeTimeFormat(lang,{numeric:'auto'}):null,
full=new Intl.DateTimeFormat(lang,{dateStyle:'medium',timeStyle:'short'});
function rel(t){var s=(t-Date.now())/1000,a=Math.abs(s),u=[[60,'second',1],[3600,'minute',60],[86400,'hour',3600],[2592000,'day',86400],[1/0,'month',2592000]];
for(var i=0;i<u.length;i++)if(a<u[i][0])return rtf.format(Math.round(s/u[i][2]),u[i][1]);}
d.querySelectorAll('time[datetime]').forEach(function(el){var t=Date.parse(el.getAttribute('datetime'));if(isNaN(t))return;
var day=el.hasAttribute('data-daily');if(day)while(t<Date.now())t+=864e5;
if(el.hasAttribute('data-future')&&t<Date.now()){el.textContent=lang==='he'?'בקרוב':'soon';return}
el.title=full.format(t);if(rtf)el.textContent=rel(t)});
d.querySelectorAll('[data-copy]').forEach(function(btn){btn.addEventListener('click',function(){var v=d.getElementById(btn.dataset.copy).textContent.trim(),
done=function(){var o=btn.dataset.label||btn.textContent;btn.dataset.label=o;btn.querySelector('span').textContent=btn.dataset.done;
setTimeout(function(){btn.querySelector('span').textContent=o},1800)};
if(navigator.clipboard)navigator.clipboard.writeText(v).then(done,function(){});else{var s=getSelection(),g=d.createRange();g.selectNodeContents(d.getElementById(btn.dataset.copy));s.removeAllRanges();s.addRange(g)}})});
var m=d.querySelectorAll('[data-stremio]');if(m.length){var h='stremio://'+location.host+'/manifest.json';m.forEach(function(a){if(a.getAttribute('href').indexOf('stremio://')!==0)a.href=h})}
d.querySelectorAll('[data-stremio-web]').forEach(function(a){if(a.href.indexOf('?addon=')<0)a.href='https://web.stremio.com/#/addons?addon='+encodeURIComponent(location.origin+'/manifest.json')});
d.querySelectorAll('[data-origin]').forEach(function(el){if(el.textContent.indexOf('{{')===0||!/^https?:/.test(el.textContent))el.textContent=location.origin+'/manifest.json'});
})();`;

/** Set before the page paints, so a remembered theme never flashes. */
const THEME_FIRST = `try{var t=localStorage.getItem('iltv-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export const ICONS = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  github:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>',
} as const;

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
}

/** The document head: title, description, canonical address, icons, share cards, theme colour, styles. */
export function head(h: PageHead, extraCss = ''): string {
  const url = absolute(h.path);
  const alt = Object.entries(h.alternates ?? {})
    .map(([l, p]) => `<link rel="alternate" hreflang="${l}" href="${esc(absolute(p))}">`)
    .join('');
  const xDefault =
    h.alternates?.en !== undefined
      ? `<link rel="alternate" hreflang="x-default" href="${esc(absolute(h.alternates.en))}">`
      : '';
  const ld = h.jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(h.jsonLd).replace(/</g, '\\u003c')}</script>`
    : '';
  const image = absolute(sitePaths.shareImage);
  return `<!doctype html><html lang="${h.lang}" dir="${h.lang === 'he' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(h.title)}</title>
<meta name="description" content="${esc(h.description)}">
<link rel="canonical" href="${esc(url)}">${alt}${xDefault}
<meta name="robots" content="index,follow">
<meta name="theme-color" content="${BRAND.navy}">
<link rel="icon" href="/${sitePaths.favicon}" sizes="32x32"><link rel="icon" href="/${sitePaths.faviconSvg}" type="image/svg+xml">
<link rel="apple-touch-icon" href="/${sitePaths.appleTouchIcon}"><link rel="manifest" href="/${sitePaths.webManifest}">
${h.preload ? `<link rel="preload" as="image" href="${esc(h.preload)}" fetchpriority="high">` : ''}
<meta property="og:type" content="website"><meta property="og:site_name" content="Israel TV">
<meta property="og:title" content="${esc(h.title)}"><meta property="og:description" content="${esc(h.description)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Israel TV: Israeli TV in Stremio and Nuvio">
<meta property="og:locale" content="${h.lang === 'he' ? 'he_IL' : 'en_US'}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(h.title)}">
<meta name="twitter:description" content="${esc(h.description)}"><meta name="twitter:image" content="${esc(image)}">
${ld}<script>${THEME_FIRST}</script>
<style>${CSS}${extraCss}</style></head>`;
}

export interface NavLink {
  href: string;
  label: string;
  /** Hidden on narrow screens. */
  optional?: boolean;
  /** For a link to the other language. */
  hreflang?: Lang;
}

/** The top bar: logo and name, links, the theme button. `over`: drawn over the landing page's dark header. */
export function topBar(lang: Lang, links: NavLink[], opts: { over?: boolean; home?: string } = {}): string {
  const label = lang === 'he' ? 'החלפת מצב כהה/בהיר' : 'Switch between dark and light';
  return `<a class="skip" href="#main">${lang === 'he' ? 'דילוג לתוכן' : 'Skip to content'}</a>
<header class="top${opts.over ? ' over' : ''}"><div class="wrap">
<a class="brand" href="${opts.home ?? '/'}"><img src="/${sitePaths.faviconSvg}" alt="" width="32" height="32">Israel TV</a>
<nav class="nav" aria-label="${lang === 'he' ? 'ראשי' : 'Main'}">${links
    .map(
      (l) =>
        `<a href="${esc(l.href)}"${l.optional ? ' class="opt"' : ''}${l.hreflang ? ` hreflang="${l.hreflang}" lang="${l.hreflang}"` : ''}>${esc(l.label)}</a>`,
    )
    .join('')}</nav>
<button class="icon-btn" id="theme" type="button" aria-label="${label}" title="${label}"><span class="theme-light">${ICONS.moon}</span><span class="theme-dark">${ICONS.sun}</span></button>
</div></header>`;
}

export function footer(lang: Lang, extra = ''): string {
  const he = lang === 'he';
  return `<footer><div class="wrap">
<nav aria-label="${he ? 'קישורים' : 'Links'}">
<a href="${he ? '/he/' : '/'}">${he ? 'דף הבית' : 'Home'}</a>
<a href="/status">${he ? 'מצב השירות' : 'Status'}</a>
<a href="${PROJECT_URL}">${he ? 'קוד המקור ב-GitHub' : 'Source code on GitHub'}</a>
<a href="${DOCS_URL}">${he ? 'תיעוד' : 'Documentation'}</a>
<a href="${ISSUES_URL}">${he ? 'דיווח על בעיה' : 'Report a problem'}</a>
<a href="${PROJECT_URL}/blob/main/docs/privacy.md">${he ? 'פרטיות' : 'Privacy'}</a>
</nav>${extra}
<p class="fine">${
    he
      ? `קוד פתוח ברישיון <a href="${LICENSE_URL}">AGPL-3.0</a>. Israel TV לא מאחסן וידאו: האפליקציה מנגנת ישירות מהשירותים החינמיים של הגופים המשדרים. בלי חשבונות ובלי מעקב.`
      : `Open source under the <a href="${LICENSE_URL}">AGPL-3.0</a> license. Israel TV hosts no video: your app plays it straight from the broadcasters' own free services. No accounts, no tracking.`
  }</p>
</div></footer>
<script>${SCRIPT}</script>`;
}
