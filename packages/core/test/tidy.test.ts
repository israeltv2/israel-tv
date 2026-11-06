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
  expect(tidyEpisodeTitle('מקום לדאגה', 'מקום לדאגה')).toBe('מקום לדאגה'); // never empty
});

test('genres for a filter: one spelling, no "תכניות" prefix, no site sections', () => {
  expect(
    cleanGenres(['תכניות אקטואליה', 'אקטואליה', 'תוכניות אוכל', 'חדשות 13', 'דיגיטל 13', 'מצויירים']),
  ).toEqual(['אקטואליה', 'אוכל', 'מצוירים']);
});
