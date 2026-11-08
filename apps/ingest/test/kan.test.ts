import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assignNumbers, type ScrapedShow } from '@israel-tv/core';
import type { PageLoader } from '@israel-tv/kan';
import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import { crawlKan, type KanCrawlOptions } from '../src/kan.ts';

const fx = (n: string) =>
  readFileSync(new URL(`../../../packages/kan/test/fixtures/${n}.html`, import.meta.url), 'utf8');

function loader(routes: Record<string, string>, challenged = new Set<string>()) {
  const urls: string[] = [];
  return {
    urls,
    async load(url: string) {
      urls.push(url);
      if (challenged.has(url)) return { status: 403, html: '<title>רק רגע...</title>', challenged: true };
      const p = new URL(url).pathname;
      const name = routes[p];
      if (name) return { status: 200, html: fx(name), challenged: false };
      // Every other Eurovision episode page: reuse the recorded one with its id swapped in.
      const m = /\/p-1006421\/s1\/(\d+)\/$/.exec(p);
      if (m)
        return {
          status: 200,
          html: fx('episode-1006639').replaceAll('1006639', m[1] ?? ''),
          challenged: false,
        };
      return { status: 404, html: '', challenged: false };
    },
    async close() {},
  };
}

const opts = (l: PageLoader, pagesPerRun: number): KanCrawlOptions => ({
  browser: { type: 'chrome', headed: true },
  pagesPerRun,
  pageIntervalMs: 0,
  airingWindowDays: 14,
  loader: l,
  guide: false,
});

/** Every stored Kan episode, in show and season order. */
const kanEpisodes = (store: Store) =>
  store.listShows({ source: 'kan' }).flatMap((x) => x.show.seasons.flatMap((y) => y.episodes));

const routes = {
  '/lobby/kan11/': 'lobby-kan11',
  '/lobby-kids/kids-teens': 'lobby-kids-teens',
  '/lobby-kids/tiny/': 'lobby-kids-tiny',
  '/lobby/series/': 'lobby-series',
  '/content/kan/kan-11/p-1006421/': 'show-p-1006421',
};

