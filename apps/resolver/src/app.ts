// Private stream resolver: a second Stremio addon that runs on the viewer's own network and does play-time work
// only (it serves no catalogs). Two modules, each with its own config switch, log component and events:
//
// - mako-auth (mako-auth.ts): Mako tickets and the ~1 KB master playlist per play; video comes from Mako's CDN.
// - geo-relay (geo-relay.ts): geo-blocked Reshet/Kan video through the geo proxy, only when refused from here.
//
// This file answers the manifest and stream requests, asking each module for its streams.
import { randomBytes } from 'node:crypto';
import {
  clientHash,
  GEO_LIMITED,
  LIVE_CHANNELS,
  type LiveChannel,
  newPlayId,
  parseSeriesId,
  parseVideoId,
  type ScrapedEpisode,
  type Stream,
  type UsageEvent,
} from '@israel-tv/core';
import type { GeoFetch } from '@israel-tv/net';
import { RELEASE_VERSION } from '@israel-tv/runtime';
import { type Context, Hono } from 'hono';
import type { Fetch, Log, ModuleContext, Play } from './context.ts';
import { geoRelay } from './geo-relay.ts';
import { makoAuth } from './mako-auth.ts';
import { type PlayInfo, PlaySessions } from './sessions.ts';

export { absolutize } from './context.ts';
export { RELAY_HOSTS } from './geo-relay.ts';

/** Our series for an IMDb/TMDB id, with the seasons that share TMDB's numbering. */
export type ExternalHit = { series: string; seasons: number[] };

export interface ResolverDeps {
  /** Episode data for a published video id, from the home database. */
  episode(
    series: string,
    season: number,
    episode: number,
  ): ScrapedEpisode | undefined | Promise<ScrapedEpisode | undefined>;
  /** Our series for an IMDb (`tt…`) or TMDB (`tmdb:…`) id, with the seasons that share TMDB's numbering. */
  external?(id: string): ExternalHit | undefined | Promise<ExternalHit | undefined>;
  /** Plain fetch (Mako, and checking direct streams; no proxy). */
  fetch: Fetch;
  /** Fetch through the geo adapter; without it there is no geo-relay. */
  geoFetch?: GeoFetch;
  /** Module switches (both on by default). */
  modules?: { makoAuth?: boolean; geoRelay?: boolean };
  channels?: readonly LiveChannel[];
  /** Secret for signing relay URLs; random per process by default. */
  secret?: Buffer;
  /** Log for a component (`resolver`, `mako-auth`, `geo-relay`). */
  log?: (component: 'resolver' | 'mako-auth' | 'geo-relay') => Log;
  /** Outcome of each relay through the geo proxy (for /status). */
  onRelay?: (r: { ok: boolean; error?: string }) => void;
  /** Usage and diagnostics events. */
  onEvent?: (e: UsageEvent) => void;
  /** Play and relay sessions (shared with the usage dashboard); one is made when not given. */
  sessions?: PlaySessions;
  /** Secret salt for client hashes; random per process when not given. */
  salt?: string;
  /** The resolver's logo and the background for its manifest. */
  branding?: { logo?: { body: Uint8Array; type: string }; background?: { body: Uint8Array; type: string } };
  /** The address this app is reached at, for the URLs it hands out (default: the request's origin). */
  publicBase?: (c: Context) => string;
  /** Manifest overrides (the remote, Mako-only resolver names itself differently). */
  manifest?: { id: string; name: string; description: string; idPrefixes: string[] };
  /** The client's address for a request (default: the connecting socket's). */
  clientAddress?: (c: Context) => string | undefined;
}

