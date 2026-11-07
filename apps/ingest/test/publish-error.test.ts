import { expect, test } from 'vitest';
import { publishError } from '../src/publish.ts';

const env = { apiTokenEnv: 'CLOUDFLARE_API_TOKEN', accountIdEnv: 'CLOUDFLARE_ACCOUNT_ID' };

test('a Cloudflare outage is not blamed on the setup', () => {
  const e = publishError(
    '✘ [ERROR] Received a malformed response from the API\nno healthy upstream\n',
    1,
    env,
  );
  expect(e.message).toContain("Cloudflare's side");
  expect(e.message).not.toContain('Check CLOUDFLARE_API_TOKEN');
});

test('an authentication failure points at the token', () => {
  const e = publishError('✘ [ERROR] Authentication error [code: 10000]\n', 1, env);
  expect(e.message).toContain('Check CLOUDFLARE_API_TOKEN');
});

import { Store } from '@israel-tv/store';
import {
  CLOUDFLARE_OUTAGE,
  deployWithRetries,
  failedPublishes,
  PUBLISH_ALERT_AFTER,
  PublishError,
  retryDelay,
} from '../src/publish.ts';

const OUTAGE = '✘ [ERROR] Received a malformed response from the API\nno healthy upstream\n';

test('Cloudflare outages are tried again with growing pauses; a setup problem is not', async () => {
  const waits: number[] = [];
  const retry = {
    attempts: 4,
    baseMs: 1000,
    maxMs: 10_000,
    sleep: async (ms: number) => void waits.push(ms),
    random: () => 1,
  };
  let calls = 0;
  const d = await deployWithRetries(
    async () => {
      calls++;
      if (calls < 3) throw publishError(OUTAGE, 1, env);
      return { ms: 1, detail: 'Uploaded 3 files' };
    },
    () => {},
    retry,
  );
  expect(d.detail).toBe('Uploaded 3 files');
  expect(calls).toBe(3);
  expect(waits).toEqual([1000, 4000]);
  // Out of tries: the error says how many it took.
  calls = 0;
  await expect(
    deployWithRetries(
      async () => {
        calls++;
        throw publishError(OUTAGE, 1, env);
      },
      () => {},
      retry,
    ),
  ).rejects.toThrow(/\(4 tries\)/);
  expect(calls).toBe(4);
  // A token problem fails at once.
  calls = 0;
  await expect(
    deployWithRetries(
      async () => {
        calls++;
        throw publishError('✘ [ERROR] Authentication error [code: 10000]\n', 1, env);
      },
      () => {},
      retry,
    ),
  ).rejects.toBeInstanceOf(PublishError);
  expect(calls).toBe(1);
});

test('the pause before a retry grows ×4 to its cap, with 50–100% jitter', () => {
  const r = { attempts: 4, baseMs: 15_000, maxMs: 180_000 };
  expect(retryDelay(1, { ...r, random: () => 1 })).toBe(15_000);
  expect(retryDelay(2, { ...r, random: () => 1 })).toBe(60_000);
  expect(retryDelay(3, { ...r, random: () => 1 })).toBe(180_000);
  expect(retryDelay(3, { ...r, random: () => 0 })).toBe(90_000);
  expect(
    CLOUDFLARE_OUTAGE.test(
      'Cloudflare deploy failed: Received a malformed response from the API no healthy upstream',
    ),
  ).toBe(true);
  expect(CLOUDFLARE_OUTAGE.test('Cloudflare deploy failed: Authentication error [code: 10000]')).toBe(false);
});

test('/status calls failed publishes a problem: a setup error at once, outages only several in a row', () => {
  const store = Store.open(':memory:');
  const publish = (status: 'ok' | 'failed', error?: string) =>
    store.finishRun(store.startRun('publish', 'cloudflare'), { status, ...(error ? { error } : {}) });
  const outage =
    'Cloudflare deploy failed: Received a malformed response from the API no healthy upstream (4 tries)\nThis looks like…';
  publish('ok');
  publish('failed', outage);
  expect(failedPublishes(store)).toEqual({ inRow: 1, alert: false });
  // A restart in between is not a failure, and does not break the count.
  publish('failed', 'interrupted (process stopped)');
  for (let i = 1; i < PUBLISH_ALERT_AFTER; i++) publish('failed', outage);
  expect(failedPublishes(store)).toEqual({ inRow: PUBLISH_ALERT_AFTER, alert: true });
  publish('ok');
  expect(failedPublishes(store)).toEqual({ inRow: 0, alert: false });
  publish(
    'failed',
    'Cloudflare deploy failed: Authentication error [code: 10000]\nCheck CLOUDFLARE_API_TOKEN',
  );
  expect(failedPublishes(store)).toEqual({ inRow: 1, alert: true });
});
