// The status page's words in English and Hebrew for what the status file holds as codes: the sources' notes, the
// publish and TMDB notes, the warnings and the catalog check. Each is worded from its code and values, never by
// reading the English text; a code a page does not know (a newer publisher) is shown as the English text, marked as
// English. The Hebrew is written for Hebrew readers, not translated word for word.
import type { StatusFile, StatusNote, StatusParams } from '@israel-tv/core';
import { type Child, type Html, html } from './html.ts';
import { sourceName } from './names.ts';
import { type Lang, num, when } from './page.ts';

const n = (p: StatusParams | undefined, k: string) => (typeof p?.[k] === 'number' ? (p[k] as number) : 0);
const s = (p: StatusParams | undefined, k: string) => (typeof p?.[k] === 'string' ? (p[k] as string) : '');
const list = (p: StatusParams | undefined, k: string) =>
  Array.isArray(p?.[k]) ? (p[k] as string[]).filter((x) => typeof x === 'string') : [];

/** A Hebrew count: its own words for one ("תוכנית אחת"), the number and the plural otherwise. */
export const heCount = (count: number, one: string, many: string) =>
  count === 1 ? one : `${num(count, 'he')} ${many}`;

/** An English count ("1 show", "3 shows"). */
export const enCount = (count: number, one: string, many: string) =>
  `${num(count)} ${count === 1 ? one : many}`;

/** A title (Hebrew or not) inside a sentence, isolated so its direction cannot leak. */
const title = (t: string) => html`<bdi dir="auto">${t}</bdi>`;
/** A key, an id or a technical message in Latin letters inside Hebrew text. */
const latin = (t: string) => html`<bdi dir="ltr" lang="en">${t}</bdi>`;
/** The site's address and its own message, in English on a line of their own (they never mix into Hebrew well). */
const technical = (p: StatusParams) =>
  html`<br><span dir="ltr" lang="en" class="en-text">${s(p, 'url')}: ${s(p, 'detail')}</span>`;
/** Titles in a list ("א, ב, ג"), with how many more there are. */
const titles = (names: string[], more: number, lang: Lang) =>
  html`${names.map((x, i) => html`${i ? ', ' : ''}${title(x)}`)}${
    more > 0 ? (lang === 'he' ? ` ועוד ${num(more, 'he')}` : ` and ${num(more)} more`) : ''
  }`;

/** English text shown as it is on a Hebrew page (a note this page has no words for, an error from a site). */
export const asEnglish = (text: string, lang: Lang): Html =>
  lang === 'he' ? html`<span dir="ltr" lang="en" class="en-text">${text}</span>` : html`${text}`;

/**
 * What a viewer may want to know about a source, worded from its fields: episodes the site no longer offers, the
 * site's bot check. (Not the notes' text: the fields say the same and old status files have them too.)
 */
export function viewerNotes(s: StatusFile['sources'][number] | undefined, lang: Lang): string[] {
  const out: string[] = [];
  const he = lang === 'he';
  const gone = s?.skipped?.noLongerOffered ?? 0;
  if (gone && s?.source === 'reshet')
    out.push(
      he
        ? gone === 1
          ? 'תקופת הצפייה של פרק אחד של רשת 13 הסתיימה, ולכן הוא לא בקטלוג.'
          : `תקופת הצפייה של ${num(gone, 'he')} פרקים של רשת 13 הסתיימה, ולכן הם לא בקטלוג.`
        : `${num(gone)} Reshet ${gone === 1 ? 'episode is' : 'episodes are'} past their availability window, so ${gone === 1 ? 'it is' : 'they are'} not in the catalog.`,
    );
  else if (gone)
    out.push(
      he
        ? gone === 1
          ? 'פרק אחד כבר לא זמין באתר של כאן (זכויות השידור שלו פגו), ולכן הוא לא בקטלוג.'
          : `${num(gone, 'he')} פרקים כבר לא זמינים באתר של כאן (זכויות השידור שלהם פגו), ולכן הם לא בקטלוג.`
        : `${num(gone)} Kan ${gone === 1 ? 'episode is' : 'episodes are'} no longer offered (the broadcast rights ended), so ${gone === 1 ? 'it is' : 'they are'} not in the catalog.`,
    );
  const bot = s?.botCheck;
  if (bot?.challenged)
    out.push(
      he
        ? `ההגנה מפני בוטים באתר של כאן עצרה היום ${num(bot.challenged, 'he')} מתוך ${num(bot.pages, 'he')} טעינות דפים; הקריאה נמשכת.`
        : `Kan’s bot check stopped ${num(bot.challenged)} of ${num(bot.pages)} page loads today; reading carries on.`,
    );
  return out;
}

