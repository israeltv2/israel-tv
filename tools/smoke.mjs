// `pnpm smoke`: start the two roles that run without any account and fetch their manifests, the way an app would.
// No broadcaster site is contacted (every source is off); the resolver-only instance plays from the local-only
// one's catalog. Runs on Windows, macOS and Linux (CI runs it on all three).
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const home = (config) => {
  const dir = mkdtempSync(join(tmpdir(), 'israel-tv-smoke-'));
  writeFileSync(join(dir, 'israel-tv.config.json'), JSON.stringify(config));
  return dir;
};
const off = { mako: false, reshet: false, kan: false, live: false };
const local = home({
  role: 'local-only',
  sources: off,
  browser: { type: 'none' },
  publisher: { type: 'local', host: '127.0.0.1', port: 17700 },
  resolver: { host: '127.0.0.1', port: 17701 },
  admin: { host: '127.0.0.1', port: 17702 },
});
const resolverOnly = home({
  role: 'resolver-only',
  resolver: { host: '127.0.0.1', port: 17711, catalogUrl: 'http://127.0.0.1:17700/manifest.json' },
});

const children = [];
const start = (cli, dir) => {
  const args = [cli, 'start', ...(cli.includes('ingest') ? ['--no-initial-run'] : [])];
  const child = spawn(process.execPath, args, {
    cwd: repo,
    env: { ...process.env, ISRAEL_TV_HOME: dir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d;
  });
  child.stderr.on('data', (d) => {
    out += d;
  });
  children.push({ child, log: () => out });
};
const waitFor = async (url, what) => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        const m = await r.json();
        console.log(`ok   ${what}: ${url} → ${m.name ?? m.id}`);
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${what} did not answer at ${url}`);
};

let failed = false;
try {
  start('apps/ingest/src/cli.ts', local);
  await waitFor('http://127.0.0.1:17700/manifest.json', 'local-only addon');
  await waitFor('http://127.0.0.1:17701/manifest.json', 'local-only resolver');
  start('apps/resolver/src/cli.ts', resolverOnly);
  await waitFor('http://127.0.0.1:17711/manifest.json', 'resolver-only');
} catch (err) {
  failed = true;
  console.error(`FAIL ${err.message}`);
  for (const c of children) console.error(`--- output:\n${c.log()}`);
} finally {
  for (const c of children) c.child.kill();
}
process.exit(failed ? 1 : 0);
