// The page people see when they open the addon's address in a browser (/, and /he/ in Hebrew): what Israel TV is,
// what is in it (the real rows, counts and live channels, written in when the site is rendered), how to add it in
// one click, the home helper and watching from abroad in plain words, questions, and where the project lives.
// Pre-rendered: the page reads complete without its few lines of script.
import { sitePaths } from '@israel-tv/core';
import { CATALOG_LOGO, catalogAppName, catalogName } from './names.ts';
import {
  absolute,
  bdi,
  DOCS_URL,
  esc,
  footer,
  head,
  ICONS,
  ISSUES_URL,
  type Lang,
  LICENSE_URL,
  num,
  PROJECT_URL,
  topBar,
} from './page.ts';
import type { Overall } from './status-html.ts';

export { PROJECT_URL } from './page.ts';

export interface LandingInput {
  name: string;
  description: string;
  /** The rows as published, in the apps' order. */
  catalogs: {
    id: string;
    source: string;
    shows: number;
    episodes: number;
    filling?: { inCatalog: number; known: number };
  }[];
  live: { id: string; name: string; logo: boolean; helper: boolean }[];
  /** The status page's headline. */
  status?: Overall;
  /** The addon's public address when known (else the page's script fills in the install links). */
  publicUrl?: string;
}

const HELPER_DOC = `${PROJECT_URL}/blob/main/docs/setup/home-helper.md`;
const ABROAD_DOC = `${HELPER_DOC}#watching-from-abroad`;
const AGENTS_DOC = `${PROJECT_URL}/blob/main/docs/setup/for-agents.md`;
const SELF_HOST_DOC = `${PROJECT_URL}/blob/main/docs/setup/README.md`;
const BROKEN_URL = `${PROJECT_URL}/issues/new?template=broken-source.yml`;
const TAKEDOWN_DOC = `${PROJECT_URL}/blob/main/docs/takedown.md`;
const ISRAEL_ONLY_LABEL = 'זמין לצפייה רק בישראל';

/** Where each source plays: in Israel, abroad (plain words). */
const WHERE: Record<string, Record<Lang, { israel: string; abroad: string; helper?: boolean }>> = {
  mako: {
    en: { israel: 'With the home helper', abroad: 'With the home helper', helper: true },
    he: { israel: 'עם העוזר הביתי', abroad: 'עם העוזר הביתי', helper: true },
  },
  reshet: {
    en: { israel: 'Plays', abroad: 'Most episodes play' },
    he: { israel: 'מתנגן', abroad: 'רוב הפרקים מתנגנים' },
  },
  kan: {
    en: { israel: 'Plays', abroad: 'Some titles play' },
    he: { israel: 'מתנגן', abroad: 'חלק מהתוכניות מתנגנות' },
  },
};

