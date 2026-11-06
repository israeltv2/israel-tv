// Render the whole addon site (Stremio JSON files) from the home database contents. Pure: data in, files out.
import {
  CATALOG_PAGE_SIZE,
  CATALOGS,
  CONTRACT,
  type EpisodeAssignment,
  type EpisodePlay,
  type ExtIds,
  type Freshness,
  GEO_LIMITED,
  type Manifest,
  type Meta,
  type MetaPreview,
  normalizeForSearch,
  ORIGIN_TOKEN,
  type ScrapedShow,
  type SearchRow,
  type SeasonAssignment,
  type SeasonPlay,
  type SeasonStreams,
  SOURCES,
  type Source,
  type StatusFile,
  type Stream,
  sitePaths,
  type Video,
  videoId,
} from '@israel-tv/core';
import { renderStatusHtml } from './status-html.ts';

export interface RenderShow {
  seriesId: string;
  catalog: string;
  title: string;
  show: ScrapedShow;
  seasons: SeasonAssignment[];
  episodes: EpisodeAssignment[];
  latestAirDate: string | null;
  latestEpisodeSeenAt: string | null;
  state: 'listed' | 'delisted';
  tmdbId: number | null;
  imdbId: string | null;
}

export interface LiveChannelRender {
  id: string;
  name: string;
  logo?: string;
  description?: string;
  /** Streams playable without the resolver. */
  streams: Stream[];
}

export interface RenderInput {
  version: string;
  shows: RenderShow[];
  live: LiveChannelRender[];
  status: StatusFile;
  registry: unknown;
  /** Published as `freshness.json` (see core freshness.ts). */
  freshness?: Freshness;
  /** catalog id → warning shown as the first item of that row (failures are visible, not hidden). */
  catalogWarnings: Record<string, string>;
  name?: string;
  /** Enabled sources, for the description (default: all). */
  sources?: string[];
  /** Images served as they are: `logo.png`, `background.png`, `logos/<channel id>.png`. */
  assets?: Map<string, Uint8Array>;
}

/** Rendered files: text (JSON, HTML) or binary (images). */
export type SiteFiles = Map<string, string | Uint8Array>;

const SHAPE = 'landscape' as const;
const json = (v: unknown) => JSON.stringify(v);

export const STATUS_ID_PREFIX = 'iltv_status_';

function sortKey(s: RenderShow): string {
  return `${s.latestAirDate ?? '0000-00-00'}|${s.latestEpisodeSeenAt ?? ''}`;
}

function preview(s: RenderShow): MetaPreview {
  const p: MetaPreview = { id: s.seriesId, type: 'series', name: s.title, posterShape: SHAPE };
  if (s.show.poster) p.poster = s.show.poster;
  if (s.show.description) p.description = s.show.description;
  if (s.latestAirDate) p.releaseInfo = s.latestAirDate.slice(0, 4);
  return p;
}

function seasonLabel(a: SeasonAssignment | undefined, title: string): string | undefined {
  if (!a || a.kind === 'numbered' || a.kind === 'single') return undefined;
  return title || String(a.number);
}

function videosFor(s: RenderShow): Video[] {
  const seasonByKey = new Map(s.seasons.map((a) => [a.key, a]));
  const epByKey = new Map(s.episodes.map((a) => [a.key, a]));
  const videos: Video[] = [];
  for (const season of s.show.seasons) {
    const sa = seasonByKey.get(season.key);
    const label = seasonLabel(sa, season.title);
    for (const ep of season.episodes) {
      const a = epByKey.get(ep.key);
      if (!a) continue;
      const base = ep.title || `פרק ${a.episode}`;
      const v: Video = {
        id: videoId(s.seriesId, a.season, a.episode),
        title: label ? `${label} · ${base}` : base,
        season: a.season,
        episode: a.episode,
      };
      if (ep.airDate) v.released = `${ep.airDate}T00:00:00.000Z`;
      if (ep.thumbnail) v.thumbnail = ep.thumbnail;
      if (ep.description) v.overview = ep.description;
      videos.push(v);
    }
  }
  return videos.sort((x, y) => (x.season ?? 0) - (y.season ?? 0) || (x.episode ?? 0) - (y.episode ?? 0));
}

function metaFor(s: RenderShow): Meta {
  const m: Meta = { ...preview(s), videos: videosFor(s) };
  if (s.show.background) m.background = s.show.background;
  if (s.show.genres?.length) m.genres = s.show.genres;
  if (s.show.pageUrl) m.links = [{ name: 'Source', category: 'Website', url: s.show.pageUrl }];
  return m;
}

