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
