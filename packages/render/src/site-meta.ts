// The small files search engines and browsers ask for: robots.txt, sitemap.xml and the web app manifest. Only the
// pages (landing and status in two languages, the library) are for indexing; the addon's JSON and data paths are not.
import { sitePaths } from '@israel-tv/core';
import { absolute, BRAND } from './page.ts';

/** Paths that hold the addon's data, never pages (each JSON response also says `X-Robots-Tag: noindex`). */
export const DATA_PATHS = ['/catalog/', '/meta/', '/stream/', '/streams/', '/play/', '/*.json$'];

export function robotsTxt(): string {
  return `User-agent: *
${DATA_PATHS.map((p) => `Disallow: ${p}`).join('\n')}
Allow: /

Sitemap: ${absolute(sitePaths.sitemap)}
`;
}

/**
 * The sitemap: the home and status pages in both languages (each with its other language), the library's pages, and
 * the programme guide in both languages when there is one.
 */
export function sitemapXml(library: string[] = [], opts: { guide?: boolean } = {}): string {
  const page = (path: string, priority: string, pair?: { en: string; he: string }) =>
    `<url><loc>${absolute(path)}</loc>${
      pair
        ? `<xhtml:link rel="alternate" hreflang="en" href="${absolute(pair.en)}"/><xhtml:link rel="alternate" hreflang="he" href="${absolute(pair.he)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${absolute(pair.en)}"/>`
        : ''
    }<priority>${priority}</priority></url>`;
  const home = { en: '', he: 'he/' };
  const status = { en: 'status', he: 'he/status' };
  const guide = { en: 'en/live/guide/', he: 'live/guide/' };
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${page('', '1.0', home)}
${page('he/', '0.9', home)}
${page('status', '0.5', status)}
${page('he/status', '0.5', status)}
${opts.guide ? `${page(guide.he, '0.7', guide)}\n${page(guide.en, '0.6', guide)}\n` : ''}${library.map((p) => page(p, p.startsWith('show/') ? '0.6' : '0.8')).join('\n')}
</urlset>
`;
}

export function webManifest(): string {
  return JSON.stringify({
    name: 'Israel TV',
    short_name: 'Israel TV',
    description: 'Israeli TV shows and live channels in Stremio and Nuvio.',
    start_url: '/',
    scope: '/',
    display: 'browser',
    background_color: BRAND.night,
    theme_color: BRAND.night,
    icons: [
      { src: `/${sitePaths.icon192}`, sizes: '192x192', type: 'image/png' },
      { src: `/${sitePaths.icon512}`, sizes: '512x512', type: 'image/png' },
      { src: `/${sitePaths.iconMaskable}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: `/${sitePaths.faviconSvg}`, sizes: 'any', type: 'image/svg+xml' },
    ],
  });
}