/** Notes another part of the page already says (from the fields, or in a section of their own). */
const SAID_ELSEWHERE = new Set([
  'last-run-failed',
  'run-partial',
  'run-partial-failed',
  'blocked-recovered',
  'blocked-retrying',
  'blocked-still',
  'first-fill',
  'empty-shows',
  'live-answering',
  'kan-no-longer-offered',
  'reshet-past-window',
  'kan-bot-check',
  'kan-not-video',
]);

/** A source's note for the contributors' list, or undefined when the page says it elsewhere. */
export function noteText(note: StatusNote, english: string | undefined, lang: Lang): Child | undefined {
  if (SAID_ELSEWHERE.has(note.code)) return undefined;
  const he = lang === 'he';
  const p = note.params;
  switch (note.code) {
    case 'no-full-run':
      return he ? 'עוד לא הייתה קריאה מלאה.' : 'No full read yet.';
    case 'limited-run-only':
      return he
        ? 'עד עכשיו רצה רק ריצת ניסיון מוגבלת; הקריאה המלאה תרוץ בזמן הקבוע לה.'
        : 'Only a limited test run so far; the full read follows on schedule.';
    case 'bot-check-rate':
      return he
        ? `ההגנה מפני בוטים באתר ענתה היום על ${num(n(p, 'pages'), 'he')} מתוך ${num(n(p, 'requests'), 'he')} בקשות. ${num(n(p, 'cleared'), 'he')} מהן נקראו בניסיון חוזר מהיר, ו${heCount(n(p, 'delayed'), 'תוכנית אחת נדחתה', 'תוכניות נדחו')} לניסיון מאוחר יותר.`
        : `The site’s bot check answered ${num(n(p, 'pages'))} of ${num(n(p, 'requests'))} requests today; ${num(n(p, 'cleared'))} were read on a quick retry, ${enCount(n(p, 'delayed'), 'show was', 'shows were')} delayed to a later retry.`;
    case 'no-success-36h':
      return he ? 'לא הייתה קריאה מוצלחת ב-36 השעות האחרונות.' : 'No successful read in 36 hours.';
    case 'never-succeeded-36h':
      return he
        ? 'עוד לא הייתה אף קריאה מוצלחת, והניסיון הראשון היה לפני יותר מ-36 שעות.'
        : 'Never read successfully; the first try was over 36 hours ago.';
    case 'no-shows':
      return he ? 'אין אף תוכנית.' : 'No shows at all.';
    case 'kan-waiting-retry': {
      const c = n(p, 'count');
      return he
        ? `${c === 1 ? 'תוכנית אחת ממתינה' : `${num(c, 'he')} תוכניות ממתינות`} לקריאה חוזרת של דף פרק שלא נטען (עד ${num(n(p, 'tries'), 'he')} ניסיונות, בהפרש של ${num(n(p, 'hours'), 'he')} שעות). הפרקים הבאים ${c === 1 ? 'שלה' : 'שלהן'} ממתינים לו.`
        : `${enCount(c, 'show waits', 'shows wait')} to read again an episode page that failed to load (up to ${n(p, 'tries')} tries, ${n(p, 'hours')} hours apart); the later episodes wait for it.`;
    }
    case 'kan-gave-up': {
      const c = n(p, 'count');
      return he
        ? c === 1
          ? `דף פרק אחד לא נטען ${num(n(p, 'tries'), 'he')} פעמים, ולכן דילגנו עליו.`
          : `${num(c, 'he')} דפי פרקים לא נטענו ${num(n(p, 'tries'), 'he')} פעמים, ולכן דילגנו עליהם.`
        : `${enCount(c, 'episode page', 'episode pages')} failed to load ${n(p, 'tries')} times and ${c === 1 ? 'was' : 'were'} skipped.`;
    }
    default:
      return english ? asEnglish(english, lang) : undefined;
  }
}

