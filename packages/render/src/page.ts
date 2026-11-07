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

/** Self-hosted type (no request to a font service): IBM Plex Sans Hebrew for reading, Karantina for headlines. */
const HE_RANGE = 'U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F';
const LATIN_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const face = (family: string, file: string, weight: number, range: string) =>
  `@font-face{font-family:"${family}";src:url(/fonts/${file}.woff2) format("woff2");font-weight:${weight};font-style:normal;font-display:swap;unicode-range:${range}}`;
/**
 * Stand-ins drawn from Arial (on almost every computer and phone browser that has it), scaled to the width of our
 * faces (measured per script: Karantina is far narrower than Arial in Hebrew): until a face arrives the text takes
 * the same room, so swapping it in does not rewrap lines and move the page.
 */
const standIn = (family: string, weight: number, range: string, scale: number) =>
  `@font-face{font-family:"${family} fb";src:${weight >= 600 ? 'local("Arial Bold"),local("Arial-BoldMT")' : 'local("Arial"),local("ArialMT")'};font-weight:${weight};size-adjust:${scale}%;unicode-range:${range}}`;
const FONTS = [
  face('Plex', 'plex-he-400', 400, HE_RANGE),
  face('Plex', 'plex-latin-400', 400, LATIN_RANGE),
  face('Plex', 'plex-he-600', 600, HE_RANGE),
  face('Plex', 'plex-latin-600', 600, LATIN_RANGE),
  face('Karantina', 'karantina-he-700', 700, HE_RANGE),
  face('Karantina', 'karantina-latin-700', 700, LATIN_RANGE),
  standIn('Plex', 400, HE_RANGE, 104.4),
  standIn('Plex', 400, LATIN_RANGE, 100.3),
  standIn('Plex', 600, HE_RANGE, 90.6),
  standIn('Plex', 600, LATIN_RANGE, 89.5),
  standIn('Karantina', 700, HE_RANGE, 70.6),
  standIn('Karantina', 700, LATIN_RANGE, 89.5),
].join('');

const DARK = `--bg:${BRAND.night};--bg-2:#121119;--surface:#17151e;--surface-2:#221f2b;--border:#302c3a;--fg:#f3ede3;--muted:#ada497;
--accent:${BRAND.stone};--accent-strong:#f5cd85;--accent-fg:#1c1406;--accent-soft:#2d2517;--on-air:${BRAND.onAir};
--ok:#72d6a0;--ok-bg:#12291f;--warn:#f0b54f;--warn-bg:#2f2512;--error:#ff8172;--error-bg:#341917;--none:#2b2833;
--shadow:0 12px 32px rgb(0 0 0/38%);--poster-bg:#221f2b;color-scheme:dark`;
const LIGHT = `--bg:#f5f0e7;--bg-2:#efe8dc;--surface:#fffbf4;--surface-2:#eee6d8;--border:#ddd2c0;--fg:#1d1a22;--muted:#5b5346;
--accent:#83540c;--accent-strong:#6a4308;--accent-fg:#fffbf4;--accent-soft:#f3e3c4;--on-air:#d42d1f;
--ok:#16704a;--ok-bg:#dff1e6;--warn:#8a5600;--warn-bg:#f8ebcf;--error:#b3352b;--error-bg:#f9e2de;--none:#d6cdbf;
--shadow:0 8px 24px rgb(60 40 10/12%);--poster-bg:#e6dccb;color-scheme:light`;

