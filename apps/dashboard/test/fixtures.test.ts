// The screenshot fixtures stay true to the contract: each answer passes its schema.
import {
  ActionSchema,
  DeploysSchema,
  FailuresSchema,
  HealthSchema,
  LiveSchema,
  OverviewSchema,
  PlaysSchema,
  SessionSchema,
  SourcesSchema,
  SystemSchema,
  TraceSchema,
} from '@israel-tv/admin-contract';
import { expect, test } from 'vitest';
import { FIXTURES } from './fixtures.ts';

test('every fixture fits its schema', () => {
  const schemas = {
    session: SessionSchema,
    health: HealthSchema,
    overview: OverviewSchema,
    sources: SourcesSchema,
    plays: PlaysSchema,
    failures: FailuresSchema,
    trace: TraceSchema,
    live: LiveSchema,
    deploys: DeploysSchema,
    system: SystemSchema,
    refresh: ActionSchema,
    canary: ActionSchema,
  } as const;
  for (const [name, schema] of Object.entries(schemas)) {
    const r = schema.safeParse(FIXTURES[name as keyof typeof FIXTURES]);
    expect(r.success, `${name}: ${r.error?.message}`).toBe(true);
  }
});
