// `pnpm test:strict`: the whole test suite with Node's pending deprecations on and any deprecated API failing the
// run (see fail-on-deprecation.mjs). The preload is passed as a file URL so it works on Windows too.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const preload = pathToFileURL(new URL('./fail-on-deprecation.mjs', import.meta.url).pathname).href;
const env = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --pending-deprecation --import ${preload}`.trim(),
};
const r = spawnSync('pnpm', ['-r', '--no-bail', 'test'], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);
