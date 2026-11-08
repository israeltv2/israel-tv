import { expect, test } from 'vitest';
import { guideMatcher, programmeKeys } from '../src/guide-match.ts';

test.each([
  ['בוש - עונה 7 - פרק 6', ['בוש עונה 7 פרק 6', 'בוש']],
  ['קופה ראשית-עונה חדשה-פרק 8', ['קופה ראשית עונה חדשה פרק 8', 'קופה ראשית']],
  ['חדש!הסדרתיים 2 - דילמת האסיר', ['הסדרתיימ 2 דילמת האסיר', 'הסדרתיימ 2', 'הסדרתיימ']],
  ['הזמר במסכה – הונאת הענק נחשפת', ['הזמר במסכה הונאת הענק נחשפת', 'הזמר במסכה']],
  ['הישרדות - עונה 8 - ש.ח', ['הישרדות עונה 8 ש ח', 'הישרדות']],
  // A dash inside a word or number is part of the title.
  ['המתחם ה-25 - החקירה!', ['המתחמ ה 25 החקירה', 'המתחמ ה 25']],
  ['12 בצוהריים', ['12 בצוהריימ']],
])('programme keys of %s', (title, keys) => {
  expect(programmeKeys(title)).toEqual(keys);
});

const shows = [
  { id: 'iltv_reshet_58', catalog: 'iltv_reshet13', title: 'הישרדות' },
  { id: 'iltv_reshet_110', catalog: 'iltv_reshet13', title: 'חמש' },
  { id: 'iltv_reshet_49', catalog: 'iltv_reshet13', title: 'הדו"ח היומי' },
  { id: 'iltv_mako_8', catalog: 'iltv_keshet12', title: 'הזמר במסכה' },
  { id: 'iltv_kan_144', catalog: 'iltv_kankids', title: 'בלואי' },
  { id: 'iltv_kan_15', catalog: 'iltv_kan11', title: 'נער יהודי גאה' },
  // Two shows of one title in a row: never a guess.
  { id: 'iltv_kan_1', catalog: 'iltv_kan11', title: 'הכוורת' },
  { id: 'iltv_kan_2', catalog: 'iltv_kan11', title: 'הכוורת' },
];

test('a programme is matched to its own broadcaster’s show by title, rerun and episode parts aside', () => {
  const showFor = guideMatcher(shows);
  expect(showFor('iltv_live_reshet13', 'הישרדות - עונה 8 - ש.ח')).toBe('iltv_reshet_58');
  expect(showFor('iltv_live_reshet13', 'הדוח היומי')).toBe('iltv_reshet_49');
  expect(showFor('iltv_live_keshet12', 'הזמר במסכה – הארנב נתפס ונחשף')).toBe('iltv_mako_8');
  expect(showFor('iltv_live_kanedu', 'בלואי - קליפסו')).toBe('iltv_kan_144');
  expect(showFor('iltv_live_kan11', 'נער יהודי גאה - חלק ב')).toBe('iltv_kan_15');
});

test('no link across broadcasters, for ambiguous titles, partial titles or channels without a catalog', () => {
  const showFor = guideMatcher(shows);
  // Channel 14's "חמש" is not Reshet 13's.
  expect(showFor('iltv_live_ch14', 'חמש')).toBeUndefined();
  // Keshet 12 does not air Reshet's shows.
  expect(showFor('iltv_live_keshet12', 'הישרדות')).toBeUndefined();
  expect(showFor('iltv_live_kan11', 'הכוורת')).toBeUndefined();
  // A title that only starts like a show is another programme.
  expect(showFor('iltv_live_reshet13', 'הישרדות הגדולה')).toBeUndefined();
  expect(showFor('iltv_live_knesset', 'הישרדות')).toBeUndefined();
});
