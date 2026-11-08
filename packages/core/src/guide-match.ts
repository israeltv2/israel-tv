// Which show in the catalog a programme in the guide is, by its title. Conservative on purpose: a wrong link sends a
// viewer to the wrong show, a missing one only leaves the programme as plain text. A programme is matched only to
// its own broadcaster's shows (Channel 14's "חמש" is not Reshet 13's "חמש"), only on the whole title or the title
// before an episode or season part ("בוש - עונה 7 - פרק 6" → "בוש"), and never when two shows share that title.
import { normalizeForSearch } from './hebrew.ts';

/** The catalog rows each channel's programmes may be matched to, most likely first. */
export const CHANNEL_ROWS: Readonly<Record<string, readonly string[]>> = {
  iltv_live_keshet12: ['iltv_keshet12'],
  iltv_live_ch24: ['iltv_keshet12'],
  iltv_live_k12comedy: ['iltv_keshet12'],
  iltv_live_k12drama: ['iltv_keshet12'],
  iltv_live_k12music: ['iltv_keshet12'],
  iltv_live_k12food: ['iltv_keshet12'],
  iltv_live_erets: ['iltv_keshet12'],
  iltv_live_savri: ['iltv_keshet12'],
  iltv_live_reshet13: ['iltv_reshet13'],
  iltv_live_r13comedy: ['iltv_reshet13'],
  iltv_live_r13nofesh: ['iltv_reshet13'],
  iltv_live_r13reality: ['iltv_reshet13'],
  iltv_live_kan11: ['iltv_kan11', 'iltv_kanarchive', 'iltv_kankids'],
  iltv_live_kanedu: ['iltv_kankids', 'iltv_kan11', 'iltv_kanarchive'],
  iltv_live_makan33: ['iltv_kan11', 'iltv_kankids', 'iltv_kanarchive'],
};

/** A "new" or "premiere" mark before the title ("חדש!הסדרתיים 2"). */
const LEAD = /^\s*(?:חדש|בכורה)\s*!\s*/;
/**
 * Where the episode or season part starts: a dash with a space on at least one side ("בוש - עונה 7", "פופיק 5-
 * פופיק"), or a dash right before a season, episode or week ("קופה ראשית-עונה חדשה"). A dash inside a word or
 * number ("המתחם ה-25") is part of the title.
 */
const PART = /\s+[-–—]\s*|\s*[-–—]\s+|[-–—](?=עונה|פרק|שבוע|חלק)/u;
/** A trailing season number ("הבלתי חשובים 3", "בני מצווה 3") or season word ("עונה 2"). */
const SEASON_TAIL = /\s+(?:עונה\s+)?\d{1,2}$/;

/**
 * The normalized forms a programme title may have in the catalog, most specific first: the whole title, the title
 * before its episode part, and that without a trailing season number.
 */
export function programmeKeys(title: string): string[] {
  const t = title.replace(LEAD, '').trim();
  const head = t.split(PART)[0]?.trim() ?? t;
  const bare = head.replace(SEASON_TAIL, '').trim();
  const keys = [t, head, ...(bare.length >= 3 ? [bare] : [])].map(normalizeForSearch).filter(Boolean);
  return [...new Set(keys)];
}

export interface MatchShow {
  id: string;
  catalog: string;
  title: string;
}

/**
 * A matcher over the catalog's shows: (channel, programme title) → the show's id, or undefined when no show (or more
 * than one) has that title in the rows the channel's broadcaster fills.
 */
export function guideMatcher(
  shows: readonly MatchShow[],
): (channel: string, title: string) => string | undefined {
  // row → normalized title → ids
  const byRow = new Map<string, Map<string, string[]>>();
  for (const s of shows) {
    const key = normalizeForSearch(s.title);
    if (!key) continue;
    const row = byRow.get(s.catalog) ?? new Map<string, string[]>();
    row.set(key, [...(row.get(key) ?? []), s.id]);
    byRow.set(s.catalog, row);
  }
  const memo = new Map<string, string | undefined>();
  return (channel, title) => {
    const rows = CHANNEL_ROWS[channel];
    if (!rows) return undefined;
    const memoKey = `${channel}\n${title}`;
    if (memo.has(memoKey)) return memo.get(memoKey);
    let found: string | undefined;
    search: for (const key of programmeKeys(title))
      for (const row of rows) {
        const ids = byRow.get(row)?.get(key);
        if (!ids) continue;
        // Two shows of one title: no guess.
        if (ids.length === 1) found = ids[0];
        break search;
      }
    memo.set(memoKey, found);
    return found;
  };
}
