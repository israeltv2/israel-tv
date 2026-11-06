// Integration check: a Stremio-style client with both addons installed — the catalog (as published) and a
// resolver that plays from that published catalog — asked for every kind of title, at home (in Israel) and
// abroad. It checks which addon answers which request, and that no title gets competing streams except the
// one deliberate pair (abroad: the catalog's Israel-only direct stream next to the resolver's relay of it).

import { createAddonApp } from '@israel-tv/addon';
import { assignNumbers, ConfigSchema, type ScrapedShow } from '@israel-tv/core';
import { catalogLookup, createResolverApp } from '@israel-tv/resolver';
import { Store } from '@israel-tv/store';
import { expect, test } from 'vitest';
import { renderFromStore } from '../src/publish.ts';

const CATALOG = 'https://catalog.example';

function show(
  source: 'mako' | 'reshet' | 'kan',
  key: string,
  ep: ScrapedShow['seasons'][number]['episodes'][number],
): ScrapedShow {
  return {
    source,
    key,
    title: key,
    catalog: source === 'mako' ? 'iltv_keshet12' : source === 'reshet' ? 'iltv_reshet13' : 'iltv_kan11',
    pageUrl: `https://example/${key}`,
    seasons: [{ key: `${key}|s1`, title: 'עונה 1', episodes: [ep] }],
  };
}

/** A published catalog with one show per source and the live channels. */
function publishedCatalog(): Map<string, string | Uint8Array> {
  const store = Store.open(':memory:');
  const shows = [
    show('mako', '/mako-show', {
      key: 'm1',
      title: 'Mako episode',
      airDate: '2026-11-05',
      streams: [],
      play: { vcmid: 'v1', channelId: 'c1' },
    }),
    show('reshet', '/reshet-show', {
      key: 'r1',
      title: 'Reshet episode',
      airDate: '2026-11-05',
      availableAbroad: false,
      streams: [{ url: 'https://cdnapisec.kaltura.com/p/1/entryId/r1/a.m3u8', kind: 'direct' }],
    }),
    show('kan', '/kan-show', {
      key: 'kan:1',
      title: 'Kan episode',
      airDate: '2026-11-05',
      availableAbroad: false,
      streams: [{ url: 'https://kan.cdn-redge.media/vod/k1/index.m3u8', kind: 'direct' }],
    }),
  ];
  for (const s of shows) {
    const id = store.seriesIdFor(s.source, s.key);
    store.saveShow(id, s, assignNumbers(s, store.assignments(id)).added, '2026-11-05', true);
  }
  const config = ConfigSchema.parse({ publisher: { type: 'local' } });
  return renderFromStore(store, config);
}

type Addon = { fetch: (req: Request) => Response | Promise<Response> };

/** What a Stremio client does: ask every addon whose manifest claims this stream request. */
async function askStreams(addons: Addon[], type: string, id: string) {
  const out: { addon: string; streams: { url?: string; title?: string; name?: string }[] }[] = [];
  for (const a of addons) {
    const m = (await (await a.fetch(new Request('http://h/manifest.json'))).json()) as {
      id: string;
      resources: (string | { name: string; types?: string[]; idPrefixes?: string[] })[];
      idPrefixes?: string[];
      types?: string[];
    };
    const res = m.resources.map((r) => (typeof r === 'string' ? { name: r } : r));
    const stream = res.find((r) => r.name === 'stream') as
      | { types?: string[]; idPrefixes?: string[] }
      | undefined;
    const prefixes = stream?.idPrefixes ?? m.idPrefixes ?? [];
    const types = stream?.types ?? m.types ?? [];
    if (!stream || !types.includes(type) || !prefixes.some((p) => id.startsWith(p))) continue;
    const r = await a.fetch(new Request(`http://h/stream/${type}/${encodeURIComponent(id)}.json`));
    const body = (await r.json()) as { streams: { url?: string; title?: string; name?: string }[] };
    if (body.streams.length) out.push({ addon: m.id, streams: body.streams });
  }
  return out;
}