const CSS = `${FONTS}
:root{${DARK};--hero-fg:#f8f3ea;--hero-muted:#d3cabd;--radius:16px;--ease-out:cubic-bezier(.23,1,.32,1);--ease-io:cubic-bezier(.77,0,.175,1);
--display:"Karantina","Karantina fb","Plex",system-ui,sans-serif;--body:"Plex","Plex fb",system-ui,-apple-system,"Segoe UI","Noto Sans Hebrew","Arial Hebrew",Arial,sans-serif}
:root[data-theme=light]{${LIGHT}}
@view-transition{navigation:auto}
::view-transition-old(root),::view-transition-new(root){animation-duration:.24s;animation-timing-function:var(--ease-out)}
::view-transition-group(*){animation-duration:.32s;animation-timing-function:var(--ease-out)}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%;background:var(--bg);scrollbar-color:var(--border) transparent}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 var(--body);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:var(--accent);text-underline-offset:3px;text-decoration-thickness:1px}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:6px}
h1,h2,h3{line-height:1.15;margin:0 0 .5em;text-wrap:balance}
h1,h2{font-family:var(--display);font-weight:700;letter-spacing:.01em;line-height:.95}
h2{font-size:clamp(2.2rem,5vw,3.1rem)}
h3{font-size:1.08rem;font-weight:600}
p{margin:0 0 .8em;text-wrap:pretty}
code{font:.88em ui-monospace,"SF Mono",Menlo,Consolas,monospace;background:var(--surface-2);padding:.1em .35em;border-radius:6px;overflow-wrap:anywhere}
img{max-width:100%}
.wrap{max-width:74rem;margin-inline:auto;padding-inline:16px}
@media (min-width:720px){.wrap{padding-inline:28px}}
.skip{position:absolute;inset-inline-start:-999px;top:8px}
.skip:focus{inset-inline-start:8px;z-index:9;background:var(--surface);padding:8px 12px}
.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:blur(14px) saturate(1.3);border-bottom:1px solid color-mix(in srgb,var(--border) 70%,transparent);view-transition-name:top}
.top.over{position:absolute;inset-inline:0;background:linear-gradient(rgb(8 7 12/70%),transparent);border-color:transparent;backdrop-filter:none}
.top .wrap{display:flex;align-items:center;gap:4px;min-height:60px}
.brand{display:flex;align-items:center;gap:10px;white-space:nowrap;font:700 1.75rem/1 var(--display);letter-spacing:.02em;color:var(--fg);text-decoration:none;margin-inline-end:auto}
.brand img{width:30px;height:30px}
@media (max-width:420px){.brand{font-size:1.45rem;gap:8px}.brand img{width:26px;height:26px}.nav a{padding:8px 6px}}
.over .brand,.over .nav a,.over .icon-btn{color:var(--hero-fg)}
.nav{display:flex;align-items:center}
.nav a{color:var(--fg);text-decoration:none;padding:8px 8px;border-radius:10px;font-size:.92rem;white-space:nowrap;transition:background-color .15s var(--ease-out)}
.nav a[aria-current=page]{color:var(--accent)}
.over .nav a[aria-current=page]{color:var(--hero-fg)}
@media (min-width:720px){.nav a{padding:6px 12px;font-size:.95rem}}
.nav a:hover{background:color-mix(in srgb,currentColor 12%,transparent)}
.nav .opt{display:none}
@media (min-width:860px){.nav .opt{display:inline-block}}
.icon-btn{display:inline-grid;place-items:center;width:40px;height:40px;border-radius:10px;border:0;background:transparent;color:var(--fg);cursor:pointer;text-decoration:none}
.icon-btn:hover{background:color-mix(in srgb,currentColor 12%,transparent)}
.icon-btn svg{width:20px;height:20px}
.theme-light{display:none}
:root[data-theme=light] .theme-light{display:block}:root[data-theme=light] .theme-dark{display:none}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px}
.muted{color:var(--muted)}
.small{font-size:.875rem}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:.8rem;font-weight:600;padding:3px 10px;border-radius:999px;white-space:nowrap}
.pill::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
.ok{color:var(--ok)}.pill.ok{background:var(--ok-bg)}
.warn{color:var(--warn)}.pill.warn{background:var(--warn-bg)}
.error{color:var(--error)}.pill.error{background:var(--error-bg)}
.pill.info{color:var(--muted);background:var(--surface-2)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:10px 20px;border-radius:999px;font-weight:600;
font-size:1rem;text-decoration:none;border:1px solid transparent;cursor:pointer;font-family:inherit;transition:transform .16s var(--ease-out),background-color .16s var(--ease-out),border-color .16s var(--ease-out)}
.btn:active{transform:scale(.97)}
.btn svg{width:18px;height:18px;flex:none}
.btn-primary{background:var(--accent);color:var(--accent-fg)}
.btn-primary:hover{background:var(--accent-strong)}
.hero .btn-primary,.show-hero .btn-primary{background:${BRAND.stone};color:#1c1406}
.hero .btn-primary:hover,.show-hero .btn-primary:hover{background:#f5cd85}
.btn-ghost{background:rgb(255 255 255/8%);color:var(--hero-fg);border-color:rgb(255 255 255/28%)}
.btn-ghost:hover{background:rgb(255 255 255/16%)}
.btn-plain{background:var(--surface);color:var(--fg);border-color:var(--border)}
.btn-plain:hover{border-color:var(--accent)}
section{padding-block:56px}
.grid{display:grid;gap:16px}
@media (min-width:640px){.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:960px){.grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}}
details{border:1px solid var(--border);border-radius:14px;background:var(--surface);margin-block:10px}
details>summary{cursor:pointer;padding:14px 16px;font-weight:600;list-style:none;display:flex;gap:12px;align-items:center}
details>summary::-webkit-details-marker{display:none}
details>summary::before{content:"";width:8px;height:8px;border-inline-end:2px solid var(--accent);border-block-end:2px solid var(--accent);transform:rotate(-45deg);transition:transform .2s var(--ease-out);flex:none}
[dir=rtl] details>summary::before{transform:rotate(135deg)}
details[open]>summary::before,[dir=rtl] details[open]>summary::before{transform:rotate(45deg)}
details>.body{padding:0 16px 16px}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{text-align:start;padding:8px 6px;border-bottom:1px solid var(--border);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:.8rem}
.table-scroll{overflow-x:auto}
.on-air{display:inline-flex;align-items:center;gap:8px;font-weight:600;color:var(--on-air)}
.on-air::before{content:"";width:9px;height:9px;border-radius:50%;background:currentColor;box-shadow:0 0 0 0 currentColor;animation:pulse 1.8s var(--ease-out) infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,currentColor 60%,transparent)}100%{box-shadow:0 0 0 9px transparent}}
.poster{display:block;aspect-ratio:2/3;width:100%;height:auto;object-fit:cover;border-radius:12px;background:var(--poster-bg)}
footer{border-top:1px solid var(--border);padding-block:32px;margin-top:32px;font-size:.92rem;background:var(--bg-2)}
footer .wrap{display:flex;flex-wrap:wrap;gap:10px 20px;align-items:center}
footer nav{display:flex;flex-wrap:wrap;gap:6px 18px}
footer a{color:var(--fg)}
footer .fine{flex-basis:100%;color:var(--muted);font-size:.85rem;margin:0}
@media (prefers-reduced-motion:reduce){@view-transition{navigation:none}*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
`;

