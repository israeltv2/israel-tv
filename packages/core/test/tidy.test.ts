import { expect, test } from 'vitest';
import { cleanGenres } from '../src/model.ts';
import { cleanShowTitle, tidyEpisodeTitle, tidyText } from '../src/tidy.ts';

test('text: entities decoded (also double-encoded), every space one plain space', () => {
  expect(tidyText('סוף הפרק&amp;nbsp;')).toBe('סוף הפרק');
  expect(tidyText('Israeli Keshet 12  News')).toBe('Israeli Keshet 12 News');
  expect(tidyText('בב&quot;ש')).toBe('בב"ש');
});

test('episode titles lose what the app already shows (the live cases)', () => {
  expect(tidyEpisodeTitle('מקום לדאגה, עונה 1, פרק 1', 'מקום לדאגה')).toBe('פרק 1');
  // Mako's page title with its search-engine line and the site's name (iltv_mako_654, 2026-11-07).
  expect(tidyEpisodeTitle('היא תצא בלי כלום | סרט דוקומנטרי לצפייה ישירה. makoTV', 'היא תצא בלי כלום')).toBe(
    'סרט דוקומנטרי',
  );
  expect(tidyEpisodeTitle('הסרט | פרק 3 | לצפייה ישירה', 'סדרה')).toBe('הסרט | פרק 3');
  expect(tidyEpisodeTitle('ביקור ב-mako', 'סדרה')).toBe('ביקור ב-mako');
  expect(tidyEpisodeTitle('המועדון עם שחר חסון | עונה 2 | דדו מילמן', 'המועדון עם שחר חסון')).toBe(
    'דדו מילמן',
  );
  expect(tidyEpisodeTitle('עושים שישי עם אריק וייס 06.11.26 - התכנית המלאה', 'עושים שישי עם אריק וייס')).toBe(
    '06.11.26',
  );
  expect(tidyEpisodeTitle('הלידה הדרמטית', 'בייבי בום')).toBe('הלידה הדרמטית');
  // Leftover separators and SEO endings (found by the catalog audit).
  expect(tidyEpisodeTitle('פרק 6 -', 'x')).toBe('פרק 6');
  expect(tidyEpisodeTitle('השטיח האדום |', 'x')).toBe('השטיח האדום');
  expect(tidyEpisodeTitle('אבודים במרוקו - שני החלקים לצפייה ישירה', 'x')).toBe('אבודים במרוקו - שני החלקים');
  expect(tidyEpisodeTitle('מקום לדאגה', 'מקום לדאגה')).toBe('מקום לדאגה'); // never empty
});

test('genres for a filter: one spelling, no "תכניות" prefix, no site sections', () => {
  expect(
    cleanGenres(['תכניות אקטואליה', 'אקטואליה', 'תוכניות אוכל', 'חדשות 13', 'דיגיטל 13', 'מצויירים']),
  ).toEqual(['אקטואליה', 'בישול', 'מצוירים']);
  // One name across sources.
  expect(cleanGenres(['לייף סטייל', 'לייפסטייל', 'שעשועון', 'שעשועונים', 'תעודה'])).toEqual([
    'לייפסטייל',
    'שעשועונים',
    'דוקומנטרי',
  ]);
  // Kan's lobby cards (several in one string, archive labels, an unfilled page template) and TMDB's Hebrew names.
  expect(
    cleanGenres(['מוזיקה, דרמה, ילדים ונוער', 'ארכיון', 'טלוויזיה ישראלית', '$' + '{elem.Genres}']),
  ).toEqual(['מוזיקה', 'דרמה', 'ילדים']);
  expect(cleanGenres(['דוקו', 'דוקו ריאליטי', 'בידור ואירוח, כללי', 'דיבורים'])).toEqual([
    'דוקומנטרי',
    'דוקו-ריאליטי',
    'בידור ואירוח',
    'אירוח',
  ]);
});

