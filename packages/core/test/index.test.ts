import { expect, test } from 'vitest';
import { PROJECT_NAME } from '../src/index.ts';

test('exports the project name', () => {
  expect(PROJECT_NAME).toBe('Israel TV');
});
