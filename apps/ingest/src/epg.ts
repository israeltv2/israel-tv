// The live programme guide, from the broadcasters' own schedule pages (measured 2026-11-07; never third-party
// guide files of unknown licence). Each reader turns one page into programmes; `refreshGuides` reads the pages
// that are due and keeps the last good guide per channel in the store; the publisher writes `epg.json`.
//   Keshet 12  mako.co.il EPGResponse (JSON, UTC start + duration)      read through the Mako scraper, every 6 h
//   Reshet 13  13tv.co.il/tv-guide/ (__NEXT_DATA__ broadcastWeek)       read through the Reshet scraper, every 6 h
//   Channel 14 c14.co.il/wp-json/now14-api/v1/shidurim (JSON)            every 6 h (robots.txt allows /wp-json/)
//   Knesset    knesset.tv schedule page (HTML, ~3.6 MB, all days)        every 12 h
//   Kan 11, Kan Educational, Makan 33: kan.org.il/tv-guide/ (HTML)      read by the Kan crawler's browser (kan.ts)
// Not covered: i24 (its API holds an undated weekly template its own site no longer shows), Channel 10 (behind a
// bot checkpoint), Channel 24, ynet and the 24/7 loop channels (no schedule published).
import {
  type Config,
  DAY_MS,
  type GuideFile,
  type GuideRow,
  HOUR_MS,
  nextDay,
  tidyText,
  zonedTime,
} from '@israel-tv/core';
import { createFetcher, type Fetcher } from '@israel-tv/net';
import type { Store } from '@israel-tv/store';
import { z } from 'zod';

export const GUIDE_KEY = 'epg:guide';
const TZ = 'Asia/Jerusalem';

interface ChannelGuide {
  at: string;
  rows: GuideRow[];
  /** The last read failed (the rows are the last good ones). */
  error?: string;
}
export type GuideState = Record<string, ChannelGuide>;

/** A programme read from a page, before ends are filled in. */
interface Item {
  start: number;
  end?: number | undefined;
  title: string;
  description?: string | undefined;
  image?: string | undefined;
}

const clean = (s: string | null | undefined) => {
  const t = tidyText((s ?? '').replace(/<[^>]+>/g, ' '));
  return t || undefined;
};

/** At most this many programmes per channel from one read (two weeks of a busy channel), titles this long. */
const MAX_ROWS = 1500;
const MAX_TITLE = 120;

/** Programmes by start, with a missing end taken from the next start (the last one gets an hour). */
export function toRows(items: Item[]): GuideRow[] {
  const sorted = items
    .map((i) => ({ ...i, title: i.title.slice(0, MAX_TITLE) }))
    .filter((i) => Number.isFinite(i.start) && i.title)
    .sort((a, b) => a.start - b.start)
    .filter((i, n, all) => n === 0 || i.start !== all[n - 1]?.start);
  return sorted.slice(0, MAX_ROWS).map((i, n) => {
    const end = i.end ?? sorted[n + 1]?.start ?? i.start + HOUR_MS;
    // A programme never runs past the next one's start, nor longer than a day.
    const row: GuideRow = [i.start, Math.min(end, sorted[n + 1]?.start ?? end, i.start + DAY_MS), i.title];
    const desc = i.description && i.description !== i.title ? i.description.slice(0, 300) : undefined;
    if (desc || i.image) row.push(desc ?? '');
    if (i.image) row.push(i.image);
    return row;
  });
}

const MakoGuide = z.looseObject({
  programs: z.array(
    z.looseObject({
      ProgramName: z.string(),
      EventDescription: z.string().nullish(),
      StartTimeUTC: z.number(),
      DurationMs: z.number().nullish(),
      Picture: z.string().nullish(),
    }),
  ),
});

