import { expect, test } from 'vitest';
import { expandSearchKey, normalizeForSearch, searchMatches, stripPrefix } from '../src/hebrew.ts';

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

test.each([
  ['צהל', 'לצהל'],
  ['שפ', 'משחקי השפ'],
  ['לצהל', 'צהל'],
  ['שפ', 'והשפ'],
])('a search for %s finds %s (Hebrew prefix letters)', (q, key) => {
  expect(searchMatches(expandSearchKey(key), q)).toBeGreaterThan(0);
});

test.each([
  ['חק', 'משחקי'],
  ['kan', 'makan'],
])('a search for %s does not find %s', (q, key) => {
  expect(searchMatches(expandSearchKey(key), q)).toBe(0);
});

test('a two-letter word keeps its first letter', () => {
  expect(stripPrefix('הם')).toBeUndefined();
  expect(stripPrefix('לצהל')).toBe('צהל');
  expect(stripPrefix('ואב')).toBe('אב');
});