const LANDING_CSS = `
.hero{position:relative;color:var(--hero-fg);background:#0b1730 url(/${sitePaths.heroImage}) center 78%/cover no-repeat;isolation:isolate}
.hero::before{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,rgb(7 15 33/55%) 0%,rgb(7 15 33/35%) 45%,rgb(7 15 33/88%) 100%)}
.hero .wrap{padding-block:104px 56px;display:grid;gap:20px}
@media (min-width:900px){.hero .wrap{padding-block:136px 84px}}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:.85rem;font-weight:600;color:var(--hero-muted);letter-spacing:.02em}
.hero h1{font-size:clamp(2.1rem,6.4vw,3.6rem);line-height:1.05;margin:0;max-width:16ch;letter-spacing:-.025em}
.hero .lead{font-size:clamp(1.05rem,2.4vw,1.25rem);color:var(--hero-muted);max-width:40rem;margin:0}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px}
.link-box{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;background:rgb(255 255 255/8%);border:1px solid rgb(255 255 255/20%);border-radius:14px;padding:12px 14px;max-width:44rem;backdrop-filter:blur(6px)}
.link-box code{background:transparent;color:#fff;font-size:clamp(.8rem,3.4vw,.95rem);padding:0;direction:ltr;unicode-bidi:isolate}
.link-box .small{color:var(--hero-muted);flex-basis:100%}
.status-chip{display:inline-flex;align-items:center;gap:8px;color:#fff;text-decoration:none;font-size:.92rem;background:rgb(255 255 255/10%);border:1px solid rgb(255 255 255/22%);padding:6px 12px;border-radius:999px;justify-self:start}
.status-chip:hover{background:rgb(255 255 255/16%)}
.status-chip i{width:9px;height:9px;border-radius:50%;background:#4fd39b;box-shadow:0 0 0 3px rgb(79 211 155/25%)}
.status-chip.warn i,.status-chip.info i{background:#f5bd4f;box-shadow:0 0 0 3px rgb(245 189 79/25%)}
.status-chip.error i{background:#ff7b6e;box-shadow:0 0 0 3px rgb(255 123 110/25%)}
.stats{display:flex;flex-wrap:wrap;gap:10px 28px;margin:0;padding:0;list-style:none}
.stats li{display:flex;flex-direction:column}
.stats strong{font-size:1.6rem;font-variant-numeric:tabular-nums;line-height:1.1}
.stats span{color:var(--hero-muted);font-size:.85rem}
.section-lead{color:var(--muted);max-width:44rem;margin-bottom:20px}
.rows-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))}
.row{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;align-items:center}
.row img{grid-row:span 2;border-radius:12px;background:var(--surface-2)}
.row h3{margin:0;font-size:1.2rem}
.row .en{color:var(--muted);font-size:.9rem}
.row dl{grid-column:1/-1;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:10px 0 0;font-size:.9rem}
.row dt{color:var(--muted)}.row dd{margin:0}
.row .counts{grid-column:1/-1;font-size:.95rem;margin:6px 0 0}
.home{color:var(--warn);font-weight:600}
.channels{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(min(100%,150px),1fr))}
.channels li{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:8px 10px;font-weight:550}
.channels img{border-radius:8px;flex:none;background:var(--surface-2)}
.channels .nm{display:flex;flex-direction:column;align-items:flex-start;min-width:0;line-height:1.3}
.channels .tag{font-size:.7rem;font-weight:600;color:var(--warn);border:1px solid currentColor;border-radius:6px;padding:0 6px;margin-top:3px;white-space:nowrap}
.filling{grid-column:1/-1;margin:4px 0 0;font-size:.85rem;color:var(--accent)}
.steps{counter-reset:s;list-style:none;margin:0;padding:0;display:grid;gap:12px}
.steps li{counter-increment:s;display:grid;grid-template-columns:32px 1fr;gap:12px;align-items:start}
.steps li::before{content:counter(s);width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-weight:700;background:var(--accent-soft);color:var(--accent)}
.alt{background:var(--surface-2);border-block:1px solid var(--border)}
.callout{border-inline-start:4px solid var(--accent);background:var(--accent-soft);border-radius:10px;padding:12px 16px;margin:16px 0}
.he-label{font-weight:700}
.faq details{background:var(--surface)}
.oss{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
`;

const t = (lang: Lang, en: string, he: string) => (lang === 'he' ? he : en);

