// The size budget (gzip, as a browser receives it), measured on the build: what the first page loads, and
// everything together (the chart library loads with the sections that draw charts). Run `pnpm build` first.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { dashboardBuilt } from '../server/serve.ts';

const BUDGET_KB = { entryJs: 140, allJs: 300, css: 12 };
const DIST = new URL('../dist/', import.meta.url);

test.skipIf(!dashboardBuilt())('the dashboard stays small (gzip)', () => {
  const manifest = JSON.parse(readFileSync(new URL('.vite/manifest.json', DIST), 'utf8')) as Record<
    string,
    { file: string; isEntry?: boolean; imports?: string[]; css?: string[] }
  >;
  const gz = (file: string) => gzipSync(readFileSync(new URL(file, DIST))).length / 1024;
  const entryKey = Object.keys(manifest).find((k) => manifest[k]?.isEntry) as string;
  // The entry and the chunks it imports statically.
  const first = new Set<string>();
  const walk = (k: string) => {
    const m = manifest[k];
    if (!m || first.has(m.file)) return;
    first.add(m.file);
    for (const i of m.imports ?? []) walk(i);
  };
  walk(entryKey);
  const files = [...new Set(Object.values(manifest).map((m) => m.file))];
  const js = (list: Iterable<string>) =>
    [...list].filter((f) => f.endsWith('.js')).reduce((n, f) => n + gz(f), 0);
  const css = [...new Set(Object.values(manifest).flatMap((m) => m.css ?? []))].reduce(
    (n, f) => n + gz(f),
    0,
  );
  const sizes = { entryJs: js(first), allJs: js(files), css };
  console.log(
    `dashboard (gzip): first load ${sizes.entryJs.toFixed(1)} KB JS, all ${sizes.allJs.toFixed(1)} KB JS, ${sizes.css.toFixed(1)} KB CSS`,
  );
  expect(sizes.entryJs).toBeLessThan(BUDGET_KB.entryJs);
  expect(sizes.allJs).toBeLessThan(BUDGET_KB.allJs);
  expect(sizes.css).toBeLessThan(BUDGET_KB.css);
});

test.runIf(process.env.CI)('CI builds the dashboard before testing it', () => {
  expect(dashboardBuilt()).toBe(true);
});