function addons(files: Map<string, string | Uint8Array>, where: 'home' | 'abroad') {
  const catalog = createAddonApp({ read: async (p) => (files.has(p) ? String(files.get(p)) : undefined) });
  // The resolver reads the catalog over HTTP, the way a resolver-only install reads a served catalog (here the
  // catalog addon itself, as the local server serves it; the Worker serves the same files as static assets).
  const catalogFetch = (async (url: string) =>
    catalog.fetch(new Request(`http://h/${url.slice(CATALOG.length + 1)}`))) as unknown as typeof fetch;
  const upstream = async (url: string) => {
    if (url.includes('playlist.jsp'))
      return Response.json({ media: [{ url: 'https://x.akamaized.net/m.m3u8', cdn: 'AKAMAI' }] });
    if (url.includes('entitlement')) return Response.json({ tickets: [{ ticket: 'hdnea%3Dx' }] });
    if (url.includes('akamaized')) return new Response('#EXTM3U\nv.m3u8\n');
    // Direct streams (the resolver checks them from its own network): fine at home, refused abroad.
    return new Response('', { status: where === 'home' ? 200 : 403 });
  };
  const lookup = catalogLookup(CATALOG, catalogFetch);
  const resolver = createResolverApp({
    episode: lookup.episode,
    external: lookup.external,
    fetch: upstream,
    geoFetch: (async () => new Response('#EXTM3U\n')) as never,
  });
  return { catalog, resolver };
}

test('integration: which addon answers what, at home and abroad', async () => {
  const files = publishedCatalog();
  const id = (source: string) =>
    [...files.keys()]
      .find((p) => p.startsWith(`meta/series/iltv_${source}_`))
      ?.match(/(iltv_\w+_\d+)/)?.[1] ?? '';
  const ep = (source: string) => `${id(source)}:1:1`;

  for (const where of ['home', 'abroad'] as const) {
    const { catalog, resolver } = addons(files, where);
    const both = [catalog, resolver];
    const by = async (type: string, vid: string) =>
      Object.fromEntries((await askStreams(both, type, vid)).map((a) => [a.addon, a.streams]));

    // Catalogs and metadata come only from the catalog; the resolver serves none.
    const rm = (await (await resolver.fetch(new Request('http://h/manifest.json'))).json()) as {
      catalogs: unknown[];
      resources: { name: string }[];
    };
    expect(rm.catalogs).toEqual([]);
    expect(rm.resources.map((r) => r.name)).toEqual(['stream']);

    // Mako: only the resolver (one stream), at home and abroad.
    const mako = await by('series', ep('mako'));
    expect(Object.keys(mako)).toEqual(['community.israel-tv.resolver']);
    expect(mako['community.israel-tv.resolver']).toHaveLength(1);

    for (const source of ['reshet', 'kan']) {
      const got = await by('series', ep(source));
      if (where === 'home') {
        // Plays directly at home: only the catalog's stream, no duplicate from the resolver.
        expect(Object.keys(got), source).toEqual(['community.israel-tv']);
        expect(got['community.israel-tv']).toHaveLength(1);
      } else {
        // Abroad: the deliberate pair — the catalog's direct stream (labelled Israel-only) and one relay of it.
        expect(Object.keys(got).sort(), source).toEqual([
          'community.israel-tv',
          'community.israel-tv.resolver',
        ]);
        expect(got['community.israel-tv']).toHaveLength(1);
        // Labels: source (and quality, when known) as the name; plainly Israel-only on the public one.
        expect(got['community.israel-tv']?.[0]?.name).toMatch(
          source === 'reshet' ? /^[\u200F\u202B]?רשת 13/ : /^[\u200F\u202B]?כאן/,
        );
        expect(got['community.israel-tv']?.[0]?.title).toMatch(/זמין לצפייה רק בישראל/);
        expect(got['community.israel-tv.resolver']).toHaveLength(1);
        expect(got['community.israel-tv.resolver']?.[0]?.name).toMatch(
          source === 'reshet' ? /^[\u200F\u202B]?רשת 13/ : /^[\u200F\u202B]?כאן/,
        );
        expect(got['community.israel-tv.resolver']?.[0]?.title).toMatch(/דרך החיבור הישראלי שלך/);
      }
    }

    // Live: Keshet 12 only through the resolver; Kan 11 from the catalog, relayed by the resolver only abroad,
    // one relay per direct stream.
    const k12 = await by('tv', 'iltv_live_keshet12');
    expect(Object.keys(k12)).toEqual(['community.israel-tv.resolver']);
    const kan11 = await by('tv', 'iltv_live_kan11');
    const direct = kan11['community.israel-tv'] ?? [];
    expect(direct.length).toBeGreaterThan(0);
    expect(kan11['community.israel-tv.resolver']?.length ?? 0).toBe(where === 'home' ? 0 : direct.length);
  }
});
