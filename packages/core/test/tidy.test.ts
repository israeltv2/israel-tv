import { expect, test } from 'vitest';
import { cleanGenres } from '../src/model.ts';
import { tidyEpisodeTitle, tidyText } from '../src/tidy.ts';

test('text: entities decoded (also double-encoded), every space one plain space', () => {
  expect(tidyText('סוף הפרק&amp;nbsp;')).toBe('סוף הפרק');
  expect(tidyText('Israeli Keshet 12  News')).toBe('Israeli Keshet 12 News');
  expect(tidyText('בב&quot;ש')).toBe('בב"ש');
});

test('episode titles lose what the app already shows (the live cases)', () => {
  expect(tidyEpisodeTitle('מקום לדאגה, עונה 1, פרק 1', 'מקום לדאגה')).toBe('פרק 1');
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
  ).toEqual(['אקטואליה', 'אוכל', 'מצוירים']);
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
