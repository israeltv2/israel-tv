// Private stream resolver: a second Stremio addon that runs on the viewer's own network.
//
// - Mako (VOD and live): Mako tickets are short-lived and Akamai binds the session token to the
//   User-Agent that fetched the master playlist. So the resolver hands out its own /play URL; each time
//   the player opens it, the resolver gets a fresh ticket, fetches the master with the player's
//   User-Agent and returns it with absolute variant URLs. Video then flows player ↔ CDN directly.
// - Geo-blocked items (Reshet abroad, Kan): when a geo proxy is configured, the resolver fetches the
//   playlist through it. Only URLs the resolver signed itself, on allowed hosts, are relayed.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  GEO_LIMITED,
  LIVE_CHANNELS,
  type LiveChannel,
  parseSeriesId,
  parseVideoId,
  type ScrapedEpisode,
  type Stream,
} from '@israel-tv/core';
import { makoPlaylistUrl, parsePlaylist } from '@israel-tv/mako';
import type { GeoFetch } from '@israel-tv/net';
import { Hono } from 'hono';

const HLS = 'application/vnd.apple.mpegurl';
const MAKO_ENTITLEMENT = 'https://mass.mako.co.il/ClicksStatistics/entitlementsServicesV2.jsp';
const MAKO_LIVE_HOST = 'https://mako-streaming.akamaized.net';
/** Where Mako's own responses may send the resolver (its CDNs); anything else is refused. */
const MAKO_MEDIA_HOST = /(^|\.)(akamaized\.net|mako\.co\.il|cloudfront\.net)$/;

function makoUrl(u: string): string {
  const url = new URL(u);
  if (url.protocol !== 'https:' || !MAKO_MEDIA_HOST.test(url.hostname))
    throw new Error(`unexpected Mako media host ${url.host}`);
  return url.toString();
}

/** Hosts the relay may fetch through the geo proxy. */
export const RELAY_HOSTS = [/(^|\.)cdn-redge\.media$/, /(^|\.)kan\.org\.il$/, /^cdnapisec\.kaltura\.com$/];

const isRelayHost = (hostname: string) => RELAY_HOSTS.some((re) => re.test(hostname));

export interface ResolverDeps {
  /** Episode data for a published video id, from the home database. */
  episode(series: string, season: number, episode: number): ScrapedEpisode | undefined;
  /** Our series for an IMDb (`tt…`) or TMDB (`tmdb:…`) id, with the seasons that share TMDB's numbering. */
  external?(id: string): { series: string; seasons: number[] } | undefined;
  /** Plain fetch (Mako; no proxy needed). */
  fetch: (
    url: string,
    init?: { headers?: Record<string, string>; redirect?: 'follow' | 'manual' },
  ) => Promise<Response>;
  /** Fetch through the geo adapter; undefined when no geo proxy is configured. */
  geoFetch?: GeoFetch;
  channels?: readonly LiveChannel[];
  /** Secret for signing relay URLs; random per process by default. */
  secret?: Buffer;
  /** One-line problem reports (e.g. the geo proxy failing). */
  log?: (line: string) => void;
  /** Outcome of each relay through the geo proxy (for /status). */
  onRelay?: (r: { ok: boolean; error?: string }) => void;
}

const sign = (secret: Buffer, s: string) =>
  createHmac('sha256', secret).update(s).digest('base64url').slice(0, 22);

function verify(secret: Buffer, s: string, sig: string): boolean {
  const a = Buffer.from(sign(secret, s));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Make every URI in a playlist absolute (relative to where the playlist was fetched). */
export function absolutize(
  playlist: string,
  base: string,
  rewrite: (abs: string) => string = (u) => u,
): string {
  return playlist
    .split('\n')
    .map((line) => {
      const l = line.trim();
      if (l === '') return line;
      if (l.startsWith('#')) {
        return line.replace(
          /URI="([^"]+)"/g,
          (_, u: string) => `URI="${rewrite(new URL(u, base).toString())}"`,
        );
      }
      return rewrite(new URL(l, base).toString());
    })
    .join('\n');
}

