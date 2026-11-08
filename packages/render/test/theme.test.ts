import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, test } from 'vitest';

// The theme button in client/site.js, run against a minimal page. The view transition applies the change a moment
// later (as browsers do), which is when a value read back from the page was still the old theme.
const SITE_JS = readFileSync(new URL('../src/client/site.js', import.meta.url), 'utf8');
const THEME_FIRST = readFileSync(new URL('../src/client/theme-first.js', import.meta.url), 'utf8');

function page(stored: string | null, transitions: boolean) {
  const store = new Map<string, string>(stored ? [['iltv-theme', stored]] : []);
  const pending: Array<() => void> = [];
  let click: () => void = () => {};
  const root = { lang: 'en', dataset: {} as Record<string, string> };
  const document = {
    documentElement: root,
    getElementById: (id: string) =>
      id === 'theme'
        ? {
            addEventListener: (_: string, fn: () => void) => {
              click = fn;
            },
          }
        : null,
    querySelectorAll: () => [],
    ...(transitions ? { startViewTransition: (fn: () => void) => pending.push(fn) } : {}),
  };
  const ctx = {
    document,
    window: { Intl },
    Intl,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
    },
    matchMedia: () => ({ matches: false }),
    location: { origin: 'https://example.test', host: 'example.test' },
    navigator: {},
    setInterval: () => 0,
    setTimeout: () => 0,
  };
  runInNewContext(THEME_FIRST, ctx);
  runInNewContext(SITE_JS, ctx);
  return {
    theme: () => root.dataset.theme ?? 'dark',
    stored: () => store.get('iltv-theme') ?? null,
    click: () => {
      click();
      for (const fn of pending.splice(0)) fn();
    },
    reload: () => page(store.get('iltv-theme') ?? null, transitions),
  };
}

describe('the theme button', () => {
  for (const transitions of [true, false]) {
    test(`remembers the theme it switched to (${transitions ? 'with' : 'without'} a view transition)`, () => {
      let p = page(null, transitions);
      expect(p.theme()).toBe('dark');
      p.click();
      expect(p.theme()).toBe('light');
      expect(p.stored()).toBe('light');
      p = p.reload();
      expect(p.theme()).toBe('light');
      p.click();
      expect(p.theme()).toBe('dark');
      expect(p.stored()).toBe('dark');
      expect(p.reload().theme()).toBe('dark');
    });
  }
});
