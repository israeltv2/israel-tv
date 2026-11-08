// Render the whole addon site (Stremio JSON files) from the home database contents. Pure: data in, files out.
import {
  ADDON_ID,
  CATALOG_PAGE_SIZE,
  CATALOGS,
  CONTACT_EMAIL,
  CONTRACT,
  cleanDescription,
  cleanGenres,
  type EpisodeAssignment,
  type EpisodePlay,
  type ExtIds,
  type Freshness,
  GEO_LIMITED,
  type GuideFile,
  ISRAEL_ONLY,
  isTrailer,
  kalturaImage,
  LIVE_ALIASES,
  type Manifest,
  type Meta,
  type MetaPreview,
  normalizeForSearch,
  ORIGIN_TOKEN,
  rtl,
  type ScrapedShow,
  type SearchRow,
  type SeasonAssignment,
  type SeasonPlay,
  type SeasonStreams,
  SOURCES,
  type Source,
  type StatusCatalog,
  type StatusFile,
  type Stream,
  sitePaths,
  streamName,
  type TmdbDetails,
  tidyEpisodeTitle,
  tidyText,
  type Video,
  videoId,
} from '@israel-tv/core';
import { renderLandingHtml } from './landing-html.ts';
import { type LibraryRow, libraryUrls, plain, renderLibrary } from './library-html.ts';
import { publicStatus } from './public-text.ts';
import { robotsTxt, sitemapXml, webManifest } from './site-meta.ts';
import { overall, renderStatusHtml } from './status-html.ts';

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
  /** Other names (from TMDB, in English or the original): found by search, never shown. */
  aliases?: string[];
  /** What TMDB says about the show (matched shows only): fills what the source leaves empty, nothing else. */
  tmdb?: TmdbDetails;
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
  /** catalog id → "still filling" text, shown as a ⏳ item first in that row (after a warning, if any). */
  catalogFilling?: Record<string, string>;
  name?: string;
  /** Enabled sources, for the description (default: all). */
  sources?: string[];
  /** Images served as they are: `logo.png`, `background.png`, `logos/<channel id>.png`. */
  assets?: Map<string, Uint8Array>;
  /** When "ended" is judged (default now). */
  now?: number;
  /**
   * What playing the streams showed (apps/ingest stream-probe.ts): per series, whether it plays only in Israel
   * (overrides what the source says); per episode key, its measured best quality ("540p").
   */
  probes?: { israelOnly?: Record<string, boolean>; quality?: Record<string, string> };
  /** The live programme guide (apps/ingest epg.ts), published as `epg.json`. */
  guide?: GuideFile;
  /** stremio-addons.net's signature for the listed addon (config `addon.stremioAddonsConfig`). */
  stremioAddonsConfig?: { issuer: string; signature: string };
  /** The addon's public address, when known: written into the landing page's install links. */
  publicUrl?: string;
}

/** Genres offered as a filter on a row: those of its shows, most common first. */
export const MAX_GENRE_OPTIONS = 30;

/** Rendered files: text (JSON, HTML) or binary (images). */
export type SiteFiles = Map<string, string | Uint8Array>;

/** Series posters are portrait: the publisher makes sure of it (apps/ingest/src/posters.ts). */
const SHAPE = 'poster' as const;
const json = (v: unknown) => JSON.stringify(v);

export const STATUS_ID_PREFIX = 'iltv_status_';

/** Something to watch: numbered episodes that are still in the show (a show with only a trailer has none). */
const hasVideos = (s: RenderShow) =>
  s.episodes.length > 0 && s.show.seasons.some((x) => x.episodes.length > 0);

function sortKey(s: RenderShow): string {
  return `${s.latestAirDate ?? '0000-00-00'}|${s.latestEpisodeSeenAt ?? ''}`;
}

/** No episode for this long: the show has ended (a seasonal show off the air for months has not). */
const ENDED_AFTER_DAYS = 365;

