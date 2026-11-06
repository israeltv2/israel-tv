// Live channels: render entries and a health check of their direct streams.
import { ISRAEL_ONLY, LIVE_CHANNELS, type LiveChannel, ORIGIN_TOKEN, sitePaths } from '@israel-tv/core';
import type { LiveChannelRender } from '@israel-tv/render';
import type { Store } from '@israel-tv/store';
import { runStatus } from './runner.ts';

/** Live channels for rendering; `logos` are the channel ids that have a logo tile among the site's images. */
export function liveRender(logos: ReadonlySet<string> = new Set()): LiveChannelRender[] {
  return LIVE_CHANNELS.map((c) => ({
    id: c.id,
    name: c.name,
    ...(logos.has(c.id) ? { logo: `${ORIGIN_TOKEN}/${sitePaths.channelLogo(c.id)}` } : {}),
    description: c.description,
    streams: c.direct.map((l) => ({
      url: l.url,
      name: c.name,
      title: c.geo ? `${l.title} · ${ISRAEL_ONLY}` : l.title,
    })),
  }));
}

async function probe(url: string): Promise<number> {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    const text = r.ok ? await r.text() : '';
    return r.ok && text.includes('#EXTM3U') ? 200 : r.status || 0;
  } catch {
    return 0;
  }
}

/** Check the first direct stream of every channel (Mako channels need the resolver and are skipped). */
export async function checkLive(
  store: Store,
  channels: readonly LiveChannel[] = LIVE_CHANNELS,
): Promise<{ ok: number; failed: string[] }> {
  const runId = store.startRun('full', 'live');
  const failed: string[] = [];
  let ok = 0;
  for (const c of channels) {
    if (c.direct.length === 0) continue;
    // The first link that answers counts; a channel is down only when none do.
    let status = 0;
    for (const l of c.direct) {
      status = await probe(l.url);
      if (status === 200) break;
    }
    if (status === 200) ok++;
    else failed.push(`${c.name} (HTTP ${status || 'no answer'})`);
  }
  store.finishRun(runId, {
    status: runStatus(ok, failed.length),
    showsOk: ok,
    showsFailed: failed.length,
    ...(failed.length ? { error: `not answering: ${failed.join(', ')}` } : {}),
  });
  return { ok, failed };
}
