import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { RELEASE_VERSION } from '../src/version.ts';

test('the release version is the root package version (what release-please bumps)', () => {
  const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  expect(RELEASE_VERSION).toBe(root.version);
  expect(RELEASE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
});
