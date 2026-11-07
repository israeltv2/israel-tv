// Kan (kan.org.il, kankids.org.il) pages: lobby → show pages → episode pages. Video URLs appear only in an
// episode page's player config (<script type="application/json" data-redge-config>), as a Redge HLS URL
// with no token or expiry; most titles are geo-blocked outside Israel.
import { z } from 'zod';

export const KAN_ORIGIN = 'https://www.kan.org.il';

const decodeEntities = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

const stripTags = (s: string) =>
  decodeEntities(s.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

function meta(html: string, property: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)="${property}"[^>]*content="([^"]*)"`, 'i');
  const v = re.exec(html)?.[1];
  return v ? stripTags(v) : undefined;
}

/**
 * True when the HTML is Cloudflare's bot check (the "רק רגע…" interstitial or its Turnstile checkbox, "ביצוע אימות
 * אבטחה") rather than content. Kan's normal pages also load one `/cdn-cgi/challenge-platform/…` script (bot
 * scoring), so that path alone is not a challenge; the challenge's own options object and widget are.
 */
export function isChallenge(html: string): boolean {
  return (
    /<title>\s*(רק רגע|Just a moment|Attention Required)/i.test(html) ||
    /window\._cf_chl_opt|cf-turnstile|challenges\.cloudflare\.com\/turnstile|id="challenge-(?:form|stage|running)"/.test(
      html,
    ) ||
    /cf-chl/.test(html.slice(0, 20_000))
  );
}

/** Show pages linked from a lobby: `<origin>/content/<channelPath>/<p-123 or slug>/`. */
export function parseLobby(html: string, origin: string, channelPath: string): string[] {
  const host = new URL(origin).host.replace(/\./g, '\\.');
  const re = new RegExp(`href="(?:https://${host})?(/content/${channelPath}/[\\w-]+/)"`, 'g');
  const out = new Set<string>();
  for (const m of html.matchAll(re)) if (m[1]) out.add(m[1]);
  return [...out];
}

/**
 * Each show's picture on a lobby card (`<a href="…/p-123/"><img src="/media/…">`), by show path. Kan's share images
 * (og:image) are refused to everyone off its pages; the lobby's own posters are what its pages show. Preferred: the
 * portrait poster (300×450); otherwise the card's first picture.
 */
export function parseLobbyPosters(html: string): Map<string, string> {
  const card =
    /<a[^>]*href="(?:https:\/\/[^"/]+)?(\/content\/[^"]+\/)"[^>]*>\s*(?:<[^>]*>\s*){0,3}?<img[^>]*src="(\/media\/[^"]+)"/g;
  const found = new Map<string, string[]>();
  for (const m of html.matchAll(card)) {
    if (!m[1] || !m[2]) continue;
    const list = found.get(m[1]) ?? [];
    list.push(m[2].replace(/&amp;/g, '&'));
    found.set(m[1], list);
  }
  const out = new Map<string, string>();
  for (const [path, list] of found) {
    const raster = list.filter((u) => !/\.svg(\?|$)/i.test(u));
    const poster =
      raster.find((u) => /width=300&height=450/.test(u)) ??
      raster.find((u) => /poster|239/i.test(decodeURIComponent(u.split('?')[0] ?? ''))) ??
      raster[0];
    if (poster) out.set(path, poster);
  }
  return out;
}

export interface KanEpisodeLink {
  /** Path of the episode page. */
  path: string;
  /** Kan's numeric page id (increases with publication). */
  id: number;
}

export interface KanShowPage {
  title: string;
  description?: string;
  image?: string;
  episodes: KanEpisodeLink[];
}

/**
 * A show's name without what Kan's page titles add around it (measured on the live lobbies): the site name
 * ("כאן חינוכית | …", "… | כאן"), "- פרקים מלאים לצפייה ישירה" / "- הסרט המלא", "| סדרה … מבית …", and an Arabic
 * name with its tagline ("מאה אחוז | مئة في المئة - …"). A dash that is part of the name stays.
 */
