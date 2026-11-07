import { rtl } from './tidy.ts';

// What a stream says in the app's stream list: its source and best quality as the name ("רשת 13 · 720p"), and
// in the title what to expect (the episode, and plainly when it plays only from Israel).

export const SOURCE_LABELS: Record<string, string> = {
  mako: 'קשת 12',
  reshet: 'רשת 13',
  kan: 'כאן',
  live: 'שידור חי',
};

/** Said on a stream that plays only from an Israeli connection. */
export const ISRAEL_ONLY = 'זמין לצפייה רק בישראל';

/**
 * The best quality of a stream when its address says it: Kan names its ladder there (`…_1080_KAN/…`). Others are
 * measured from the playlist (apps/ingest stream-probe.ts: Reshet episodes top out at 540p or 720p) and passed in.
 */
export function streamQuality(source: string, url: string): string | undefined {
  if (source === 'kan') {
    const m = /_(\d{3,4})_KAN\//i.exec(url);
    return m ? `${m[1]}p` : undefined;
  }
  return undefined;
}

/** "רשת 13 · 720p", or the source alone when its quality is not known. `measured` wins over the address. */
export function streamName(source: string, url = '', measured?: string): string {
  const label = SOURCE_LABELS[source] ?? 'Israel TV';
  const q = measured ?? streamQuality(source, url);
  return rtl(q ? `${label} · ${q}` : label);
}