/** The publish note (`publishNote`, else the `publish` text). */
export function publishText(status: StatusFile, lang: Lang): Child | undefined {
  const note = status.publishNote;
  const he = lang === 'he';
  if (note?.code === 'publish-failed') {
    const inRow = n(note.params, 'inRow');
    return he
      ? html`הפרסום האחרון נכשל (${when(s(note.params, 'at'), 'he')})${inRow > 1 ? `, ${num(inRow, 'he')} פעמים ברציפות` : ''}: ${latin(s(note.params, 'error'))}`
      : html`The last publish failed (${when(s(note.params, 'at'))})${inRow > 1 ? `, ${num(inRow)} times in a row` : ''}: ${s(note.params, 'error')}`;
  }
  if (note?.code === 'publish-stale')
    return he
      ? html`הקטלוג לא פורסם מאז ${when(s(note.params, 'since'), 'he')}.`
      : html`The catalog has not been published since ${when(s(note.params, 'since'))}.`;
  return status.publish ? asEnglish(status.publish, lang) : undefined;
}

/** The TMDB note (`tmdbNote`, else the `tmdb` text). */
export function tmdbText(status: StatusFile, lang: Lang): Child | undefined {
  const note = status.tmdbNote;
  if (note?.code === 'tmdb-failed')
    return lang === 'he'
      ? html`ההתאמה האחרונה ל-TMDB נכשלה (${when(s(note.params, 'at'), 'he')}): ${latin(s(note.params, 'error'))}`
      : html`The last TMDB matching failed (${when(s(note.params, 'at'))}): ${s(note.params, 'error')}`;
  return status.tmdb ? asEnglish(status.tmdb, lang) : undefined;
}

const WARNING_WORDS: Record<string, Record<Lang, string>> = {
  'source-note': { en: 'Notes from reading the channels’ sites', he: 'הערות מקריאת אתרי הערוצים' },
  'source-renumbered': {
    en: 'A channel renumbered an episode (ours keeps its number)',
    he: 'ערוץ שינה מספר של פרק (אצלנו המספר נשאר)',
  },
  'episode-number-taken': { en: 'Two episodes claimed the same number', he: 'שני פרקים עם אותו מספר' },
  'season-number-taken': { en: 'Two seasons claimed the same number', he: 'שתי עונות עם אותו מספר' },
  'numbers-reversed': {
    en: 'Episode numbers that run against the air dates',
    he: 'מספרי פרקים שהולכים הפוך מתאריכי השידור',
  },
  'bot-check': { en: 'Shows delayed by a site’s bot protection', he: 'תוכניות שהתעכבו בגלל הגנה מפני בוטים' },
  'tmdb-duplicate': { en: 'TMDB matches given to two shows', he: 'התאמות TMDB שנמצאו לשתי תוכניות' },
  'thin-result': { en: 'Reads that found less than before', he: 'קריאות שמצאו פחות מבפעם הקודמת' },
  'image-failed': { en: 'Images that could not be copied', he: 'תמונות שלא הצלחנו להעתיק' },
};

/** A kind of warning, as a heading. */
export const warningWord = (code: string, lang: Lang) =>
  WARNING_WORDS[code]?.[lang] ?? code.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * One warning in Hebrew, from its code and values; undefined when it has none (older warnings) or the code is not
 * known here. (English pages show the message itself: it is written in English.)
 */
