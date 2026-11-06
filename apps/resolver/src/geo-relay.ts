// geo-relay: geo-blocked Reshet and Kan video through the configured geo proxy — the only part of the system
// that carries video. It relays a title only when its direct stream is refused from this network (the resolver
// runs on the viewer's network), and fetches through the proxy only URLs it signed itself, on allowed hosts,
// checking every redirect hop.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Stream } from '@israel-tv/core';
import type { GeoFetch } from '@israel-tv/net';
import type { Context, Hono } from 'hono';
import { absolutize, HLS, type ModuleContext, type Play, playerUA, withPlayId } from './context.ts';

/** Hosts the relay may fetch through the geo proxy. */
export const RELAY_HOSTS = [/(^|\.)cdn-redge\.media$/, /(^|\.)kan\.org\.il$/, /^cdnapisec\.kaltura\.com$/];

const isRelayHost = (hostname: string) => RELAY_HOSTS.some((re) => re.test(hostname));

const sign = (secret: Buffer, s: string) =>
  createHmac('sha256', secret).update(s).digest('base64url').slice(0, 22);

function verify(secret: Buffer, s: string, sig: string): boolean {
  const a = Buffer.from(sign(secret, s));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A direct stream is re-checked after this long. */
const PROBE_TTL_MS = 6 * 3_600_000;

export interface GeoRelayDeps extends ModuleContext {
  geoFetch: GeoFetch;
  /** Secret for signing relay URLs. */
  secret: Buffer;
  /** Outcome of each relay through the geo proxy (for /status). */
  onRelay?: (r: { ok: boolean; error?: string }) => void;
}

export function geoRelay(d: GeoRelayDeps) {
  const probes = new Map<string, { blocked: boolean; note: string; at: number }>();

  /** Whether `url` is refused from this network (cached per key, e.g. per show). */
  async function blockedHere(key: string, url: string): Promise<{ blocked: boolean; note: string }> {
    const hit = probes.get(key);
    if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit;
    let result: { blocked: boolean; note: string };
    // Only a broadcaster's own https host is probed (and could be relayed): a catalog cannot make this resolver
    // reach anything else.
    let target: URL | undefined;
    try {
      target = new URL(url);
    } catch {}
    if (target?.protocol !== 'https:' || !isRelayHost(target.hostname)) {
      result = { blocked: false, note: 'not a broadcaster host: not probed, not relayed' };
      probes.set(key, { ...result, at: Date.now() });
      return result;
    }
    try {
      const r = await d.fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android) ExoPlayer' },
        signal: AbortSignal.timeout(4000),
      });
      await r.body?.cancel();
      result =
        r.status === 401 || r.status === 403 || r.status === 451
          ? { blocked: true, note: `direct refused here (HTTP ${r.status}): relayed` }
          : r.ok
            ? { blocked: false, note: 'direct plays here: not relayed' }
            : { blocked: true, note: `direct answered HTTP ${r.status}: relayed` };
    } catch (err) {
      // Could not tell: offer the relay rather than nothing.
      result = { blocked: true, note: `direct probe failed (${(err as Error).message}): relayed` };
    }
    probes.set(key, { ...result, at: Date.now() });
    if (probes.size > 2000) probes.delete(probes.keys().next().value as string);
    return result;
  }

  function relayUrl(origin: string, url: string, playId?: string): string {
    const u = Buffer.from(url).toString('base64url');
    // Named by what it is: a playlist when its path ends in .m3u8 (or is Kaltura's playManifest), else a segment.
    const ext =
      /\.m3u8$/.test(new URL(url).pathname) || /\/playManifest\//.test(new URL(url).pathname) ? 'm3u8' : 'ts';
    const path = `${origin}/relay/${sign(d.secret, u)}/${u}.${ext}`;
    return playId ? withPlayId(path, playId) : path;
  }

  /**
   * The relayed stream for a direct URL, only when the direct stream is refused here. `directPlays` says the
   * resolver offers nothing on purpose (the public addon's direct stream plays).
   */
  async function streamFor(
    origin: string,
    play: Play,
    key: string,
    url: string,
    title: string,
    name = 'Israel TV',
  ): Promise<{ stream?: Stream; note: string; directPlays: boolean }> {
    const probe = await blockedHere(key, url);
    if (!probe.blocked) return { note: probe.note, directPlays: true };
    return {
      stream: { url: relayUrl(origin, url, play.playId), name, title },
      note: probe.note,
      directPlays: false,
    };
  }

  async function relay(
    c: Context,
    playId: string | undefined,
    note: { error?: string; rejected?: boolean },
  ): Promise<Response> {
    const fail = (msg: string, status: 400 | 403 | 502) => {
      note.error = msg;
      return c.text(msg, status);
    };
    /** A refusal of the request itself (forged or not ours): not a play, so not recorded. */
    const reject = (msg: string, status: 400 | 403) => {
      note.rejected = true;
      return fail(msg, status);
    };
    const sig = c.req.param('sig') ?? '';
    const enc = (c.req.param('file') ?? '').replace(/\.(m3u8|ts|bin)$/, '');
    if (!verify(d.secret, enc, sig)) return reject('bad signature', 403);
    const target = Buffer.from(enc, 'base64url').toString();
    let host: string;
    try {
      host = new URL(target).hostname;
    } catch {
      return reject('bad url', 400);
    }
    if (!isRelayHost(host)) return reject('host not allowed', 403);
    const range = c.req.header('range');
    // Follow redirects by hand so every hop is checked: a hop to a host that is not geo-gated goes back
    // to the player as a plain redirect; nothing else is fetched through the proxy.
    let url = target;
    let r: Response | undefined;
    let rotated = false;
    for (let hop = 0; hop < 5; hop++) {
      try {
        r = await d.geoFetch(url, {
          headers: { 'user-agent': playerUA(c), ...(range ? { range } : {}) },
          signal: AbortSignal.timeout(30_000),
          redirect: 'manual',
        });
      } catch (err) {
        const why = (err as Error).message;
        d.onRelay?.({ ok: false, error: why });
        d.log('relay through the geo proxy failed', { playId, host: new URL(url).host, error: why });
        return fail(`geo proxy failed: ${why}`, 502);
      }
      // A refusal can be the exit's fault (a CDN that does not see this exit as Israeli): once per request, try
      // the next exit before giving up.
      if ((r.status === 401 || r.status === 403) && !rotated && d.geoFetch.rotate) {
        rotated = true;
        await r.body?.cancel();
        const exit = d.geoFetch.rotate();
        d.log('relay refused through this exit; trying the next one', {
          playId,
          host: new URL(url).host,
          status: r.status,
          exit,
        });
        hop--;
        r = undefined;
        continue;
      }
      const location = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
      if (!location) break;
      await r.body?.cancel();
      const next = new URL(location, url);
      if (next.protocol !== 'https:' && next.protocol !== 'http:') return fail('bad redirect', 502);
      if (!isRelayHost(next.hostname)) return c.redirect(next.toString(), 302);
      url = next.toString();
      r = undefined;
    }
    if (!r) return fail('too many redirects', 502);
    const upstreamOk = r.ok || r.status === 206;
    d.onRelay?.(
      upstreamOk
        ? { ok: true }
        : { ok: false, error: `upstream answered HTTP ${r.status} (is the proxy's exit in Israel?)` },
    );
    if (!upstreamOk) note.error = `upstream HTTP ${r.status}`;
    const type = r.headers.get('content-type') ?? '';
    const isPlaylist = /mpegurl/i.test(type) || /\.m3u8(\?|$)/.test(url);
    if (isPlaylist && r.ok) {
      const text = await r.text();
      // Relay nested playlists and segments too only for hosts on the list; others (signed CDN links that
      // are not geo-gated) go to the player directly.
      const origin = new URL(c.req.url).origin;
      const body = absolutize(text, url, (abs) =>
        isRelayHost(new URL(abs).hostname) ? relayUrl(origin, abs, playId) : abs,
      );
      return c.body(body, 200, { 'content-type': HLS, 'cache-control': 'no-store' });
    }
    const headers: Record<string, string> = { 'cache-control': 'no-store' };
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = r.headers.get(h);
      if (v) headers[h] = v;
    }
    return new Response(r.body, { status: r.status, headers });
  }

  function mount(app: Hono): void {
    app.get('/relay/:sig/:file', async (c) => {
      const t0 = Date.now();
      const playId = c.req.query('p');
      const note: { error?: string; rejected?: boolean } = {};
      const res = await relay(c, playId, note);
      if (!playId || note.rejected) return res;
      const playlist = /mpegurl/i.test(res.headers.get('content-type') ?? '');
      const info = d.sessions.info(playId);
      d.sessions.relay(playId, info, {
        playlist,
        ms: Date.now() - t0,
        status: res.status,
        ...(note.error ? { error: note.error } : {}),
      });
      // A failed playlist is a failed play; failed segments are counted in the session's one event.
      if (note.error && (c.req.param('file') ?? '').endsWith('.m3u8')) {
        d.emit({
          kind: 'failure',
          outcome: 'error',
          playId,
          ...info,
          status: res.status,
          detail: { stage: 'relay', reason: note.error },
        });
      }
      // Count the bytes as they stream to the player.
      if (!playlist && res.body && res.status < 400) {
        const counted = res.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, ctl) {
              d.sessions.addBytes(playId, chunk.byteLength);
              ctl.enqueue(chunk);
            },
          }),
        );
        return new Response(counted, { status: res.status, headers: res.headers });
      }
      return res;
    });
  }

  return { streamFor, mount };
}
