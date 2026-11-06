// Kaltura (partner 2748741) lookups: which entries are blocked from where this runs.
import { KALTURA_PARTNER } from './parse.ts';

const API = 'https://cdnapisec.kaltura.com/api_v3/service/multirequest';

type Post = (body: unknown) => Promise<unknown>;

export const kalturaPost: Post = async (body) => {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`Kaltura API HTTP ${r.status}`);
  return r.json();
};

const session = { service: 'session', action: 'startWidgetSession', widgetId: `_${KALTURA_PARTNER}` };
const base = { apiVersion: '3.3.0', format: 1, partnerId: KALTURA_PARTNER };

function check(r: unknown, i: number): Record<string, unknown> {
  const x = (r as unknown[])[i] as Record<string, unknown> | undefined;
  if (!x || x.objectType === 'KalturaAPIException')
    throw new Error(`Kaltura: ${String(x?.message ?? 'no result')}`);
  return x;
}

/**
 * Entry id → blocked here (true/false). Entries share access-control profiles, so each profile is
 * checked once (with one of its entries) and remembered in `profiles` across calls.
 */
export async function blockedEntries(
  entryIds: string[],
  profiles: Map<number, boolean>,
  post: Post = kalturaPost,
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  for (let i = 0; i < entryIds.length; i += 500) {
    const chunk = entryIds.slice(i, i + 500);
    const r = await post({
      ...base,
      1: session,
      2: {
        service: 'baseEntry',
        action: 'list',
        ks: '{1:result:ks}',
        filter: { idIn: chunk.join(',') },
        pager: { pageSize: 500 },
        responseProfile: { type: 1, fields: 'id,accessControlId' },
      },
    });
    const objects = (check(r, 1).objects ?? []) as { id: string; accessControlId?: number }[];
    for (const o of objects) {
      const profile = o.accessControlId ?? 0;
      if (!profiles.has(profile)) {
        const pc = check(
          await post({
            ...base,
            1: session,
            2: {
              service: 'baseEntry',
              action: 'getPlaybackContext',
              entryId: o.id,
              ks: '{1:result:ks}',
              contextDataParams: { objectType: 'KalturaContextDataParams', flavorTags: 'all' },
            },
          }),
          1,
        );
        const actions = (pc.actions ?? []) as { objectType?: string }[];
        profiles.set(
          profile,
          actions.some((a) => a.objectType === 'KalturaAccessControlBlockAction'),
        );
      }
      out.set(o.id, profiles.get(profile) ?? false);
    }
  }
  return out;
}
