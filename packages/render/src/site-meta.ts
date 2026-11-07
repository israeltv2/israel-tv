// The small files search engines and browsers ask for: robots.txt, sitemap.xml and the web app manifest. Only the
// pages (landing in two languages, status) are for indexing; the addon's JSON and data paths are not.
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

export function sitemapXml(): string {
  const page = (path: string, alternates: boolean, priority: string) =>
    `<url><loc>${absolute(path)}</loc>${
      alternates
        ? `<xhtml:link rel="alternate" hreflang="en" href="${absolute('')}"/><xhtml:link rel="alternate" hreflang="he" href="${absolute('he/')}"/><xhtml:link rel="alternate" hreflang="x-default" href="${absolute('')}"/>`
        : ''
    }<priority>${priority}</priority></url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${page('', true, '1.0')}
${page('he/', true, '0.9')}
${page('status', false, '0.5')}
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
    background_color: BRAND.navy,
    theme_color: BRAND.navy,
    icons: [
      { src: `/${sitePaths.icon192}`, sizes: '192x192', type: 'image/png' },
      { src: `/${sitePaths.icon512}`, sizes: '512x512', type: 'image/png' },
      { src: `/${sitePaths.iconMaskable}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: `/${sitePaths.faviconSvg}`, sizes: 'any', type: 'image/svg+xml' },
    ],
  });
}