/** The few lines of script: the remembered theme, relative times, the copy button, "on the air now". */
const SCRIPT = `(function(){var d=document,r=d.documentElement,k='iltv-theme';
var b=d.getElementById('theme');if(b)b.addEventListener('click',function(){var light=r.dataset.theme!=='light';
var go=function(){r.dataset.theme=light?'light':'dark'};if(d.startViewTransition&&!matchMedia('(prefers-reduced-motion: reduce)').matches)d.startViewTransition(go);else go();
try{localStorage.setItem(k,r.dataset.theme)}catch(e){}});
var lang=r.lang||'en',rtf=window.Intl&&Intl.RelativeTimeFormat?new Intl.RelativeTimeFormat(lang,{numeric:'auto'}):null,
full=new Intl.DateTimeFormat(lang,{dateStyle:'medium',timeStyle:'short'});
function rel(t){var s=(t-Date.now())/1000,a=Math.abs(s),u=[[60,'second',1],[3600,'minute',60],[86400,'hour',3600],[2592000,'day',86400],[1/0,'month',2592000]];
for(var i=0;i<u.length;i++)if(a<u[i][0])return rtf.format(Math.round(s/u[i][2]),u[i][1]);}
d.querySelectorAll('time[datetime]').forEach(function(el){if(el.hasAttribute('data-abs'))return;var t=Date.parse(el.getAttribute('datetime'));if(isNaN(t))return;
var day=el.hasAttribute('data-daily');if(day)while(t<Date.now())t+=864e5;
if(el.hasAttribute('data-future')&&t<Date.now()){el.textContent=lang==='he'?'בקרוב':'soon';return}
el.title=full.format(t);if(rtf)el.textContent=rel(t)});
d.querySelectorAll('[data-copy]').forEach(function(btn){btn.addEventListener('click',function(){var v=d.getElementById(btn.dataset.copy).textContent.trim(),
done=function(){var o=btn.dataset.label||btn.querySelector('span').textContent;btn.dataset.label=o;btn.querySelector('span').textContent=btn.dataset.done;
setTimeout(function(){btn.querySelector('span').textContent=o},1800)};
if(navigator.clipboard)navigator.clipboard.writeText(v).then(done,function(){});else{var s=getSelection(),g=d.createRange();g.selectNodeContents(d.getElementById(btn.dataset.copy));s.removeAllRanges();s.addRange(g)}})});
var m=d.querySelectorAll('[data-stremio]');if(m.length){var h='stremio://'+location.host+'/manifest.json';m.forEach(function(a){if(a.getAttribute('href').indexOf('stremio://')!==0)a.href=h})}
d.querySelectorAll('[data-stremio-web]').forEach(function(a){if(a.href.indexOf('?addon=')<0)a.href='https://web.stremio.com/#/addons?addon='+encodeURIComponent(location.origin+'/manifest.json')});
d.querySelectorAll('[data-origin]').forEach(function(el){if(el.textContent.indexOf('{{')===0||!/^https?:/.test(el.textContent))el.textContent=location.origin+'/manifest.json'});
d.querySelectorAll('.tick').forEach(function(t){var c=t.firstElementChild.cloneNode(true);c.setAttribute('aria-hidden','true');
c.querySelectorAll('a').forEach(function(a){a.tabIndex=-1});t.appendChild(c);t.classList.add('on')});
function air(){var now=Date.now();d.querySelectorAll('[data-guide]').forEach(function(g){var seen=0;g.querySelectorAll('[data-s]').forEach(function(li){var s=+li.dataset.s,e=+li.dataset.e;
var gone=e<=now,cur=!gone&&s<=now;li.hidden=gone||seen>=(+g.dataset.guide||2);li.classList.toggle('now',cur);if(!li.hidden)seen++;
if(cur)li.style.setProperty('--p',Math.min(1,(now-s)/(e-s)).toFixed(3))});g.classList.toggle('empty',!seen)})}
air();setInterval(air,30000);
})();`;