test('crawl fills a show over several budgeted slices and never re-reads known episodes', async () => {
  const store = Store.open(':memory:');
  // Only the Eurovision show is "in" the lobby for this test: other shows are not recorded and 404.
  const l = loader(routes);
  const first = await crawlKan(store, opts(l, 3));
  expect(first.pages).toBe(3); // 2 lobbies + 1 show page
  for (let i = 0; i < 80 && kanEpisodes(store).length < 9; i++) {
    await crawlKan(store, opts(l, 10));
  }
  const show = store.listShows({ source: 'kan' }).find((s) => s.title.includes('אירוויזיון'));
  expect(show?.catalog).toBe('iltv_kan11');
  const eps = show?.show.seasons.flatMap((s) => s.episodes) ?? [];
  expect(eps.length).toBe(9);
  expect(eps[0]?.availableAbroad).toBe(false);
  expect(eps[0]?.streams[0]?.url).toMatch(/^https:\/\/r\.il\.cdn-redge\.media\//);
  const numbers = store
    .assignments(show?.seriesId ?? '')
    .episodes.map((e) => e.episode)
    .sort((a, b) => a - b);
  expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const episodePageLoads = l.urls.filter((u) => /\/s1\/\d+\/$/.test(u));
  expect(new Set(episodePageLoads).size).toBe(episodePageLoads.length);
});

test('a challenge stops the slice and backs off', async () => {
  const store = Store.open(':memory:');
  const l = loader(routes, new Set(['https://www.kan.org.il/lobby/kan11/']));
  const r = await crawlKan(store, opts(l, 5));
  expect(r.note).toMatch(/stopped: .*bot check.*next try after/);
  const again = await crawlKan(store, opts(l, 5));
  expect(again).toMatchObject({ pages: 0 });
  expect(again.note).toMatch(/backing off/);
  expect(store.lastRun('crawl', 'kan')?.status).toBe('failed');
});

test('browser off means Kan off', async () => {
  const store = Store.open(':memory:');
  const r = await crawlKan(store, { ...opts(loader(routes), 5), browser: { type: 'none' } });
  expect(r.note).toMatch(/Kan is off/);
});

test('episodes read before a block are kept and not re-read', async () => {
  const store = Store.open(':memory:');
  const challenged = new Set(['https://www.kan.org.il/content/kan/kan-11/p-1006421/s1/1006640/']);
  const l = loader(routes, challenged);
  let r = await crawlKan(store, opts(l, 10));
  for (let i = 0; i < 40 && !r.failed; i++) r = await crawlKan(store, opts(l, 10));
  expect(r.failed).toBe(true);
  expect(l.urls.filter((u) => u.endsWith('/1006639/'))).toHaveLength(1);
  const show = store.listShows({ source: 'kan' })[0];
  expect(show?.show.seasons.flatMap((s) => s.episodes).map((e) => e.key)).toEqual(['kan:1006639']);
});

test('a refreshed show is read first; a failed first read does not make its backlog "new"', async () => {
  const store = Store.open(':memory:');
  const l = loader(routes);
  await crawlKan(store, opts(l, 4)); // lobbies only
  l.urls.length = 0;
  const key = 'https://www.kan.org.il/content/kan/kan-11/p-1006421/';
  await crawlKan(store, { ...opts(l, 1), priority: [key] });
  expect(l.urls).toEqual([key]);
  // A show whose first read fails is retried later as a first read, not as a re-read.
  const broken = loader({ ...routes });
  await crawlKan(store, opts(broken, 3));
  const state = store.getState<{ shows: Record<string, { checkedAt?: string; failedAt?: string }> }>(
    'kan:crawl',
  );
  const failed = Object.values(state?.shows ?? {}).filter((s) => s.failedAt);
  expect(failed.length).toBeGreaterThan(0);
  expect(failed.every((s) => !s.checkedAt)).toBe(true);
});

test('a browser that cannot load pages at all makes the slice back off without marking pages broken', async () => {
  const store = Store.open(':memory:');
  const throwing = {
    urls: [] as string[],
    async load(): Promise<never> {
      throw new Error('net::ERR_TUNNEL_CONNECTION_FAILED');
    },
    async close() {},
  };
  const r = await crawlKan(store, { ...opts(loader(routes), 5), loader: throwing });
  expect(r.failed).toBe(true);
  const state = store.getState<{ backoffUntil?: string; shows: Record<string, { failedAt?: string }> }>(
    'kan:crawl',
  );
  expect(state?.backoffUntil).toBeDefined();
  expect(Object.values(state?.shows ?? {}).some((s) => s.failedAt)).toBe(false);
});

test('a refreshed show whose page fails without a block counts as attempted (no refresh loop)', async () => {
  const store = Store.open(':memory:');
  const l = loader(routes);
  await crawlKan(store, opts(l, 2)); // lobbies
  const dead = 'https://www.kan.org.il/content/kan/kan-11/p-1003359/'; // not routed: 404
  const r = await crawlKan(store, { ...opts(l, 1), priority: [dead] });
  expect(r.attemptedShows).toContain(dead);
  expect(r.failed).toBeUndefined();
});

test('a known show whose page lists no episodes is a failed read, even with a player on the page', async () => {
  const store = Store.open(':memory:');
  const l = loader(routes);
  for (let i = 0; i < 60 && kanEpisodes(store).length < 9; i++) {
    await crawlKan(store, opts(l, 10));
  }
  const id = store.listShows({ source: 'kan' })[0]?.seriesId ?? '';
  const before = store.assignments(id).episodes.length;
  // Same show page with its episode links gone (layout change), still embedding a player.
  const changed = fx('show-p-1006421').replace(/href="[^"]*p-1006421\/s1\/\d+\/"/g, 'href="#"');
  const l2 = {
    ...l,
    async load(url: string) {
      return url.endsWith('/p-1006421/') ? { status: 200, html: changed, challenged: false } : l.load(url);
    },
  };
  await crawlKan(store, {
    ...opts(l2, 3),
    priority: ['https://www.kan.org.il/content/kan/kan-11/p-1006421/'],
  });
  expect(store.assignments(id).episodes.length).toBe(before);
  expect(store.getShow(id)?.lastError).toMatch(/lists no episodes/);
});

test('a known Kan show whose page disappears shows as failing', async () => {
  const store = Store.open(':memory:');
  const l = loader(routes);
  const eps = () => kanEpisodes(store).length;
  for (let i = 0; i < 80 && eps() < 9; i++) await crawlKan(store, opts(l, 10));
  const id = store.listShows({ source: 'kan' })[0]?.seriesId ?? '';
  const gone = {
    ...l,
    async load(url: string) {
      return url.endsWith('/p-1006421/') ? { status: 404, html: '', challenged: false } : l.load(url);
    },
  };
  await crawlKan(store, {
    ...opts(gone, 3),
    priority: ['https://www.kan.org.il/content/kan/kan-11/p-1006421/'],
  });
  expect(store.getShow(id)?.lastError).toMatch(/404/);
});

test('a Kan episode page that fails once does not get numbered after the later ones', async () => {
  const store = Store.open(':memory:');
  let fail = true;
  const base = loader(routes);
  const flaky = {
    ...base,
    async load(url: string) {
      if (url.endsWith('/s1/1006640/') && fail) return { status: 404, html: '', challenged: false };
      return base.load(url);
    },
  };
  const eps = () => kanEpisodes(store);
  for (let i = 0; i < 30; i++) await crawlKan(store, opts(flaky, 10));
  // Read up to the gap and stopped there.
  expect(eps().map((e) => e.key)).toEqual(['kan:1006639']);
  // Later (after the retry gap) the page works again: reading continues in order.
  const state = store.getState<{
    shows: Record<string, { retry?: Record<string, { n: number; at: string }> }>;
  }>('kan:crawl');
  for (const s of Object.values(state?.shows ?? {}))
    for (const r of Object.values(s.retry ?? {})) r.at = '2000-01-01T00:00:00.000Z';
  if (state) store.setState('kan:crawl', state);
  fail = false;
  for (let i = 0; i < 30 && eps().length < 9; i++) await crawlKan(store, opts(flaky, 10));
  const id = store.listShows({ source: 'kan' })[0]?.seriesId ?? '';
  const byKey = new Map(store.assignments(id).episodes.map((e) => [e.key, e.episode]));
  expect(byKey.get('kan:1006639')).toBe(1);
  expect(byKey.get('kan:1006640')).toBe(2);
});

test('an episode page given up on is not queued again when the show page is re-read', async () => {
  const store = Store.open(':memory:');
  const base = loader(routes);
  const dead = {
    ...base,
    async load(url: string) {
      return url.endsWith('/s1/1006640/') ? { status: 404, html: '', challenged: false } : base.load(url);
    },
  };
  const age = () => {
    const st = store.getState<{
      shows: Record<string, { retry?: Record<string, { at: string }>; checkedAt?: string }>;
    }>('kan:crawl');
    for (const s of Object.values(st?.shows ?? {})) {
      for (const r of Object.values(s.retry ?? {})) r.at = '2000-01-01T00:00:00.000Z';
    }
    if (st) store.setState('kan:crawl', st);
  };
  for (let i = 0; i < 40; i++) {
    await crawlKan(store, opts(dead, 10));
    age();
  }
  const eps = kanEpisodes(store);
  expect(eps.length).toBe(8); // all but the dead page
  // Re-read the show page: the dead page must not come back to block the queue.
  const key = 'https://www.kan.org.il/content/kan/kan-11/p-1006421/';
  await crawlKan(store, { ...opts(dead, 3), priority: [key] });
  const st = store.getState<{ shows: Record<string, { pending: string[] }> }>('kan:crawl');
  expect(st?.shows[key]?.pending).toEqual([]);
});

type Crawl = {
  backoffUntil?: string;
  shows: Record<string, { retry?: Record<string, { at: string }>; failed: string[] }>;
};
const age = (store: Store) => {
  const st = store.getState<Crawl>('kan:crawl');
  if (!st) return;
  delete st.backoffUntil;
  for (const s of Object.values(st.shows)) {
    for (const r of Object.values(s.retry ?? {})) r.at = '2000-01-01T00:00:00.000Z';
  }
  store.setState('kan:crawl', st);
};

test('server errors on two pages in a row back off without charging anything', async () => {
  const store = Store.open(':memory:');
  const base = loader(routes);
  const down = {
    ...base,
    async load(url: string) {
      return /\/(s1\/\d+|p-\d+)\/$/.test(url) ? { status: 503, html: '', challenged: false } : base.load(url);
    },
  };
  let r = await crawlKan(store, opts(down, 10));
  for (let i = 0; i < 5 && !r.failed; i++) r = await crawlKan(store, opts(down, 10));
  expect(r.failed).toBe(true);
  const st = store.getState<Crawl>('kan:crawl');
  expect(st?.backoffUntil).toBeDefined();
  expect(Object.values(st?.shows ?? {}).every((s) => !s.retry && s.failed.length === 0)).toBe(true);
});

test('one episode page that always answers 500 is given up in time; the rest are read in order', async () => {
  const store = Store.open(':memory:');
  const base = loader(routes);
  const broken = {
    ...base,
    async load(url: string) {
      return url.endsWith('/s1/1006640/') ? { status: 500, html: '', challenged: false } : base.load(url);
    },
  };
  for (let i = 0; i < 80; i++) {
    await crawlKan(store, opts(broken, 10));
    age(store);
  }
  const id = store.listShows({ source: 'kan' })[0]?.seriesId ?? '';
  const byKey = new Map(store.assignments(id).episodes.map((e) => [e.key, e.episode]));
  expect(byKey.has('kan:1006640')).toBe(false);
  expect(byKey.size).toBe(8);
  expect(byKey.get('kan:1006639')).toBe(1);
  expect(byKey.get('kan:1006641') ?? byKey.get('kan:1007199')).toBe(2); // next page continues the order
});

test('a show page that always answers 500 is charged and skipped, not a reason to stop Kan', async () => {
  const store = Store.open(':memory:');
  const base = loader(routes);
  const brokenShow = 'https://www.kan.org.il/content/kan/kan-11/p-1003359/';
  const l = {
    ...base,
    async load(url: string) {
      return url === brokenShow ? { status: 500, html: '', challenged: false } : base.load(url);
    },
  };
  const eps = () => kanEpisodes(store).length;
  for (let i = 0; i < 60 && eps() < 9; i++) await crawlKan(store, opts(l, 10));
  expect(eps()).toBe(9); // the Eurovision show was still read in full
  const st = store.getState<{ shows: Record<string, { failedAt?: string; checkedAt?: string }> }>(
    'kan:crawl',
  );
  expect(st?.shows[brokenShow]?.failedAt ?? st?.shows[brokenShow]?.checkedAt).toBeDefined();
});

test('an outage of kankids alone is not blamed on its pages while kan.org.il works', async () => {
  const store = Store.open(':memory:');
  const base = loader(routes);
  // Every kankids show page lists the Eurovision episodes (on kankids), and those episode pages answer 503.
  const l = {
    ...base,
    async load(url: string) {
      const u = new URL(url);
      if (u.host === 'www.kankids.org.il' && /\/s1\/\d+\/$/.test(u.pathname))
        return { status: 503, html: '', challenged: false };
      if (u.host === 'www.kankids.org.il' && /\/p-\d+\/$/.test(u.pathname))
        return { status: 200, html: fx('show-p-1006421'), challenged: false };
      return base.load(url);
    },
  };
  for (let i = 0; i < 60; i++) {
    await crawlKan(store, opts(l, 10));
    age(store);
  }
  const st = store.getState<Crawl>('kan:crawl');
  const kids = Object.entries(st?.shows ?? {}).filter(([k]) => k.includes('kankids'));
  expect(kids.length).toBeGreaterThan(0);
  for (const [, s] of kids) {
    expect(s.failed).toEqual([]);
    expect(s.retry ?? {}).toEqual({});
  }
}, 30_000); // 60 slices: slower on Windows runners

test('a lone server error at the end of a slice is settled with the lobby, and shows on the run', async () => {
  const store = Store.open(':memory:');
  const base = loader(routes);
  const l = {
    ...base,
    async load(url: string) {
      return url.endsWith('/s1/1007199/') ? { status: 500, html: '', challenged: false } : base.load(url);
    },
  };
  let charged = false;
  for (let i = 0; i < 40 && !charged; i++) {
    await crawlKan(store, opts(l, 10));
    const st = store.getState<Crawl>('kan:crawl');
    charged = Object.values(st?.shows ?? {}).some((s) => Object.keys(s.retry ?? {}).length > 0);
  }
  expect(charged).toBe(true);
  expect(store.lastRun('crawl', 'kan')?.status).toBe('partial');
  // The next slice, with the page's retry not yet due: the show waits, which is a note, not another partial slice.
  const { kanSkippedPages } = await import('../src/kan.ts');
  await crawlKan(store, opts(base, 10));
  expect(store.lastRun('crawl', 'kan')?.status).toBe('ok');
  expect(kanSkippedPages(store).waiting).toBe(1);
});

test('a show whose failed page is due for its retry is read first, before the backlog', async () => {
  const { episodeQueue } = await import('../src/kan.ts');
  const store = Store.open(':memory:');
  const page = (show: number, n: number) => `https://www.kan.org.il/content/kan/kan-11/p-${show}/${n}/`;
  const shows = {
    'https://www.kan.org.il/content/kan/kan-11/p-1/': {
      origin: 'https://www.kan.org.il',
      catalog: 'iltv_kan11',
      pending: [page(1, 1)],
      failed: [],
      fresh: [page(1, 1)],
    },
    'https://www.kan.org.il/content/kan/kan-11/p-2/': {
      origin: 'https://www.kan.org.il',
      catalog: 'iltv_kan11',
      pending: [page(2, 1), page(2, 2)],
      failed: [],
      retry: { [page(2, 1)]: { n: 1, at: '2026-11-06T00:00:00Z' } },
    },
  };
  const order = episodeQueue(store, shows, Date.now(), () => 0).map(([k]) => k.split('/').at(-2));
  expect(order).toEqual(['p-2', 'p-1']);
});

test('an outage of episode pages alone, with the lobby up, never charges the waiting page', async () => {
  const store = Store.open(':memory:');
  const base = loader(routes);
  for (let i = 0; i < 30; i++) await crawlKan(store, opts(base, 10)); // first fill
  const key = 'https://www.kan.org.il/content/kan/kan-11/p-1006421/';
  const st = store.getState<Crawl & { shows: Record<string, { pending: string[] }> }>('kan:crawl');
  const show = st?.shows[key];
  if (!st || !show) throw new Error('no state');
  show.pending = [`${key}s1/1009999/`]; // a new episode is waiting
  store.setState('kan:crawl', st);
  const down = {
    ...base,
    async load(url: string) {
      return /\/s1\/\d+\/$/.test(url) ? { status: 503, html: '', challenged: false } : base.load(url);
    },
  };
  for (let i = 0; i < 20; i++) {
    await crawlKan(store, opts(down, 10));
    age(store);
  }
  const after = store.getState<Crawl>('kan:crawl')?.shows[key];
  expect(after?.failed).toEqual([]);
  expect(after?.retry ?? {}).toEqual({});
});

test('a lobby that fails does not stop the crawl of known shows', async () => {
  const store = Store.open(':memory:');
  const base = loader(routes);
  const l = {
    ...base,
    async load(url: string) {
      return url.includes('kids-teens') ? { status: 503, html: '', challenged: false } : base.load(url);
    },
  };
  const eps = () => kanEpisodes(store).length;
  for (let i = 0; i < 30 && eps() < 9; i++) await crawlKan(store, opts(l, 10));
  expect(eps()).toBe(9);
});

test('one episode page that times out is treated like a server error, not a dead browser', async () => {
  const store = Store.open(':memory:');
  const base = loader(routes);
  const l = {
    ...base,
    async load(url: string) {
      if (url.endsWith('/s1/1006640/')) throw new Error('page.goto: Timeout 60000ms exceeded.');
      return base.load(url);
    },
  };
  for (let i = 0; i < 80; i++) {
    await crawlKan(store, opts(l, 10));
    age(store);
  }
  const id = store.listShows({ source: 'kan' })[0]?.seriesId ?? '';
  const byKey = new Map(store.assignments(id).episodes.map((e) => [e.key, e.episode]));
  expect(byKey.has('kan:1006640')).toBe(false);
  expect(byKey.size).toBe(8);
});

test('a proxy error backs off without charging the page', async () => {
  const store = Store.open(':memory:');
  const base = loader(routes);
  const l = {
    ...base,
    async load(url: string) {
      if (/\/s1\/\d+\/$/.test(url)) throw new Error('page.goto: net::ERR_PROXY_CONNECTION_FAILED at x');
      return base.load(url);
    },
  };
  let r = await crawlKan(store, opts(l, 10));
  for (let i = 0; i < 5 && !r.failed; i++) r = await crawlKan(store, opts(l, 10));
  expect(r.failed).toBe(true);
  const st = store.getState<Crawl>('kan:crawl');
  expect(Object.values(st?.shows ?? {}).every((s) => !s.retry && s.failed.length === 0)).toBe(true);
});

test('a show that appears in a later lobby read is airing from the start', async () => {
  const store = Store.open(':memory:');
  await crawlKan(store, opts(loader(routes), 3));
  const st = store.getState<Crawl & { lobbiesAt?: string; shows: Record<string, { lastNewAt?: string }> }>(
    'kan:crawl',
  );
  if (!st) throw new Error('no state');
  const [firstKey] = Object.keys(st.shows);
  expect(Object.values(st.shows).every((s) => !s.lastNewAt)).toBe(true); // install-time shows: not airing
  if (firstKey) delete st.shows[firstKey];
  st.lobbiesAt = '2000-01-01T00:00:00.000Z';
  store.setState('kan:crawl', st);
  await crawlKan(store, opts(loader(routes), 3));
  const after = store.getState<Crawl & { shows: Record<string, { lastNewAt?: string }> }>('kan:crawl');
  expect(firstKey && after?.shows[firstKey]?.lastNewAt).toBeTruthy();
});

test('a Kan show keeps our own copy of its image, used for its poster, background and thumbnails', async () => {
  const { mkdtempSync, readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { ConfigSchema } = await import('@israel-tv/core');
  const { renderFromStore } = await import('../src/publish.ts');
  const { kanArtwork } = await import('../src/kan.ts');
  const { default: jpeg } = await import('jpeg-js');
  // Small but real (noise keeps it over the 1,000-byte minimum for a saved copy).
  const px = new Uint8Array(60 * 90 * 4).map((_, i) => (i * 7919) % 251);
  const portraitJpeg = jpeg.encode({ width: 60, height: 90, data: px }, 90).data;
  const dir = mkdtempSync(join(tmpdir(), 'art-'));
  const store = Store.open(join(dir, 'israel-tv.sqlite'));
  const base = loader(routes);
  const withImage = {
    ...base,
    async load(url: string, o?: { image?: (html: string) => string | undefined }) {
      const page = await base.load(url);
      const src = o?.image?.(page.html);
      return src ? { ...page, image: { url: src, status: 200, jpeg: portraitJpeg } } : page;
    },
  };
  const artworkDir = join(dir, 'artwork');
  for (let i = 0; i < 30 && kanEpisodes(store).length < 9; i++)
    await crawlKan(store, { ...opts(withImage, 10), artworkDir });
  expect(readdirSync(artworkDir).length).toBeGreaterThan(0);
  const key = 'https://www.kan.org.il/content/kan/kan-11/p-1006421/';
  expect(kanArtwork(store, artworkDir).has(key)).toBe(true);
  const config = ConfigSchema.parse({
    store: { path: join(dir, 'israel-tv.sqlite') },
    sources: { mako: false, reshet: false },
  });
  const files = renderFromStore(store, config);
  const id = store.findSeriesId('kan', key) ?? '';
  expect(files.get(`art/${id}.jpg`)).toBeInstanceOf(Uint8Array);
  const meta = JSON.parse(String(files.get(`meta/series/${id}.json`))).meta;
  expect(meta.poster).toBe(`{{israel-tv-origin}}/art/${id}.jpg`);
  expect(meta.background).toBe(meta.poster);
  expect(meta.videos.every((v: { thumbnail?: string }) => v.thumbnail === meta.poster)).toBe(true);
}, 30_000);

test('a show whose image has no copy yet is due, at most once a day', async () => {
  const { showDue, FULL_LISTS } = await import('../src/kan.ts');
  const now = Date.parse('2026-11-06T12:00:00Z');
  const fresh = {
    origin: 'o',
    catalog: 'c',
    pending: [],
    failed: [],
    checkedAt: '2026-11-06T11:00:00Z',
    lists: FULL_LISTS,
  };
  expect(showDue({ ...fresh }, now, 14)).toBe(false);
  expect(showDue({ ...fresh, image: 'https://x/i.jpg' }, now, 14)).toBe(true);
  expect(showDue({ ...fresh, image: 'https://x/i.jpg', artTriedAt: '2026-11-06T10:00:00Z' }, now, 14)).toBe(
    false,
  );
  expect(
    showDue({ ...fresh, image: 'https://x/i.jpg', art: { from: 'https://x/i.jpg', file: 'f' } }, now, 14),
  ).toBe(false);
});

test('lobby posters are copied from the lobby read itself, and a failed copy waits a day', async () => {
  const { mkdtempSync, readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { kanArtwork } = await import('../src/kan.ts');
  const run = async (ok: boolean) => {
    const dir = mkdtempSync(join(tmpdir(), 'lobby-art-'));
    const store = Store.open(join(dir, 'israel-tv.sqlite'));
    const base = loader(routes);
    const lobbyReads: string[] = [];
    const withImages = {
      ...base,
      async load(url: string, o?: { images?: (html: string) => string[] }) {
        const page = await base.load(url);
        const wanted = o?.images?.(page.html) ?? [];
        if (wanted.length) lobbyReads.push(url);
        return wanted.length
          ? {
              ...page,
              images: wanted.map((u) =>
                ok ? { url: u, status: 200, jpeg: new Uint8Array(4000).fill(7) } : { url: u, status: 403 },
              ),
            }
          : page;
      },
    };
    const artworkDir = join(dir, 'artwork');
    await crawlKan(store, { ...opts(withImages, 4), artworkDir });
    const first = lobbyReads.length;
    await crawlKan(store, { ...opts(withImages, 4), artworkDir });
    return { store, artworkDir, first, second: lobbyReads.length - first };
  };
  const good = await run(true);
  expect(good.first).toBeGreaterThan(0);
  // Every show on a lobby card has its copy after the first slice, before any show page was read.
  expect(readdirSync(good.artworkDir).length).toBeGreaterThanOrEqual(42);
  expect(
    kanArtwork(good.store, good.artworkDir).has('https://www.kan.org.il/content/kan/kan-11/p-1088672/'),
  ).toBe(true);
  expect(good.second).toBe(0);
  const bad = await run(false);
  expect(bad.first).toBeGreaterThan(0);
  expect(bad.second).toBe(0); // not every slice: the failed copies are tried again the next day
});

test('Kan episodes carry their publication day as the air date; older ones get it later, numbers unchanged', async () => {
  const store = Store.open(':memory:');
  const l = loader(routes);
  for (let i = 0; i < 80 && kanEpisodes(store).length < 9; i++) await crawlKan(store, opts(l, 10));
  expect(kanEpisodes(store).every((e) => e.airDate === '2026-03-04')).toBe(true);
  // As if read before dates were kept.
  const row = store.listShows({ source: 'kan' })[0];
  if (!row) throw new Error('no show');
  const before = store.assignments(row.seriesId);
  const undated = {
    ...row.show,
    seasons: row.show.seasons.map((x) => ({ ...x, episodes: x.episodes.map(({ airDate: _, ...e }) => e) })),
  };
  store.saveShow(row.seriesId, undated, { seasons: [], episodes: [] }, undefined, false);
  expect(kanEpisodes(store).some((e) => e.airDate)).toBe(false);
  const state = store.getState<{ shows: Record<string, { checkedAt?: string }> }>('kan:crawl');
  for (const s of Object.values(state?.shows ?? {})) if (s.checkedAt) s.checkedAt = '2026-01-01T00:00:00Z';
  store.setState('kan:crawl', state);
  for (let i = 0; i < 60 && !kanEpisodes(store).every((e) => e.airDate); i++)
    await crawlKan(store, opts(l, 10));
  expect(kanEpisodes(store).every((e) => e.airDate === '2026-03-04')).toBe(true);
  expect(store.assignments(row.seriesId)).toEqual(before);
});

test('show names stored before cleaning are cleaned in place', async () => {
  const store = Store.open(':memory:');
  const l = loader(routes);
  for (let i = 0; i < 80 && kanEpisodes(store).length < 9; i++) await crawlKan(store, opts(l, 10));
  const row = store.listShows({ source: 'kan' })[0];
  if (!row) throw new Error('no show');
  const junk = `${row.title} - פרקים מלאים לצפייה ישירה`;
  store.saveShow(row.seriesId, { ...row.show, title: junk }, { seasons: [], episodes: [] }, undefined, false);
  const state = store.getState<{ shows: Record<string, { title?: string }> }>('kan:crawl');
  for (const s of Object.values(state?.shows ?? {})) s.title = junk;
  store.setState('kan:crawl', state);
  await crawlKan(store, { ...opts(l, 0), browser: { type: 'none' } });
  expect(store.getShow(row.seriesId)?.title).toBe(row.title);
});

test('episode pages: newly published first, then shows with the fewest episodes, the archive on ties', async () => {
  const { episodeQueue } = await import('../src/kan.ts');
  const store = Store.open(':memory:');
  const show = (catalog: string, pending: number, fresh = 0) => ({
    origin: 'https://www.kan.org.il',
    catalog,
    checkedAt: '2026-11-06T00:00:00Z',
    pending: Array.from({ length: pending }, (_, i) => `https://www.kan.org.il/p/${catalog}/${i}/`),
    failed: [],
    ...(fresh ? { fresh: [`https://www.kan.org.il/p/${catalog}/0/`] } : {}),
  });
  // "big" already has episodes stored; "tehran" has none yet.
  const big: ScrapedShow = {
    source: 'kan',
    key: 'https://www.kan.org.il/content/kan/kan-11/p-1/',
    title: 'גדולה',
    catalog: 'iltv_kan11',
    seasons: [
      {
        key: 's1',
        title: 'עונה 1',
        episodes: [
          { key: 'kan:1', title: 'פרק 1', streams: [{ url: 'https://cdn.test/1.m3u8', kind: 'direct' }] },
        ],
      },
    ],
  };
  const id = store.seriesIdFor('kan', big.key);
  store.saveShow(id, big, assignNumbers(big, store.assignments(id)).added, '2026-11-05', true);
  const shows = {
    [big.key]: show('iltv_kan11', 100),
    'https://www.kan.org.il/content/kan/kan-11/p-2/': show('iltv_kan11', 18),
    'https://www.kan.org.il/content/kan/kan-11/p-3/': show('iltv_kan11', 5, 1),
    'https://www.kan.org.il/content/archive1/vod/p-4/': show('iltv_kanarchive', 40),
  };
  const order = episodeQueue(store, shows, Date.now(), () => 0).map(([k]) => k.split('/').at(-2));
  // The archive show with nothing yet comes before a show that already has episodes, after one in another row
  // with nothing either (it only loses ties): rows fill side by side instead of the archive waiting for days.
  expect(order).toEqual(['p-3', 'p-2', 'p-4', 'p-1']);
});

test('a row still filling is counted: shows in the catalog of those its lobbies list', async () => {
  const { kanRowProgress, stillFilling } = await import('../src/kan.ts');
  const store = Store.open(':memory:');
  const l = loader(routes);
  await crawlKan(store, opts(l, 4)); // lobbies only: nothing in the catalog yet
  const p = kanRowProgress(store);
  expect(p.iltv_kan11?.known).toBeGreaterThan(10);
  expect(p.iltv_kan11?.inCatalog).toBe(0);
  expect(p.iltv_kanarchive?.known).toBeGreaterThan(100);
  expect(stillFilling(p.iltv_kan11)).toBe(true);
});

test('the live guide: one Kan guide page per slice, each channel today and tomorrow, twice a day', async () => {
  const { GUIDE_KEY } = await import('../src/epg.ts');
  const store = Store.open(':memory:');
  const guide = readFileSync(new URL('./fixtures/epg/kanedu.html', import.meta.url), 'utf8');
  const base = loader(routes);
  const l = {
    ...base,
    async load(url: string) {
      if (url.includes('/tv-guide/')) {
        base.urls.push(url);
        return { status: 200, html: guide, challenged: false };
      }
      return base.load(url);
    },
  };
  for (let i = 0; i < 6; i++) await crawlKan(store, { ...opts(l, 6), guide: true });
  const guides = base.urls.filter((u) => u.includes('/tv-guide/'));
  expect(guides).toHaveLength(6); // 3 channels × today and tomorrow, one per slice
  expect(new Set(guides).size).toBe(6);
  await crawlKan(store, { ...opts(l, 6), guide: true });
  expect(base.urls.filter((u) => u.includes('/tv-guide/'))).toHaveLength(6); // none due again yet
  const state = store.getState<Record<string, { rows: unknown[] }>>(GUIDE_KEY);
  expect(Object.keys(state ?? {}).sort()).toEqual([
    'iltv_live_kan11',
    'iltv_live_kanedu',
    'iltv_live_makan33',
  ]);
});

test('a trailer page is skipped for good: never stored, never re-queued, never makes the show "airing"', async () => {
  const store = Store.open(':memory:');
  const titleJson =
    '"title":"\\u05D7\\u05D1\\u05E8\\u05D9 \\u0022\\u05E7\\u05D5\\u05E4\\u05D4 \\u05E8\\u05D0\\u05E9\\u05D9\\u05EA\\u0022 \\u05DE\\u05EA\\u05DB\\u05D5\\u05E0\\u05E0\\u05D9\\u05DD \\u05DC\\u05D0\\u05D9\\u05E8\\u05D5\\u05D5\\u05D9\\u05D6\\u05D9\\u05D5\\u05DF"';
  const base = loader(routes);
  let trailerUrl = '';
  const l = {
    ...base,
    async load(url: string) {
      const r = await base.load(url);
      // The first episode page of the show is a trailer.
      if (!trailerUrl && /\/p-1006421\/s1\/\d+\/$/.test(url)) trailerUrl = url;
      return url === trailerUrl ? { ...r, html: r.html.replace(titleJson, '"title":"טריילר"') } : r;
    },
  };
  for (let i = 0; i < 40 && kanEpisodes(store).length < 8; i++) await crawlKan(store, opts(l, 10));
  expect(trailerUrl).not.toBe('');
  expect(kanEpisodes(store).some((e) => e.title === 'טריילר')).toBe(false);
  type S = {
    shows: Record<string, { skipped?: string[]; pending: string[]; lastNewAt?: string; checkedAt?: string }>;
  };
  const key = 'https://www.kan.org.il/content/kan/kan-11/p-1006421/';
  const before = store.getState<S>('kan:crawl')?.shows[key];
  expect(before?.skipped).toEqual([trailerUrl]);
  // A re-read of the show page finds the trailer link again: not pending, not new.
  const state = store.getState<S>('kan:crawl');
  for (const s of Object.values(state?.shows ?? {})) if (s.checkedAt) s.checkedAt = '2026-01-01T00:00:00Z';
  store.setState('kan:crawl', state);
  const lastNewAt = before?.lastNewAt;
  for (let i = 0; i < 40; i++) {
    await crawlKan(store, opts(l, 10));
    const now = store.getState<S>('kan:crawl')?.shows[key];
    if (now?.checkedAt !== '2026-01-01T00:00:00Z') break;
  }
  const after = store.getState<S>('kan:crawl')?.shows[key];
  expect(after?.pending).not.toContain(trailerUrl);
  expect(after?.lastNewAt).toBe(lastNewAt);
});

test('a Kan guide page that is refused never stops the crawl', async () => {
  const store = Store.open(':memory:');
  const base = loader(routes, new Set());
  const l = {
    ...base,
    async load(url: string) {
      if (url.includes('/tv-guide/')) return { status: 403, html: '', challenged: true };
      return base.load(url);
    },
  };
  const r = await crawlKan(store, { ...opts(l, 6), guide: true });
  expect(r.failed).toBeUndefined();
  expect(r.pages).toBe(6);
});

test('episode pages Kan took down or that hold no video are skipped at once, counted, and never retried', async () => {
  const store = Store.open(':memory:');
  const base = loader(routes);
  const special: Record<string, string> = {};
  const l = {
    ...base,
    async load(url: string) {
      const r = await base.load(url);
      const m = /\/p-1006421\/s1\/(\d+)\/$/.exec(url);
      if (!m) return r;
      // The show's first two episode pages: one taken down (rights ended), one an article with no video.
      if (Object.keys(special).length < 2 && !special[url])
        special[url] =
          Object.keys(special).length === 0 ? 'episode-447786-rights-expired' : 'episode-128487-no-video';
      const name = special[url];
      return name ? { status: 200, html: fx(name), challenged: false } : r;
    },
  };
  for (let i = 0; i < 40 && kanEpisodes(store).length < 7; i++) await crawlKan(store, opts(l, 10));
  expect(kanEpisodes(store)).toHaveLength(7);
  type S = {
    shows: Record<string, { removed?: string[]; notVideo?: string[]; retry?: object; failed: string[] }>;
  };
  const s = store.getState<S>('kan:crawl')?.shows['https://www.kan.org.il/content/kan/kan-11/p-1006421/'];
  const [removed, article] = Object.keys(special);
  expect(s?.removed).toEqual([removed]);
  expect(s?.notVideo).toEqual([article]);
  expect(s?.failed).toEqual([]);
  expect(Object.keys(s?.retry ?? {})).toEqual([]);
  // No warning blames the layout.
  const { kanSkippedPages } = await import('../src/kan.ts');
  expect(kanSkippedPages(store)).toEqual({ removed: 1, notVideo: 1, gaveUp: 0, waiting: 0 });
});

test('a bot check that answers 200 is still a bot check: the slice backs off and nothing is charged', async () => {
  const store = Store.open(':memory:');
  const base = loader(routes);
  const l = {
    ...base,
    async load(url: string) {
      const r = await base.load(url);
      return /\/s1\/\d+\/$/.test(url)
        ? { status: 200, html: fx('challenge-turnstile'), challenged: false }
        : r;
    },
  };
  let r = await crawlKan(store, opts(l, 10));
  for (let i = 0; i < 5 && !r.failed; i++) r = await crawlKan(store, opts(l, 10));
  expect(r.note).toMatch(/bot check/);
  type S = { shows: Record<string, { retry?: object; failed: string[] }> };
  const shows = Object.values(store.getState<S>('kan:crawl')?.shows ?? {});
  expect(shows.every((s) => !s.retry || Object.keys(s.retry).length === 0)).toBe(true);
});

/** Episode pages whose player plays the Kaltura entry `1_e<page id>` (as most Kan shows' pages do). */
function kalturaPages(l: ReturnType<typeof loader>) {
  return {
    ...l,
    async load(url: string) {
      const r = await l.load(url);
      const id = /\/s1\/(\d+)\/$/.exec(url)?.[1];
      return id ? { ...r, html: r.html.replace(/\/vod\/\d+\//g, `/vod/1_e${id}/`) } : r;
    },
  };
}

test("Kan's app API names the same episodes with the same ids and numbers as the pages, falling back to pages", async () => {
  const showKey = 'https://www.kan.org.il/content/kan/kan-11/p-1006421/';
  // 1. Pages only: the reference.
  const ref = Store.open(':memory:');
  const pagesOnly = kalturaPages(loader(routes));
  for (let i = 0; i < 40 && kanEpisodes(ref).length < 9; i++)
    await crawlKan(ref, { ...opts(pagesOnly, 10), appApi: false });
  const refShow = ref.listShows({ source: 'kan' }).find((x) => x.show.key === showKey);
  const refEps = refShow?.show.seasons.flatMap((x) => x.episodes) ?? [];
  expect(refEps).toHaveLength(9);
  const number = (st: Store, id: string) =>
    Object.fromEntries(st.assignments(id).episodes.map((e) => [e.key, `S${e.season}E${e.episode}`]));
  // 2. The app API lists the same episodes (as the app does: same titles, seasons and dates), each with a Kaltura
  //    entry; one is missing from it and one entry's stream does not answer: those two are read from their pages.
  const missing = refEps[3]?.key ?? '';
  const silent = refEps[6]?.key ?? '';
  const feed = {
    title: 'אירוויזיון',
    entry: refEps
      .filter((e) => e.key !== missing)
      .map((e) => ({
        id: e.key.slice(4),
        title: e.title,
        published: `${e.airDate}T12:00:00+02:00`,
        content: {
          type: 'video/hls',
          src: `https://cdnapisec.kaltura.com/p/1/sp/1/playManifest/entryId/1_e${e.key.slice(4)}/format/applehttp/x.m3u8`,
        },
        extensions: { analyticsCustomProperties: { season: 1 } },
      })),
  };
  const app = Store.open(':memory:');
  const base = loader(routes);
  const appTexts: string[] = [];
  const withApp = {
    ...kalturaPages(base),
    async text(url: string) {
      appTexts.push(url);
      return /program\?id=1006421/.test(url)
        ? { status: 200, body: JSON.stringify(feed), challenged: false }
        : { status: 404, body: '', challenged: false };
    },
  };
  const checked: string[] = [];
  const streamPlays = async (u: string) => {
    checked.push(u);
    return !u.includes(`/1_e${silent.slice(4)}/`);
  };
  for (let i = 0; i < 40 && kanEpisodes(app).length < 9; i++)
    await crawlKan(app, { ...opts(withApp, 10), streamPlays });
  const appShow = app.listShows({ source: 'kan' }).find((x) => x.show.key === showKey);
  expect(appShow?.seriesId).toBe(refShow?.seriesId);
  // Same ids, same season/episode numbers.
  expect(number(app, appShow?.seriesId ?? '')).toEqual(number(ref, refShow?.seriesId ?? ''));
  // Read as pages: the first two (the evidence that the app agrees with the pages for this show), the one missing
  // from the app and the one whose stream does not answer. Everything else was named by the app.
  const episodePages = base.urls.filter((u) => /\/s1\/\d+\/$/.test(u));
  expect(episodePages.map((u) => `kan:${/(\d+)\/$/.exec(u)?.[1]}`).sort()).toEqual(
    [refEps[0]?.key, refEps[1]?.key, missing, silent].sort(),
  );
  expect(appTexts.some((u) => u.includes('program?id=1006421'))).toBe(true);
  // App-named episodes carry the Redge stream of their Kaltura entry; page-read ones keep the page's stream.
  const eps = appShow?.show.seasons.flatMap((x) => x.episodes) ?? [];
  const named = eps.find((e) => e.key === refEps[2]?.key);
  expect(named?.streams[0]?.url).toBe(
    `https://r.il.cdn-redge.media/webcache/gorigin/hls/oil/kancdn/vod/1_e${refEps[2]?.key.slice(4)}/LIBCODER_SMOOTH_1080_KAN/Manifest.ism/playlist.m3u8?fmp4`,
  );
  // 3. An app list that disagrees with the pages (another season, as measured for some shows) is never used.
  const other = Store.open(':memory:');
  const base2 = loader(routes);
  const wrong = {
    ...feed,
    entry: feed.entry.map((e) => ({ ...e, extensions: { analyticsCustomProperties: { season: 8 } } })),
  };
  const disagreeing = {
    ...kalturaPages(base2),
    async text(url: string) {
      return /program\?id=1006421/.test(url)
        ? { status: 200, body: JSON.stringify(wrong), challenged: false }
        : { status: 404, body: '', challenged: false };
    },
  };
  for (let i = 0; i < 40 && kanEpisodes(other).length < 9; i++)
    await crawlKan(other, { ...opts(disagreeing, 10), streamPlays: async () => true });
  const otherShow = other.listShows({ source: 'kan' }).find((x) => x.show.key === showKey);
  expect(number(other, otherShow?.seriesId ?? '')).toEqual(number(ref, refShow?.seriesId ?? ''));
  expect(base2.urls.filter((u) => /\/s1\/\d+\/$/.test(u))).toHaveLength(9);
  expect(eps.find((e) => e.key === silent)?.streams[0]?.url).toBe(refEps[6]?.streams[0]?.url);
});

test('the app is trusted for a show only when at least two of its episodes agree, stream included', async () => {
  const { appAgrees } = await import('../src/kan.ts');
  const { redgeUrl } = await import('@israel-tv/kan');
  const store = { getShow: () => undefined };
  const item = (id: string, entry: string) =>
    [
      id,
      { id, title: `פרק ${id}`, seasonNumber: 1, stream: { kind: 'redge' as const, url: redgeUrl(entry) } },
    ] as const;
  const feed = new Map([item('1', '1_a'), item('2', '1_b'), item('3', '1_c')]);
  const read = (id: string, url: string) => ({
    key: `kan:${id}`,
    title: `פרק ${id}`,
    season: 1,
    streams: [{ url }],
  });
  expect(appAgrees(store, undefined, feed, [read('1', redgeUrl('1_a'))])).toBe(false); // one is not enough
  expect(appAgrees(store, undefined, feed, [read('1', redgeUrl('1_a')), read('2', redgeUrl('1_b'))])).toBe(
    true,
  );
  // The page played another asset for one of them: never trusted.
  const numeric =
    'https://r.il.cdn-redge.media/webcache/gorigin/hls/oil/kancdn/vod/2104131/LIBCODER_SMOOTH_1080_KAN/Manifest.ism/playlist.m3u8?fmp4';
  expect(
    appAgrees(store, undefined, feed, [
      read('1', redgeUrl('1_a')),
      read('2', redgeUrl('1_b')),
      read('3', numeric),
    ]),
  ).toBe(false);
});

test('queue: fresh first, then app-trusted, then shows giving their evidence, then page-only', async () => {
  const { episodeQueue } = await import('../src/kan.ts');
  const store = Store.open(':memory:');
  const mk = (n: string, extra: object = {}) => [
    `https://www.kan.org.il/content/kan/kan-11/p-${n}/`,
    {
      origin: 'https://www.kan.org.il',
      catalog: 'iltv_kan11',
      checkedAt: '2026-11-06T00:00:00Z',
      pending: [`https://www.kan.org.il/content/kan/kan-11/p-${n}/1${n}/`],
      failed: [],
      ...extra,
    },
  ];
  const shows = Object.fromEntries([
    mk('1', { app: 'disagrees' }),
    mk('2', { app: 'trusted' }),
    mk('3'),
    mk('6', { app: undefined }),
    mk('4', { app: 'unlisted' }),
    mk('5', { fresh: ['https://www.kan.org.il/content/kan/kan-11/p-5/15/'], app: 'disagrees' }),
  ]);
  const order = episodeQueue(store, shows, Date.now(), () => 0).map(([k]) => k.split('/').at(-2));
  // p-3 and p-6 have no episodes yet: evidence pages; p-2 is trusted (one request, then the app in bulk).
  expect(order).toEqual(['p-5', 'p-2', 'p-3', 'p-6', 'p-1', 'p-4']);
});

test('a new show reads only its two evidence pages per turn when the app cannot be trusted for it', async () => {
  const store = Store.open(':memory:');
  const base = loader(routes);
  // The app lists the show with another season: never trusted, so after its two evidence pages the show yields.
  const l = {
    ...base,
    async text(url: string) {
      return /program\?id=1006421/.test(url)
        ? {
            status: 200,
            body: JSON.stringify({
              entry: [
                { id: '1006639', title: 'x', extensions: { analyticsCustomProperties: { season: 9 } } },
              ],
            }),
            challenged: false,
          }
        : { status: 404, body: '', challenged: false };
    },
  };
  // Lobbies and the show page first, then one slice for episodes.
  for (let i = 0; i < 5; i++) await crawlKan(store, { ...opts(l, 20), streamPlays: async () => true });
  type S = { shows: Record<string, { app?: string }> };
  const s = store.getState<S>('kan:crawl')?.shows['https://www.kan.org.il/content/kan/kan-11/p-1006421/'];
  expect(s?.app).toBe('disagrees');
  expect(kanEpisodes(store).length).toBeGreaterThanOrEqual(2);
});

test('after a bot check the pace halves for a day', async () => {
  const store = Store.open(':memory:');
  const l = loader(routes);
  await crawlKan(store, opts(l, 4));
  const st = store.getState<{ lastChallengeAt?: string; backoffUntil?: string }>('kan:crawl') ?? {};
  st.lastChallengeAt = new Date().toISOString();
  store.setState('kan:crawl', st);
  const r = await crawlKan(store, opts(l, 10));
  expect(r.pages).toBeLessThanOrEqual(5);
  expect(r.note).toMatch(/calm pace/);
});

test('an unnumbered episode waits behind its printed siblings, so "פרק 2" keeps number 2', async () => {
  // מלכת השכונה (2026-11-07): "מה לא עובד?" was read before "פרק 2" and took 2; "פרק 2" became 5.
  const store = Store.open(':memory:');
  const ids = [
    '1006639',
    '1006640',
    '1007199',
    '1007369',
    '1007413',
    '1007416',
    '1007417',
    '1007426',
    '1007449',
  ];
  const titleOf = (id: string) => {
    const i = ids.indexOf(id);
    return i === 1 ? 'מאחורי הקלעים' : `פרק ${i === 0 ? 1 : i} - חלק`;
  };
  const base = loader(routes);
  // The player config carries the title JSON-escaped (\u05D7…): replace the recorded title's end in that form.
  const esc = (t: string) =>
    [...t]
      .map((c) =>
        c === ' ' ? c : `\\u${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`,
      )
      .join('');
  const original = esc('מתכוננים לאירוויזיון');
  const l = {
    ...base,
    async load(url: string) {
      const r = await base.load(url);
      const id = /\/s1\/(\d+)\/$/.exec(url)?.[1];
      return id && r.status === 200 ? { ...r, html: r.html.replaceAll(original, esc(titleOf(id))) } : r;
    },
  };
  for (let i = 0; i < 80 && kanEpisodes(store).length < 9; i++) await crawlKan(store, opts(l, 4));
  const show = store.listShows({ source: 'kan' })[0];
  const byKey = new Map(store.assignments(show?.seriesId ?? '').episodes.map((e) => [e.key, e.episode]));
  expect(byKey.get('kan:1007199')).toBe(2);
  expect(byKey.get('kan:1007449')).toBe(8);
  expect(byKey.get('kan:1006640')).toBe(9);
  expect(store.recentWarnings().filter((w) => w.code === 'episode-number-taken')).toEqual([]);
});

// ---- show metadata: genres from the lobby cards, air dates from the app list (2026-11-08) ------------------------

test("a Kan show's genres: its card's, in the project's names; a kids-row show is a children's show", async () => {
  const { kanGenres } = await import('../src/kan.ts');
  expect(kanGenres({ catalog: 'iltv_kan11', genres: ['בישול', 'אוכל', 'קומדיה'] })).toEqual([
    'בישול',
    'קומדיה',
  ]);
  expect(kanGenres({ catalog: 'iltv_kanarchive', genres: ['ארכיון', 'דוקו'] })).toEqual(['דוקומנטרי']);
  expect(kanGenres({ catalog: 'iltv_kanarchive', genres: ['ארכיון'] })).toEqual([]);
  expect(kanGenres({ catalog: 'iltv_kan11' })).toEqual([]);
  // The kids row is read from Kan's kids lobbies only: that is the source saying so.
  expect(kanGenres({ catalog: 'iltv_kankids' })).toEqual(['ילדים']);
  expect(kanGenres({ catalog: 'iltv_kankids', genres: ['ילדים ונוער', 'דרמה'] })).toEqual(['ילדים', 'דרמה']);
});

/** A stored Kan show with one episode (as an earlier slice would have saved it). */
function storeKanShow(store: Store, key: string, episode: { key: string; title: string; airDate?: string }) {
  const seriesId = store.seriesIdFor('kan', key);
  const show: ScrapedShow = {
    source: 'kan',
    key,
    title: 'מטבח',
    catalog: 'iltv_kan11',
    pageUrl: key,
    seasons: [{ key: `${key}|s1`, title: 'עונה 1', episodes: [{ ...episode, streams: [] }] }],
  };
  store.saveShow(seriesId, show, assignNumbers(show, store.assignments(seriesId)).added, undefined, false);
  return seriesId;
}

test('lobby genres reach shows already stored, without a page read, and stay on later saves', async () => {
  const store = Store.open(':memory:');
  const key = 'https://www.kan.org.il/content/kan/kan-11/p-11843/';
  const id = storeKanShow(store, key, { key: 'kan:1', title: 'פרק 1', airDate: '2026-01-01' });
  const l = loader(routes);
  await crawlKan(store, opts(l, 4)); // the lobbies (and nothing else: no show page is recorded)
  expect(store.getShow(id)?.show.genres).toEqual(['בישול', 'קומדיה']);
  expect(l.urls.some((u) => u.includes('/p-11843/'))).toBe(false);
  // Numbers untouched.
  expect(store.assignments(id).episodes).toEqual([
    expect.objectContaining({ key: 'kan:1', season: 1, episode: 1 }),
  ]);
});

test('stored episodes without an air date get it from the app list (same id and title), at most weekly', async () => {
  const { appDates } = await import('../src/kan.ts');
  const item = (id: string, title: string, published?: string) =>
    [id, { id, title, stream: { kind: 'none' as const }, ...(published ? { published } : {}) }] as const;
  const feed = new Map([
    item('1', 'פרק 1', '2021-03-04'),
    item('2', 'פרק אחר', '2021-03-11'),
    item('3', 'פרק 3'),
  ]);
  expect(
    appDates(
      [
        { key: 'kan:1', title: 'פרק 1' },
        { key: 'kan:2', title: 'פרק 2' }, // another title: not taken as the same episode
        { key: 'kan:3', title: 'פרק 3' }, // no date in the app
        { key: 'kan:4', title: 'פרק 4' }, // not listed
        { key: 'kan:5', title: 'פרק 5', airDate: '2020-01-01' }, // dated already
      ],
      feed,
    ),
  ).toEqual(new Map([['kan:1', '2021-03-04']]));

  // In a slice: one app request for the show, never a page; not asked again within the week.
  const store = Store.open(':memory:');
  const key = 'https://www.kan.org.il/content/kan/kan-11/p-11843/';
  const id = storeKanShow(store, key, { key: 'kan:5551', title: 'פרק 1' });
  const asked: string[] = [];
  const base = loader(routes);
  const withApp = {
    ...base,
    async text(url: string) {
      asked.push(url);
      const body = /program\?id=11843/.test(url)
        ? { entry: [{ id: '5551', title: 'פרק 1', published: '2021-03-04T21:00:00+02:00' }] }
        : { entry: [] };
      return { status: 200, body: JSON.stringify(body), challenged: false };
    },
  };
  const r = await crawlKan(store, opts(withApp, 4));
  expect(store.getShow(id)?.show.seasons[0]?.episodes[0]?.airDate).toBe('2021-03-04');
  expect(r.note).toMatch(/1 stored episodes dated from the app API/);
  expect(asked.filter((u) => u.includes('program?id=11843'))).toHaveLength(1);
  expect(base.urls.some((u) => /\/p-11843\/\d+/.test(u))).toBe(false);
  await crawlKan(store, opts(withApp, 4));
  expect(asked.filter((u) => u.includes('program?id=11843'))).toHaveLength(1);
});

// ---- full lists (2026-11-08): Kan's app list as well as the show page ---------------------------------------------

/** The episode page fixture, as the page of another Kan episode: its id and title swapped in. */
function episodePage(id: string, title: string): string {
  const esc = (t: string) =>
    [...t]
      .map((c) =>
        /[\w ]/.test(c) ? c : `\\u${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`,
      )
      .join('');
  const recorded =
    '"title":"\\u05D7\\u05D1\\u05E8\\u05D9 \\u0022\\u05E7\\u05D5\\u05E4\\u05D4 \\u05E8\\u05D0\\u05E9\\u05D9\\u05EA\\u0022 \\u05DE\\u05EA\\u05DB\\u05D5\\u05E0\\u05E0\\u05D9\\u05DD \\u05DC\\u05D0\\u05D9\\u05E8\\u05D5\\u05D5\\u05D9\\u05D6\\u05D9\\u05D5\\u05DF"';
  const html = fx('episode-1006639');
  if (!html.includes(recorded)) throw new Error('the recorded episode title moved');
  return html.replaceAll('1006639', id).replace(recorded, `"title":"${esc(title)}"`);
}

const appJson = (n: string) =>
  JSON.parse(readFileSync(new URL(`../../../packages/kan/test/fixtures/${n}.json`, import.meta.url), 'utf8'));

test("a show's older episodes come from Kan's full list; extras that held their numbers move after them, once", async () => {
  // קופה ראשית (2026-11-08): the show page linked a few season-1 episodes; extras read early took the next numbers.
  const { checkNumbering } = await import('../src/numbering-guard.ts');
  const { FULL_LISTS } = await import('../src/kan.ts');
  const store = Store.open(':memory:');
  const key = 'https://www.kan.org.il/content/kan/kan-11/p-12832/';
  const seriesId = store.seriesIdFor('kan', key);
  const stored: ScrapedShow = {
    source: 'kan',
    key,
    title: 'קופה ראשית',
    catalog: 'iltv_kan11',
    pageUrl: key,
    seasons: [
      {
        key: `${key}|s1`,
        title: 'עונה 1',
        episodes: [
          { key: 'kan:89248', title: 'פרק 1 - שלי מהבית', numberHint: 1, streams: [] },
          { key: 'kan:855987', title: 'הרמת כוסית', streams: [] },
        ],
      },
    ],
  };
  store.saveShow(
    seriesId,
    stored,
    assignNumbers(stored, store.assignments(seriesId)).added,
    undefined,
    false,
  );
  expect(store.assignments(seriesId).episodes.map((e) => `${e.key} E${e.episode}`)).toEqual([
    'kan:89248 E1',
    'kan:855987 E2',
  ]);
  expect(checkNumbering(store).ok).toBe(true);
  // The crawl state as an older version left it: the show read, its few links read.
  store.setState('kan:crawl', {
    lobbiesAt: new Date().toISOString(),
    lobbyPosters: true,
    lobbyGenres: true,
    shows: {
      [key]: {
        origin: 'https://www.kan.org.il',
        catalog: 'iltv_kan11',
        pending: [],
        failed: [],
        checkedAt: new Date().toISOString(),
      },
    },
  });
  // Season 1 of the real list (20 printed episodes, a behind-the-scenes page) and the extras (no season in the app).
  const feed = appJson('app-program-12832');
  feed.entry = feed.entry.filter((e: { extensions?: { analyticsCustomProperties?: { season?: number } } }) =>
    [1, 0, undefined].includes(e.extensions?.analyticsCustomProperties?.season),
  );
  const titles = new Map<string, string>(
    feed.entry.map((e: { id: string; title: string }) => [e.id, e.title]),
  );
  const showPage = `<h1>קופה ראשית</h1><a href="/content/kan/kan-11/p-12832/s1/89248/">1</a><a href="/content/kan/kan-11/p-12832/855987/">x</a><a href="/content/kan/kan-11/p-12832/s1/">עונה 1</a>`;
  const read: string[] = [];
  const l = {
    urls: read,
    async load(url: string) {
      read.push(url);
      const p = new URL(url).pathname;
      if (p === '/content/kan/kan-11/p-12832/') return { status: 200, html: showPage, challenged: false };
      const id = /\/p-12832\/(?:s\d+\/)?(\d+)\/$/.exec(p)?.[1];
      if (id && titles.has(id))
        return { status: 200, html: episodePage(id, titles.get(id) ?? ''), challenged: false };
      return { status: 404, html: '', challenged: false };
    },
    async text(url: string) {
      return /program\?id=12832/.test(url)
        ? { status: 200, body: JSON.stringify(feed), challenged: false }
        : { status: 404, body: '', challenged: false };
    },
    async close() {},
  };
  const backupDir = mkdtempSync(join(tmpdir(), 'kan-full-'));
  type S = { shows: Record<string, { refill?: true; pending: string[]; lists?: number; held?: unknown[] }> };
  for (let i = 0; i < 20; i++) {
    await crawlKan(store, { ...opts(l, 30), priority: [key], backupDir, streamPlays: async () => false });
    const s = store.getState<S>('kan:crawl')?.shows[key];
    if (s?.lists === FULL_LISTS && !s.refill && s.pending.length === 0) break;
  }
  const s = store.getState<S>('kan:crawl')?.shows[key];
  expect(s).toMatchObject({ lists: FULL_LISTS, pending: [] });
  expect(s?.refill).toBeUndefined();
  const byKey = new Map(store.assignments(seriesId).episodes.map((e) => [e.key, e.episode]));
  // Every printed episode of season 1 has its own number…
  for (const [id, title] of titles) {
    const n = /^\s*פרק (\d+)/.exec(title)?.[1];
    if (n) expect([id, byKey.get(`kan:${id}`)]).toEqual([id, Number(n)]);
  }
  // …and the extra that held "פרק 2"'s number follows the printed ones.
  expect(byKey.get('kan:855987')).toBeGreaterThan(20);
  // Trailers are skipped, as before.
  expect([...titles].filter(([, t]) => t === 'טריילר').every(([id]) => !byKey.has(`kan:${id}`))).toBe(true);
  // The move is recorded: the guard passes, a backup was taken, no numbering note is left.
  expect(checkNumbering(store).ok).toBe(true);
  expect(existsSync(join(backupDir, 'before-kan-full-lists-2026-11-08.sqlite'))).toBe(true);
  expect(store.recentWarnings().filter((w) => w.code === 'episode-number-taken')).toEqual([]);
  // The older episodes were backlog, not news: the show is not "airing" because of them.
  expect(
    store.getState<{ shows: Record<string, { lastNewAt?: string }> }>('kan:crawl')?.shows[key]?.lastNewAt,
  ).toBeUndefined();
  // Every page was read once.
  const episodeReads = read.filter((u) => /\/\d+\/$/.test(u));
  expect(new Set(episodeReads).size).toBe(episodeReads.length);
});

test('named episode pages (archive) are read once, by the ids the app gives them', async () => {
  // תקומה (2026-11-08): 22 episodes at s1/rebirth-1/ … rebirth-22/, one numbered page; only that one was in.
  const store = Store.open(':memory:');
  const key = 'https://www.kan.org.il/content/archive1/vod/p-671191/';
  const feed = appJson('app-program-671191');
  const byPath = new Map<string, { id: string; title: string }>(
    feed.entry.map((e: { id: string; title: string; extensions?: { share_url?: string } }) => [
      new URL(e.extensions?.share_url ?? 'https://x/').pathname,
      { id: e.id, title: e.title },
    ]),
  );
  const read: string[] = [];
  const l = {
    urls: read,
    async load(url: string) {
      read.push(url);
      const p = new URL(url).pathname;
      if (p === '/lobby/series/') return { status: 200, html: fx('lobby-series'), challenged: false };
      if (p === '/content/archive1/vod/p-671191/')
        return { status: 200, html: fx('show-p-671191-named'), challenged: false };
      const e = byPath.get(p);
      if (e) return { status: 200, html: episodePage(e.id, e.title), challenged: false };
      if (p === '/content/archive1/vod/p-671191/943638/')
        return { status: 200, html: episodePage('943638', 'תקומה - מאחורי הקלעים'), challenged: false };
      return { status: 404, html: '', challenged: false };
    },
    async text(url: string) {
      return /program\?id=671191/.test(url)
        ? { status: 200, body: JSON.stringify(feed), challenged: false }
        : { status: 404, body: '', challenged: false };
    },
    async close() {},
  };
  for (let i = 0; i < 10 && kanEpisodes(store).length < 23; i++)
    await crawlKan(store, { ...opts(l, 40), priority: [key], streamPlays: async () => false });
  const show = store.listShows({ source: 'kan' }).find((x) => x.show.key === key);
  const eps = show?.show.seasons.flatMap((x) => x.episodes) ?? [];
  expect(eps.length).toBe(byPath.size); // the numbered page is in the app's list too
  expect(eps.some((e) => e.key === 'kan:679009')).toBe(true); // s1/rebirth-1/
  // A re-read of the show finds nothing new and reads no episode page again.
  const before = read.length;
  const st = store.getState<{ shows: Record<string, { checkedAt?: string; pending: string[] }> }>(
    'kan:crawl',
  );
  const s = st?.shows[key];
  if (s) s.checkedAt = '2026-01-01T00:00:00Z';
  store.setState('kan:crawl', st);
  await crawlKan(store, { ...opts(l, 40), priority: [key], streamPlays: async () => false });
  expect(store.getState<typeof st>('kan:crawl')?.shows[key]?.pending).toEqual([]);
  expect(read.slice(before).filter((u) => u.includes('/p-671191/s1/'))).toEqual([]);
});

test("the order of a show's pages: by id, one address per id, named ones without an id last", async () => {
  const { episodeOrder, appListed } = await import('../src/kan.ts');
  const o = 'https://www.kan.org.il';
  const show = `${o}/content/kan/kan-11/p-1/`;
  expect(
    episodeOrder({ ids: { [`${show}s1/b/`]: '5' } }, [
      `${show}s2/30/`,
      `${show}s1/a/`,
      `${show}s1/b/`,
      `${show}10/`,
      `${show}s1/10/`,
    ]),
  ).toEqual([`${show}s1/b/`, `${show}10/`, `${show}s2/30/`, `${show}s1/a/`]);
  const item = (id: string, pageUrl?: string) =>
    [id, { id, title: id, stream: { kind: 'none' as const }, ...(pageUrl ? { pageUrl } : {}) }] as const;
  expect(
    appListed(
      show,
      o,
      new Map([
        item('1', `${show}s1/1/`),
        item('2', `${show}s1/name-2/`),
        item('3'), // a YouTube clip: no web page
        item('4', `${o}/content/kan/kan-11/p-9/4/`), // another show's
        item('5', `https://www.kan.org.il/content/kan/kan-11/p-1/%D7%A2%D7%95%D7%A0%D7%94-2/5/`),
      ]),
    ),
  ).toEqual({
    urls: [`${show}s1/1/`, `${show}s1/name-2/`, `${show}עונה-2/5/`],
    ids: { [`${show}s1/name-2/`]: '2' },
    noPage: 1,
  });
});
