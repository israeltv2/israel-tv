// The live programme guide as published (`epg.json`) and what the addon makes of it: "now / next" lines for the
// live tiles (every app shows them), and Stremio's guide grid (apps with EPG support ask for a `date` page of the
// live row: docs/epg.md of the Stremio addon SDK). Programmes are never put on a channel's own meta page: Nuvio
// shows any item with videos as a series (an episode list instead of a play button).

/** One programme: [start, end] in epoch ms, its title, and (when the broadcaster gives them) a blurb and a picture. */
export type GuideRow = [start: number, end: number, title: string, description?: string, image?: string];
/** epg.json: channel id → its programmes, by start time. */
export type GuideFile = Record<string, GuideRow[]>;

const time = new Map<string, Intl.DateTimeFormat>();
/** "21:00" in the broadcaster's time zone. */
export function clock(ms: number, timeZone = 'Asia/Jerusalem'): string {
  let f = time.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    time.set(timeZone, f);
  }
  return f.format(ms);
}

/** What is on now and what comes next. */
export function nowNext(rows: readonly GuideRow[], now: number): { now?: GuideRow; next?: GuideRow } {
  const i = rows.findIndex((r) => r[0] <= now && now < r[1]);
  if (i >= 0) return { now: rows[i] as GuideRow, ...(rows[i + 1] ? { next: rows[i + 1] as GuideRow } : {}) };
  const next = rows.find((r) => r[0] > now);
  return next ? { next } : {};
}

/** "עכשיו: חדשות 12 (עד 21:00) · אחר כך 21:00: הישרדות", or undefined without a guide for now. */
export function guideLine(rows: readonly GuideRow[] | undefined, now: number): string | undefined {
  if (!rows?.length) return undefined;
  const { now: on, next } = nowNext(rows, now);
  const parts = [
    ...(on ? [`עכשיו: ${on[2]} (עד ${clock(on[1])})`] : []),
    ...(next ? [`אחר כך ${clock(next[0])}: ${next[2]}`] : []),
  ];
  return parts.length ? parts.join(' · ') : undefined;
}

/** A programme as a guide entry (Stremio EPG: id, title, released, startTime, endTime; the rest optional). */
export interface GuideVideo {
  id: string;
  title: string;
  released: string;
  startTime: string;
  endTime: string;
  runtime?: string;
  overview?: string;
  thumbnail?: string;
}

/** A channel's programmes that overlap [from, to), as guide entries. */
export function guideVideos(
  channelId: string,
  rows: readonly GuideRow[],
  from: number,
  to: number,
): GuideVideo[] {
  return rows
    .filter(([s, e]) => e > from && s < to && e > s)
    .map(([s, e, title, overview, thumbnail]) => {
      const startTime = new Date(s).toISOString();
      return {
        id: `${channelId}:epg:${startTime}`,
        title,
        released: startTime,
        startTime,
        endTime: new Date(e).toISOString(),
        runtime: `${Math.round((e - s) / 60_000)} min`,
        ...(overview ? { overview } : {}),
        ...(thumbnail ? { thumbnail } : {}),
      };
    });
}

/** A live channel id, also when an app asks for one of its guide entries (`iltv_live_kan11:epg:<start>`). */
export function liveChannelOf(id: string): string | undefined {
  const m = /^(iltv_live_[a-z0-9]+)(?::epg:.*)?$/.exec(id);
  return m?.[1];
}
