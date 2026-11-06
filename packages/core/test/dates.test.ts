import { expect, test } from 'vitest';
import { parseDottedDate } from '../src/dates.ts';

test.each([
  ['פרק 5@05.11.26', '2026-11-05'],
  ['17.07.17', '2017-07-17'],
  ['1.2.2024', '2024-02-01'],
  ['31.02.26', undefined],
  ['', undefined],
  [undefined, undefined],
])('parses %s', (input, expected) => {
  expect(parseDottedDate(input)).toBe(expected);
});