/** The landing page in English (`/`) or Hebrew (`/he/`). */
export function renderLandingHtml(input: LandingInput, lang: Lang = 'en'): string {
  const he = lang === 'he';
  const base = input.publicUrl?.replace(/\/+$/, '');
  const manifestUrl = base ? `${base}/${sitePaths.manifest}` : absolute(sitePaths.manifest);
  const stremio = base
    ? `stremio://${base.replace(/^https?:\/\//, '')}/${sitePaths.manifest}`
    : `/${sitePaths.manifest}`;
  const stremioWeb = base
    ? `https://web.stremio.com/#/addons?addon=${encodeURIComponent(`${base}/${sitePaths.manifest}`)}`
    : 'https://web.stremio.com/#/addons';
  const shows = input.catalogs.filter((c) => c.source !== 'live');
  const totalShows = shows.reduce((n, c) => n + c.shows, 0);
  const totalEpisodes = shows.reduce((n, c) => n + c.episodes, 0);
  const liveCount = input.live.length;
  const helperChannels = input.live.filter((c) => c.helper);
  const hasMako = input.catalogs.some((c) => c.source === 'mako');
  const rowNames = input.catalogs.map((c) => `<span class="he-label">${bdi(catalogAppName(c.id))}</span>`);
  const home = he ? '/he/' : '/';
  const title = t(
    lang,
    'Israel TV: Israeli TV shows and live channels in Stremio and Nuvio',
    'Israel TV: תוכניות ישראליות ושידורים חיים ב-Stremio וב-Nuvio',
  );
  const description = t(
    lang,
    `Watch Keshet 12, Reshet 13, Kan and ${liveCount || 'Israeli'} live channels in Stremio and Nuvio: ${num(totalShows)} shows and ${num(totalEpisodes)} episodes, free, no account. One-click install.`,
    `קשת 12, רשת 13, כאן ו-${liveCount || ''} ערוצים בשידור חי ב-Stremio וב-Nuvio: ${num(totalShows, lang)} תוכניות ו-${num(totalEpisodes, lang)} פרקים, בחינם ובלי הרשמה. התקנה בלחיצה.`,
  );
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: input.name,
    description: input.description,
    url: absolute(he ? 'he/' : ''),
    image: absolute(sitePaths.shareImage),
    applicationCategory: 'EntertainmentApplication',
    applicationSubCategory: 'Stremio addon',
    operatingSystem: 'Android, iOS, Windows, macOS, Linux, Android TV (in Stremio or Nuvio)',
    inLanguage: 'he',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
    sameAs: [PROJECT_URL],
  };

  const statusChip = input.status
    ? `<a class="status-chip ${input.status.level}" href="/status"><i aria-hidden="true"></i>${esc(
        he ? HE_STATUS[input.status.level] : input.status.title,
      )} · ${t(lang, 'Status page', 'דף המצב')}</a>`
    : `<a class="status-chip" href="/status"><i aria-hidden="true"></i>${t(lang, 'Status page', 'דף המצב')}</a>`;

  const rowCards = shows
    .map((c) => {
      const where = WHERE[c.source]?.[lang];
      const logo = input.live.length ? CATALOG_LOGO[c.id] : undefined;
      return `<article class="card row">${logo ? `<img src="/${esc(sitePaths.channelLogo(logo))}" alt="" width="52" height="52" loading="lazy">` : ''}
<h3><bdi lang="he" dir="rtl">${esc(catalogAppName(c.id))}</bdi></h3>${he ? '' : `<span class="en">${esc(catalogName(c.id, 'en'))}</span>`}
<p class="counts"><strong>${num(c.shows, lang)}</strong> ${t(lang, 'shows', 'תוכניות')} · <strong>${num(c.episodes, lang)}</strong> ${t(lang, 'episodes', 'פרקים')}</p>
${
  c.filling
    ? `<p class="filling">${t(
        lang,
        `Still filling: ${num(c.filling.inCatalog)} of ${num(c.filling.known)} shows so far, the rest over the next days.`,
        `עדיין מתמלאת: ${num(c.filling.inCatalog, lang)} מתוך ${num(c.filling.known, lang)} תוכניות עד עכשיו, השאר בימים הקרובים.`,
      )}</p>`
    : ''
}
${
  where
    ? `<dl><dt>${t(lang, 'In Israel', 'בישראל')}</dt><dd${where.helper ? ' class="home"' : ''}>${esc(where.israel)}</dd><dt>${t(lang, 'Abroad', 'בחו״ל')}</dt><dd${where.helper ? ' class="home"' : ''}>${esc(where.abroad)}</dd></dl>`
    : ''
}</article>`;
    })
    .join('');

  const channels = input.live
    .map(
      (c) =>
        `<li>${c.logo ? `<img src="/${esc(sitePaths.channelLogo(c.id))}" alt="" width="36" height="36" loading="lazy">` : ''}<span class="nm">${bdi(c.name)}${
          c.helper ? `<span class="tag">${t(lang, 'home helper', 'עוזר ביתי')}</span>` : ''
        }</span></li>`,
    )
    .join('');

  const faq: [string, string][] = he
    ? [
        [
          'פרק חדש עוד לא מופיע.',
          'פרקים חדשים מופיעים בדרך כלל תוך שעה-שעתיים מרגע שעלו לאתר הערוץ. האפליקציות שומרות את השורות לזמן מה: משכו למטה לרענון, או הפעילו את האפליקציה מחדש.',
        ],
        [
          'שורה מתחילה ב-⚠.',
          'האתר של הערוץ לא נקרא כבר זמן מה. מה שרואים הוא הרשימה הטובה האחרונה, והיא ממשיכה להתנגן. <a href="/status">דף המצב</a> מראה מה קורה.',
        ],
        [
          'שורה מתחילה ב-⏳.',
          'השורה עדיין מתמלאת (התוכניות של כאן מגיעות במשך כמה ימים). הפריט הראשון אומר כמה כבר נכנסו.',
        ],
        [
          'משהו לא מתנגן.',
          `בדקו את <a href="/status">דף המצב</a>, ואז <a href="${BROKEN_URL}">ספרו לנו</a> איזו תוכנית ואיזה פרק. אם כתוב „${ISRAEL_ONLY_LABEL}” ואתם בחו״ל, זו החלטה של הגוף המשדר.`,
        ],
        [
          'החיפוש לא מוצא כלום.',
          'חפשו בעברית, כמו שהערוץ כותב את השם. תוכניות מוכרות רבות נמצאות גם לפי השם באנגלית.',
        ],
        [
          'זה עובד עם התוספים האחרים שלי?',
          'כן. כשפותחים תוכנית ישראלית משורות של תוסף אחר, Israel TV מוסיף את הפרקים שלו גם שם, אם הוא מכיר את התוכנית והעונות ממוספרות אותו דבר. סרטים הוא לא נוגע בהם.',
        ],
        [
          'כמה זה עולה? צריך חשבון?',
          'שום דבר, ולא. אין חשבונות ואין מעקב. הווידאו מגיע ישירות מהשירותים החינמיים של הגופים המשדרים; Israel TV לא מאחסן וידאו.',
        ],
        ['יש לי זכויות במשהו שמופיע כאן ואני רוצה שיוסר.', `ראו <a href="${TAKEDOWN_DOC}">בקשות הסרה</a>.`],
      ]
    : [
        [
          'A new episode is not there yet.',
          'New episodes usually appear within an hour or two of going online on the channel’s site. Apps keep the rows for a while: pull down to refresh, or restart the app.',
        ],
        [
          'A row starts with ⚠.',
          'That channel’s site has not been read for a while. What you see is the last good list, and it still plays. The <a href="/status">status page</a> says what is going on.',
        ],
        [
          'A row starts with ⏳.',
          'That row is still filling (Kan’s shows arrive over a few days). The first item says how many are in so far.',
        ],
        [
          'Something does not play.',
          `Check the <a href="/status">status page</a>, then <a href="${BROKEN_URL}">tell us</a> which show and episode. If it says <span lang="he" dir="rtl" class="he-label">${ISRAEL_ONLY_LABEL}</span> and you are abroad, that is the broadcaster’s choice.`,
        ],
        [
          'Search finds nothing.',
          'Search in Hebrew, the way the channel writes the title. Many well-known shows are also found by their English name.',
        ],
        [
          'Does it work with my other addons?',
          'Yes. When you open an Israeli show from another addon’s rows (Stremio’s own, for example), Israel TV adds its episodes there too, if it knows the show and the seasons are numbered the same. It never touches movies.',
        ],
        [
          'What does it cost? Do I need an account?',
          'Nothing, and no. There are no accounts and no tracking. The video comes straight from the broadcasters’ own free services; Israel TV hosts no video.',
        ],
        [
          'You own something shown here and want it removed?',
          `See <a href="${TAKEDOWN_DOC}">removal requests</a>.`,
        ],
      ];

  const nav = [
    { href: '#watch', label: t(lang, 'What’s on', 'מה יש'), optional: true },
    { href: '#install', label: t(lang, 'Install', 'התקנה') },
    { href: '#abroad', label: t(lang, 'Abroad', 'בחו״ל'), optional: true },
    { href: '#faq', label: t(lang, 'Questions', 'שאלות'), optional: true },
    { href: '/status', label: t(lang, 'Status', 'מצב') },
    he
      ? { href: '/', label: 'English', hreflang: 'en' as const }
      : { href: '/he/', label: 'עברית', hreflang: 'he' as const },
  ];

  return `${head(
    {
      lang,
      title,
      description,
      path: he ? 'he/' : '',
      alternates: { en: '', he: 'he/' },
      jsonLd,
      preload: `/${sitePaths.heroImage}`,
    },
    LANDING_CSS,
  )}<body>
${topBar(lang, nav, { over: true, home })}
<main id="main">
<div class="hero"><div class="wrap">
<span class="eyebrow">${t(lang, 'Free addon for Stremio and Nuvio', 'תוסף חינמי ל-Stremio ול-Nuvio')}</span>
<h1>${t(lang, 'Israeli TV, in the app you already use', 'טלוויזיה ישראלית, באפליקציה שכבר יש לכם')}</h1>
<p class="lead">${t(
    lang,
    `Keshet 12, Reshet 13, Kan${liveCount ? ` and ${liveCount} live channels` : ''}: thousands of episodes in Hebrew, newest first. Free, no account, nothing to sign up for.`,
    `קשת 12, רשת 13, כאן${liveCount ? ` ו-${liveCount} ערוצים בשידור חי` : ''}: אלפי פרקים, החדשים ראשונים. בחינם, בלי חשבון ובלי הרשמה.`,
  )}</p>
<div class="actions">
<a class="btn btn-primary" href="${esc(stremio)}" data-stremio>${ICONS.play}${t(lang, 'Install in Stremio', 'התקנה ב-Stremio')}</a>
<button class="btn btn-ghost" type="button" data-copy="manifest-url" data-done="${t(lang, 'Copied', 'הועתק')}">${ICONS.copy}<span>${t(lang, 'Copy the link', 'העתקת הקישור')}</span></button>
</div>
<div class="link-box"><span class="small">${t(lang, 'Or paste this link into your app’s addon search (Nuvio too):', 'או הדביקו את הקישור הזה בחיפוש התוספים של האפליקציה (גם ב-Nuvio):')}</span><code id="manifest-url" data-origin>${esc(manifestUrl)}</code></div>
<ul class="stats" aria-label="${t(lang, 'In the catalog now', 'בקטלוג עכשיו')}">
<li><strong>${num(totalShows, lang)}</strong><span>${t(lang, 'shows', 'תוכניות')}</span></li>
<li><strong>${num(totalEpisodes, lang)}</strong><span>${t(lang, 'episodes', 'פרקים')}</span></li>
${liveCount ? `<li><strong>${num(liveCount, lang)}</strong><span>${t(lang, 'live channels', 'ערוצים בשידור חי')}</span></li>` : ''}
</ul>
${statusChip}
</div></div>

<section id="watch" aria-labelledby="watch-h"><div class="wrap">
<h2 id="watch-h">${t(lang, 'What you can watch', 'מה אפשר לראות')}</h2>
<p class="section-lead">${t(
    lang,
    `After you add it, your app has new rows: ${rowNames.join(', ')}. Shows are in Hebrew, newest episode first, with search and show pages. Episodes keep their numbers for good, so your progress stays put.`,
    `אחרי ההוספה יופיעו באפליקציה שורות חדשות: ${rowNames.join(', ')}. התוכניות בעברית, הפרק החדש ראשון, עם חיפוש ודפי תוכנית. מספרי הפרקים לא משתנים, כך שהמקום שבו עצרתם נשמר.`,
  )}</p>
<div class="rows-grid">${rowCards}</div>
${
  liveCount
    ? `<h3 style="margin-top:32px">${t(lang, 'Live channels', 'ערוצים בשידור חי')}</h3>
