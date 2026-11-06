// Browser adapter for Kan pages: a real Chrome/Chromium (configurable path), one fresh context per page
// (Kan's Cloudflare lets the first navigation of a session through), images/fonts/media blocked to keep
// proxy connections down, optional geo proxy.
import type { BrowserConfig } from '@israel-tv/core';
import type { ProxyEndpoint } from '@israel-tv/net';
import { type Browser, chromium } from 'playwright-core';
import { isChallenge } from './parse.ts';

export interface LoadedPage {
  status: number;
  html: string;
  challenged: boolean;
  /** The image asked for with `image`, fetched in the same session and resized to a JPEG. */
  image?: { url: string; status: number; jpeg?: Uint8Array; error?: string };
}

export interface LoadOptions {
  /** An image the page links to (e.g. its share image), to fetch in the same browser session. */
  image?: (html: string) => string | undefined;
  /** Largest width of the resized image. */
  imageWidth?: number;
}

export interface PageLoader {
  load(url: string, opts?: LoadOptions): Promise<LoadedPage>;
  close(): Promise<void>;
}

/**
 * Runs in a blank tab: scale an image (given as a data: URL, so the canvas is never tainted) down on a canvas and
 * hand back a JPEG as base64.
 */
async function fetchResized(arg: {
  src: string;
  width: number;
}): Promise<{ status: number; b64?: string; error?: string }> {
  // Browser APIs (this runs inside the page), typed here without pulling the DOM types into Node code.
  const g = globalThis as unknown as {
    Image: new () => { src: string; decode(): Promise<void>; naturalWidth: number; naturalHeight: number };
    OffscreenCanvas: new (
      w: number,
      h: number,
    ) => {
      getContext(t: '2d'): { drawImage(i: unknown, x: number, y: number, w: number, h: number): void } | null;
      convertToBlob(o: { type: string; quality: number }): Promise<Blob>;
    };
  };
  try {
    const img = new g.Image();
    img.src = arg.src;
    await img.decode();
    const w = Math.min(arg.width, img.naturalWidth);
    const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
    const canvas = new g.OffscreenCanvas(w, h);
    canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
    const bytes = new Uint8Array(
      await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 })).arrayBuffer(),
    );
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { status: 200, b64: btoa(bin) };
  } catch (err) {
    return { status: 0, error: String(err) };
  }
}

export async function createChromeLoader(
  cfg: Extract<BrowserConfig, { type: 'chrome' }>,
  proxy: ProxyEndpoint | undefined,
): Promise<PageLoader> {
  let browser: Browser;
  try {
    browser = await chromium.launch({
      ...(cfg.executablePath ? { executablePath: cfg.executablePath } : { channel: 'chrome' }),
      headless: !cfg.headed,
      args: ['--window-position=-2400,-2400', '--window-size=1280,900', '--mute-audio'],
      ...(proxy
        ? {
            proxy: {
              server: proxy.server,
              ...(proxy.username ? { username: proxy.username } : {}),
              ...(proxy.password ? { password: proxy.password } : {}),
            },
          }
        : {}),
    });
  } catch (err) {
    throw new Error(
      `could not start the browser for Kan (${(err as Error).message.split('\n')[0]}). ` +
        'Install Google Chrome, or set browser.executablePath in israel-tv.config.json, or set browser.type to "none" to turn Kan off.',
    );
  }
  return {
    async load(url, opts = {}) {
      const context = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
      try {
        // Heavy resources are not loaded, except the one image asked for (see `image`).
        let allowImage: string | undefined;
        await context.route('**/*', (route) => {
          const req = route.request();
          return ['image', 'font', 'media'].includes(req.resourceType()) && req.url() !== allowImage
            ? route.abort()
            : route.continue();
        });
        const page = await context.newPage();
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        for (let i = 0; i < 25 && isChallenge(await page.content()); i++) await page.waitForTimeout(1000);
        await page.waitForTimeout(1500);
        const html = await page.content();
        const challenged = isChallenge(html);
        const src = !challenged && opts.image ? opts.image(html) : undefined;
        if (!src) return { status: res?.status() ?? 0, html, challenged };
        // The show page loads the image the way it would show it (an image request, from that page, in this
        // session: Kan refuses its images to a script's fetch and to opening them as a page). Its bytes are taken
        // from the browser's answer and scaled down in a blank tab from a data: URL, so a canvas is never tainted
        // by an image from another site (kankids).
        allowImage = new URL(src, page.url()).toString();
        const want = allowImage;
        const response = page.waitForResponse((r) => r.url() === want, { timeout: 30_000 }).catch(() => null);
        await page.evaluate((u) => {
          const img = new (globalThis as unknown as { Image: new () => { src: string } }).Image();
          img.src = u;
        }, want);
        const answer = await response;
        const answered = answer?.status() ?? 0;
        let got: { status: number; b64?: string; error?: string } = { status: answered };
        if (answer && answered === 200) {
          const body = await answer.body();
          const type = (answer.headers()['content-type'] ?? 'image/jpeg').split(';')[0];
          const blank = await context.newPage();
          got = await blank.evaluate(fetchResized, {
            src: `data:${type};base64,${body.toString('base64')}`,
            width: opts.imageWidth ?? 960,
          });
        }
        return {
          status: res?.status() ?? 0,
          html,
          challenged,
          image: {
            url: src,
            status: got.status,
            ...(got.b64 ? { jpeg: Buffer.from(got.b64, 'base64') } : {}),
            ...(got.error ? { error: got.error } : {}),
          },
        };
      } finally {
        await context.close();
      }
    },
    close: () => browser.close(),
  };
}