function airDates(s: RenderShow): string[] {
  return s.show.seasons
    .flatMap((x) => x.episodes.map((e) => e.airDate))
    .filter((d): d is string => !!d)
    .sort();
}

export function hasEnded(s: RenderShow, now: number): boolean | undefined {
  const last = airDates(s).at(-1);
  if (!last) return undefined;
  return now - Date.parse(`${last}T00:00:00Z`) > ENDED_AFTER_DAYS * 86_400_000;
}

/**
 * The year line, in the usual form (Cinemeta, IMDb, Wikipedia: en dash, no spaces): the years of the first and the
 * latest episode, "2024–2026", or one year when they are the same. Whether the show still runs is said by
 * `status` ("Returning Series"/"Ended"), which apps show next to it.
 */
export function releaseInfo(s: RenderShow): string | undefined {
  const dates = airDates(s);
  // No dated episode: the years TMDB gives a matched show, in the same form.
  const first = dates[0]?.slice(0, 4) ?? s.tmdb?.firstYear;
  const last = dates.at(-1)?.slice(0, 4) ?? s.tmdb?.lastYear ?? first;
  if (!first || !last) return undefined;
  return first === last ? first : `${first}–${last}`;
}

/** The show's genres: the source's; TMDB's (matched shows) when the source gives none. */
export function showGenres(s: RenderShow): string[] {
  const own = cleanGenres(s.show.genres);
  return own.length ? own : cleanGenres(s.tmdb?.genres);
}

/** The show's description: the source's; TMDB's Hebrew overview (matched shows) when the source has none. */
export function showDescription(s: RenderShow): string | undefined {
  return cleanDescription(s.show.description) ?? cleanDescription(s.tmdb?.overview);
}

function preview(s: RenderShow): MetaPreview {
  const p: MetaPreview = { id: s.seriesId, type: 'series', name: rtl(tidyText(s.title)), posterShape: SHAPE };
  if (s.show.poster) p.poster = s.show.poster;
  const description = showDescription(s);
  if (description) p.description = rtl(description);
  const year = releaseInfo(s);
  if (year) p.releaseInfo = year;
  const genres = showGenres(s);
  if (genres.length) p.genres = genres;
  if (s.imdbId) p.imdb_id = s.imdbId;
  return p;
}

/** Season names that only say "the episodes" (a site's archive bucket): nothing worth repeating on every episode. */
const GENERIC_SEASON = /^(?:עונות קודמות|פרקים קודמים|פרקים מלאים|כל הפרקים|פרקים|ארכיון)$/;

/** Named seasons ("VIP 5") say which they are in episode titles; numbered and year ones not. */
function seasonLabel(a: SeasonAssignment | undefined, title: string): string | undefined {
  // An untitled season has nothing to say ("101 ·" means nothing to a viewer).
  const t = tidyText(title);
  if (a?.kind !== 'named' || !t || GENERIC_SEASON.test(t)) return undefined;
  return t;
}

/**
 * A show as published: without trailers and promos (read before they were left out at the source boundary;
 * model.ts) and without episodes the source no longer offers (`unavailable`; their numbers stay reserved, so the
 * others keep theirs). A show left with nothing is not in the catalog (hasVideos).
 */
function published(s: RenderShow): RenderShow {
  const out = (e: ScrapedShow['seasons'][number]['episodes'][number]) =>
    e.unavailable === true || isTrailer(e.title);
  if (!s.show.seasons.some((x) => x.episodes.some(out))) return s;
  return {
    ...s,
    show: {
      ...s.show,
      seasons: s.show.seasons.map((x) => ({ ...x, episodes: x.episodes.filter((e) => !out(e)) })),
    },
  };
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
      const base = (ep.title && tidyEpisodeTitle(ep.title, s.title)) || `פרק ${a.episode}`;
      const v: Video = {
        id: videoId(s.seriesId, a.season, a.episode),
        title: rtl(label ? `${label} · ${base}` : base),
        season: a.season,
        episode: a.episode,
      };
      if (ep.airDate) v.released = `${ep.airDate}T00:00:00.000Z`;
      // Stored before stills were sized (the reader sizes them now): sized here too.
      if (ep.thumbnail) v.thumbnail = kalturaImage(ep.thumbnail, 640, 360);
      if (ep.description) v.overview = rtl(tidyText(ep.description));
      videos.push(v);
    }
  }
  return videos.sort((x, y) => (x.season ?? 0) - (y.season ?? 0) || (x.episode ?? 0) - (y.episode ?? 0));
}