test('trailers and promos are not episodes', async () => {
  const { isTrailer } = await import('../src/tidy.ts');
  for (const t of [
    'טריילר',
    'ברנשטיין - הפרטיזן האחרון | טריילר',
    'טריילר - עונה 2',
    'הטריילר הרשמי',
    'פרומו',
  ])
    expect(isTrailer(t), t).toBe(true);
  for (const t of ['פרק 3', 'הטריילר שנעלם', 'מאחורי הקלעים', 'טריילרים בקולנוע הישראלי'])
    expect(isTrailer(t), t).toBe(false);
});

test('a closing pointer to another page of the site is dropped', async () => {
  const { cleanDescription } = await import('../src/tidy.ts');
  expect(cleanDescription('סדרה על הכלא. כל תסריטי הסדרה מחכים לכם בעמוד כאן תסריטים >>')).toBe(
    'סדרה על הכלא.',
  );
  expect(cleanDescription('סדרה על הכלא >> ועוד')).toBe('סדרה על הכלא >> ועוד');
  // Names in «» are not pointers.
  expect(cleanDescription('הסדרה החדשה של «כאן»')).toBe('הסדרה החדשה של «כאן»');
  expect(cleanDescription('עונה חדשה. בכיכובם של «רוני» ו«דנה»')).toBe('עונה חדשה. בכיכובם של «רוני» ו«דנה»');
});

test('a leading "<name> לצפייה ישירה -" is dropped (Reshet show site pages)', async () => {
  const { cleanDescription } = await import('../src/tidy.ts');
  expect(
    cleanDescription('בני ערובה לצפייה ישירה - סדרת מתח בכיכובה של אילת זורר. יעל היא מנתחת בכירה'),
  ).toBe('סדרת מתח בכיכובה של אילת זורר. יעל היא מנתחת בכירה');
  // Only as a prefix: an ordinary sentence that mentions it later keeps its start.
  expect(cleanDescription('סדרה חדשה. כל הפרקים לצפייה ישירה - באתר')).toBe(
    'סדרה חדשה. כל הפרקים לצפייה ישירה - באתר',
  );
});

test('descriptions lose what sites add for search engines (the live cases)', async () => {
  const { cleanDescription } = await import('../src/tidy.ts');
  expect(
    cleanDescription('%%excerpt%% חדשות 13 | חדשות היום - תוכנית אקטואליה יומית. כל יום ב-15:00 בערוץ 13'),
  ).toBe('חדשות היום - תוכנית אקטואליה יומית. כל יום ב-15:00 בערוץ 13');
  expect(cleanDescription('אבי שושן מבין שהוא בבעיה. האם הוא יצליח? | "הישרדות", לצפייה ישירה')).toBe(
    'אבי שושן מבין שהוא בבעיה. האם הוא יצליח?',
  );
  expect(cleanDescription('סרטיו של דרור גלוברמן לצפייה ישירה')).toBe('סרטיו של דרור גלוברמן');
  expect(cleanDescription('ערוץ רשת 13, כל תוכניות הטלוויזיה, החדשות והכתבות לצפייה ישירה')).toBeUndefined();
  const sentence = 'תכנית הבישול של קשת 12: כל המתכונים, הקטעים ופרקים מלאים מתכניות מבשלים עם קשת';
  expect(cleanDescription(sentence)).toBe(sentence);
});

test('right-to-left: Hebrew-first lines with Latin letters or digits are wrapped in an RTL embedding, once', async () => {
  const { RLM, RLE, PDF, rtl } = await import('../src/tidy.ts');
  expect(rtl('פספורט TV')).toBe(`${RLE}פספורט TV${PDF}`);
  expect(rtl('רשת 13 · 720p')).toBe(`${RLE}רשת 13 · 720p${PDF}`);
  expect(rtl('100 שושנים - מחווה')).toBe(`${RLE}100 שושנים - מחווה${PDF}`); // the first letter is Hebrew
  expect(rtl(rtl('פספורט TV'))).toBe(`${RLE}פספורט TV${PDF}`); // never twice
  expect(rtl(`${RLM}פספורט TV`)).toBe(`${RLE}פספורט TV${PDF}`); // the older mark is replaced
  expect(rtl('בייבי בום')).toBe('בייבי בום'); // only Hebrew: not needed
  expect(rtl('MasterChef Israel')).toBe('MasterChef Israel'); // Latin first
  expect(rtl('i24 עברית')).toBe('i24 עברית');
  expect(rtl('')).toBe('');
  expect(rtl(undefined)).toBeUndefined();
});