/** Keshet 12: start in UTC epoch ms, a duration. */
export function parseMakoGuide(raw: unknown): GuideRow[] {
  return toRows(
    MakoGuide.parse(raw).programs.map((p) => ({
      start: p.StartTimeUTC,
      ...(p.DurationMs ? { end: p.StartTimeUTC + p.DurationMs } : {}),
      title: clean(p.ProgramName) ?? '',
      ...(clean(p.EventDescription) ? { description: clean(p.EventDescription) } : {}),
      ...(p.Picture && /^https:\/\/img\.mako\.co\.il\//.test(p.Picture) && !/placeHolder/i.test(p.Picture)
        ? { image: p.Picture.replace(/\\\//g, '/') }
        : {}),
    })),
  );
}

const ReshetWeek = z.array(
  z.looseObject({
    shows: z
      .array(
        z.looseObject({
          title: z.string().nullish(),
          desc: z.string().nullish(),
          image: z.string().nullish(),
          show_date: z.string().nullish(),
          start_time: z.string().nullish(),
        }),
      )
      .nullish(),
  }),
);

/**
 * Reshet 13: the guide page's week, each day a list of `HH:mm` starts in Israel time (no ends). A broadcast day
 * runs past midnight: a start earlier than the one before it is on the next calendar day.
 */
export function parseReshetGuide(html: string): GuideRow[] {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m?.[1]) throw new Error('Reshet guide: no __NEXT_DATA__ (layout changed?)');
  const grids = (
    JSON.parse(m[1]) as { props?: { pageProps?: { page?: { Content?: { PageGrid?: unknown[] } } } } }
  ).props?.pageProps?.page?.Content?.PageGrid;
  const grid = (grids ?? []).find((g) => !!g && typeof g === 'object' && 'broadcastWeek' in g) as
    | { broadcastWeek: unknown }
    | undefined;
  if (!grid) throw new Error('Reshet guide: no broadcastWeek (layout changed?)');
  const items: Item[] = [];
  for (const d of ReshetWeek.parse(grid.broadcastWeek)) {
    let prev = -1;
    let dayShift = 0;
    for (const s of d.shows ?? []) {
      if (!s.show_date || !s.start_time || !/^\d{1,2}:\d{2}$/.test(s.start_time)) continue;
      const [h = 0, mi = 0] = s.start_time.split(':').map(Number);
      const minute = h * 60 + mi;
      if (minute < prev) dayShift = 1;
      prev = minute;
      const title = clean(s.title);
      if (!title) continue;
      items.push({
        start: zonedTime(nextDay(s.show_date, dayShift), s.start_time, TZ),
        title,
        ...(clean(s.desc) ? { description: clean(s.desc) } : {}),
        ...(s.image?.startsWith('https://') ? { image: s.image } : {}),
      });
    }
  }
  return toRows(items);
}

const Ch14Guide = z.looseObject({
  shidurim: z.array(
    z.record(
      z.string(),
      z.array(
        z.looseObject({
          program: z.string(),
          subtitle: z.string().nullish(),
          start: z.string(),
          end: z.string().nullish(),
          image: z.string().nullish(),
        }),
      ),
    ),
  ),
});

/** Channel 14: per day, `HH:mm` start and end in Israel time (an end before its start is after midnight). */
export function parseCh14Guide(raw: unknown): GuideRow[] {
  const items: Item[] = [];
  for (const byDay of Ch14Guide.parse(raw).shidurim)
    for (const [day, list] of Object.entries(byDay)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      for (const p of list) {
        if (!/^\d{1,2}:\d{2}$/.test(p.start)) continue;
        const start = zonedTime(day, p.start, TZ);
        let end = p.end && /^\d{1,2}:\d{2}$/.test(p.end) ? zonedTime(day, p.end, TZ) : undefined;
        if (end !== undefined && end <= start) end += DAY_MS;
        const title = clean(p.program);
        if (!title) continue;
        items.push({
          start,
          ...(end ? { end } : {}),
          title,
          ...(clean(p.subtitle) ? { description: clean(p.subtitle) } : {}),
          ...(p.image?.startsWith('https://') ? { image: p.image } : {}),
        });
      }
    }
  return toRows(items);
}

/** Knesset: one page, a table per day ("יום שבת 31/10/2026"), `HH:mm` starts in Israel time (no ends). */
export function parseKnessetGuide(html: string): GuideRow[] {
  const items: Item[] = [];
  const days = html.split(/<div class="broadcasts-table-element-\d+">/).slice(1);
  for (const block of days) {
    const d = /broadcast-header-date[^>]*>[^<]*?(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(block);
    if (!d) continue;
    const day = `${d[3]}-${d[2]?.padStart(2, '0')}-${d[1]?.padStart(2, '0')}`;
    let prev = -1;
    let shift = 0;
    for (const row of block.split(/class="broadcast-list-container"/).slice(1)) {
      const t = /broadcast-list-content-timing">\s*(\d{1,2}:\d{2})/.exec(row)?.[1];
      const title = clean(/<h3 class="broadcast-list-content-title[^"]*">([\s\S]*?)<\/h3>/.exec(row)?.[1]);
      if (!t || !title) continue;
      const [h = 0, mi = 0] = t.split(':').map(Number);
      if (h * 60 + mi < prev) shift = 1;
      prev = h * 60 + mi;
      const desc = clean(/class="broadcast-desc-alt[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(row)?.[1]);
      items.push({
        start: zonedTime(nextDay(day, shift), t, TZ),
        title,
        ...(desc ? { description: desc } : {}),
      });
    }
  }
  return toRows(items);
}

/** Kan's guide page for one channel and day: rows with their start in UTC ("6.11.2026 23:42:00"), no ends. */
export function parseKanGuide(html: string, origin = 'https://www.kan.org.il'): GuideRow[] {
  const items: Item[] = [];
  for (const row of html.split(/<div class="results-item/).slice(1)) {
    const t = /data-date-utc="(\d{1,2})\.(\d{1,2})\.(\d{4}) (\d{1,2}):(\d{2})/.exec(row);
    const title = clean(/<h3 class="program-title">([\s\S]*?)<\/h3>/.exec(row)?.[1]);
    if (!t || !title) continue;
    const [, d, mo, y, h, mi] = t.map(Number) as number[];
    const desc = clean(/<div class="program-description[^"]*">([\s\S]*?)<\/div>/.exec(row)?.[1]);
    const img = /<div class="program-media[^"]*">[\s\S]*?<img[^>]*src="([^"]+)"/.exec(row)?.[1];
    items.push({
      start: Date.UTC(y ?? 0, (mo ?? 1) - 1, d, h, mi),
      title,
      ...(desc ? { description: desc } : {}),
      ...(img && /^https:\/\//.test(new URL(img.replace(/&amp;/g, '&'), origin).toString())
        ? { image: new URL(img.replace(/&amp;/g, '&'), origin).toString() }
        : {}),
    });
  }
  return toRows(items);
}

/** Kan's channels on its guide page, by our channel id. */
export const KAN_GUIDE_CHANNELS: Record<string, number> = {
  iltv_live_kan11: 4444,
  iltv_live_kanedu: 4471,
  iltv_live_makan33: 4532,
};

/** Keep one channel's newly read programmes: they replace the stored ones in the span they cover. */
export function storeGuide(store: Store, channel: string, rows: GuideRow[], now = Date.now()): void {
  const state = store.getState<GuideState>(GUIDE_KEY) ?? {};
  const old = state[channel]?.rows ?? [];
  const from = rows[0]?.[0] ?? Number.POSITIVE_INFINITY;
  const to = rows.at(-1)?.[1] ?? Number.NEGATIVE_INFINITY;
  const kept = old.filter((r) => (r[1] <= from || r[0] >= to) && r[1] > now - DAY_MS);
  state[channel] = { at: new Date(now).toISOString(), rows: [...kept, ...rows].sort((a, b) => a[0] - b[0]) };
  store.setState(GUIDE_KEY, state);
}

function guideFailed(store: Store, channel: string, error: string, now: number): void {
  const state = store.getState<GuideState>(GUIDE_KEY) ?? {};
  state[channel] = {
    at: state[channel]?.at ?? new Date(now).toISOString(),
    rows: state[channel]?.rows ?? [],
    error,
  };
  store.setState(GUIDE_KEY, state);
}

interface GuideSource {
  channels: string[];
  everyMs: number;
  read(f: Fetcher): Promise<GuideRow[]>;
  /** Which source switch in the config this guide belongs to (its reader). */
  needs: 'live' | 'mako' | 'reshet';
}

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; israel-tv guide)' };

export const GUIDE_SOURCES: Record<string, GuideSource> = {
  keshet12: {
    channels: ['iltv_live_keshet12'],
    everyMs: 6 * HOUR_MS,
    needs: 'mako',
    read: async (f) =>
      parseMakoGuide(await f.json('https://www.mako.co.il/AjaxPage?jspName=EPGResponse.jsp')),
  },
  reshet13: {
    channels: ['iltv_live_reshet13'],
    everyMs: 6 * HOUR_MS,
    needs: 'reshet',
    read: async (f) => {
      const r = await f.text('https://13tv.co.il/tv-guide/');
      if (r.status !== 200) throw new Error(`Reshet guide HTTP ${r.status}`);
      return parseReshetGuide(r.body);
    },
  },
  ch14: {
    channels: ['iltv_live_ch14'],
    everyMs: 6 * HOUR_MS,
    needs: 'live',
    read: async () => {
      const r = await fetch('https://www.c14.co.il/wp-json/now14-api/v1/shidurim', {
        headers: UA,
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) throw new Error(`Channel 14 guide HTTP ${r.status}`);
      return parseCh14Guide(await r.json());
    },
  },
  knesset: {
    channels: ['iltv_live_knesset'],
    everyMs: 12 * HOUR_MS,
    needs: 'live',
    read: async () => {
      const r = await fetch(`https://www.knesset.tv/${encodeURIComponent('עכשיו-מנגן-בערוץ')}/`, {
        headers: UA,
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) throw new Error(`Knesset guide HTTP ${r.status}`);
      return parseKnessetGuide(await r.text());
    },
  },
};

/** Read the guides that are due; a failed one keeps its last good programmes and says why. */
export async function refreshGuides(
  store: Store,
  config: Pick<Config, 'sources' | 'scraping'>,
  opts: {
    now?: number;
    fetcher?: Fetcher;
    log?: (line: string) => void;
    sources?: Record<string, GuideSource>;
  } = {},
): Promise<{ read: string[]; failed: string[] }> {
  const now = opts.now ?? Date.now();
  if (!config.sources.live) return { read: [], failed: [] };
  const f = opts.fetcher ?? createFetcher({ delayMs: config.scraping.delayMs });
  const state = store.getState<GuideState>(GUIDE_KEY) ?? {};
  const read: string[] = [];
  const failed: string[] = [];
  for (const [name, src] of Object.entries(opts.sources ?? GUIDE_SOURCES)) {
    if (!config.sources[src.needs]) continue;
    const last = Math.min(...src.channels.map((c) => Date.parse(state[c]?.at ?? '1970-01-01')));
    if (now - last < src.everyMs && src.channels.every((c) => !state[c]?.error)) continue;
    try {
      const rows = await src.read(f);
      if (rows.length === 0) throw new Error('the schedule page lists no programmes (layout changed?)');
      for (const c of src.channels) storeGuide(store, c, rows, now);
      read.push(name);
    } catch (err) {
      const message = (err as Error).message.split('\n')[0] ?? 'failed';
      for (const c of src.channels) guideFailed(store, c, message, now);
      failed.push(`${name}: ${message}`);
    }
  }
  if (read.length + failed.length > 0)
    opts.log?.(
      `guide: read ${read.join(', ') || 'none'}${failed.length ? `; failed ${failed.join('; ')}` : ''}`,
    );
  return { read, failed };
}

/** What `epg.json` holds: each channel's programmes from 6 hours ago to 3 days ahead. */
export function guideFile(store: Store, now = Date.now()): GuideFile {
  const out: GuideFile = {};
  for (const [channel, g] of Object.entries(store.getState<GuideState>(GUIDE_KEY) ?? {})) {
    const rows = g.rows.filter((r) => r[1] > now - 6 * HOUR_MS && r[0] < now + 3 * DAY_MS);
    if (rows.length) out[channel] = rows;
  }
  return out;
}
