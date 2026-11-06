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
