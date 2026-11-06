import { readFileSync } from 'node:fs';
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

const opts = (l: ReturnType<typeof loader>, pagesPerRun: number): KanCrawlOptions => ({
  browser: { type: 'chrome', headed: true },
  pagesPerRun,
  pageIntervalMs: 0,
  airingWindowDays: 14,
  loader: l,
});

const routes = {
  '/lobby/kan11/': 'lobby-kan11',
  '/lobby-kids/kids-teens': 'lobby-kids-teens',
  '/content/kan/kan-11/p-1006421/': 'show-p-1006421',
};

test('crawl fills a show over several budgeted slices and never re-reads known episodes', async () => {
  const store = Store.open(':memory:');
  // Only the Eurovision show is "in" the lobby for this test: other shows are not recorded and 404.
  const l = loader(routes);
  const first = await crawlKan(store, opts(l, 3));
  expect(first.pages).toBe(3); // 2 lobbies + 1 show page
  for (
    let i = 0;
    i < 80 &&
    store.listShows({ source: 'kan' }).flatMap((s) => s.show.seasons.flatMap((x) => x.episodes)).length < 9;
    i++
  ) {
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
  expect(r.note).toMatch(/stopped: .*challenge/);
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
  await crawlKan(store, opts(l, 2)); // lobbies only
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
  const r = await crawlKan(store, { ...opts(loader(routes), 5), loader: throwing as never });
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

test('a video embedded in a show page is keyed by its stable Kan video id', async () => {
  const { kanEpisodeKey } = await import('../src/kan.ts');
  expect(
    kanEpisodeKey({ id: '1006639', hls: 'https://r.il.cdn-redge.media/x/kancdn/vod/2173543/L/a.m3u8' }),
  ).toBe('kan:1006639');
  expect(
    kanEpisodeKey({
      id: 'h5b9ddce0bdef4bc8929337f2519979ba',
      hls: 'https://r.il.cdn-redge.media/x/kancdn/vod/2171294/L/a.m3u8',
    }),
  ).toBe('kan:vod-2171294');
});
