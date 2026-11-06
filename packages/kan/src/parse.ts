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

/** True when the HTML is a Cloudflare challenge page rather than content. */
export function isChallenge(html: string): boolean {
  return (
    /<title>\s*(רק רגע|Just a moment)/i.test(html) || /cf-chl|challenge-platform/.test(html.slice(0, 20_000))
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
  /** Player config embedded in the show page itself (single-video shows). */
  featured?: KanEpisode;
}

/** Episode links of a show page: `<show>/<id>/` or `<show>/s<season>/<id>/`. */
export function parseShowPage(html: string, showPath: string, origin: string = KAN_ORIGIN): KanShowPage {
  const esc = showPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`href="(?:https://[^"/]+)?(${esc}(?:s[\\w-]+/)?(\\d+)/)"`, 'g');
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
  const image = meta(html, 'og:image');
  const featured = parseEpisodePage(html, origin);
  return {
    title: title.replace(/\s*\|\s*כאן.*$/, '').trim(),
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    episodes: [...seen.values()].sort((a, b) => a.id - b.id),
    ...(featured ? { featured } : {}),
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
}

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
    return {
      id: c.data.id,
      title: (c.data.meta?.title ?? '').trim(),
      hls: hls.startsWith('//') ? `https:${hls}` : hls,
      ...(c.data.meta?.seasonNumber ? { seasonNumber: c.data.meta.seasonNumber } : {}),
      ...(c.data.meta?.seriesName ? { seriesName: c.data.meta.seriesName.trim() } : {}),
      ...(poster ? { poster } : {}),
      ...(description ? { description } : {}),
    };
  }
  return undefined;
}