export function cleanKanTitle(raw: string): string {
  const t = raw
    .replace(/\s+/g, ' ')
    .replace(/^כאן(?: חינוכית| 11| ילדים)?\s*\|\s*/, '')
    .replace(/\s*\|\s*כאן(?:\s.*)?$/, '')
    .replace(/\s*\|\s*(?:סדרה|סדרת|סרט|תוכנית)[^|]*מבית[^|]*$/, '')
    .replace(/\s*\|\s*[\u0600-\u06FF][^|]*$/, '')
    .replace(
      /\s*[-–]?\s*(?:(?:כל ה)?פרקים מלאים|הסרט המלא|הסדרה המלאה|כל הפרקים)(?:\s*לצפייה ישירה)?\s*$/,
      '',
    )
    .replace(/\s*[-–]?\s*לצפייה ישירה\s*$/, '')
    .replace(/\s+[-–]\s+(?:סדרת|סדרה|סרט)\s[^|]*$/, '')
    .replace(/\s*[|\-–]\s*$/, '')
    .trim();
  return t || raw.trim();
}

/** Episode links of a show page: `<show>/<id>/` or `<show>/<season>/<id>/`. */
export function parseShowPage(html: string, showPath: string): KanShowPage {
  const esc = showPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The season part, when present, is one path segment: `s2/` on kan.org.il, `עונה-3/` on kankids.
  const re = new RegExp(`href="(?:https://[^"/]+)?(${esc}(?:[^"/]+/)?(\\d+)/)"`, 'g');
  const seen = new Map<string, KanEpisodeLink>();
  for (const m of html.matchAll(re)) {
    if (m[1] && m[2] && !seen.has(m[1])) seen.set(m[1], { path: m[1], id: Number(m[2]) });
  }
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1];
  const title =
    meta(html, 'og:title') ??
    (h1 ? stripTags(h1) : undefined) ??
    stripTags(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? '');
  const desc = /class="info-description[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1];
  const description = desc ? stripTags(desc) : meta(html, 'og:description');
  // Kan refuses its share image (og:image) off its pages; a picture the page itself shows loads: its first
  // still or promo (the `?width=…&v=…` images), the share image only as a last resort.
  const shown = /<img[^>]*\ssrc="(\/media\/[^"]+\.(?:jpe?g|png|webp)\?[^"]*width=\d+[^"]*)"/i.exec(html)?.[1];
  const image = shown ? shown.replace(/&amp;/g, '&') : meta(html, 'og:image');
  return {
    title: cleanKanTitle(title),
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    episodes: [...seen.values()].sort((a, b) => a.id - b.id),
  };
}

const PlayerConfig = z.looseObject({
  id: z.coerce.string(),
  isLive: z.boolean().nullish(),
  poster: z.string().nullish(),
  file: z.looseObject({ hls: z.string().nullish(), dash: z.string().nullish() }).nullish(),
  meta: z
    .looseObject({
      title: z.string().nullish(),
      seasonNumber: z.number().nullish(),
      seriesName: z.string().nullish(),
    })
    .nullish(),
});

export interface KanEpisode {
  id: string;
  title: string;
  hls: string;
  seasonNumber?: number;
  seriesName?: string;
  poster?: string;
  description?: string;
  /** The day Kan published the episode (its page's datePublished, Israel's date): the air date we use. */
  published?: string;
  /** The player config's `subtitles`, as Kan gives it, when not empty (its shape is not known yet: measured). */
  subtitles?: unknown;
}

/**
 * What an episode page turned out to be. Only `episode` has a video; the others are told apart so each is handled
 * on its own terms (measured 2026-11-07 on the pages that had been reported as "no player config"):
 * - `challenge`: Cloudflare's bot check came back instead of the page (retry later; never the page's fault);
 * - `removed`: Kan took the video down when its broadcast rights ended ("בשל הסכמי זכויות שידור, … כבר לא זמין
 *   לצפייה", a `rights-expired` overlay where the player was);
 * - `not-video`: an article or promo page linked among the episodes, with no video at all (an empty contentUrl);
 * - `unknown`: none of these — possibly a layout change (retried, then given up, visibly).
 */
export type EpisodePageKind =
  | { kind: 'episode'; episode: KanEpisode }
  | { kind: 'challenge' }
  | { kind: 'removed' }
  | { kind: 'not-video' }
  | { kind: 'unknown' };

export function classifyEpisodePage(
  html: string,
  origin: string = KAN_ORIGIN,
  url?: string,
): EpisodePageKind {
  if (isChallenge(html)) return { kind: 'challenge' };
  if (/class="rights-expired[" ]/.test(html)) return { kind: 'removed' };
  const episode = parseEpisodePage(html, origin) ?? (url ? parseVideoObject(html, url) : undefined);
  if (episode) return { kind: 'episode', episode };
  const video = videoObject(html);
  if (video && !video.contentUrl) return { kind: 'not-video' };
  return { kind: 'unknown' };
}

