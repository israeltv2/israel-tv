// `pnpm check:addresses` (CI): no real-looking private network addresses or personal hostnames in tracked files.
// Examples in docs use placeholders such as <this computer's address>. Recorded test fixtures (real pages from the
// broadcasters) and tests that need an address to exercise the code are allowed; extra personal patterns can be
// added locally through ISRAEL_TV_PRIVATE_PATTERNS (never written into the repository).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PRIVATE_IP =
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/;
const extra = (process.env.ISRAEL_TV_PRIVATE_PATTERNS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => new RegExp(s, 'i'));
const allowed = (f) =>
  /(^|\/)test\//.test(f) ||
  /\/fixtures\//.test(f) ||
  f === 'pnpm-lock.yaml' ||
  f.startsWith('spikes/') ||
  f === 'tools/check-addresses.mjs';
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const found = [];
for (const f of files) {
  if (allowed(f) || /\.(png|jpe?g|gif|ico|woff2?|sqlite)$/i.test(f)) continue;
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    if (PRIVATE_IP.test(line) || extra.some((re) => re.test(line)))
      found.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}
if (found.length) {
  console.error(
    `Private addresses or personal names found (use a placeholder like <this computer's address>):\n${found.join('\n')}`,
  );
  process.exit(1);
}
console.log(`no private addresses or personal names in ${files.length} tracked files`);
