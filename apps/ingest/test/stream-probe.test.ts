import { assignNumbers, ConfigSchema, type ScrapedShow } from '@israel-tv/core';
import { Store } from '@israel-tv/store';
import { describe, expect, test } from 'vitest';
import { renderFromStore } from '../src/publish.ts';
import { maxHeight, type ProbeFetch, probeHls, probeStreams } from '../src/stream-probe.ts';

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=507403,RESOLUTION=640x360
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=984498,RESOLUTION=960x540
mid/index.m3u8
`;
const MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6,
seg-1.ts
`;

/** A fake CDN: path → status (and body for playlists). */
function cdn(routes: Record<string, [number, string?]>): ProbeFetch & { asked: string[] } {
  const asked: string[] = [];
  const f = async (url: string) => {
    asked.push(url);
    const [status, body = ''] = routes[new URL(url).pathname] ?? [404];
    return new Response(status === 204 ? null : body, { status });
  };
  return Object.assign(f, { asked });
}

describe('probeHls', () => {
  test('the tallest rendition of a master', () => {
    expect(maxHeight(MASTER)).toBe(540);
    expect(maxHeight('#EXTM3U\nseg.ts')).toBeUndefined();
  });

  test('playlist, variant and segment answer: plays', async () => {
    const f = cdn({ '/m.m3u8': [200, MASTER], '/low/index.m3u8': [200, MEDIA], '/low/seg-1.ts': [206, 'x'] });
    expect(await probeHls('https://cdn.test/m.m3u8', f)).toEqual({
      result: 'ok',
      status: 206,
      maxHeight: 540,
    });
    expect(f.asked).toEqual([
      'https://cdn.test/m.m3u8',
      'https://cdn.test/low/index.m3u8',
      'https://cdn.test/low/seg-1.ts',
    ]);
  });

  test('a 403 anywhere is a refusal (geo), other errors only a failure', async () => {
    expect(await probeHls('https://cdn.test/m.m3u8', cdn({ '/m.m3u8': [403] }))).toMatchObject({
      result: 'refused',
      step: 'master',
    });
    const seg403 = cdn({ '/m.m3u8': [200, MASTER], '/low/index.m3u8': [200, MEDIA], '/low/seg-1.ts': [403] });
    expect(await probeHls('https://cdn.test/m.m3u8', seg403)).toMatchObject({
      result: 'refused',
      step: 'segment',
    });
    expect(await probeHls('https://cdn.test/m.m3u8', cdn({ '/m.m3u8': [502] }))).toMatchObject({
      result: 'failed',
      status: 502,
    });
    const boom: ProbeFetch = async () => {
      throw new Error('ECONNRESET');
    };
    expect(await probeHls('https://cdn.test/m.m3u8', boom)).toEqual({ result: 'failed', status: 0 });
  });

  test('quality only: the master is enough', async () => {
    const f = cdn({ '/m.m3u8': [200, MASTER] });
    expect(await probeHls('https://cdn.test/m.m3u8', f, { segment: false })).toEqual({
      result: 'ok',
      status: 200,
      maxHeight: 540,
    });
    expect(f.asked).toHaveLength(1);
  });
});