export function createResolverApp(deps: ResolverDeps) {
  const channels = deps.channels ?? LIVE_CHANNELS;
  const app = new Hono();
  const sessions = deps.sessions ?? new PlaySessions(deps.onEvent);
  const salt = deps.salt ?? randomBytes(16).toString('hex');
  const addressOf = deps.clientAddress ?? defaultClientAddress;
  const logFor = deps.log ?? (() => () => {});
  const log = logFor('resolver');
  const context = (component: 'mako-auth' | 'geo-relay'): ModuleContext => ({
    fetch: deps.fetch,
    sessions,
    log: logFor(component),
    emit: (e) => deps.onEvent?.({ ts: new Date().toISOString(), component, ...e }),
    clientOf: async (c) => {
      const a = addressOf(c);
      return a ? await clientHash(salt, a) : undefined;
    },
  });
  const mako =
    deps.modules?.makoAuth === false
      ? undefined
      : makoAuth({ ...context('mako-auth'), episode: deps.episode, channels });
  const relay =
    deps.geoFetch && deps.modules?.geoRelay !== false
      ? geoRelay({
          ...context('geo-relay'),
          geoFetch: deps.geoFetch,
          secret: deps.secret ?? randomBytes(32),
          ...(deps.onRelay ? { onRelay: deps.onRelay } : {}),
        })
      : undefined;

  app.use('*', async (c, next) => {
    await next();
    c.header('Access-Control-Allow-Origin', '*');
  });

  const base = (c: Context) => deps.publicBase?.(c) ?? new URL(c.req.url).origin;

  app.get('/', (c) => c.redirect('/manifest.json'));
  app.get('/manifest.json', (c) =>
    c.json({
      id: deps.manifest?.id ?? 'community.israel-tv.resolver',
      version: RELEASE_VERSION,
      name: deps.manifest?.name ?? 'Israel TV · home helper',
      description:
        deps.manifest?.description ??
        'Plays Keshet 12 and live channels from your own computer, and Reshet and Kan where they are refused.',
      resources: [
        {
          name: 'stream',
          types: ['series', 'tv'],
          idPrefixes: deps.manifest?.idPrefixes ?? [
            'iltv_mako_',
            'iltv_reshet_',
            'iltv_kan_',
            'iltv_live_',
            'tt',
            'tmdb:',
          ],
        },
      ],
      types: ['series', 'tv'],
      catalogs: [],
      ...(deps.branding?.logo ? { logo: `${base(c)}/logo.png` } : {}),
      ...(deps.branding?.background ? { background: `${base(c)}/background.jpg` } : {}),
    }),
  );
  for (const [path, img] of [
    ['/logo.png', deps.branding?.logo],
    ['/background.jpg', deps.branding?.background],
  ] as const) {
    if (img)
      app.get(path, (c) =>
        c.body(new Uint8Array(img.body), 200, {
          'content-type': img.type,
          'cache-control': 'public, max-age=86400',
        }),
      );
  }

  // ---- streams --------------------------------------------------------------------------------------

  app.get('/stream/:type/:file', async (c) => {
    const id = decodeURIComponent(c.req.param('file')).replace(/\.json$/, '');
    const origin = base(c);
    const t0 = Date.now();
    // The daily playback canary marks its requests: its plays are not usage (rollups and "playing now" skip them).
    const playId = c.req.header('x-israel-tv-canary') === '1' ? `canary-${newPlayId()}` : newPlayId();
    const client = await context('mako-auth').clientOf(c);
    const streams: Stream[] = [];
    let info: PlayInfo = {};
    const notes: string[] = [];
    /** Nothing offered on purpose: the direct stream (from the public addon) plays from here. */
    let directPlays = false;
    const play = (): Play => ({ playId, info });
    // Shows opened from other catalogs (tt123:2:5 or tmdb:123:2:5) map onto ours, numbered seasons only.
    const ext = /^(tt\d+|tmdb:\d+):(\d+):(\d+)$/.exec(id);
    const mapped = ext?.[1] ? await deps.external?.(ext[1]) : undefined;
    const v = mapped?.seasons.includes(Number(ext?.[2]))
      ? { series: mapped.series, season: Number(ext?.[2]), episode: Number(ext?.[3]) }
      : parseVideoId(id);
    if (v) {
      const video = `${v.series}:${v.season}:${v.episode}`;
      const source = parseSeriesId(v.series)?.source;
      info = { showId: v.series, episodeId: video, ...(source ? { source } : {}) };
      const ep = await deps.episode(v.series, v.season, v.episode);
      if (ep && mako && v.series.startsWith('iltv_mako_') && ep.play?.vcmid)
        streams.push(...mako.streams(origin, play(), { video }));
      // Reshet and Kan video is geo-blocked outside Israel; the relay is offered only when it is refused here.
      const geoSource = source !== undefined && GEO_LIMITED.has(source);
      if (ep && relay && (geoSource || ep.availableAbroad === false)) {
        const direct = ep.streams.find((s) => s.kind === 'direct' || s.kind === 'resolver');
        if (direct) {
          const r = await relay.streamFor(origin, play(), v.series, direct.url, 'דרך ישראל · via Israel');
          notes.push(r.note);
          if (r.stream) streams.push(r.stream);
          directPlays ||= r.directPlays;
        }
      }
    } else {
      const ch = channels.find((x) => x.id === id);
      if (ch) {
        info = { showId: ch.id, source: 'live' };
        if (mako) streams.push(...mako.streams(origin, play(), { channel: ch }));
        if (ch.geo && relay) {
          for (const l of ch.direct) {
            const r = await relay.streamFor(
              origin,
              play(),
              `${ch.id}|${l.url}`,
              l.url,
              `${l.title} · דרך ישראל · via Israel`,
            );
            notes.push(r.note);
            if (r.stream) streams.push(r.stream);
            directPlays ||= r.directPlays;
          }
        }
      }
    }
    if (client) info.client = client;
    sessions.begin(playId, info);
    const offered =
      streams.length > 0
        ? `${streams.length} streams`
        : directPlays
          ? 'none needed'
          : 'no stream for this id here';
    deps.onEvent?.({
      ts: new Date().toISOString(),
      kind: 'stream_request',
      component: 'resolver',
      outcome: streams.length > 0 || directPlays ? 'ok' : 'error',
      playId,
      ...info,
      ...(info.episodeId || info.showId ? {} : { episodeId: id }),
      status: 200,
      latencyMs: Date.now() - t0,
      detail: { offered, ...(notes.length ? { notes } : {}) },
    });
    log('stream request', { playId, ...info, offered });
    return c.json({ streams }, 200, { 'cache-control': 'no-store' });
  });

  mako?.mount(app);
  relay?.mount(app);

  app.notFound((c) => c.json({ error: 'not found' }, 404));
  return app;
}

/** The connecting address as seen by the Node server (a home-network address). */
function defaultClientAddress(c: Context): string | undefined {
  return (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket
    ?.remoteAddress;
}
