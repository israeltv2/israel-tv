// The release this copy is: the root package.json's version, which every release bumps. Apps show it as the
// addons' version, so a viewer's app and the project's releases speak of the same number.
import { readFileSync } from 'node:fs';

function rootVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const RELEASE_VERSION = rootVersion();
