// Serves the built dashboard (apps/dashboard/dist, made by `pnpm build`) to the daemon's admin app. The page is a
// static single-page app: hashed assets are cached for good, the page itself never. Every page gets a fresh nonce
// for the style elements its components add at run time, and a strict content security policy (no inline script,
// nothing from other origins except show posters).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

export interface DashboardFile {
  body: Uint8Array | string;
  type: string;
  /** Safe to cache for good (content-hashed names). */
  immutable: boolean;
}

/** Whether the dashboard has been built (`pnpm build`); the daemon says so on /status otherwise. */
export function dashboardBuilt(): boolean {
  return existsSync(`${DIST}index.html`);
}

const NOT_BUILT = `<!doctype html><meta charset="utf-8"><title>Dashboard not built</title>
<p style="font:16px system-ui;margin:2rem">The dashboard has not been built in this copy. Run <code>pnpm build</code>
(or use a release / the Docker image, which include it), then reload.</p>`;

const cache = new Map<string, DashboardFile>();

/** The CSP for a dashboard page with this nonce. Posters come from the broadcasters' and the catalog's https URLs. */
export function dashboardCsp(nonce: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

/** A fresh nonce for one page. */
export function newNonce(): string {
  return randomBytes(16).toString('base64');
}

/**
 * A dashboard file by its path under /dash/ ('' or 'index.html' is the page, with `nonce` filled in), or
 * undefined. Only files inside dist are served.
 */
export function dashboardFile(path: string, nonce = ''): DashboardFile | undefined {
  const rel = path === '' ? 'index.html' : path;
  if (rel === 'index.html') {
    if (!dashboardBuilt()) return { body: NOT_BUILT, type: TYPES['.html'] as string, immutable: false };
    const html = readFileSync(`${DIST}index.html`, 'utf8').replaceAll('__CSP_NONCE__', nonce);
    return { body: html, type: TYPES['.html'] as string, immutable: false };
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(rel) || rel.includes('..')) return undefined;
  const full = normalize(`${DIST}${rel}`);
  if (!full.startsWith(normalize(DIST)) || full.endsWith(sep)) return undefined;
  const hit = cache.get(rel);
  if (hit) return hit;
  const type = TYPES[extname(rel)];
  if (!type || !existsSync(full)) return undefined;
  const f = { body: readFileSync(full), type, immutable: rel.startsWith('assets/') };
  if (f.immutable) cache.set(rel, f);
  return f;
}
