import { expect, test } from 'vitest';
import { normalizeForSearch } from '../src/hebrew.ts';

test.each([
  ['מאסטר שף', 'מאסטר שפ'],
  ['שָׁלוֹם', 'שלומ'],
  ['צה"ל', 'צהל'],
  ["ג'קי", 'גקי'],
  ['  Big   Brother!! ', 'big brother'],
  ['האח הגדול – VIP', 'האח הגדול vip'],
])('normalizes %s', (input, expected) => {
  expect(normalizeForSearch(input)).toBe(expected);
});

test('typed form matches title with final letters', () => {
  expect(normalizeForSearch('מאסטר שף')).toContain(normalizeForSearch('מאסטר שפ'));
});
