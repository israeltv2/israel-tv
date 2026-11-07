// `pnpm audit:images [--base <addon address>] [--max 600] [--metas 12] [--json <file>]`: every image the public
// catalog shows, checked the way a viewer's app loads it, from wherever this runs (outside Israel, most viewers'
// case without a VPN). Walks manifest → catalogs → a sample of metas → their episode stills, and reports per source
// and kind (poster, background, logo, still, live tile, row item): missing, placeholder (the generic poster: the
// show has no image of its own yet), broken (not 200, not an image, unreadable), refused abroad (403 from a
// broadcaster's own host), tiny, and wrong shape. Polite: at most 4 requests at once, at most --max requests in all,
// only the first bytes of each image (enough for its size).

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    base: {
      type: 'string',
      default: process.env.ISRAEL_TV_PUBLIC_URL ?? 'https://israel-tv.israeltv2.workers.dev',
    },
    max: { type: 'string', default: '600' },
    metas: { type: 'string', default: '12' },
    stills: { type: 'string', default: '2' },
    json: { type: 'string' },
  },
});
const BASE = args.base.replace(/\/$/, '');
const MAX = Number(args.max);
const METAS_PER_CATALOG = Number(args.metas);
const STILLS_PER_META = Number(args.stills);
const CONCURRENCY = 4;
/** Hosts that answer only viewers in Israel (their 403 abroad is a geo refusal, not a broken file). */
const GEO_HOSTS = /(^|\.)(kan\.org\.il|kankids\.org\.il)$/i;
/** The generic poster (ours, or a broadcaster's own stand-in): the show has no image of its own. */
const PLACEHOLDER = /\/art\/placeholder-poster\.jpg$|(?:deafult|default)_poster_image/i;

let requests = 0;
const budgetLeft = () => requests < MAX;

