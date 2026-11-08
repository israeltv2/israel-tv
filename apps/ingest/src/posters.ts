// Series posters are portrait (2:3), always: apps show them in a "poster" row, and a landscape image there is
// cropped or letter-boxed. Every poster's real shape is measured: a portrait image is used as it is, any other is
// turned into a portrait one here (the image fitted on a blurred, darkened fill of itself) and served from our site.
// A poster that is refused outside Israel (Kan's own site) is never published: our copy, or a placeholder until then.
// A portrait poster that is needlessly heavy (Keshet 12's are often 200+ KB at 420×600) on a host that cannot resize
// on request is served as our own lighter copy, at most POSTER_W wide (the same picture, ~50 KB).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type Config, ORIGIN_TOKEN } from '@israel-tv/core';
import type { Store } from '@israel-tv/store';
import jpeg from 'jpeg-js';

export const POSTER_W = 400;
export const POSTER_H = 600;
const STATE_KEY = 'posters:v1';
/** Image hosts that refuse viewers outside Israel: never published as a poster address. */
const GEO_BLOCKED = /(^|\.)kan\.org\.il$/i;
const RETRY_FAILED_MS = 24 * 3600_000;
const MAX_BYTES = 8 * 1024 * 1024;

export type Size = { w: number; h: number };
/**
 * `file`: our version of it (a portrait one, or a lighter copy). `v`: 2 once a portrait poster has also been checked
 * for weight (posters measured before that are fetched once more).
 */
type Measured =
  | { w: number; h: number; at: string; file?: string; v?: number }
  | { error: string; at: string };
/** A portrait JPEG heavier than this is worth a lighter copy... */
const COMPACT_FROM_BYTES = 100 * 1024;
/** ...when the copy is at most this share of it. */
const COMPACT_GAIN = 0.6;
/** Hosts that resize on request (the site asks them for its size): their posters stay theirs. */
const RESIZES = /^https:\/\/media\d*\.reshet\.tv\/image\/upload\//;
type PosterState = Record<string, Measured>;

export function posterDir(config: Config): string {
  return join(dirname(config.store.path), 'posters');
}

/** Portrait enough for a poster row: at least 6:5 tall (2:3 posters, 9:16 stills, 7:10 covers). */
export function isPortrait(s: Size): boolean {
  return s.h >= s.w * 1.2;
}

/**
 * A broadcaster's own stand-in for a show with no artwork (Reshet's black "default poster"): not the show's image,
 * so never published as its poster (ours is used instead, and the dashboard draws its tile).
 */
const STOCK_IMAGE = /(?:deafult|default)_poster_image/i;

export function isStockImage(url: string): boolean {
  return STOCK_IMAGE.test(url);
}