/** Per season, what a resolver needs per episode (so it does not need the home database). */
function seasonPlayFiles(s: RenderShow): Map<number, SeasonPlay> {
  const epByKey = new Map(s.episodes.map((a) => [a.key, a]));
  const out = new Map<number, SeasonPlay>();
  for (const season of s.show.seasons) {
    for (const ep of season.episodes) {
      const a = epByKey.get(ep.key);
      if (!a) continue;
      const direct = ep.streams.find((x) => x.kind === 'direct' || x.kind === 'resolver')?.url;
      const play: EpisodePlay = {
        ...(ep.play?.vcmid && ep.play.channelId
          ? {
              mako: {
                vcmid: ep.play.vcmid,
                channelId: ep.play.channelId,
                ...(ep.play.galleryChannelId ? { galleryChannelId: ep.play.galleryChannelId } : {}),
              },
            }
          : {}),
        ...(direct ? { direct } : {}),
        ...(ep.availableAbroad === false ? { israelOnly: true } : {}),
      };
      if (!play.mako && !play.direct) continue;
      const file = out.get(a.season) ?? {};
      file[String(a.episode)] = play;
      out.set(a.season, file);
    }
  }
  return out;
}

function seasonStreamFiles(s: RenderShow): Map<number, SeasonStreams> {
  const epByKey = new Map(s.episodes.map((a) => [a.key, a]));
  const out = new Map<number, SeasonStreams>();
  for (const season of s.show.seasons) {
    for (const ep of season.episodes) {
      const a = epByKey.get(ep.key);
      const direct = ep.streams.filter((x) => x.kind === 'direct');
      if (!a || direct.length === 0) continue;
      const file = out.get(a.season) ?? {};
      file[String(a.episode)] = direct.map((x) => ({
        url: x.url,
        name: 'Israel TV',
        title:
          [x.label, ep.availableAbroad === false ? 'ישראל בלבד' : undefined].filter(Boolean).join(' · ') ||
          s.title,
        behaviorHints: { bingeGroup: `iltv-${s.seriesId}` },
      }));
      out.set(a.season, file);
    }
  }
  return out;
}

const SOURCE_NAMES: Record<string, string> = {
  mako: 'Keshet 12 (Mako)',
  reshet: 'Reshet 13',
  kan: 'Kan 11 and Kan Educational',
  live: 'live channels',
};

function describe(sources: string[]): string {
  const names = sources.map((s) => SOURCE_NAMES[s]).filter(Boolean);
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? 'Israeli TV');
  const notes: string[] = [];
  if (sources.includes('mako'))
    notes.push(
      'Mako episodes play through the Israel TV resolver on the home network of whoever runs this instance',
    );
  if (sources.some((s) => GEO_LIMITED.has(s as Source)))
    notes.push('Reshet and Kan video is mostly limited to Israel');
  return `Israeli TV: ${list}.${notes.length ? ` ${notes.join('; ')}.` : ''}`;
}

export function buildManifest(input: RenderInput, catalogIds: Set<string>, externalIds = true): Manifest {
  // Claim IMDb/TMDB ids only when some show is matched: otherwise apps would ask us about every title.
  const streamPrefixes = externalIds ? ['iltv_', 'tt', 'tmdb:'] : ['iltv_'];
  return {
    id: 'community.israel-tv',
    version: input.version,
    name: input.name ?? 'Israel TV',
    description: describe(input.sources ?? [...SOURCES]),
    resources: [
      'catalog',
      { name: 'meta', types: ['series', 'tv'], idPrefixes: ['iltv_'] },
      { name: 'stream', types: ['series', 'tv'], idPrefixes: streamPrefixes },
    ],
    types: ['series', 'tv'],
    idPrefixes: streamPrefixes,
    ...(input.assets?.has(sitePaths.logo) ? { logo: `${ORIGIN_TOKEN}/${sitePaths.logo}` } : {}),
    ...(input.assets?.has(sitePaths.background)
      ? { background: `${ORIGIN_TOKEN}/${sitePaths.background}` }
      : {}),
    catalogs: CATALOGS.filter((c) => catalogIds.has(c.id)).map((c) => ({
      type: c.type,
      id: c.id,
      name: c.name,
      extra: [{ name: 'search' }, { name: 'skip' }],
    })),
  };
}