/** Set before the page paints, so a remembered theme never flashes. */
const THEME_FIRST = `try{var t=localStorage.getItem('iltv-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export const ICONS = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
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
  /** The share card's picture (default: the site's share image). */
  image?: string;
  /** Open Graph type (default "website"). */
  ogType?: string;
}

/** The fonts a page needs before its first paint: its language's reading face and the headline face. */
const preloadFonts = (files: string[]) =>
  files
    .map((f) => `<link rel="preload" as="font" type="font/woff2" href="/fonts/${f}.woff2" crossorigin>`)
    .join('');
const FONT_PRELOAD: Record<Lang, string> = {
  en: preloadFonts(['plex-latin-400', 'karantina-latin-700']),
  // Hebrew text carries digits and app names (Latin letters): the Latin reading face too, or lines rewrap on load.
  he: preloadFonts(['plex-he-400', 'plex-latin-400', 'karantina-he-700']),
};

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
  const image = h.image ?? absolute(sitePaths.shareImage);
  return `<!doctype html><html lang="${h.lang}" dir="${h.lang === 'he' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(h.title)}</title>
<meta name="description" content="${esc(h.description)}">
<link rel="canonical" href="${esc(url)}">${alt}${xDefault}
<meta name="robots" content="index,follow">
<meta name="theme-color" content="${BRAND.night}">
<link rel="icon" href="/${sitePaths.favicon}" sizes="32x32"><link rel="icon" href="/${sitePaths.faviconSvg}" type="image/svg+xml">
<link rel="apple-touch-icon" href="/${sitePaths.appleTouchIcon}"><link rel="manifest" href="/${sitePaths.webManifest}">
${FONT_PRELOAD[h.lang]}${h.preload ? `<link rel="preload" as="image" href="${esc(h.preload)}" fetchpriority="high">` : ''}
<meta property="og:type" content="${h.ogType ?? 'website'}"><meta property="og:site_name" content="Israel TV">
<meta property="og:title" content="${esc(h.title)}"><meta property="og:description" content="${esc(h.description)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image)}">
${h.image ? '' : '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'}
<meta property="og:image:alt" content="${esc(h.image ? h.title : 'Israel TV: Israeli TV in Stremio and Nuvio')}">
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
  /** This page (marked for screen readers and drawn in the accent). */
  current?: boolean;
}

