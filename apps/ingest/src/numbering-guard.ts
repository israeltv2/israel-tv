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
 * After a recorded migration moved some of one show's episodes on purpose: those episodes' stored numbers are their
 * history from now on. Nothing else is taken over, so any other move (in this show or another) still stops a publish.
 */
export function sanctionMoves(store: Store, seriesId: string, keys: readonly string[]): void {
  const history = store.getState<Record<string, string>>(NUMBERING_HISTORY);
  if (!history) {
    sanctionNumbering(store);
    return;
  }
  const now = store.numberingNow();
  for (const key of keys) {
    const k = `${seriesId}|${key}`;
    if (now[k] !== undefined) history[k] = now[k];
  }
  store.setState(NUMBERING_HISTORY, history);
}