/**
 * Said on every Keshet 12 show page: its episodes play only through the viewer's own home helper, so without one
 * the app's stream list is empty. (Not a placeholder "stream": Nuvio would try to play a guide link as video.)
 */
export const MAKO_HELPER_NOTE =
  'כדי לצפות בפרקים של קשת 12 צריך את העוזר הביתי של Israel TV. איך מתקינים: github.com/israeltv2/israel-tv';

function metaFor(s: RenderShow, now: number): Meta {
  const m: Meta = { ...preview(s), videos: videosFor(s) };
  if (s.show.source === 'mako')
    m.description = rtl([showDescription(s), MAKO_HELPER_NOTE].filter(Boolean).join('\n\n'));
  // Shown by apps (Nuvio: a "Status" row), and used by them for the year line when it is a bare year.
  const last = airDates(s).at(-1);
  if (last) {
    m.lastAirDate = last;
    m.status = hasEnded(s, now) ? 'Ended' : 'Returning Series';
  }
  if (s.show.background) m.background = s.show.background;
  if (s.show.pageUrl) m.links = [{ name: 'Source', category: 'Website', url: s.show.pageUrl }];
  return m;
}

/** Per season, what a resolver needs per episode (so it does not need the home database). */
type Probes = RenderInput['probes'];

/** Plays only from Israel: as measured from abroad for the series when it was, else as the source says. */
const israelOnly = (s: RenderShow, ep: ScrapedShow['seasons'][number]['episodes'][number], probes: Probes) =>
  probes?.israelOnly?.[s.seriesId] ?? ep.availableAbroad === false;

function seasonPlayFiles(s: RenderShow, probes: Probes): Map<number, SeasonPlay> {
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
        ...(israelOnly(s, ep, probes) ? { israelOnly: true } : {}),
      };
      if (!play.mako && !play.direct) continue;
      const file = out.get(a.season) ?? {};
      file[String(a.episode)] = play;
      out.set(a.season, file);
    }
  }
  return out;
}

function seasonStreamFiles(s: RenderShow, probes: Probes): Map<number, SeasonStreams> {
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
        name: streamName(s.show.source, x.url, probes?.quality?.[ep.key]),
        title: rtl(
          [
            (ep.title && tidyEpisodeTitle(ep.title, s.title)) || `פרק ${a.episode}`,
            x.label,
            israelOnly(s, ep, probes) ? ISRAEL_ONLY : undefined,
          ]
            .filter(Boolean)
            .join(' · '),
        ),
        behaviorHints: { bingeGroup: `iltv-${s.seriesId}` },
      }));
      out.set(a.season, file);
    }
  }
  return out;
}

const SOURCE_NAMES: Record<string, string> = {
  mako: 'Keshet 12',
  reshet: 'Reshet 13',
  kan: 'Kan',
};

/** The manifest's description, for viewers: what is in it, and the two things that limit playing. */
export function describe(sources: string[]): string {
  const names = sources.map((s) => SOURCE_NAMES[s]).filter((n): n is string => !!n);
  const live = sources.includes('live');
  if (names.length === 0) return live ? 'Israeli live TV channels.' : 'Israeli TV.';
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  const notes: string[] = [];
  if (sources.includes('mako')) notes.push('Keshet 12 needs your own home helper');
  if (sources.some((s) => GEO_LIMITED.has(s as Source))) notes.push('some shows play only in Israel');
  const what = `Israeli TV shows${live ? ' and live channels' : ''} from ${list}.`;
  return notes.length ? `${what} ${notes.join('; ').replace(/^./, (c) => c.toUpperCase())}.` : what;
}