describe('probeStreams → published labels', () => {
  const kanShow = (key: string, hls: string): ScrapedShow => ({
    source: 'kan',
    key,
    title: `כאן ${key}`,
    catalog: 'iltv_kan11',
    seasons: [
      {
        key: '1',
        title: 'עונה 1',
        episodes: [
          {
            key: `kan:${key}-1`,
            title: 'פרק 1',
            airDate: '2026-10-01',
            availableAbroad: false,
            streams: [{ url: hls, kind: 'direct' }],
          },
        ],
      },
    ],
  });
  const reshetShow: ScrapedShow = {
    source: 'reshet',
    key: 'r1',
    title: 'רשת',
    catalog: 'iltv_reshet13',
    seasons: [
      {
        key: '1',
        title: 'עונה 1',
        episodes: [
          {
            key: '1_abc',
            title: 'פרק 1',
            airDate: '2026-10-01',
            streams: [{ url: 'https://cdn.test/r/m.m3u8', kind: 'direct' }],
          },
        ],
      },
    ],
  };

  test('Kan titles that play abroad lose the label; refused ones keep it; Reshet shows its measured quality', async () => {
    const store = Store.open(':memory:');
    for (const s of [
      kanShow('open', 'https://cdn.test/open/m.m3u8'),
      kanShow('shut', 'https://cdn.test/shut/m.m3u8'),
      reshetShow,
    ]) {
      const id = store.seriesIdFor(s.source, s.key);
      store.saveShow(id, s, assignNumbers(s, store.assignments(id)).added, '2026-11-05', true);
    }
    const f = cdn({
      '/open/m.m3u8': [200, MASTER],
      '/open/low/index.m3u8': [200, MEDIA],
      '/open/low/seg-1.ts': [206, 'x'],
      '/shut/m.m3u8': [403],
      '/r/m.m3u8': [200, MASTER],
    });
    const config = ConfigSchema.parse({ geo: { type: 'http-proxy', urls: ['https://proxy.test:89'] } });
    expect(await probeStreams(store, config, { fetch: f })).toEqual({ kan: 2, quality: 1 });
    // Nothing is due again right away.
    expect(await probeStreams(store, config, { fetch: f })).toEqual({ kan: 0, quality: 0 });

    const files = renderFromStore(store, config);
    const streams = (id: string) => JSON.parse(String(files.get(`streams/${id}/1.json`)))['1'][0];
    const open = store.findSeriesId('kan', 'open') ?? '';
    const shut = store.findSeriesId('kan', 'shut') ?? '';
    expect(streams(open).title).not.toMatch(/רק בישראל/);
    expect(streams(shut).title).toMatch(/זמין לצפייה רק בישראל/);
    expect(JSON.parse(String(files.get(`play/${open}/1.json`)))['1'].israelOnly).toBeUndefined();
    expect(JSON.parse(String(files.get(`play/${shut}/1.json`)))['1'].israelOnly).toBe(true);
    expect(streams(store.findSeriesId('reshet', 'r1') ?? '').name).toMatch(/540p/);
  });

  test('inside Israel (no geo proxy) Kan is not probed and keeps its label', async () => {
    const store = Store.open(':memory:');
    const s = kanShow('open', 'https://cdn.test/open/m.m3u8');
    const id = store.seriesIdFor(s.source, s.key);
    store.saveShow(id, s, assignNumbers(s, store.assignments(id)).added, '2026-11-05', true);
    const f = cdn({});
    expect(await probeStreams(store, ConfigSchema.parse({}), { fetch: f })).toEqual({ kan: 0, quality: 0 });
    expect(f.asked).toEqual([]);
  });
});

test('probes ask only public https addresses, also after a redirect', async () => {
  const { publicHttps } = await import('../src/stream-probe.ts');
  for (const u of [
    'http://cdn.test/m.m3u8',
    'https://127.0.0.1/x',
    'https://192.168.1.5/x',
    'https://[::1]/x',
    'https://localhost/x',
  ])
    expect(publicHttps(u), u).toBe(false);
  expect(publicHttps('https://r.il.cdn-redge.media/x.m3u8')).toBe(true);
  const intoLan: ProbeFetch = async () =>
    new Response(null, { status: 302, headers: { location: 'https://10.0.0.2:7702/admin' } });
  expect(await probeHls('https://cdn.test/m.m3u8', intoLan)).toMatchObject({ result: 'failed', status: 400 });
});

test("Kan titles take at most half of a call's reads; Reshet qualities get the rest", async () => {
  const store = Store.open(':memory:');
  const kan = (n: number): ScrapedShow => ({
    source: 'kan',
    key: `k${n}`,
    title: `כאן ${n}`,
    catalog: 'iltv_kan11',
    seasons: [
      {
        key: '1',
        title: 'עונה 1',
        episodes: [
          {
            key: `kan:${n}`,
            title: 'פרק 1',
            streams: [{ url: 'https://cdn.test/shut/m.m3u8', kind: 'direct' }],
          },
        ],
      },
    ],
  });
  const reshet: ScrapedShow = {
    source: 'reshet',
    key: 'r',
    title: 'ר',
    catalog: 'iltv_reshet13',
    seasons: [
      {
        key: '1',
        title: 'עונה 1',
        episodes: [
          { key: 'e', title: 'פרק 1', streams: [{ url: 'https://cdn.test/r/m.m3u8', kind: 'direct' }] },
        ],
      },
    ],
  };
  for (const s of [...Array.from({ length: 20 }, (_, i) => kan(i)), reshet]) {
    const id = store.seriesIdFor(s.source, s.key);
    store.saveShow(id, s, assignNumbers(s, store.assignments(id)).added, '2026-11-05', true);
  }
  const f = cdn({ '/shut/m.m3u8': [403], '/r/m.m3u8': [200, MASTER] });
  const config = ConfigSchema.parse({ geo: { type: 'http-proxy', urls: ['https://proxy.test:89'] } });
  expect(await probeStreams(store, config, { fetch: f, budget: 30 })).toEqual({ kan: 5, quality: 1 });
});
