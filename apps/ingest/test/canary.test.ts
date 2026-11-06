import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import { canaryEvent, pickTargets, playCheck, runCanary } from '../src/canary.ts';

const hls = (body: string, url: string, status = 200) => {
  const r = new Response(body, { status });
  Object.defineProperty(r, 'url', { value: url });
  return r;
};

function cdn(fail?: { at: 'master' | 'variant' | 'segment'; status: number }) {
  return (async (u: string) => {
    if (u.endsWith('master.m3u8'))
      return fail?.at === 'master'
        ? hls('', u, fail.status)
        : hls('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow/v.m3u8\n', u);
    if (u.endsWith('v.m3u8'))
      return fail?.at === 'variant' ? hls('', u, fail.status) : hls('#EXTM3U\n#EXTINF:2,\nseg1.ts\n', u);
    return fail?.at === 'segment' ? hls('', u, fail.status) : hls('x', u, 206);
  }) as unknown as typeof fetch;
}

test('play check: master, variant, first segment — and where it fails', async () => {
  expect(await playCheck('https://cdn/x/master.m3u8', cdn())).toEqual({ statuses: [200, 200, 206] });
  expect(await playCheck('https://cdn/x/master.m3u8', cdn({ at: 'master', status: 403 }))).toMatchObject({
    statuses: [403],
    step: 'master',
  });
  expect(await playCheck('https://cdn/x/master.m3u8', cdn({ at: 'segment', status: 404 }))).toMatchObject({
    statuses: [200, 200, 404],
    step: 'segment',
  });
});

test('the canary picks a recent playable title per source from the catalog, and records events', async () => {
  const store = Store.open(':memory:');
  const show = (key: string, date: string) => ({
    source: 'reshet' as const,
    key,
    title: key,
    catalog: 'iltv_reshet13',
    pageUrl: `https://x${key}`,
    seasons: [
      {
        key: `${key}|s1`,
        title: 'עונה 1',
        episodes: [
          {
            key: `${key}-e1`,
            title: 'e1',
            airDate: date,
            streams: [{ url: 'https://cdn/x/master.m3u8', kind: 'direct' as const }],
          },
        ],
      },
    ],
  });
  for (const [key, date] of [
    ['/old', '2026-01-01'],
    ['/new', '2026-11-05'],
  ] as const) {
    const id = store.seriesIdFor('reshet', key);
    store.saveShow(
      id,
      show(key, date),
      {
        seasons: [{ key: `${key}|s1`, number: 1, kind: 'numbered' }],
        episodes: [{ key: `${key}-e1`, season: 1, episode: 1 }],
      },
      date,
      true,
    );
  }
  const targets = pickTargets(store, ['reshet', 'live']);
  expect(targets[0]).toMatchObject({
    source: 'reshet',
    episodeId: `${store.findSeriesId('reshet', '/new')}:1:1`,
  });
  expect(targets[1]?.source).toBe('live');
  const results = await runCanary(store, ['reshet'], undefined, cdn());
  expect(results[0]).toMatchObject({ outcome: 'ok', via: 'direct', statuses: [200, 200, 206] });
  const e = canaryEvent(results[0] as never);
  expect(e).toMatchObject({ kind: 'canary', component: 'canary', outcome: 'ok', source: 'reshet' });
});

function reshetStore(shows: [key: string, date: string][]) {
  const store = Store.open(':memory:');
  for (const [key, date] of shows) {
    const id = store.seriesIdFor('reshet', key);
    store.saveShow(
      id,
      {
        source: 'reshet',
        key,
        title: key,
        catalog: 'iltv_reshet13',
        pageUrl: `https://x${key}`,
        seasons: [
          {
            key: `${key}|s1`,
            title: 'עונה 1',
            episodes: [
              {
                key: `${key}-e1`,
                title: 'e1',
                airDate: date,
                streams: [{ url: `https://cdn${key}/master.m3u8`, kind: 'direct' }],
              },
            ],
          },
        ],
      },
      {
        seasons: [{ key: `${key}|s1`, number: 1, kind: 'numbered' }],
        episodes: [{ key: `${key}-e1`, season: 1, episode: 1 }],
      },
      date,
      true,
    );
  }
  return store;
}

/** A CDN where one show's master answers `status`; everything else plays. */
function cdnFailing(path: string, status: number) {
  const ok = cdn();
  return (async (u: string) =>
    u.includes(path) && u.endsWith('master.m3u8') ? hls('', u, status) : ok(u)) as unknown as typeof fetch;
}

test('a title that will not play is "episode unavailable": the next recent title is tried and the source stays green', async () => {
  const store = reshetStore([
    ['/dead', '2026-11-06'],
    ['/fine', '2026-11-05'],
  ]);
  const dead = `${store.findSeriesId('reshet', '/dead')}:1:1`;
  const [r] = await runCanary(store, ['reshet'], undefined, cdnFailing('/dead', 403), { retryDelayMs: 0 });
  expect(r).toMatchObject({
    outcome: 'ok',
    tried: 2,
    episodeId: `${store.findSeriesId('reshet', '/fine')}:1:1`,
  });
  expect(r?.unavailable).toEqual([
    { episodeId: dead, step: 'master', statuses: [403], detail: 'master HTTP 403' },
  ]);
  expect(canaryEvent(r as never).detail).toMatchObject({ tried: 2, unavailable: [{ episodeId: dead }] });
  // The next run starts with another title: the failed one is remembered for a day.
  const [again] = await runCanary(store, ['reshet'], undefined, cdnFailing('/dead', 403), {
    retryDelayMs: 0,
  });
  expect(again).toMatchObject({ outcome: 'ok', tried: 1 });
});

test("a source is red only when its titles all fail, or a failure is not the title's (5xx)", async () => {
  const store = reshetStore([
    ['/a', '2026-11-06'],
    ['/b', '2026-11-05'],
  ]);
  const all = (async (u: string) => hls('', u, 404)) as unknown as typeof fetch;
  const [r] = await runCanary(store, ['reshet'], undefined, all, { retryDelayMs: 0 });
  expect(r).toMatchObject({ outcome: 'error', step: 'master', tried: 2 });
  const store2 = reshetStore([
    ['/a', '2026-11-06'],
    ['/b', '2026-11-05'],
  ]);
  const [r2] = await runCanary(store2, ['reshet'], undefined, cdnFailing('/a', 502), { retryDelayMs: 0 });
  expect(r2).toMatchObject({ outcome: 'error', tried: 1 });
});

test('a relayed title that fails is checked once more before it counts (the relay moves to another exit)', async () => {
  const store = reshetStore([['/k', '2026-11-06']]);
  let segments = 0;
  const flaky = (async (u: string) => {
    if (u.includes('/stream/'))
      return Response.json({ streams: [{ url: 'http://resolver/relay/sig/abc.m3u8' }] });
    if (u.endsWith('abc.m3u8')) return hls('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8\n', u);
    if (u.endsWith('v.m3u8')) return hls('#EXTM3U\n#EXTINF:2,\nseg1.ts\n', u);
    return ++segments === 1 ? hls('', u, 403) : hls('x', u, 206);
  }) as unknown as typeof fetch;
  const [r] = await runCanary(store, ['reshet'], 'http://resolver', flaky, { retryDelayMs: 0 });
  expect(r).toMatchObject({ outcome: 'ok', via: 'resolver', retried: true });
});