<p class="section-lead">${t(
        lang,
        `With what is on now and next. Apps with a TV-guide screen also get the full programme guide.${helperChannels.length ? ' Channels marked “home helper” play only through your own home helper.' : ''}`,
        `עם מה משודר עכשיו ומה הבא. באפליקציות עם מסך לוח שידורים מופיע גם לוח השידורים המלא.${helperChannels.length ? ' ערוצים שמסומנים „עוזר ביתי” מתנגנים רק דרך העוזר הביתי שלכם.' : ''}`,
      )}</p>
<ul class="channels">${channels}</ul>`
    : ''
}
</div></section>

<section id="install" class="alt" aria-labelledby="install-h"><div class="wrap">
<h2 id="install-h">${t(lang, 'Add it in a minute', 'הוספה בדקה')}</h2>
<p class="section-lead">${t(lang, 'The link is the whole install: nothing to download, no account to make.', 'הקישור הוא כל ההתקנה: אין מה להוריד ואין חשבון לפתוח.')}</p>
<div class="grid two">
<div class="card"><h3>Stremio</h3><ol class="steps">
<li><span>${t(
    lang,
    `Press <a href="${esc(stremio)}" data-stremio>Install in Stremio</a> on this page, on a computer or phone that has Stremio. No Stremio app here? Use <a href="${esc(stremioWeb)}" data-stremio-web>Stremio’s website</a>.`,
    `לחצו על <a href="${esc(stremio)}" data-stremio>התקנה ב-Stremio</a> בדף הזה, במחשב או בטלפון שמותקן בהם Stremio. אין כאן את האפליקציה? השתמשו ב<a href="${esc(stremioWeb)}" data-stremio-web>אתר של Stremio</a>.`,
  )}</span></li>
<li><span>${t(lang, 'Or: open <strong>Addons</strong> in Stremio, paste the link into the search box and choose <strong>Install</strong>.', 'או: פתחו ב-Stremio את <strong>Addons</strong>, הדביקו את הקישור בתיבת החיפוש ובחרו <strong>Install</strong>.')}</span></li>
<li><span>${t(lang, 'Signed in to Stremio? It then appears in all your Stremio apps, the TV too.', 'מחוברים לחשבון Stremio? התוסף יופיע בכל האפליקציות שלכם, גם בטלוויזיה.')}</span></li>
</ol></div>
<div class="card"><h3>Nuvio</h3><ol class="steps">
<li><span>${t(lang, 'Copy the link above.', 'העתיקו את הקישור שלמעלה.')}</span></li>
<li><span>${t(lang, 'In Nuvio open <strong>Settings → Addons → Add addon</strong>.', 'ב-Nuvio פתחו <strong>Settings ← Addons ← Add addon</strong>.')}</span></li>
<li><span>${t(lang, 'Paste the link and add it. The new rows appear on the home screen.', 'הדביקו את הקישור והוסיפו. השורות החדשות יופיעו במסך הבית.')}</span></li>
</ol></div>
</div>
<p class="callout">${t(
    lang,
    '<strong>On a TV?</strong> Typing a link with a remote is no fun: add it on your phone or computer, signed in to the same Stremio account, and it shows up on the TV too.',
    '<strong>בטלוויזיה?</strong> להקליד קישור עם שלט זה לא כיף: הוסיפו אותו בטלפון או במחשב, מחוברים לאותו חשבון Stremio, והוא יופיע גם בטלוויזיה.',
  )}</p>
</div></section>

${
  hasMako || helperChannels.length
    ? `<section id="helper" aria-labelledby="helper-h"><div class="wrap">