export function createResolverApp(deps: ResolverDeps) {
  const secret = deps.secret ?? randomBytes(32);
  const channels = deps.channels ?? LIVE_CHANNELS;
  const app = new Hono();

  app.use('*', async (c, next) => {
    await next();
    c.header('Access-Control-Allow-Origin', '*');
  });

  const base = (c: { req: { url: string } }) => new URL(c.req.url).origin;

  app.get('/', (c) => c.redirect('/manifest.json'));
  app.get('/manifest.json', (c) =>
    c.json({
      id: 'community.israel-tv.resolver',
      version: '1.0.0',
      name: 'Israel TV · home resolver',
      description:
        'Plays Mako (Keshet 12) episodes and live channels, and relays geo-blocked Reshet/Kan video through your configured proxy. Runs on your home network.',
      resources: [
        {
          name: 'stream',
          types: ['series', 'tv'],
          idPrefixes: ['iltv_mako_', 'iltv_reshet_', 'iltv_kan_', 'iltv_live_', 'tt', 'tmdb:'],
        },
      ],
      types: ['series', 'tv'],
      catalogs: [],
    }),
  );

  // ---- streams --------------------------------------------------------------------------------------

  app.get('/stream/:type/:file', (c) => {
    const id = decodeURIComponent(c.req.param('file')).replace(/\.json$/, '');
    const origin = base(c);
    const streams: Stream[] = [];
    // Shows opened from other catalogs (tt123:2:5 or tmdb:123:2:5) map onto ours, numbered seasons only.
    const ext = /^(tt\d+|tmdb:\d+):(\d+):(\d+)$/.exec(id);
    const mapped = ext?.[1] ? deps.external?.(ext[1]) : undefined;
    const v =
      mapped && mapped.seasons.includes(Number(ext?.[2]))
        ? { series: mapped.series, season: Number(ext?.[2]), episode: Number(ext?.[3]) }
        : parseVideoId(id);
    if (v) {
      const ep = deps.episode(v.series, v.season, v.episode);
      if (ep && v.series.startsWith('iltv_mako_') && ep.play?.vcmid) {
        streams.push({
          url: `${origin}/play/mako/${encodeURIComponent(`${v.series}:${v.season}:${v.episode}`)}.m3u8`,
          name: 'Israel TV',
          title: 'Mako',
        });
      }
      // Reshet and Kan video is geo-blocked outside Israel. With a geo proxy, offer the relayed stream for
      // every such episode: whether it is blocked depends on where the viewer is, not on where ingest ran.
      const source = parseSeriesId(v.series)?.source;
      const geoSource = source !== undefined && GEO_LIMITED.has(source);
      if (ep && deps.geoFetch && (geoSource || ep.availableAbroad === false)) {
        const direct = ep.streams.find((s) => s.kind === 'direct' || s.kind === 'resolver');
        if (direct) streams.push(relayStream(origin, direct.url, 'דרך ישראל · via Israel'));
      }
    } else {
      const ch = channels.find((x) => x.id === id);
      if (ch) {
        (ch.mako ?? []).forEach((m, i) => {
          streams.push({
            url: `${origin}/play/mako-live/${ch.id}/${i}.m3u8`,
            name: 'Israel TV',
            title: m.title,
          });
        });
        if (ch.geo && deps.geoFetch) {
          for (const l of ch.direct)
            streams.push(relayStream(origin, l.url, `${l.title} · דרך ישראל · via Israel`));
        }
      }
    }
    return c.json({ streams }, 200, { 'cache-control': 'no-store' });
  });

  function relayUrl(origin: string, url: string): string {
    const u = Buffer.from(url).toString('base64url');
    const ext =
      /\.m3u8(\?|$)/.test(new URL(url).pathname) || /playManifest|playlist|manifest/i.test(url)
        ? 'm3u8'
        : 'ts';
    return `${origin}/relay/${sign(secret, u)}/${u}.${ext}`;
  }

  function relayStream(origin: string, url: string, title: string): Stream {
    return { url: relayUrl(origin, url), name: 'Israel TV', title };
  }

  // ---- Mako -----------------------------------------------------------------------------------------

  async function makoTicketedMaster(mediaUrl: string, cdn: string): Promise<string> {
    const u = `${MAKO_ENTITLEMENT}?et=gt&lp=${encodeURIComponent(mediaUrl)}&rv=${encodeURIComponent(cdn)}`;
    const r = await deps.fetch(u);
    if (!r.ok) throw new Error(`Mako entitlement HTTP ${r.status}`);
    const j = (await r.json()) as { tickets?: { ticket?: string; url?: string }[] };
    const t = j.tickets?.[0];
    if (!t?.ticket) throw new Error('Mako entitlement returned no ticket');
    return `${makoUrl(t.url ?? mediaUrl)}?${decodeURIComponent(t.ticket)}`;
  }

  async function makoMasterFor(mediaUrl: string, cdn: string, userAgent: string): Promise<Response> {
    // Follow redirects by hand so every hop stays on Mako's CDNs.
    let url = await makoTicketedMaster(mediaUrl, cdn);
    let r: Response | undefined;
    for (let hop = 0; hop < 5; hop++) {
      r = await deps.fetch(url, {
        headers: { 'user-agent': userAgent, referer: 'https://www.mako.co.il/' },
        redirect: 'manual',
      });
      const location = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
      if (!location) break;
      await r.body?.cancel();
      url = makoUrl(new URL(location, url).toString());
      r = undefined;
    }
    if (!r) return new Response('Mako master: too many redirects', { status: 502 });
    if (!r.ok) return new Response(`Mako master HTTP ${r.status}`, { status: r.status });
    const body = absolutize(await r.text(), url);
    return new Response(body, { headers: { 'content-type': HLS, 'cache-control': 'no-store' } });
  }

  const playerUA = (c: { req: { header(n: string): string | undefined } }) =>
    c.req.header('user-agent') ?? 'Mozilla/5.0 (Linux; Android) ExoPlayer';

  app.get('/play/mako/:file', async (c) => {
    const id = decodeURIComponent(c.req.param('file')).replace(/\.m3u8$/, '');
    const v = parseVideoId(id);
    const ep = v ? deps.episode(v.series, v.season, v.episode) : undefined;
    const play = ep?.play;
    if (!play?.vcmid || !play.channelId) return c.text('unknown episode', 404);
    try {
      const pr = await deps.fetch(
        makoPlaylistUrl({
          vcmid: play.vcmid,
          channelId: play.channelId,
          ...(play.galleryChannelId ? { galleryChannelId: play.galleryChannelId } : {}),
        }),
      );
      if (!pr.ok) return c.text(`Mako playlist HTTP ${pr.status}`, 502);
      const media = parsePlaylist(await pr.json());
      const pick = media.find((m) => m.cdn === 'AKAMAI') ?? media[0];
      if (!pick) return c.text('Mako returned no media', 502);
      return await makoMasterFor(makoUrl(pick.url), pick.cdn ?? 'AKAMAI', playerUA(c));
    } catch (err) {
      return c.text((err as Error).message, 502);
    }
  });

  app.get('/play/mako-live/:channel/:file', async (c) => {
    const ch = channels.find((x) => x.id === c.req.param('channel'));
    const m = ch?.mako?.[Number(c.req.param('file').replace(/\.m3u8$/, ''))];
    if (!m) return c.text('unknown channel', 404);
    try {
      return await makoMasterFor(`${m.host ?? MAKO_LIVE_HOST}${m.path}`, m.cdn ?? 'AKAMAI', playerUA(c));
    } catch (err) {
      return c.text((err as Error).message, 502);
    }
  });

  // ---- relay through the geo proxy -----------------------------------------------------------------

  app.get('/relay/:sig/:file', async (c) => {
    const geo = deps.geoFetch;
    if (!geo) return c.text('no geo proxy configured', 404);
    const sig = c.req.param('sig');
    const enc = c.req.param('file').replace(/\.(m3u8|ts|bin)$/, '');
    if (!verify(secret, enc, sig)) return c.text('bad signature', 403);
    const target = Buffer.from(enc, 'base64url').toString();
    let host: string;
    try {
      host = new URL(target).hostname;
    } catch {
      return c.text('bad url', 400);
    }
    if (!isRelayHost(host)) return c.text('host not allowed', 403);
    const range = c.req.header('range');
    // Follow redirects by hand so every hop is checked: a hop to a host that is not geo-gated goes back
    // to the player as a plain redirect; nothing else is fetched through the proxy.
    let url = target;
    let r: Response | undefined;
    for (let hop = 0; hop < 5; hop++) {
      try {
        r = await geo(url, {
          headers: { 'user-agent': playerUA(c), ...(range ? { range } : {}) },
          signal: AbortSignal.timeout(30_000),
          redirect: 'manual',
        });
      } catch (err) {
        const why = (err as Error).message;
        deps.onRelay?.({ ok: false, error: why });
        deps.log?.(`relay through the geo proxy failed for ${new URL(url).host}: ${why}`);
        return c.text(`geo proxy failed: ${why}`, 502);
      }
      const location = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
      if (!location) break;
      await r.body?.cancel();
      const next = new URL(location, url);
      if (next.protocol !== 'https:' && next.protocol !== 'http:') return c.text('bad redirect', 502);
      if (!isRelayHost(next.hostname)) return c.redirect(next.toString(), 302);
      url = next.toString();
      r = undefined;
    }
    if (!r) return c.text('too many redirects', 502);
    deps.onRelay?.(
      r.ok || r.status === 206
        ? { ok: true }
        : { ok: false, error: `upstream answered HTTP ${r.status} (is the proxy's exit in Israel?)` },
    );
    const type = r.headers.get('content-type') ?? '';
    const isPlaylist = /mpegurl/i.test(type) || /\.m3u8(\?|$)/.test(url);
    if (isPlaylist && r.ok) {
      const text = await r.text();
      // Relay nested playlists and segments too only for hosts on the list; others (signed CDN links that
      // are not geo-gated) go to the player directly.
      const origin = base(c);
      const body = absolutize(text, url, (abs) =>
        isRelayHost(new URL(abs).hostname) ? relayUrl(origin, abs) : abs,
      );
      return c.body(body, 200, { 'content-type': HLS, 'cache-control': 'no-store' });
    }
    const headers: Record<string, string> = { 'cache-control': 'no-store' };
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = r.headers.get(h);
      if (v) headers[h] = v;
    }
    return new Response(r.body, { status: r.status, headers });
  });

  app.notFound((c) => c.json({ error: 'not found' }, 404));
  return app;
}
