// Serves the owner's dashboard (apps/dashboard/web) to the admin app: the page, its stylesheet, its TypeScript with
// the types stripped (Node's own stripTypeScriptTypes — no bundler, no build step, nothing generated), and the few
// browser modules it uses (Preact, htm, uPlot), straight from the installed packages. The page finds them
// through an import map whose hash goes into the content security policy.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));

/** Browser modules: the name the page imports → the file in the installed package. */
const VENDOR: Record<string, { file: string; as: string }> = {
  preact: { file: 'preact', as: 'preact.mjs' },
  'preact/hooks': { file: 'preact/hooks', as: 'preact-hooks.mjs' },
  htm: { file: 'htm', as: 'htm.mjs' },
  'htm/preact': { file: 'htm/preact', as: 'htm-preact.mjs' },
};

function vendorPath(name: string): string {
  return fileURLToPath(import.meta.resolve(name));
}
const UPLOT_DIR = fileURLToPath(new URL('.', import.meta.resolve('uplot/package.json')));

const IMPORT_MAP = JSON.stringify({
  imports: {
    ...Object.fromEntries(Object.entries(VENDOR).map(([name, v]) => [name, `/dash/vendor/${v.as}`])),
  },
});
/** The CSP source that allows exactly this inline import map. */
export const IMPORT_MAP_HASH = `'sha256-${createHash('sha256').update(IMPORT_MAP).digest('base64')}'`;

export interface DashboardFile {
  body: string;
  type: string;
  /** Safe to cache for good (vendor files are fixed per installed version). */
  immutable: boolean;
}

const cache = new Map<string, DashboardFile>();
const JS = 'text/javascript; charset=utf-8';

function load(path: string): DashboardFile | undefined {
  if (path === 'index.html') {
    const html = readFileSync(`${WEB}index.html`, 'utf8').replace('{ "imports": {} }', IMPORT_MAP);
    return { body: html, type: 'text/html; charset=utf-8', immutable: false };
  }
  if (path === 'styles.css')
    return {
      body: readFileSync(`${WEB}styles.css`, 'utf8'),
      type: 'text/css; charset=utf-8',
      immutable: false,
    };
  // uPlot's minified build (a classic script that defines window.uPlot; its module build is not minified).
  if (path === 'vendor/uplot.min.js')
    return { body: readFileSync(`${UPLOT_DIR}dist/uPlot.iife.min.js`, 'utf8'), type: JS, immutable: true };
  if (path === 'vendor/uplot.css')
    return {
      body: readFileSync(`${UPLOT_DIR}dist/uPlot.min.css`, 'utf8'),
      type: 'text/css; charset=utf-8',
      immutable: true,
    };
  const vendor = Object.values(VENDOR).find((v) => `vendor/${v.as}` === path);
  if (vendor) return { body: readFileSync(vendorPath(vendor.file), 'utf8'), type: JS, immutable: true };
  // The page's own modules: web/<name>.ts, types stripped. Only plain names in the web folder.
  const m = /^app\/([a-z0-9-]+)\.ts$/.exec(path);
  if (m && existsSync(`${WEB}${m[1]}.ts`)) {
    const source = readFileSync(`${WEB}${m[1]}.ts`, 'utf8');
    return { body: stripTypeScriptTypes(source), type: JS, immutable: false };
  }
  return undefined;
}

/** A dashboard file by its path under /dash/, or undefined. Kept in memory once read. */
export function dashboardFile(path: string): DashboardFile | undefined {
  const hit = cache.get(path);
  if (hit) return hit;
  const f = load(path);
  if (f) cache.set(path, f);
  return f;
}

/** Every file the page loads at first (for the size budget test). */
export function dashboardFiles(): string[] {
  const app = ['main', 'api', 'views', 'charts'].map((n) => `app/${n}.ts`);
  return [
    'index.html',
    'styles.css',
    ...app,
    ...Object.values(VENDOR).map((v) => `vendor/${v.as}`),
    'vendor/uplot.min.js',
    'vendor/uplot.css',
  ];
}
