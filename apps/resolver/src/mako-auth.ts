// mako-auth: Mako playback. Mako tickets are short-lived and Akamai binds the session token to the User-Agent
// that fetched the master playlist, so the resolver hands out its own /play URL; each time the player opens it,
// this module gets a fresh ticket, fetches the master with the player's User-Agent and returns it (~1 KB) with
// absolute variant URLs. Video then flows player ↔ Mako's CDN directly: this module never carries video.
import {
  type LiveChannel,
  parseVideoId,
  probePrefix,
  rtl,
  type ScrapedEpisode,
  SOURCE_LABELS,
  type Stream,
} from '@israel-tv/core';
import { makoPlaylistUrl, parsePlaylist } from '@israel-tv/mako';
import type { Context, Hono } from 'hono';
import { absolutize, HLS, type ModuleContext, type Play, playerUA, withPlayId } from './context.ts';
import type { PlayInfo } from './sessions.ts';

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

export interface MakoAuthDeps extends ModuleContext {
  episode(
    series: string,
    season: number,
    episode: number,
  ): ScrapedEpisode | undefined | Promise<ScrapedEpisode | undefined>;
  channels: readonly LiveChannel[];
}

/** Upstream statuses of one play, filled in as it goes. */
interface PlayRun extends Play {
  up: string[];
  /**
   * Whose fault a failed play is: `episode` when Mako answered properly but this one title cannot be played
   * (every CDN refused its master with a valid ticket, no media listed), `source` otherwise.
   */
  blame?: 'episode' | 'source';
}

