// Live channels: render entries and a health check of their direct streams.
import { LIVE_CHANNELS, type LiveChannel } from '@israel-tv/core';
import type { LiveChannelRender } from '@israel-tv/render';
import type { Store } from '@israel-tv/store';

export function liveRender(): LiveChannelRender[] {
  return LIVE_CHANNELS.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    streams: c.direct.map((l) => ({
      url: l.url,
      name: 'Israel TV',
      title: c.geo ? `${l.title} · ייתכן חסום מחוץ לישראל` : l.title,
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
    const first = c.direct[0];
    if (!first) continue;
    let status = await probe(first.url);
    // Fall back to the next link before calling the channel down.
    for (const alt of c.direct.slice(1)) {
      if (status === 200) break;
      status = await probe(alt.url);
    }
    if (status === 200) ok++;
    else failed.push(`${c.name} (HTTP ${status || 'no answer'})`);
  }
  store.finishRun(runId, {
    status: failed.length === 0 ? 'ok' : ok === 0 ? 'failed' : 'partial',
    showsOk: ok,
    showsFailed: failed.length,
    ...(failed.length ? { error: `not answering: ${failed.join(', ')}` } : {}),
  });
  return { ok, failed };
}