export function renderSite(input: RenderInput): SiteFiles {
  const files: SiteFiles = new Map(input.assets ?? []);
  const search: SearchRow[] = [];
  const extIds: ExtIds = {};
  const rows = new Map<string, MetaPreview[]>();

  const listed = input.shows.filter((s) => s.state === 'listed' && s.episodes.length > 0);
  listed.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  for (const s of listed) {
    const row = rows.get(s.catalog) ?? [];
    row.push(preview(s));
    rows.set(s.catalog, row);
    search.push([s.seriesId, 'series', s.catalog, s.title, normalizeForSearch(s.title), s.show.poster ?? '']);
  }

  const counts = new Map<string, number>();
  for (const s of input.shows) {
    for (const k of [s.imdbId, s.tmdbId ? `tmdb:${s.tmdbId}` : null])
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const shared = new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));

  // Meta and streams for every show ever published (delisted ones too, so watch history still opens).
  for (const s of input.shows) {
    if (s.episodes.length === 0) continue;
    files.set(sitePaths.meta('series', s.seriesId), json({ meta: metaFor(s) }));
    for (const [season, streams] of seasonStreamFiles(s)) {
      files.set(sitePaths.seasonStreams(s.seriesId, season), json(streams));
    }
    for (const [season, play] of seasonPlayFiles(s)) {
      files.set(sitePaths.seasonPlay(s.seriesId, season), json(play));
    }
    const numbered = s.seasons
      .filter((a) => a.kind === 'numbered' || a.kind === 'single')
      .map((a) => a.number);
    if (numbered.length > 0) {
      // An id held by two series is ambiguous: publish neither.
      if (s.imdbId && !shared.has(s.imdbId)) extIds[s.imdbId] = { id: s.seriesId, seasons: numbered };
      const tmdb = s.tmdbId ? `tmdb:${s.tmdbId}` : undefined;
      if (tmdb && !shared.has(tmdb)) extIds[tmdb] = { id: s.seriesId, seasons: numbered };
    }
  }

  // Live channels.
  if (input.live.length > 0) {
    const row: MetaPreview[] = [];
    for (const ch of input.live) {
      const p: MetaPreview = { id: ch.id, type: 'tv', name: ch.name, posterShape: 'square' };
      if (ch.logo) p.poster = ch.logo;
      if (ch.description) p.description = ch.description;
      row.push(p);
      const meta: Meta = { ...p, ...(ch.logo ? { logo: ch.logo, background: ch.logo } : {}) };
      files.set(sitePaths.meta('tv', ch.id), json({ meta }));
      files.set(sitePaths.liveStreams(ch.id), json({ streams: ch.streams }));
      search.push([ch.id, 'tv', 'iltv_live', ch.name, normalizeForSearch(ch.name), ch.logo ?? '']);
    }
    rows.set('iltv_live', row);
  }

  // Visible failures: a labelled first item in the affected row.
  for (const [catalog, text] of Object.entries(input.catalogWarnings)) {
    const def = CATALOGS.find((c) => c.id === catalog);
    if (!def) continue;
    const id = `${STATUS_ID_PREFIX}${catalog}`;
    const item: MetaPreview = {
      id,
      type: def.type,
      name: `⚠ ${text}`,
      description: `${text}\nפרטים: /status`,
    };
    rows.set(catalog, [item, ...(rows.get(catalog) ?? [])]);
    files.set(sitePaths.meta(def.type, id), json({ meta: { ...item, videos: [] } }));
  }

  // Every row of a running source is in the manifest, even before it has shows (Kan fills over days): an
  // empty row says it is still loading instead of being left out.
  const running = new Set(input.sources ?? CATALOGS.map((c) => c.source));
  for (const def of CATALOGS) {
    if (!running.has(def.source) || rows.get(def.id)?.length) continue;
    const id = `${STATUS_ID_PREFIX}${def.id}`;
    const text = 'עדיין בטעינה: התוכניות יופיעו כאן בקרוב';
    const item: MetaPreview = {
      id,
      type: def.type,
      name: `⏳ ${text}`,
      description: `${text}\nפרטים: /status`,
    };
    rows.set(def.id, [item]);
    files.set(sitePaths.meta(def.type, id), json({ meta: { ...item, videos: [] } }));
  }

  for (const [catalog, metas] of rows) {
    const def = CATALOGS.find((c) => c.id === catalog);
    if (!def) continue;
    for (let skip = 0; skip < Math.max(metas.length, 1); skip += CATALOG_PAGE_SIZE) {
      files.set(
        sitePaths.catalog(def.type, catalog, skip),
        json({ metas: metas.slice(skip, skip + CATALOG_PAGE_SIZE) }),
      );
    }
  }

  files.set(
    sitePaths.manifest,
    json(buildManifest(input, new Set(rows.keys()), Object.keys(extIds).length > 0)),
  );
  files.set(sitePaths.search, json(search));
  files.set(sitePaths.extIds, json(extIds));
  files.set(sitePaths.status, json(input.status));
  files.set(sitePaths.statusPage, renderStatusHtml(input.status));
  files.set(sitePaths.registry, json(input.registry));
  files.set(sitePaths.contract, json(CONTRACT));
  if (input.freshness) files.set(sitePaths.freshness, json(input.freshness));
  return files;
}
