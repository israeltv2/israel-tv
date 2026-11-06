// Staleness: the public catalog says so itself when it has not been updated for too long — computed where it is
// served (the Worker), so it works even when the home machine is down and cannot publish anything.

/** Published with every catalog (`freshness.json`). */
export interface Freshness {
  /** When the catalog was rendered (rounded down to 6 hours, so a quiet catalog still refreshes it). */
  publishedAt: string;
  /** Per source: the last good read, and how often a good read is expected. */
  sources: Record<string, { lastGoodAt?: string; cadenceHours: number }>;
  /** Catalog row id → its source. */
  catalogs: Record<string, string>;
}

/** The catalog counts as not updated after this long without a publish. */
export const STALE_PUBLISH_HOURS = 36;
/** Warning items for stale rows have ids starting with this. */
export const STALE_ID_PREFIX = 'iltv_stale_';

const HOUR = 3_600_000;

/** Round down to 6 hours (see `publishedAt`). */
export function freshnessStamp(now = Date.now()): string {
  return new Date(Math.floor(now / (6 * HOUR)) * 6 * HOUR).toISOString();
}

/** When a row counts as not updated, the time it was last updated; else undefined. */
export function staleSince(f: Freshness, catalog: string, now = Date.now()): string | undefined {
  if (now - Date.parse(f.publishedAt) > STALE_PUBLISH_HOURS * HOUR) return f.publishedAt;
  const src = f.sources[f.catalogs[catalog] ?? ''];
  if (src?.lastGoodAt && now - Date.parse(src.lastGoodAt) > src.cadenceHours * 2 * HOUR)
    return src.lastGoodAt;
  return undefined;
}

/** The warning item shown first in a stale row (and its page). */
export function staleItem(catalog: string, type: string, since: string) {
  const when = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(since));
  const name = `⚠ הקטלוג לא עודכן מאז ${when}`;
  return {
    id: `${STALE_ID_PREFIX}${catalog}`,
    type,
    name,
    description: `${name}. New episodes may be missing until it is updated again (catalog not updated since ${since.slice(0, 16).replace('T', ' ')} UTC).`,
    posterShape: type === 'tv' ? 'square' : 'poster',
  };
}
