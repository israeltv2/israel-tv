// `pnpm budget:workers` (CI): bundle both Cloudflare Workers the way a deploy does (wrangler --dry-run: nothing is
// uploaded, no account needed) and fail if either grows past its budget. The router must stay tiny; the API Worker
// well inside the free plan's 3 MB limit and quick to start.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const catalog = fileURLToPath(new URL('../apps/catalog/', import.meta.url));
const BUDGET_KB = { router: 4, api: 40 };
let failed = false;
for (const [name, main] of [
  ['router', 'src/router.ts'],
  ['api', 'src/api.ts'],
]) {
  const dir = mkdtempSync(join(tmpdir(), `iltv-${name}-`));
  const config = join(dir, 'wrangler.json');
  writeFileSync(
    config,
    JSON.stringify({ name: `budget-${name}`, main: join(catalog, main), compatibility_date: '2026-11-01' }),
  );
  const r = spawnSync(
    join(catalog, 'node_modules/.bin/wrangler'),
    ['deploy', '--dry-run', '--outdir', join(dir, 'out'), '--config', config],
    {
      cwd: catalog,
      env: { ...process.env, HOME: dir, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' },
      encoding: 'utf8',
      shell: process.platform === 'win32',
    },
  );
  if (r.status !== 0) {
    console.error(`FAIL ${name}: bundling failed\n${r.stdout}\n${r.stderr}`);
    failed = true;
    continue;
  }
  const js = readdirSync(join(dir, 'out')).filter((f) => f.endsWith('.js'));
  const bytes = js.reduce((n, f) => n + gzipSync(readFileSync(join(dir, 'out', f))).length, 0);
  const kb = bytes / 1024;
  const ok = kb <= BUDGET_KB[name];
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${name} Worker: ${kb.toFixed(1)} KB gzip (budget ${BUDGET_KB[name]} KB)`,
  );
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
