// The numbering guard. Apps keep watch progress by series:season:episode, so a number, once published, never
// moves. Numbers are only ever added, except by a recorded one-time migration (renumber.ts), which re-takes the
// history when it is done. Before every publish the guard compares what is stored with the history: an episode
// that moved (or vanished) outside a migration stops the publish, and /status says which. The rules that assign
// numbers are frozen too (packages/core/test/numbering-frozen.test.ts).
import { NUMBERING_HISTORY, type Store } from '@israel-tv/store';

export type GuardResult = { ok: true; added: number } | { ok: false; moved: number; examples: string[] };

export function checkNumbering(store: Store): GuardResult {
  const now = store.numberingNow();
  const history = store.getState<Record<string, string>>(NUMBERING_HISTORY);
  if (!history) {
    store.setState(NUMBERING_HISTORY, now);
    return { ok: true, added: Object.keys(now).length };
  }
  const examples: string[] = [];
  let moved = 0;
  for (const [key, was] of Object.entries(history)) {
    const is = now[key];
    if (is === was) continue;
    moved++;
    if (examples.length < 5) {
      const [series, episode] = key.split('|');
      examples.push(`${series} ${episode}: ${was} → ${is ?? 'gone'}`);
    }
  }
  if (moved > 0) return { ok: false, moved, examples };
  const added = Object.keys(now).length - Object.keys(history).length;
  if (added > 0) store.setState(NUMBERING_HISTORY, now);
  return { ok: true, added };
}

/** After a recorded migration moved numbers on purpose: the stored numbers are the history from now on. */
export function sanctionNumbering(store: Store): void {
  store.setState(NUMBERING_HISTORY, store.numberingNow());
}

/**
 * After a recorded migration moved one show's numbers on purpose: that show's stored numbers are its history from
 * now on; every other show's history stays as it was (a move elsewhere still stops the publish).
 */
export function sanctionShow(store: Store, seriesId: string): void {
  const history = store.getState<Record<string, string>>(NUMBERING_HISTORY);
  if (!history) {
    sanctionNumbering(store);
    return;
  }
  const prefix = `${seriesId}|`;
  const next = Object.fromEntries(Object.entries(history).filter(([k]) => !k.startsWith(prefix)));
  for (const [k, v] of Object.entries(store.numberingNow())) if (k.startsWith(prefix)) next[k] = v;
  store.setState(NUMBERING_HISTORY, next);
}