test('filler endings go; "פרק N" stays', () => {
  expect(tidyEpisodeTitle('פרק 1 המלא', 'x')).toBe('פרק 1');
  expect(tidyEpisodeTitle('פרק 7 - הפרק המלא', 'x')).toBe('פרק 7');
  expect(tidyEpisodeTitle('הגמר הגדול - התוכנית המלאה', 'x')).toBe('הגמר הגדול');
  expect(tidyEpisodeTitle('המהדורה המלאה', 'x')).toBe('המהדורה');
  expect(tidyEpisodeTitle('המלא', 'x')).toBe('המלא'); // never empty
});

test('every HTML entity is decoded (Reshet sends numeric ones)', () => {
  expect(tidyText('הסיפור של ג&#x27;קי &#39;ו&#8211;עוד &hellip; &ndash; &Amp; &bogus;')).toBe(
    "הסיפור של ג'קי 'ו–עוד … – & &bogus;",
  );
});

test('show names lose page-title boilerplate (the live cases, 2026-11-08)', () => {
  const cases: [string, string][] = [
    ['אויבים: מנהיגי ערב נחשפים – פרקים מלאים לצפייה', 'אויבים: מנהיגי ערב נחשפים'],
    ['שקשוקה | באדיבות כאן חינוכית', 'שקשוקה'],
    ['שלי הכובשת | באדיבות כאן חינוכית', 'שלי הכובשת'],
    ['פרפר נחמד | באדיבות כאן חינוכית', 'פרפר נחמד'],
    ['מקבלים שבת עם דב אלבוים | תוכניות מלאות', 'מקבלים שבת עם דב אלבוים'],
    ['החמישיה הקאמרית | פרקים', 'החמישיה הקאמרית'],
    ['שעת הסין | פרקים מלאים לצפייה', 'שעת הסין'],
    ['מי אתה חושב שאתה? | פרקים מלאים לצפייה', 'מי אתה חושב שאתה?'],
    ['איזו דרמה | תכניות מלאות לצפייה', 'איזו דרמה'],
    ['ניסים גרמה מארח | תכניות מלאות', 'ניסים גרמה מארח'],
    ['שישי בטברנה | תכניות לצפיה ישירה', 'שישי בטברנה'],
    ['פינת גורדון | תכניות', 'פינת גורדון'],
    ['מבט שני | כתבות מלאות', 'מבט שני'],
    ['יום של חול | תוכנית מלאות', 'יום של חול'],
    ['סרטי תעודה נבחרים | סרטים מלאים', 'סרטי תעודה נבחרים'],
    ['מסך אישי | הפרקים המלאים', 'מסך אישי'],
    ['שלוש, ארבע, חמש וחצי | פרקים', 'שלוש, ארבע, חמש וחצי'],
    ['הגל"צניקים | פרקים', 'הגל"צניקים'],
    ['כאן ארכיון | איפה היינו - תוכניות מלאות', 'איפה היינו'],
  ];
  for (const [raw, clean] of cases) expect(cleanShowTitle(raw)).toBe(clean);
});

test('show names keep their own subtitles and dashes', () => {
  for (const name of [
    'מנהלל לירושלים | דוד (דדי) רפאל בן עמי ז"ל',
    'ארץ זרה | סרטו התיעודי של העיתונאי שלומי אלדר',
    'בילו"יים | דרמה בשני חלקים',
    'קופה ראשית - הסרט: מאחורי הקלעים',
    'כאן ספיישלים - טקסים, מופעים ומשדרים מיוחדים',
    'מתן בלו – הסיפור המלא',
    'פרפר נחמד - הסיפורים',
    'כן - מה?!',
    'פרקים',
    'תוכניות מלאות',
  ])
    expect(cleanShowTitle(name)).toBe(name);
});