async function getJson(path) {
  requests++;
  const r = await fetch(`${BASE}/${path}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

/** Width and height from an image's first bytes (JPEG, PNG, WebP, GIF), or undefined. */
export function imageSize(b) {
  const u16 = (i) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
  const u32 = (i) => ((u16(i) << 16) | u16(i + 2)) >>> 0;
  const le16 = (i) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
  const le24 = (i) => le16(i) | ((b[i + 2] ?? 0) << 16);
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return undefined;
      const m = b[i + 1] ?? 0;
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) {
        i += 2;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { h: u16(i + 5), w: u16(i + 7) };
      i += 2 + u16(i + 2);
    }
    return undefined;
  }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: u32(16), h: u32(20) };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: le16(6), h: le16(8) };
  const tag = (i) => String.fromCharCode(...b.subarray(i, i + 4));
  if (tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    const kind = tag(12);
    if (kind === 'VP8 ') return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
    if (kind === 'VP8L') {
      const v = ((b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24)) >>> 0;
      return { w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') return { w: le24(24) + 1, h: le24(27) + 1 };
  }
  return undefined;
}

/** The first bytes of an image (up to 256 KB: a progressive JPEG's size can sit late), and how it answered. */
async function probe(url) {
  requests++;
  try {
    const r = await fetch(url, {
      headers: { range: 'bytes=0-262143', 'user-agent': 'Mozilla/5.0 (image-audit; Israel TV)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    const type = (r.headers.get('content-type') ?? '').split(';')[0];
    const chunks = [];
    let n = 0;
    const reader = r.body?.getReader();
    while (reader && n < 262_144) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      n += value.length;
    }
    await reader?.cancel().catch(() => undefined);
    const body = new Uint8Array(n);
    let o = 0;
    for (const c of chunks) {
      body.set(c.subarray(0, n - o), o);
      o += c.length;
    }
    return { status: r.status, type, body };
  } catch (e) {
    return { status: 0, type: '', body: new Uint8Array(), error: e.message };
  }
}

/** The expected shape of each kind. */
const SHAPES = {
  poster: { label: '2:3', ok: (s) => s.h >= s.w * 1.2, min: 150 },
  square: { label: '1:1', ok: (s) => s.w / s.h > 0.8 && s.w / s.h < 1.25, min: 64 },
  landscape: { label: 'landscape', ok: (s) => s.w > s.h, min: 160 },
};

function verdict(url, shape, p) {
  if (p.status === 0) return { issue: 'broken', detail: p.error ?? 'no answer' };
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {}
  if ((p.status === 403 || p.status === 451) && GEO_HOSTS.test(host))
    return { issue: 'refused abroad', detail: `HTTP ${p.status} from ${host}` };
  if (p.status !== 200 && p.status !== 206) return { issue: 'broken', detail: `HTTP ${p.status}` };
  if (!p.type.startsWith('image/'))
    return { issue: 'broken', detail: `not an image (${p.type || 'no type'})` };
  if (p.type === 'image/svg+xml') return {};
  const size = imageSize(p.body);
  if (!size) return { issue: 'broken', detail: `unreadable ${p.type}` };
  const want = SHAPES[shape];
  if (Math.min(size.w, size.h) < want.min) return { issue: 'tiny', detail: `${size.w}×${size.h}`, size };
  if (!want.ok(size))
    return { issue: 'wrong shape', detail: `${size.w}×${size.h}, want ${want.label}`, size };
  return { size };
}

const sourceOf = (id) => id.split('_')[1] ?? 'other';

// ---- walk the catalog ------------------------------------------------------------------------------------------

/** Image uses found: { url, kind, shape, source, where }. A url used several times is fetched once. */
const uses = [];
const missing = [];
const add = (url, kind, shape, source, where) => {
  if (!url) return missing.push({ kind, source, where });
  uses.push({ url, kind, shape, source, where });
};

const manifest = await getJson('manifest.json');
/** Which source each row is (the published freshness file says). */
const rowSource = await getJson('freshness.json').then(
  (f) => f.catalogs ?? {},
  () => ({}),
);
add(manifest.logo, 'addon logo', 'square', 'addon', 'manifest');
add(manifest.background, 'addon background', 'landscape', 'addon', 'manifest');

const metaJobs = [];
for (const c of manifest.catalogs) {
  let page;
  try {
    page = await getJson(`catalog/${c.type}/${c.id}.json`);
  } catch (e) {
    console.error(`catalog ${c.id}: ${e.message}`);
    continue;
  }
  const items = page.metas ?? [];
  const shows = items.filter((m) => !m.id.startsWith('iltv_status_'));
  for (const m of items.filter((x) => x.id.startsWith('iltv_status_')))
    add(m.poster, 'row notice', 'poster', rowSource[c.id] ?? c.id, `${c.id} ${m.id}`);
  const live = c.type === 'tv';
  for (const m of shows) {
    const shape =
      m.posterShape === 'square' ? 'square' : m.posterShape === 'landscape' ? 'landscape' : 'poster';
    add(m.poster, live ? 'live tile' : 'poster', shape, sourceOf(m.id), `${c.id} ${m.id}`);
  }
  // An even sample of the row (every live channel), so far into the row as near its start.
  const n = live ? shows.length : Math.min(METAS_PER_CATALOG, shows.length);
  for (let i = 0; i < n; i++)
    metaJobs.push({ type: c.type, id: shows[Math.floor((i * shows.length) / n)].id });
}

await pool(metaJobs, async ({ type, id }) => {
  if (!budgetLeft()) return;
  let meta;
  try {
    meta = (await getJson(`meta/${type}/${id}.json`)).meta;
  } catch (e) {
    return missing.push({ kind: 'meta', source: sourceOf(id), where: `${id}: ${e.message}` });
  }
  const src = sourceOf(id);
  add(meta.background, 'background', 'landscape', src, id);
  if (type === 'tv') add(meta.logo, 'logo', 'square', src, id);
  const videos = meta.videos ?? [];
  for (let i = 0; i < Math.min(STILLS_PER_META, videos.length); i++) {
    const v = videos[Math.floor((i * videos.length) / Math.min(STILLS_PER_META, videos.length))];
    add(v.thumbnail, 'still', 'landscape', src, v.id);
  }
});

// ---- check each image once ----------------------------------------------------------------------------------------

const byUrl = new Map();
for (const u of uses) if (!byUrl.has(u.url)) byUrl.set(u.url, u);
const results = new Map();
let skipped = 0;
await pool([...byUrl.values()], async (u) => {
  if (PLACEHOLDER.test(u.url)) return results.set(u.url, { issue: 'placeholder' });
  if (!budgetLeft()) {
    skipped++;
    return;
  }
  results.set(u.url, verdict(u.url, u.shape, await probe(u.url)));
});

// ---- report ------------------------------------------------------------------------------------------------------

const ISSUES = ['missing', 'placeholder', 'broken', 'refused abroad', 'tiny', 'wrong shape'];
const table = new Map();
const row = (source, kind) => {
  const k = `${source}\t${kind}`;
  if (!table.has(k))
    table.set(k, {
      source,
      kind,
      checked: 0,
      ok: 0,
      ...Object.fromEntries(ISSUES.map((i) => [i, 0])),
      examples: [],
    });
  return table.get(k);
};
for (const m of missing) {
  const r = row(m.source, m.kind);
  r.checked++;
  r.missing++;
  if (r.examples.filter((e) => e.startsWith('missing')).length < 2) r.examples.push(`missing: ${m.where}`);
}
for (const u of uses) {
  const v = results.get(u.url);
  if (!v) continue;
  const r = row(u.source, u.kind);
  r.checked++;
  if (!v.issue) r.ok++;
  else {
    r[v.issue]++;
    if (r.examples.filter((e) => e.startsWith(v.issue)).length < 2)
      r.examples.push(`${v.issue}: ${u.where} ${v.detail ?? ''} ${u.url}`.trim());
  }
}
const rows = [...table.values()].sort(
  (a, b) => a.source.localeCompare(b.source) || a.kind.localeCompare(b.kind),
);
const pad = (s, n) => String(s).padEnd(n);
console.log(
  `Image audit of ${BASE} · ${new Date().toISOString()} · ${requests} requests${skipped ? ` (${skipped} images not checked: --max reached)` : ''}\n`,
);
console.log(
  `${pad('source', 9)}${pad('kind', 17)}${pad('checked', 8)}${pad('ok', 6)}${ISSUES.map((i) => pad(i, i.length + 2)).join('')}`,
);
for (const r of rows)
  console.log(
    `${pad(r.source, 9)}${pad(r.kind, 17)}${pad(r.checked, 8)}${pad(r.ok, 6)}${ISSUES.map((i) => pad(r[i] || '·', i.length + 2)).join('')}`,
  );
const problems = rows.filter((r) => r.examples.length);
if (problems.length) {
  console.log('\nExamples:');
  for (const r of problems) for (const e of r.examples) console.log(`  ${r.source}/${r.kind} ${e}`);
}
if (args.json)
  writeFileSync(
    args.json,
    JSON.stringify({ base: BASE, at: new Date().toISOString(), requests, skipped, rows }, null, 2),
  );

/** Runs `fn` over `items`, at most CONCURRENCY at once. */
async function pool(items, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) await fn(items[i]);
    }),
  );
}
