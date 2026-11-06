// Addon images: the operator's own (branding.dir) when present, else the bundled ones (assets/branding).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUNDLED = fileURLToPath(new URL('../../../assets/branding/', import.meta.url));
const LOGOS = fileURLToPath(new URL('../../../assets/logos/', import.meta.url));

/** A live channel's bundled logo tile (square PNG), when there is one. */
export function channelLogo(id: string): Uint8Array | undefined {
  const p = join(LOGOS, `${id}.png`);
  return /^[a-z0-9_]+$/.test(id) && existsSync(p) ? readFileSync(p) : undefined;
}

export type BrandImage = 'logo' | 'resolver-logo' | 'background' | 'poster-placeholder';

/** The image's bytes and content type, from `dir` first, else bundled. */
export function brandImage(
  dir: string | undefined,
  name: BrandImage,
): { body: Uint8Array; type: string } | undefined {
  const candidates =
    name === 'background'
      ? ['background.jpg', 'background.png']
      : name === 'poster-placeholder'
        ? ['poster-placeholder.jpg']
        : [`${name}.png`];
  for (const base of [dir, BUNDLED]) {
    if (!base) continue;
    for (const file of candidates) {
      const p = join(base, file);
      if (existsSync(p))
        return { body: readFileSync(p), type: file.endsWith('.jpg') ? 'image/jpeg' : 'image/png' };
    }
  }
  return undefined;
}
