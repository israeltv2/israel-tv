import { expect, test } from 'vitest';
import { ADMIN_API, CSRF_HEADER, SessionSchema, TraceSchema } from '../src/index.ts';

test('the admin API contract: version 1 paths and header', () => {
  expect(ADMIN_API).toBe('/api/v1');
  expect(CSRF_HEADER).toBe('x-israel-tv-csrf');
});

test('schemas refuse answers that do not fit', () => {
  expect(SessionSchema.safeParse({ csrf: 'x', revision: 'r', role: 'host', publisher: 'ftp' }).success).toBe(
    false,
  );
  expect(TraceSchema.safeParse({ playId: 'p', events: [{ ts: 't' }] }).success).toBe(false);
  expect(TraceSchema.safeParse({ playId: 'p', events: [] }).success).toBe(true);
});