function genreOptions(input: RenderInput, catalog: string): string[] {
  const n = new Map<string, number>();
  for (const s of input.shows)
    if (s.catalog === catalog && s.state === 'listed' && hasVideos(s))
      for (const g of showGenres(s)) n.set(g, (n.get(g) ?? 0) + 1);
  // A filter that finds one show is noise.
  return [...n]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'he'))
    .slice(0, MAX_GENRE_OPTIONS)
    .map(([g]) => g);
}

const hasGuide = (input: RenderInput) => Object.values(input.guide ?? {}).some((rows) => rows.length > 0);

export function buildManifest(input: RenderInput, catalogIds: Set<string>, externalIds = true): Manifest {
  // Claim IMDb/TMDB ids only when some show is matched: otherwise apps would ask us about every title.
  const streamPrefixes = externalIds ? ['iltv_', 'tt', 'tmdb:'] : ['iltv_'];
  return {
    id: ADDON_ID,
    version: input.version,
    name: input.name ?? 'Israel TV',
    description: describe(input.sources ?? [...SOURCES]),
    contactEmail: CONTACT_EMAIL,
    // Apps with a guide grid ask the live row for a day's programmes (`date`); see core epg.ts.
    ...(hasGuide(input) ? { behaviorHints: { epgProvider: true } } : {}),
    ...(input.stremioAddonsConfig ? { stremioAddonsConfig: input.stremioAddonsConfig } : {}),
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
    catalogs: CATALOGS.filter((c) => catalogIds.has(c.id)).map((c) => {
      const genres = genreOptions(input, c.id);
      return {
        type: c.type,
        id: c.id,
        name: c.name,
        extra: [
          { name: 'search' },
          { name: 'skip' },
          ...(genres.length ? [{ name: 'genre', options: genres }] : []),
          ...(c.type === 'tv' && hasGuide(input) ? [{ name: 'date' }] : []),
        ],
      };
    }),
  };
}

