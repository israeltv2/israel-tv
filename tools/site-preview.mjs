// `pnpm preview:site <published site folder> [port]`: render the public pages (landing, library, status) from an
// already published site folder (its JSON files) into a copy of it, and serve that copy locally, to see a design
// change on real data without the home database. Nothing is published.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { localAddonApp } from '../apps/ingest/src/local-server.ts';
import { siteImages } from '../apps/ingest/src/site-images.ts';
import { CATALOGS } from '../packages/core/src/catalogs.ts';
import { sitePaths } from '../packages/core/src/site.ts';
import {
  libraryUrls,
  overall,
  plain,
  renderLandingHtml,
  renderLibrary,
  renderStatusHtml,
  sitemapXml,
} from '../packages/render/src/index.ts';
import { listen } from '../packages/runtime/src/serve.ts';

const src = resolve(process.argv[2] ?? '');
const port = Number(process.argv[3] ?? 8788);
const out = join(dirname(src), `${src.split('/').pop()}-preview`);
const read = (p) => JSON.parse(readFileSync(join(src, p), 'utf8'));
const tryRead = (p) => {
  try {
    return read(p);
  } catch {
    return undefined;
  }
};

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
const status = read(sitePaths.status);
const guide = tryRead(sitePaths.epg);
const SOURCE = { iltv_keshet12: 'mako', iltv_reshet13: 'reshet' };
const rows = (status.catalogs ?? [])
  .filter((c) => c.source !== 'live')
  .map((c) => {
    const def = CATALOGS.find((x) => x.id === c.id);
    const list = [];
    for (let skip = 0; ; skip += 100) {
      const page = tryRead(sitePaths.catalog(def.type, c.id, skip))?.metas;
      if (!page?.length) break;
      list.push(...page);
    }
    const shows = list
      .filter((m) => !m.id.startsWith('iltv_status_'))
      .map((m) => {
        const meta = read(sitePaths.meta('series', m.id)).meta;
        const desc = plain(meta.description).split('\n\nכדי לצפות בפרקים של קשת 12')[0];
        return { source: SOURCE[c.id] ?? 'kan', meta: { ...meta, description: desc } };
      });
    return { id: c.id, source: c.source, shows, ...(c.filling ? { filling: c.filling } : {}) };
  });
const liveMetas = tryRead(sitePaths.catalog('tv', 'iltv_live'))?.metas ?? [];
const live = liveMetas.map((m) => ({
  id: m.id,
  name: plain(m.name),
  logo: true,
  helper: /עוזר הביתי/.test(m.description ?? ''),
}));
const wall = [];
for (let i = 0; wall.length < 36 && i < 50; i++)
  for (const r of rows) {
    const s = r.shows.filter((x) => x.meta.poster && !x.meta.poster.includes('placeholder'))[i];
    if (s && wall.length < 36) wall.push({ name: plain(s.meta.name), poster: s.meta.poster });
  }
const landing = {
  name: 'Israel TV',
  description: '',
  catalogs: status.catalogs ?? [],
  live,
  status: overall(status),
  wall,
  rowPosters: Object.fromEntries(
    rows.map((r) => [
      r.id,
      r.shows
        .filter((x) => x.meta.poster && !x.meta.poster.includes('placeholder'))
        .slice(0, 5)
        .map((x) => x.meta.poster),
    ]),
  ),
  guide,
};
const origin = `http://localhost:${port}`;
const fix = (html) =>
  html
    .replaceAll('{{israel-tv-origin}}', origin)
    .replaceAll('https://israel-tv.israeltv2.workers.dev', origin);
const files = new Map([
  [sitePaths.landing, renderLandingHtml(landing, 'en')],
  [sitePaths.landingHe, renderLandingHtml(landing, 'he')],
  [sitePaths.statusPage, renderStatusHtml(status)],
  ...renderLibrary({ rows, live, guide }),
]);
files.set(sitePaths.sitemap, sitemapXml(libraryUrls(files.keys())));
for (const [p, html] of files) {
  mkdirSync(dirname(join(out, p)), { recursive: true });
  writeFileSync(join(out, p), fix(html));
}
for (const [p, bytes] of siteImages()) {
  mkdirSync(dirname(join(out, p)), { recursive: true });
  writeFileSync(join(out, p), bytes);
}
console.log(`${files.size} pages written to ${out}; serving on ${origin}`);
await listen(localAddonApp(out).fetch, '127.0.0.1', port, 'port');
