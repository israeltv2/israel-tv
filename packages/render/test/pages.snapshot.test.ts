// Every page type rendered from the fixtures, kept as files: a change to the renderer that changes a page shows up
// here as a diff to review (`vitest -u` accepts it). Inline scripts are compared separately from the markup.
import { sitePaths } from '@israel-tv/core';
import { expect, test } from 'vitest';
import { renderLandingHtml } from '../src/landing-html.ts';
import { renderLibrary } from '../src/library-html.ts';
import { robotsTxt, sitemapXml, webManifest } from '../src/site-meta.ts';
import { renderStatusHtml } from '../src/status-html.ts';
import { LANDING, LIBRARY, SITE_STATUS } from './fixtures/site.ts';

const landing = {
  ...LANDING,
  publicUrl: 'https://addon.example.dev',
  ...(LIBRARY.guide ? { guide: LIBRARY.guide } : {}),
};
const library = renderLibrary(LIBRARY);
const PAGES: Record<string, string> = {
  'landing-en': renderLandingHtml(landing, 'en'),
  'landing-he': renderLandingHtml(landing, 'he'),
  status: renderStatusHtml(SITE_STATUS),
  'status-he': renderStatusHtml(SITE_STATUS, {}, 'he'),
  library: String(library.get(sitePaths.library)),
  row: String(library.get(sitePaths.libraryRow('reshet13'))),
  show: String(library.get(sitePaths.showPage('iltv_reshet_1'))),
  'show-empty': String(library.get(sitePaths.showPage('iltv_reshet_2'))),
  live: String(library.get(sitePaths.livePage)),
  search: String(library.get(sitePaths.searchPage)),
  sitemap: sitemapXml([...library.keys()].map((p) => p.replace(/index\.html$/, ''))),
  robots: robotsTxt(),
  manifest: webManifest(),
};

/** Pages, one tag per line (readable diffs), with the inline scripts and styles replaced by their names. */
const markup = (html: string) =>
  html
    .replace(/<script>[\s\S]*?<\/script>/g, '<script>…</script>')
    .replace(/<style>[\s\S]*?<\/style>/g, '<style>…</style>')
    .replace(/></g, '>\n<');

for (const [name, html] of Object.entries(PAGES))
  test(`page: ${name}`, async () => {
    await expect(markup(html)).toMatchFileSnapshot(`./__snapshots__/pages/${name}.html`);
  });

test('styles of every page', async () => {
  const styles = Object.entries(PAGES)
    .map(([name, html]) => `/* ${name} */\n${(html.match(/<style>[\s\S]*?<\/style>/g) ?? []).join('\n')}`)
    .join('\n\n');
  await expect(styles).toMatchFileSnapshot('./__snapshots__/pages/styles.css.txt');
});

test('inline scripts of every page', async () => {
  const scripts = Object.entries(PAGES)
    .map(([name, html]) => `// ${name}\n${(html.match(/<script>[\s\S]*?<\/script>/g) ?? []).join('\n')}`)
    .join('\n\n');
  await expect(scripts).toMatchFileSnapshot('./__snapshots__/pages/scripts.js.txt');
});
