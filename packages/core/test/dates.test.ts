import { expect, test } from 'vitest';
import { parseDottedDate } from '../src/dates.ts';

test.each([
  ['פרק 5@05.11.26', '2026-11-05'],
  ['17.07.17', '2017-07-17'],
  ['1.2.2024', '2024-02-01'],
  ['06/09/2026', '2026-09-06'],
  ['31.02.26', undefined],
  ['', undefined],
  [undefined, undefined],
])('parses %s', (input, expected) => {
  expect(parseDottedDate(input)).toBe(expected);
});

test('days in a time zone: Israel days start at 22:00 or 21:00 UTC, the day of clock changes too', async () => {
  const { nextDay, zonedDay, zonedDayStart } = await import('../src/dates.ts');
  const tz = 'Asia/Jerusalem';
  // Winter (UTC+2) and summer (UTC+3).
  expect(new Date(zonedDayStart('2026-11-07', tz)).toISOString()).toBe('2026-11-06T22:00:00.000Z');
  expect(new Date(zonedDayStart('2026-07-01', tz)).toISOString()).toBe('2026-06-30T21:00:00.000Z');
  // Clocks went back on 2026-10-25 (a 25-hour day).
  expect(zonedDayStart('2026-10-26', tz) - zonedDayStart('2026-10-25', tz)).toBe(25 * 3_600_000);
  expect(zonedDay(Date.parse('2026-11-06T23:30:00Z'), tz)).toBe('2026-11-07');
  expect(zonedDay(Date.parse('2026-11-06T23:30:00Z'))).toBe('2026-11-06');
  expect(zonedDayStart('2026-11-07')).toBe(Date.parse('2026-11-07T00:00:00Z'));
  expect(nextDay('2026-12-31')).toBe('2027-01-01');
  expect(nextDay('2026-03-01', -1)).toBe('2026-02-28');
});
