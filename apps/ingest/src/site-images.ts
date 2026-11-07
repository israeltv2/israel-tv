// The public pages' icons, share image and header picture (made from the branding by `pnpm images:site` into
// assets/site). An operator's own copy of a file in `<branding.dir>/site/` replaces the bundled one.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sitePaths } from '@israel-tv/core';

const BUNDLED = fileURLToPath(new URL('../../../assets/site/', import.meta.url));

export const SITE_IMAGES = [
  sitePaths.favicon,
  sitePaths.faviconSvg,
  sitePaths.appleTouchIcon,
  sitePaths.icon192,
  sitePaths.icon512,
  sitePaths.iconMaskable,
  sitePaths.shareImage,
  sitePaths.heroImage,
] as const;

export function siteImages(brandingDir?: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const name of SITE_IMAGES) {
    for (const dir of [brandingDir ? join(brandingDir, 'site') : undefined, BUNDLED]) {
      const p = dir && join(dir, name);
      if (p && existsSync(p)) {
        out.set(name, readFileSync(p));
        break;
      }
    }
  }
  return out;
}