<h2 id="helper-h">${t(lang, 'Keshet 12 and the home helper', 'קשת 12 והעוזר הביתי')}</h2>
<div class="grid two"><div>
<p>${t(
        lang,
        'Keshet 12 lets a video play only when your own home internet asks for it. So Keshet 12 needs a small <strong>home helper</strong>: a little program on a computer that stays on at home (a desktop PC or Mac, a storage box or a Raspberry Pi), which you add to your app as a second link.',
        'קשת 12 מאפשרת לנגן וידאו רק כשהבקשה מגיעה מהאינטרנט הביתי שלכם. לכן לקשת 12 צריך <strong>עוזר ביתי</strong> קטן: תוכנה קטנה על מחשב שנשאר דלוק בבית (מחשב שולחני, מק, כונן רשת או Raspberry Pi), שמוסיפים לאפליקציה כקישור שני.',
      )}</p>
<p>${t(
        lang,
        `Without it, Keshet 12’s shows are listed but have nothing to play${helperChannels.length ? `, and so are ${helperChannels.length} of the live channels` : ''}. Everything else works without it.`,
        `בלעדיו, התוכניות של קשת 12 מופיעות אבל אין בהן מה לנגן${helperChannels.length ? `, וכך גם ${helperChannels.length} מהערוצים החיים` : ''}. כל השאר עובד גם בלעדיו.`,
      )}</p>
