// `pnpm images:site`: make the public pages' images from the branding (assets/branding) into assets/site: the
// favicon set (favicon.ico from icon.svg; PNG icons and the Apple touch icon from the logo), the 1200×630 share
// image and a lighter copy of the background for the landing page's header. Run it after changing the branding and
// commit the results; publishing only copies them. Uses the installed Chrome (Edge on Windows) through Playwright.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const repo = fileURLToPath(new URL('..', import.meta.url));
const branding = join(repo, 'assets/branding');
const out = join(repo, 'assets/site');
const dataUrl = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;
const logo = dataUrl(join(branding, 'logo-1024.png'), 'image/png');
const svg = dataUrl(join(out, 'icon.svg'), 'image/svg+xml');
const background = dataUrl(join(branding, 'background.jpg'), 'image/jpeg');

const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
const page = await browser.newPage({ deviceScaleFactor: 1 });

/** A square PNG of an image, `pad` of the size left around it, on `bg` (transparent when omitted). */
async function square(src, size, { pad = 0, bg } = {}) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${bg ?? 'transparent'}"><img src="${src}" style="width:${size - 2 * pad}px;height:${size - 2 * pad}px"></body>`,
  );
  await page.locator('img').evaluate((img) => img.decode());
  return page.screenshot({ omitBackground: !bg, type: 'png' });
}

/** An .ico holding PNG images (every current browser reads PNG inside ICO). */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((x) => x.png)]);
}

const small = [];
for (const size of [16, 32, 48]) small.push({ size, png: await square(svg, size) });
writeFileSync(join(out, 'favicon.ico'), ico(small));
writeFileSync(join(out, 'icon-192.png'), await square(logo, 192));
writeFileSync(join(out, 'icon-512.png'), await square(logo, 512));
// Maskable: the logo inside the safe zone (80%) on a solid colour, for Android's shaped icons.
writeFileSync(join(out, 'icon-maskable-512.png'), await square(logo, 512, { pad: 72, bg: '#e3f4fd' }));
// iOS fills transparency with black: an opaque tile.
writeFileSync(join(out, 'apple-touch-icon.png'), await square(logo, 180, { pad: 14, bg: '#e3f4fd' }));

// The landing page's header: the background at 1600 px, as a lighter JPEG.
await page.setViewportSize({ width: 1600, height: 900 });
await page.setContent(
  `<body style="margin:0;overflow:hidden"><img src="${background}" style="display:block;width:1600px;height:900px;object-fit:cover"></body>`,
);
await page.locator('img').evaluate((img) => img.decode());
// A progressive JPEG paints in passes: let the last one land.
await page.waitForTimeout(500);
writeFileSync(
  join(out, 'hero.jpg'),
  await page.screenshot({ type: 'jpeg', quality: 62, clip: { x: 0, y: 0, width: 1600, height: 900 } }),
);

// The share image (Open Graph / Twitter cards): 1200×630.
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;width:1200px;height:630px;overflow:hidden;font-family:"SF Pro Display",system-ui,"Segoe UI",Arial,sans-serif;color:#fff;
background:url(${background}) center 70%/cover #0b1730}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,16,36,.15) 0%,rgba(8,16,36,.2) 45%,rgba(8,16,36,.75) 100%)}
.box{position:absolute;left:84px;top:92px;display:flex;align-items:center;gap:40px}
img{width:200px;height:200px;filter:drop-shadow(0 8px 24px rgba(0,0,0,.45))}
h1{font-size:92px;line-height:1;margin:0 0 18px;letter-spacing:-1.5px;font-weight:800}
p{margin:0;font-size:38px;line-height:1.25;color:#d6ecfb;font-weight:500}
.he{position:absolute;left:84px;right:84px;bottom:64px;font-size:36px;font-weight:600;color:#fff;display:flex;gap:18px;flex-wrap:wrap;direction:rtl;justify-content:flex-end}
.he span{background:rgba(42,169,238,.22);border:1px solid rgba(201,238,255,.45);padding:8px 22px;border-radius:999px}
</style></head><body><div class="shade"></div>
<div class="box"><img src="${logo}" alt=""><div><h1>Israel TV</h1><p>Israeli TV in Stremio and Nuvio<br>Free, no account</p></div></div>
<div class="he" lang="he"><span>קשת 12</span><span>רשת 13</span><span>כאן</span><span>שידור חי</span></div>
</body></html>`);
await page.locator('img').evaluate((img) => img.decode());
await page.waitForTimeout(500);
writeFileSync(join(out, 'og.jpg'), await page.screenshot({ type: 'jpeg', quality: 85 }));

await browser.close();
console.log(`wrote the site images to ${out}`);
