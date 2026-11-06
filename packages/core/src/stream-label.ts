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
 * The best quality of a stream, when its source's renditions are known (measured 2026-11-06): Kan names its
 * ladder in the address (`…_1080_KAN/…`); Reshet's Kaltura masters top out at 720p (every sampled episode).
 */
export function streamQuality(source: string, url: string): string | undefined {
  if (source === 'kan') {
    const m = /_(\d{3,4})_KAN\//i.exec(url);
    return m ? `${m[1]}p` : undefined;
  }
  if (source === 'reshet' && /kaltura\.com\//.test(url)) return '720p';
  return undefined;
}

/** "רשת 13 · 720p", or the source alone when its quality is not known. */
export function streamName(source: string, url = ''): string {
  const label = SOURCE_LABELS[source] ?? 'Israel TV';
  const q = streamQuality(source, url);
  return q ? `${label} · ${q}` : label;
}