</div><div class="card">
<p>${t(
        lang,
        'Setting it up takes 15 minutes to an hour the first time, and that computer has to stay on. It then plays at home; on a phone outside the house it needs some extra setup.',
        'ההתקנה לוקחת בפעם הראשונה בין רבע שעה לשעה, והמחשב צריך להישאר דלוק. אחרי זה הוא מנגן בבית; בטלפון מחוץ לבית צריך עוד קצת הגדרות.',
      )}</p>
<div class="oss"><a class="btn btn-plain" href="${HELPER_DOC}">${t(lang, 'Set up the home helper', 'התקנת העוזר הביתי')}</a><a class="btn btn-plain" href="${AGENTS_DOC}">${t(lang, 'Let an AI assistant do it', 'לתת לעוזר AI לעשות את זה')}</a></div>
</div></div>
</div></section>`
    : ''
}

<section id="abroad" class="alt" aria-labelledby="abroad-h"><div class="wrap">
<h2 id="abroad-h">${t(lang, 'Watching from abroad', 'צפייה מחו״ל')}</h2>
<div class="grid two"><div>
<p>${t(
    lang,
    'Everything in the catalog shows up anywhere in the world. Most live channels and most of Reshet 13 play anywhere, and so do the Kan titles the broadcaster allows abroad.',
    'כל מה שבקטלוג מופיע בכל מקום בעולם. רוב הערוצים החיים ורוב התוכן של רשת 13 מתנגנים בכל מקום, וכך גם תוכניות כאן שהגוף המשדר מתיר לצפייה בחו״ל.',
  )}</p>
<p>${t(
    lang,
    `A stream that plays only from an Israeli internet connection says so in the app: <span class="he-label" lang="he" dir="rtl">${ISRAEL_ONLY_LABEL}</span> (only in Israel). That is the broadcaster’s choice, not the app’s.`,
    `וידאו שמתנגן רק מחיבור אינטרנט ישראלי מסומן באפליקציה: <span class="he-label">${ISRAEL_ONLY_LABEL}</span>. זו החלטה של הגוף המשדר, לא של האפליקציה.`,
  )}</p>
</div><div class="card">
<p>${t(
    lang,
    'Keshet 12 plays with the home helper on your home network, wherever in the world your home is. The home helper can also fetch the Israel-only titles for you, through a VPN or proxy service with an Israeli location that you may already pay for. Those titles then show a second source, <span class="he-label" lang="he" dir="rtl">דרך החיבור הישראלי שלך</span>: pick that one.',
    'קשת 12 מתנגנת עם העוזר הביתי ברשת הביתית שלכם, בכל מקום בעולם שבו הבית נמצא. העוזר הביתי יכול גם להביא את התוכניות שזמינות רק בישראל, דרך שירות VPN או פרוקסי עם מיקום ישראלי (שירות בתשלום שאולי כבר יש לכם). לתוכניות האלה יופיע אז מקור נוסף, <span class="he-label">דרך החיבור הישראלי שלך</span>: בחרו בו.',
  )}</p>
<p><a href="${ABROAD_DOC}">${t(lang, 'How to set that up', 'איך מגדירים את זה')}</a></p>
</div></div>
</div></section>

<section id="faq" class="faq" aria-labelledby="faq-h"><div class="wrap">
<h2 id="faq-h">${t(lang, 'Questions', 'שאלות')}</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><div class="body"><p>${a}</p></div></details>`).join('')}
</div></section>