export function renderSite(input: RenderInput): SiteFiles {
  const files: SiteFiles = new Map(input.assets ?? []);
  const search: SearchRow[] = [];
  const extIds: ExtIds = {};
  const rows = new Map<string, MetaPreview[]>();

  const now = input.now ?? Date.now();
  input = { ...input, shows: input.shows.map(published) };
  const listed = input.shows.filter((s) => s.state === 'listed' && hasVideos(s));
  listed.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  for (const s of listed) {
    const row = rows.get(s.catalog) ?? [];
    row.push(preview(s));
    rows.set(s.catalog, row);
    const genres = showGenres(s);
    search.push([
      s.seriesId,
      'series',
      s.catalog,
      rtl(tidyText(s.title)),
      normalizeForSearch([s.title, ...(s.aliases ?? [])].join(' | ')),
      s.show.poster ?? '',
      ...(genres.length ? [genres] : []),
    ] as SearchRow);
  }

  const counts = new Map<string, number>();
  for (const s of input.shows) {
    for (const k of [s.imdbId, s.tmdbId ? `tmdb:${s.tmdbId}` : null])
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const shared = new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));

  // Meta and streams for every show ever published (delisted ones too, so watch history still opens).
  const metas = new Map<string, Meta>();
  for (const s of input.shows) {
    if (!hasVideos(s)) continue;
    const meta = metaFor(s, now);
    metas.set(s.seriesId, meta);
    files.set(sitePaths.meta('series', s.seriesId), json({ meta }));
    for (const [season, streams] of seasonStreamFiles(s, input.probes)) {
      files.set(sitePaths.seasonStreams(s.seriesId, season), json(streams));
    }
    for (const [season, play] of seasonPlayFiles(s, input.probes)) {
      files.set(sitePaths.seasonPlay(s.seriesId, season), json(play));
    }
    // Year seasons are numbered 1, 2, … by position, as TMDB numbers them; named ones (101+) never match.
    const numbered = s.seasons.filter((a) => a.kind !== 'named').map((a) => a.number);
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
      const p: MetaPreview = {
        id: ch.id,
        type: 'tv',
        name: rtl(ch.name),
        posterShape: 'square',
        behaviorHints: { isLive: true },
      };
      if (ch.logo) p.poster = ch.logo;
      if (ch.description) p.description = rtl(ch.description);
      row.push(p);
      // The channel's logo is a square tile: shown as its logo; the page's backdrop is the addon's own picture.
      const backdrop = input.assets?.has(sitePaths.background)
        ? `${ORIGIN_TOKEN}/${sitePaths.background}`
        : undefined;
      const meta: Meta = {
        ...p,
        ...(ch.logo ? { logo: ch.logo } : {}),
        ...(backdrop ? { background: backdrop } : {}),
      };
      files.set(sitePaths.meta('tv', ch.id), json({ meta }));
      files.set(
        sitePaths.liveStreams(ch.id),
        json({
          streams: ch.streams.map((x) => ({
            ...x,
            ...(x.name ? { name: rtl(x.name) } : {}),
            ...(x.title ? { title: rtl(x.title) } : {}),
          })),
        }),
      );
      search.push([
        ch.id,
        'tv',
        'iltv_live',
        rtl(ch.name),
        normalizeForSearch([ch.name, ...(LIVE_ALIASES[ch.id] ?? [])].join(' | ')),
        ch.logo ?? '',
      ]);
    }
    rows.set('iltv_live', row);
  }

  // A row's notices are tiles like any other: the generic poster, so a row never has a blank one.
  const noticeArt = input.assets?.has(sitePaths.posterPlaceholder)
    ? { poster: `${ORIGIN_TOKEN}/${sitePaths.posterPlaceholder}`, posterShape: SHAPE }
    : {};

  // A row still filling says so first (Kan's first fill takes days).
  for (const [catalog, text] of Object.entries(input.catalogFilling ?? {})) {
    const def = CATALOGS.find((c) => c.id === catalog);
    if (!def || !rows.get(catalog)?.length) continue;
    const id = `${STATUS_ID_PREFIX}${catalog}_filling`;
    const item: MetaPreview = {
      id,
      type: def.type,
      name: rtl(`⏳ ${text}`),
      description: rtl(text),
      ...noticeArt,
    };
    rows.set(catalog, [item, ...(rows.get(catalog) ?? [])]);
    files.set(sitePaths.meta(def.type, id), json({ meta: { ...item, videos: [] } }));
  }

  // Visible failures: a labelled first item in the affected row.
  for (const [catalog, text] of Object.entries(input.catalogWarnings)) {
    const def = CATALOGS.find((c) => c.id === catalog);
    if (!def) continue;
    const id = `${STATUS_ID_PREFIX}${catalog}`;
    const item: MetaPreview = {
      id,
      type: def.type,
      name: rtl(`⚠ ${text}`),
      description: rtl(`${text}\nפרטים: /status`),
      ...noticeArt,
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
      ...noticeArt,
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

  const manifest = buildManifest(input, new Set(rows.keys()), Object.keys(extIds).length > 0);
  files.set(sitePaths.manifest, json(manifest));
  // The status and the pages carry the rows as published: these counts are what the apps show.
  const origins = input.publicUrl ? { origins: [input.publicUrl] } : {};
  const status = publicStatus({ ...input.status, catalogs: publishedCatalogs(input, listed) }, origins);
  // The library pages: each show's page says what the app's show page says, without the app-only note.
  const libraryRows: LibraryRow[] = (status.catalogs ?? [])
    .filter((c) => c.source !== 'live')
    .map((c) => ({
      id: c.id,
      source: c.source,
      ...(c.filling ? { filling: c.filling } : {}),
      shows: listed
        .filter((s) => s.catalog === c.id && metas.has(s.seriesId))
        .map((s) => {
          const meta = metas.get(s.seriesId) as Meta;
          const description = showDescription(s);
          return {
            source: s.show.source,
            meta: { ...meta, description: description ? plain(description) : '' },
          };
        }),
    }));
  const landing = {
    name: manifest.name,
    description: manifest.description,
    catalogs: status.catalogs ?? [],
    live: input.live.map((ch) => ({
      id: ch.id,
      name: ch.name,
      logo: !!ch.logo,
      helper: ch.streams.length === 0,
    })),
    status: overall(status),
    ...(input.publicUrl ? { publicUrl: input.publicUrl } : {}),
    wall: posterWall(libraryRows),
    // A row's posters, from every show it lists: a row in its first fill has posters before it has episodes.
    rowPosters: Object.fromEntries(
      libraryRows.map((r) => [
        r.id,
        input.shows
          .filter((s) => s.catalog === r.id && s.state === 'listed' && s.show.poster)
          .map((s) => s.show.poster as string)
          .filter((u) => !u.includes(sitePaths.posterPlaceholder))
          .slice(0, 5),
      ]),
    ),
    ...(input.guide ? { guide: input.guide } : {}),
  };
  files.set(sitePaths.landing, renderLandingHtml(landing, 'en'));
  files.set(sitePaths.landingHe, renderLandingHtml(landing, 'he'));
  const library = renderLibrary({
    rows: libraryRows,
    live: landing.live,
    ...(input.guide ? { guide: input.guide } : {}),
  });
  for (const [path, html] of library) files.set(path, html);
  files.set(sitePaths.robots, robotsTxt());
  files.set(sitePaths.sitemap, sitemapXml(libraryUrls(library.keys())));
  files.set(sitePaths.webManifest, webManifest());
  files.set(sitePaths.search, json(search));
  files.set(sitePaths.extIds, json(extIds));
  files.set(sitePaths.status, json(status));
  files.set(sitePaths.statusPage, renderStatusHtml(status, origins));
  files.set(sitePaths.registry, json(input.registry));
  files.set(sitePaths.contract, json(CONTRACT));
  if (input.freshness) files.set(sitePaths.freshness, json(input.freshness));
  if (input.live.length > 0) files.set(sitePaths.epg, json(input.guide ?? {}));
  return files;
}

/** Posters for the landing page's moving wall: the newest shows of every row, taking turns, with real artwork. */
function posterWall(rows: LibraryRow[], n = 36): { name: string; poster: string }[] {
  const lists = rows.map((r) =>
    r.shows.filter((s) => s.meta.poster && !s.meta.poster.includes(sitePaths.posterPlaceholder)),
  );
  const out: { name: string; poster: string }[] = [];
  for (let i = 0; out.length < n && lists.some((l) => l.length > i); i++)
    for (const l of lists) {
      const s = l[i];
      if (s && out.length < n) out.push({ name: plain(s.meta.name), poster: s.meta.poster as string });
    }
  return out;
}

/**
 * The rows of the running sources with what was published in them (shows with something to watch, their episodes;
 * the live row's channels), keeping what the status already says about them (a Kan row's first-fill progress).
 */
function publishedCatalogs(input: RenderInput, listed: RenderShow[]): StatusCatalog[] {
  const running = new Set<string>(input.sources ?? SOURCES);
  const known = new Map((input.status.catalogs ?? []).map((c) => [c.id, c]));
  return CATALOGS.filter((c) => running.has(c.source) && (c.source !== 'live' || input.live.length > 0)).map(
    (c) => {
      const shows = listed.filter((s) => s.catalog === c.id);
      return {
        ...known.get(c.id),
        id: c.id,
        name: c.name,
        source: c.source,
        shows: c.source === 'live' ? input.live.length : shows.length,
        episodes: shows.reduce((n, s) => n + videosFor(s).length, 0),
      };
    },
  );
}