/** The page's schema.org VideoObject (Kan describes every episode page with one), if any. */
function videoObject(
  html: string,
):
  | { name?: string; description?: string; contentUrl?: string; thumbnailUrl?: string; uploadDate?: string }
  | undefined {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let v: unknown;
    try {
      v = JSON.parse(m[1] ?? '');
    } catch {
      continue;
    }
    if (v && typeof v === 'object' && (v as { '@type'?: unknown })['@type'] === 'VideoObject') {
      const o = v as Record<string, unknown>;
      const str = (k: string) =>
        typeof o[k] === 'string' && o[k] ? decodeEntities(o[k] as string).trim() : undefined;
      const out: Record<string, string> = {};
      for (const k of ['name', 'description', 'contentUrl', 'thumbnailUrl', 'uploadDate']) {
        const s = str(k);
        if (s) out[k] = s;
      }
      return out;
    }
  }
  return undefined;
}

/**
 * An episode from the page's VideoObject when the page has no player config but still names a Redge HLS URL (a
 * player that failed to render, or a new player): the same stream the player would play. Its id is the page id.
 */
function parseVideoObject(html: string, url: string): KanEpisode | undefined {
  const v = videoObject(html);
  const id = /\/(\d+)\/?$/.exec(new URL(url).pathname)?.[1];
  if (!v?.contentUrl || !id || !/^https:\/\/[^/]+\.cdn-redge\.media\/.+\.m3u8/.test(v.contentUrl))
    return undefined;
  // "<series> | <episode title>" (the page's title form).
  const parts = (v.name ?? '').split(' | ');
  const title = (parts.length > 1 ? parts.slice(1).join(' | ') : (parts[0] ?? '')).trim();
  const season = /\/s(\d+)\/\d+\/?$/.exec(new URL(url).pathname)?.[1];
  const published = /"(?:datePublished|uploadDate)"\s*:\s*"(\d{4}-\d{2}-\d{2})/.exec(html)?.[1];
  return {
    id,
    title,
    hls: v.contentUrl,
    ...(season ? { seasonNumber: Number(season) } : {}),
    ...(parts.length > 1 && parts[0] ? { seriesName: parts[0].trim() } : {}),
    ...(v.thumbnailUrl ? { poster: v.thumbnailUrl } : {}),
    ...(v.description ? { description: v.description } : {}),
    ...(published ? { published } : {}),
  };
}

const hasValue = (v: unknown) =>
  v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);

/** The first VOD player config on the page with an HLS URL, or undefined. */
export function parseEpisodePage(html: string, origin: string = KAN_ORIGIN): KanEpisode | undefined {
  const re = /<script type="application\/json" data-redge-config="[^"]*">([\s\S]*?)<\/script>/g;
  for (const m of html.matchAll(re)) {
    let raw: unknown;
    try {
      raw = JSON.parse(m[1] ?? '');
    } catch {
      continue;
    }
    const c = PlayerConfig.safeParse(raw);
    if (!c.success || c.data.isLive) continue;
    const hls = c.data.file?.hls;
    if (!hls) continue;
    const poster = c.data.poster ? new URL(c.data.poster, origin).toString() : undefined;
    const description = meta(html, 'og:description') ?? meta(html, 'description');
    const published = /"(?:datePublished|uploadDate)"\s*:\s*"(\d{4}-\d{2}-\d{2})/.exec(html)?.[1];
    return {
      id: c.data.id,
      title: (c.data.meta?.title ?? '').trim(),
      hls: hls.startsWith('//') ? `https:${hls}` : hls,
      ...(c.data.meta?.seasonNumber ? { seasonNumber: c.data.meta.seasonNumber } : {}),
      ...(c.data.meta?.seriesName ? { seriesName: c.data.meta.seriesName.trim() } : {}),
      ...(poster ? { poster } : {}),
      ...(description ? { description } : {}),
      ...(published ? { published } : {}),
      ...(hasValue(raw && typeof raw === 'object' ? (raw as { subtitles?: unknown }).subtitles : undefined)
        ? { subtitles: (raw as { subtitles: unknown }).subtitles }
        : {}),
    };
  }
  return undefined;
}