<section class="alt" aria-labelledby="oss-h"><div class="wrap">
<h2 id="oss-h">${t(lang, 'Open source, run by volunteers', 'קוד פתוח, בהתנדבות')}</h2>
<p class="section-lead">${t(
    lang,
    `Israel TV reads the broadcasters’ public sites slowly, keeps every show and episode under a permanent number, and points your app at the broadcasters’ own video. Anyone can read the code, report a problem, help fix a channel whose site changed, or <a href="${SELF_HOST_DOC}">run their own copy</a>. Licensed <a href="${LICENSE_URL}">AGPL-3.0</a>.`,
    `Israel TV קורא את האתרים הציבוריים של הגופים המשדרים לאט, שומר כל תוכנית וכל פרק תחת מספר קבוע, ומפנה את האפליקציה לווידאו של הגופים המשדרים עצמם. כל אחד יכול לקרוא את הקוד, לדווח על בעיה, לעזור לתקן ערוץ שהאתר שלו השתנה, או <a href="${SELF_HOST_DOC}">להריץ עותק משלו</a>. רישיון <a href="${LICENSE_URL}">AGPL-3.0</a>.`,
  )}</p>
<div class="oss">
<a class="btn btn-plain" href="${PROJECT_URL}">${ICONS.github}${t(lang, 'Source code', 'קוד המקור')}</a>
<a class="btn btn-plain" href="${ISSUES_URL}">${t(lang, 'Report a problem', 'דיווח על בעיה')}</a>
<a class="btn btn-plain" href="${DOCS_URL}">${t(lang, 'Documentation', 'תיעוד')}</a>
<a class="btn btn-plain" href="/status">${t(lang, 'Status', 'מצב השירות')}</a>
</div>
</div></section>
</main>
${footer(lang)}
</body></html>
`;
}

/** The status headline in Hebrew, for the landing page's chip. */
const HE_STATUS: Record<Overall['level'], string> = {
  ok: 'הכול עובד',
  info: 'חלק מהתוכניות עדיין נטענות',
  warn: 'עובד ברובו',
  error: 'יש תקלה בעדכון',
};
