// Public ids. Series ids are allocated once by the home registry and never reused.
// The `iltv_` prefix keeps them apart from other Israeli-TV addons a viewer may also have installed.

export const SOURCES = ['mako', 'reshet', 'kan', 'live'] as const;
export type Source = (typeof SOURCES)[number];

const SERIES_RE = /^iltv_(mako|reshet|kan|live)_(\d+)$/;
const VIDEO_RE = /^(iltv_(?:mako|reshet|kan|live)_\d+):(\d+):(\d+)$/;

export function seriesId(source: Source, n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid series number ${n}`);
  return `iltv_${source}_${n}`;
}

export function parseSeriesId(id: string): { source: Source; n: number } | undefined {
  const m = SERIES_RE.exec(id);
  return m ? { source: m[1] as Source, n: Number(m[2]) } : undefined;
}

/** Stremio video id for an episode: `<seriesId>:<season>:<episode>`. */
export function videoId(series: string, season: number, episode: number): string {
  return `${series}:${season}:${episode}`;
}

export function parseVideoId(id: string): { series: string; season: number; episode: number } | undefined {
  const m = VIDEO_RE.exec(id);
  if (!m?.[1]) return undefined;
  return { series: m[1], season: Number(m[2]), episode: Number(m[3]) };
}

export function isOurId(id: string): boolean {
  return id.startsWith('iltv_');
}