export type Section = 'home' | 'library' | 'live' | 'search' | 'status';

/** The site's own links: the library, live channels, status, and the other language of the home page. */
export function siteNav(lang: Lang, current?: Section, extra: NavLink[] = []): NavLink[] {
  const he = lang === 'he';
  return [
    ...extra,
    { href: '/library/', label: he ? 'ספרייה' : 'Library', current: current === 'library' },
    { href: '/live/', label: he ? 'שידור חי' : 'Live', current: current === 'live' },
    {
      href: '/status',
      label: he ? 'מצב' : 'Status',
      current: current === 'status',
      optional: current !== 'status',
    },
    he
      ? { href: '/', label: 'English', hreflang: 'en', optional: true }
      : { href: '/he/', label: 'עברית', hreflang: 'he', optional: true },
  ];
}

/** The top bar: logo and name, links, search, the theme button. `over`: drawn over a page's dark header picture. */
export function topBar(lang: Lang, links: NavLink[], opts: { over?: boolean; home?: string } = {}): string {
  const he = lang === 'he';
  const label = he ? 'החלפת מצב כהה/בהיר' : 'Switch between dark and light';
  const search = he ? 'חיפוש תוכנית' : 'Search for a show';
  return `<a class="skip" href="#main">${he ? 'דילוג לתוכן' : 'Skip to content'}</a>
<header class="top${opts.over ? ' over' : ''}"><div class="wrap">
<a class="brand" href="${opts.home ?? (he ? '/he/' : '/')}"><img src="/${sitePaths.faviconSvg}" alt="" width="30" height="30">Israel TV</a>
<nav class="nav" aria-label="${he ? 'ראשי' : 'Main'}">${links
    .map(
      (l) =>
        `<a href="${esc(l.href)}"${l.optional ? ' class="opt"' : ''}${l.current ? ' aria-current="page"' : ''}${l.hreflang ? ` hreflang="${l.hreflang}" lang="${l.hreflang}"` : ''}>${esc(l.label)}</a>`,
    )
    .join('')}</nav>
<a class="icon-btn" href="/search/" aria-label="${search}" title="${search}">${ICONS.search}</a>
<button class="icon-btn" id="theme" type="button" aria-label="${label}" title="${label}"><span class="theme-dark">${ICONS.sun}</span><span class="theme-light">${ICONS.moon}</span></button>
</div></header>`;
}

export function footer(lang: Lang, extra = ''): string {
  const he = lang === 'he';
  return `<footer><div class="wrap">
<nav aria-label="${he ? 'קישורים' : 'Links'}">
<a href="${he ? '/he/' : '/'}">${he ? 'דף הבית' : 'Home'}</a>
<a href="/library/">${he ? 'ספרייה' : 'Library'}</a>
<a href="/live/">${he ? 'שידור חי' : 'Live channels'}</a>
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