/** Our own files (the site's address token) and any host not on the refused list. */
export function reachableAbroad(url: string): boolean {
  if (url.startsWith(`${ORIGIN_TOKEN}/`)) return true;
  try {
    return !GEO_BLOCKED.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Width and height from the image header (JPEG, PNG, WebP), without decoding it. */
export function imageSize(b: Uint8Array): Size | undefined {
  const u16 = (i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
  const u32 = (i: number) => ((u16(i) << 16) | u16(i + 2)) >>> 0;
  const le16 = (i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
  const le24 = (i: number) => le16(i) | ((b[i + 2] ?? 0) << 16);
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return undefined;
      const marker = b[i + 1] ?? 0;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { h: u16(i + 5), w: u16(i + 7) };
      i += 2 + u16(i + 2);
    }
    return undefined;
  }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: u32(16), h: u32(20) };
  const tag = (i: number) => String.fromCharCode(...b.subarray(i, i + 4));
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

type Pixels = { width: number; height: number; data: Uint8Array };

/** Bilinear sample of a source rectangle into a w×h image. */
function resample(src: Pixels, sx: number, sy: number, sw: number, sh: number, w: number, h: number): Pixels {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(src.height - 1, Math.max(0, sy + ((y + 0.5) * sh) / h - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(src.width - 1, Math.max(0, sx + ((x + 0.5) * sw) / w - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(src.width - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const p = (yy: number, xx: number) => src.data[(yy * src.width + xx) * 4 + c] ?? 0;
        const top = p(y0, x0) * (1 - tx) + p(y0, x1) * tx;
        const bottom = p(y1, x0) * (1 - tx) + p(y1, x1) * tx;
        out[(y * w + x) * 4 + c] = top * (1 - ty) + bottom * ty;
      }
      out[(y * w + x) * 4 + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

/** Three box-blur passes each way (close to a Gaussian), in place. */
function blur(img: Pixels, r: number): void {
  const { width: w, height: h, data } = img;
  const line = new Float32Array(Math.max(w, h) * 3);
  const pass = (len: number, count: number, at: (i: number, k: number) => number) => {
    for (let k = 0; k < count; k++) {
      for (let i = 0; i < len; i++) for (let c = 0; c < 3; c++) line[i * 3 + c] = data[at(i, k) + c] ?? 0;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let i = -r; i <= r; i++) sum += line[Math.min(len - 1, Math.max(0, i)) * 3 + c] ?? 0;
        for (let i = 0; i < len; i++) {
          data[at(i, k) + c] = sum / (2 * r + 1);
          sum += (line[Math.min(len - 1, i + r + 1) * 3 + c] ?? 0) - (line[Math.max(0, i - r) * 3 + c] ?? 0);
        }
      }
    }
  };
  for (let n = 0; n < 3; n++) {
    pass(w, h, (i, k) => (k * w + i) * 4);
    pass(h, w, (i, k) => (i * w + k) * 4);
  }
}

/** A 2:3 poster from any JPEG: the whole image, centred on a blurred, darkened fill cut from itself. */
export function portraitPoster(source: Uint8Array): Uint8Array {
  const src = jpeg.decode(source, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 }) as Pixels;
  // The fill: the middle of the image, cropped to 2:3, small, blurred, darkened, then scaled up.
  const cropW = Math.min(src.width, (src.height * POSTER_W) / POSTER_H);
  const cropH = Math.min(src.height, (src.width * POSTER_H) / POSTER_W);
  const small = resample(src, (src.width - cropW) / 2, (src.height - cropH) / 2, cropW, cropH, 40, 60);
  blur(small, 3);
  for (let i = 0; i < small.data.length; i += 4)
    for (let c = 0; c < 3; c++) small.data[i + c] = (small.data[i + c] ?? 0) * 0.55;
  const out = resample(small, 0, 0, 40, 60, POSTER_W, POSTER_H);
  // The image itself, fitted inside.
  const scale = Math.min(POSTER_W / src.width, POSTER_H / src.height);
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const fit = resample(src, 0, 0, src.width, src.height, w, h);
  const ox = Math.floor((POSTER_W - w) / 2);
  const oy = Math.floor((POSTER_H - h) / 2);
  for (let y = 0; y < h; y++)
    out.data.set(fit.data.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * POSTER_W + ox) * 4);
  return jpeg.encode({ width: POSTER_W, height: POSTER_H, data: out.data }, 82).data;
}

/**
 * A lighter copy of a portrait JPEG: at most POSTER_W wide, re-encoded. Undefined when it would not be much lighter,
 * or the image is not a JPEG we can read (PNG posters stay as they are).
 */
export function compactPoster(source: Uint8Array): Uint8Array | undefined {
  if (source[0] !== 0xff || source[1] !== 0xd8) return undefined;
  let src: Pixels;
  try {
    src = jpeg.decode(source, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 }) as Pixels;
  } catch {
    return undefined;
  }
  const scale = Math.min(1, POSTER_W / src.width);
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const img = scale < 1 ? resample(src, 0, 0, src.width, src.height, w, h) : src;
  const out = jpeg.encode({ width: w, height: h, data: img.data }, 80).data;
  return out.length <= source.length * COMPACT_GAIN ? out : undefined;
}

/**
 * A local image as a portrait poster: `same` when it is one already, else a portrait version (kept next to the
 * data); undefined when it cannot be read.
 */
export function localPoster(file: string, dir: string): 'same' | Uint8Array | undefined {
  const body = readFileSync(file);
  const size = imageSize(body);
  if (!size) return undefined;
  if (isPortrait(size)) return 'same';
  const name = `local-${hash(`${file}|${statSync(file).mtimeMs}|${body.length}`)}.jpg`;
  const out = join(dir, name);
  if (existsSync(out)) return readFileSync(out);
  try {
    const poster = portraitPoster(body);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(out, poster);
    return poster;
  } catch {
    return undefined;
  }
}

/**
 * What to publish for a remote poster: its address when portrait (or not measured yet: failed fetches are retried),
 * our lighter copy when it has one, our portrait version of it when it is not portrait, and nothing (the placeholder)
 * when neither can be published.
 */
export type RemotePoster = { url: string } | { file: string } | { none: true };

export function remotePoster(store: Store, dir: string, url: string): RemotePoster {
  if (!reachableAbroad(url) || isStockImage(url)) return { none: true };
  const m = store.getState<PosterState>(STATE_KEY)?.[url];
  if (m && 'w' in m && m.file && existsSync(join(dir, m.file))) return { file: join(dir, m.file) };
  if (!m || !('w' in m) || isPortrait(m)) return { url };
  return { none: true };
}

/**
 * Measures every remote poster not measured yet (and failed ones again after a day): fetched once each, a few
 * at a time; a poster that is not portrait gets its portrait version made now, a heavy portrait one its lighter copy.
 * Returns how many were measured.
 */
export async function measurePosters(
  store: Store,
  dir: string,
  urls: string[],
  opts: { fetch?: typeof fetch; now?: number; concurrency?: number; warn?: (msg: string) => void } = {},
): Promise<number> {
  const get = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now();
  const state = { ...(store.getState<PosterState>(STATE_KEY) ?? {}) };
  const due = [...new Set(urls)].filter((u) => {
    if (!reachableAbroad(u) || isStockImage(u)) return false;
    const m = state[u];
    if (m && 'w' in m) return isPortrait(m) && !m.v && !RESIZES.test(u);
    return !m || now - Date.parse(m.at) > RETRY_FAILED_MS;
  });
  const at = new Date(now).toISOString();
  let next = 0;
  const worker = async () => {
    for (let u = due[next++]; u !== undefined; u = due[next++]) {
      try {
        const r = await get(u, { signal: AbortSignal.timeout(20_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = new Uint8Array(await r.arrayBuffer());
        if (body.length > MAX_BYTES) throw new Error('too large');
        const size = imageSize(body);
        if (!size) throw new Error('not an image we can read');
        let file: string | undefined;
        if (isPortrait(size)) {
          const light =
            body.length > COMPACT_FROM_BYTES && !RESIZES.test(u) ? compactPoster(body) : undefined;
          if (light) {
            file = `remote-${hash(u)}.jpg`;
            mkdirSync(dir, { recursive: true, mode: 0o700 });
            writeFileSync(join(dir, file), light);
          }
        } else {
          try {
            const poster = portraitPoster(body);
            file = `remote-${hash(u)}.jpg`;
            mkdirSync(dir, { recursive: true, mode: 0o700 });
            writeFileSync(join(dir, file), poster);
          } catch (e) {
            opts.warn?.(`poster ${u}: ${size.w}x${size.h}, no portrait version (${(e as Error).message})`);
          }
        }
        state[u] = { ...size, at, v: 2, ...(file ? { file } : {}) };
      } catch (e) {
        state[u] = { error: (e as Error).message, at };
        opts.warn?.(`poster ${u}: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, due.length) }, worker));
  if (due.length) store.setState(STATE_KEY, state);
  return due.length;
}

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/** What is known of a remote poster's shape: measured portrait, measured not portrait, or not measured (yet). */
export function remotePosterShape(store: Store, url: string): 'portrait' | 'not portrait' | 'unmeasured' {
  const m = store.getState<PosterState>(STATE_KEY)?.[url];
  if (!m || !('w' in m)) return 'unmeasured';
  return isPortrait(m) ? 'portrait' : 'not portrait';
}
