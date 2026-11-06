import { parseConfig } from '@israel-tv/core';
import { expect, test } from 'vitest';
import { FREE_LIMITS, quotaWarning, readQuota } from '../src/cloudflare-quota.ts';

test('a warning from 80% of a free-plan limit, saying which', () => {
  expect(quotaWarning({ requests: 79_999, aeWrites: 10, limits: FREE_LIMITS })).toBeUndefined();
  expect(quotaWarning({ requests: 80_000, aeWrites: 10, limits: FREE_LIMITS })).toMatch(
    /Worker requests 80%/,
  );
  expect(quotaWarning({ requests: 1, aeWrites: 95_000, limits: FREE_LIMITS })).toMatch(
    /usage data points 95%/,
  );
});

test("today's use is read from Cloudflare's analytics with the project token", async () => {
  const config = parseConfig({
    publisher: { type: 'cloudflare', apiTokenEnv: 'T', accountIdEnv: 'A' },
  });
  const seen: string[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    seen.push(String(url));
    expect((init?.headers ?? {}) as Record<string, string>).toMatchObject({ authorization: 'Bearer tok' });
    if (String(url).endsWith('/graphql'))
      return Response.json({
        data: {
          viewer: {
            accounts: [
              {
                workersInvocationsAdaptive: [
                  { sum: { requests: 2049 }, dimensions: { scriptName: 'israel-tv' } },
                  { sum: { requests: 1244 }, dimensions: { scriptName: 'israel-tv-api' } },
                ],
              },
            ],
          },
        },
      });
    return Response.json({ data: [{ points: '95' }] });
  }) as typeof fetch;
  const q = await readQuota(config, { T: 'tok', A: 'acc' }, fake, Date.parse('2026-11-06T12:00:00Z'));
  expect(q).toMatchObject({ day: '2026-11-06', requests: 3293, aeWrites: 95, limits: FREE_LIMITS });
  expect(q?.byScript[0]).toEqual({ script: 'israel-tv', requests: 2049 });
  expect(q?.warn).toBeUndefined();
  expect(seen[1]).toContain('/accounts/acc/analytics_engine/sql');
  expect(await readQuota(parseConfig({}), {}, fake)).toBeUndefined(); // not on Cloudflare: nothing to read
});