export function makoAuth(d: MakoAuthDeps) {
  /** Streams for a Mako episode or live channel (the play URLs point back at this module). */
  function streams(origin: string, play: Play, target: { video?: string; channel?: LiveChannel }): Stream[] {
    if (target.video) {
      return [
        {
          url: withPlayId(`${origin}/play/mako/${encodeURIComponent(target.video)}.m3u8`, play.playId),
          name: rtl(SOURCE_LABELS.mako ?? 'קשת 12'),
          title: 'דרך העוזר הביתי',
        },
      ];
    }
    return (target.channel?.mako ?? []).map((m, i) => ({
      url: withPlayId(`${origin}/play/mako-live/${target.channel?.id}/${i}.m3u8`, play.playId),
      name: rtl(target.channel?.name ?? 'קשת 12'),
      title: rtl(`${m.title} · דרך העוזר הביתי`),
    }));
  }

  async function ticketedMaster(mediaUrl: string, cdn: string, run: PlayRun): Promise<string> {
    const u = `${MAKO_ENTITLEMENT}?et=gt&lp=${encodeURIComponent(mediaUrl)}&rv=${encodeURIComponent(cdn)}`;
    const t0 = Date.now();
    const ticket = (outcome: 'ok' | 'error', status?: number, reason?: string) =>
      d.emit({
        kind: 'ticket_fetch',
        outcome,
        playId: run.playId,
        ...run.info,
        latencyMs: Date.now() - t0,
        ...(status !== undefined ? { status } : {}),
        ...(reason ? { detail: { reason } } : {}),
      });
    let r: Response;
    try {
      r = await d.fetch(u);
    } catch (err) {
      run.up.push('ticket failed');
      ticket('error', undefined, (err as Error).message);
      throw err;
    }
    run.up.push(`ticket ${r.status}`);
    if (!r.ok) {
      ticket('error', r.status, `Mako entitlement HTTP ${r.status}`);
      throw new Error(`Mako entitlement HTTP ${r.status}`);
    }
    const j = (await r.json()) as { tickets?: { ticket?: string; url?: string }[] };
    const t = j.tickets?.[0];
    if (!t?.ticket) {
      ticket('error', r.status, 'no ticket in the answer');
      throw new Error('Mako entitlement returned no ticket');
    }
    ticket('ok', r.status);
    // An empty `url` means the media URL itself; Akamai answers an absolute URL, CloudFront ("AWS") a path on
    // the media URL's host (measured 2026-11-07). One that already has a query gets the ticket appended to it.
    const base = makoUrl(new URL(t.url || mediaUrl, mediaUrl).toString());
    return `${base}${base.includes('?') ? '&' : '?'}${decodeURIComponent(t.ticket)}`;
  }

  async function masterFor(
    mediaUrl: string,
    cdn: string,
    userAgent: string,
    run: PlayRun,
  ): Promise<Response> {
    // Follow redirects by hand so every hop stays on Mako's CDNs.
    let url = await ticketedMaster(mediaUrl, cdn, run);
    let r: Response | undefined;
    for (let hop = 0; hop < 5; hop++) {
      r = await d.fetch(url, {
        headers: { 'user-agent': userAgent, referer: 'https://www.mako.co.il/' },
        redirect: 'manual',
      });
      run.up.push(`master ${r.status}`);
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

  /** Answer one play start and record it: a `play_start` (time to the playlist) or a `failure`. */
  async function recordPlay(
    c: Context,
    fallback: PlayInfo,
    work: (run: PlayRun) => Promise<Response>,
  ): Promise<Response> {
    const t0 = Date.now();
    const given = c.req.query('p');
    // A play URL opened without a play id (a hand-made request); internal checks say so with a header.
    const playId = given || `${probePrefix((h) => c.req.header(h))}direct-${t0.toString(36)}`;
    const client = await d.clientOf(c);
    const info: PlayInfo = { ...fallback, ...d.sessions.info(given), ...(client ? { client } : {}) };
    const run: PlayRun = { playId, info, up: [] };
    let res: Response;
    try {
      res = await work(run);
    } catch (err) {
      res = new Response((err as Error).message, { status: 502 });
    }
    const ms = Date.now() - t0;
    const upstream = run.up.join(', ');
    if (res.status < 400) {
      d.emit({
        kind: 'play_start',
        outcome: 'ok',
        playId,
        ...info,
        status: res.status,
        latencyMs: ms,
        detail: { upstream },
      });
      d.sessions.play(playId, info, ms);
      d.log('play started', { playId, ...info, ms, upstream });
    } else {
      const reason = (await res.clone().text()).slice(0, 300);
      const failed = /master (\d{3})/.exec(upstream.split(', ').at(-1) ?? '')?.[1];
      d.emit({
        kind: 'failure',
        outcome: 'error',
        playId,
        ...info,
        status: failed ? Number(failed) : res.status,
        latencyMs: ms,
        detail: { stage: 'play', answered: res.status, upstream, reason, blame: run.blame ?? 'source' },
      });
      d.log('play failed', { playId, ...info, status: res.status, upstream, reason });
    }
    return res;
  }

  function mount(app: Hono): void {
    app.get('/play/mako/:file', async (c) => {
      const id = decodeURIComponent(c.req.param('file')).replace(/\.m3u8$/, '');
      const v = parseVideoId(id);
      // Not an episode id at all (a probe, a typo): refused without recording a play or a failure.
      if (!v) return c.text('unknown episode', 404);
      return recordPlay(c, { source: 'mako', episodeId: id, showId: v.series }, async (run) => {
        const ep = await d.episode(v.series, v.season, v.episode);
        const play = ep?.play;
        if (!play?.vcmid || !play.channelId) return new Response('unknown episode', { status: 404 });
        const pr = await d.fetch(
          makoPlaylistUrl({
            vcmid: play.vcmid,
            channelId: play.channelId,
            ...(play.galleryChannelId ? { galleryChannelId: play.galleryChannelId } : {}),
          }),
        );
        run.up.push(`playlist ${pr.status}`);
        if (!pr.ok) return new Response(`Mako playlist HTTP ${pr.status}`, { status: 502 });
        const media = parsePlaylist(await pr.json());
        if (media.length === 0) {
          run.blame = 'episode';
          return new Response('Mako returned no media', { status: 502 });
        }
        // Akamai first; when it refuses the master (e.g. an episode still airing, served from the live
        // window), the next CDN Mako lists usually plays.
        const ordered = [
          ...media.filter((m) => m.cdn === 'AKAMAI'),
          ...media.filter((m) => m.cdn !== 'AKAMAI'),
        ];
        let last: Response | undefined;
        let thrown: unknown;
        for (const m of ordered) {
          run.up.push(`cdn ${m.cdn ?? '?'}`);
          try {
            last = await masterFor(makoUrl(m.url), m.cdn ?? 'AKAMAI', playerUA(c), run);
          } catch (err) {
            // No ticket on this CDN (refused, or none in the answer): the next one may still give one.
            thrown = err;
            continue;
          }
          if (last.ok) return last;
        }
        if (!last) throw thrown;
        // Tickets were issued, yet every CDN refused the master: this title, not Mako, is the problem
        // (seen for a few minutes on a freshly published episode before its files reach Akamai).
        if (last && last.status >= 400 && last.status < 500) run.blame = 'episode';
        return last as Response;
      });
    });

    app.get('/play/mako-live/:channel/:file', async (c) => {
      const chId = c.req.param('channel');
      return recordPlay(c, { source: 'live', showId: chId }, async (run) => {
        const ch = d.channels.find((x) => x.id === chId);
        const m = ch?.mako?.[Number(c.req.param('file').replace(/\.m3u8$/, ''))];
        if (!m) return new Response('unknown channel', { status: 404 });
        return masterFor(`${m.host ?? MAKO_LIVE_HOST}${m.path}`, m.cdn ?? 'AKAMAI', playerUA(c), run);
      });
    });
  }

  return { streams, mount };
}