export function warningHe(w: StatusFile['warnings'][number]): Child | undefined {
  const p = w.params;
  if (!p) return undefined;
  const key = () => latin(s(p, 'key'));
  switch (w.code) {
    case 'episode-number-taken':
      return html`הפרק "פרק ${s(p, 'hint') || String(n(p, 'hint'))}" (${key()}) התנגש בפרק אחר בעונה ${n(p, 'season')}, וקיבל את המספר ${n(p, 'number')}.`;
    case 'source-renumbered':
      return html`באתר הערוץ הפרק ${key()} נקרא עכשיו "פרק ${s(p, 'hint') || String(n(p, 'hint'))}"; אצלנו הוא נשאר עונה ${n(p, 'season')}, פרק ${n(p, 'episode')}.`;
    case 'season-number-taken':
      return html`העונה ${title(s(p, 'title'))} (${key()}) ביקשה את המספר ${n(p, 'number')}, שכבר תפוס, וקיבלה מספר פנוי.`;
    case 'numbers-reversed':
      return html`בעונה ${title(s(p, 'title'))} (${key()}) מספרי הפרקים הולכים הפוך מתאריכי השידור, ולכן היא ממוספרת לפי התאריכים.`;
    case 'bot-check': {
      const at = s(p, 'at');
      return html`ההגנה מפני בוטים של ${sourceName(s(p, 'source'), 'he')} עיכבה ${heCount(n(p, 'count'), 'תוכנית אחת', 'תוכניות')}${
        at ? html`; ניסיון חוזר ${when(at, 'he', { future: true })}` : ''
      } (הנתונים הטובים האחרונים נשמרו): ${titles(list(p, 'titles'), n(p, 'more'), 'he')}.`;
    }
    case 'tmdb-duplicate':
      return html`${title(s(p, 'title'))}: מזהה ה-TMDB ${latin(s(p, 'tmdbId'))} כבר מותאם ל-${latin(list(p, 'taken').join(', '))}, ולכן לא הוקצה.`;
    case 'thin-result':
      return html`${title(s(p, 'title'))}: בקריאה האחרונה נמצא פחות מבפעם הקודמת, ולכן נשארו הנתונים הטובים האחרונים (${latin(s(p, 'detail'))}).`;
    case 'source-note': {
      if (p.kan === 'episode') {
        const tries = n(p, 'tries');
        return html`דף פרק באתר של כאן לא נקרא (${
          n(p, 'gaveUp')
            ? `ויתרנו עליו אחרי ${num(tries, 'he')} ניסיונות`
            : `ניסיון ${num(tries, 'he')} מתוך ${num(n(p, 'of'), 'he')}; התוכנית ממתינה לו`
        }):${technical(p)}`;
      }
      if (p.kan === 'show') return html`דף תוכנית באתר של כאן לא נקרא:${technical(p)}`;
      if (p.kan === 'art-refused')
        return html`האתר של כאן סירב לתת ${heCount(n(p, 'count'), 'תמונה אחת', 'תמונות')} של תוכניות (${
          n(p, 'botCheck') ? 'ההגנה מפני בוטים' : latin(s(p, 'why'))
        }). ננסה שוב בתוך ${num(n(p, 'hours'), 'he')} שעות (למשל ${latin(s(p, 'examples'))}).`;
      const t = title(s(p, 'title'));
      if (p.note === 'trailer-only')
        return html`${t}: בינתיים יש רק טריילר. התוכנית תיכנס לקטלוג עם הפרק הראשון.`;
      if (p.note === 'no-episodes') return html`${t}: מופיעה באתר הערוץ, אבל אין בעמוד שלה פרקים.`;
      if (p.note === 'page-gone') return html`${t}: מופיעה באתר הערוץ, אבל העמוד שלה כבר לא קיים (404).`;
      return s(p, 'detail') ? html`${t}: ${latin(s(p, 'detail'))}` : undefined;
    }
    default:
      return undefined;
  }
}

const AUDIT_HE: Record<string, string> = {
  'artwork refused outside Israel': 'תמונות שלא נטענות מחוץ לישראל',
  'empty name or site text in a name': 'שם ריק, או טקסט מהאתר בתוך שם',
  'episode id does not match its numbers': 'מזהה פרק שלא תואם את המספרים שלו',
  'no manifest': 'אין מניפסט',
  'no poster': 'אין פוסטר',
  'page-title boilerplate in a name': 'טקסט קבוע מכותרת העמוד בתוך שם',
  'poster file missing from the site': 'קובץ פוסטר שחסר באתר',
  'poster not portrait': 'פוסטר שאינו לאורך',
  'poster refused outside Israel': 'פוסטר שלא נטען מחוץ לישראל',
  'row item differs from its show page': 'פריט בשורה ששונה מדף התוכנית שלו',
  'season numbered 101 or more': 'עונה שמספרה 101 ומעלה',
  'series shown with a non-poster shape': 'תוכנית שמוצגת בצורה שאינה פוסטר',
  'site text in a description': 'טקסט מהאתר בתוך תיאור',
  'site text in an episode title': 'טקסט מהאתר בתוך שם של פרק',
  'two episodes with one number': 'שני פרקים עם אותו מספר',
  'year line not "2024", "2021–2024" or "2024–present"':
    'שורת שנים שאינה בצורה "2024", "2021–2024" או "2024–היום"',
};

/** A catalog check's name. */
export const auditCheck = (check: string, lang: Lang): Child =>
  lang === 'he' ? (AUDIT_HE[check] ?? asEnglish(check, lang)) : check;
