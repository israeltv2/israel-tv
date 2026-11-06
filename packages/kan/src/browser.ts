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
}

export interface PageLoader {
  load(url: string): Promise<LoadedPage>;
  close(): Promise<void>;
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
    async load(url) {
      const context = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
      try {
        await context.route('**/*', (route) =>
          ['image', 'font', 'media'].includes(route.request().resourceType())
            ? route.abort()
            : route.continue(),
        );
        const page = await context.newPage();
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        for (let i = 0; i < 25 && isChallenge(await page.content()); i++) await page.waitForTimeout(1000);
        await page.waitForTimeout(1500);
        const html = await page.content();
        return { status: res?.status() ?? 0, html, challenged: isChallenge(html) };
      } finally {
        await context.close();
      }
    },
    close: () => browser.close(),
  };
}
