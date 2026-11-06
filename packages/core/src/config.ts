// The one config file (`israel-tv.config.json`). Every option has a default except where noted; secrets
// are never written here, only the names of the environment variables (from `.env`) that hold them.

import { z } from 'zod';
import { SOURCES, type Source } from './ids.ts';

const port = z.number().int().min(1).max(65535);

/** Let a section leave out `type` and get the default kind, e.g. `{ "publisher": { "port": 8000 } }`. */
const withDefaultType = (type: string) => (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) && !('type' in v) ? { type, ...v } : v;
const envName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/, 'must be an environment variable name like MY_SECRET');

const GeoNone = z.strictObject({ type: z.literal('none') });
const proxyUrl = (protocols: string[], example: string) =>
  z.string().refine(
    (u) => {
      try {
        const url = new URL(u);
        return protocols.includes(url.protocol) && url.hostname !== '';
      } catch {
        return false;
      }
    },
    `must be a full proxy URL starting with ${protocols.map((p) => `${p}//`).join(' or ')} (e.g. ${example})`,
  );

const GeoProxyFields = {
  /** Env var names holding the proxy credentials. Leave both out for a proxy without a login. */
  usernameEnv: envName.optional(),
  passwordEnv: envName.optional(),
};
const GeoHttp = z.strictObject({
  /** An http:// or https:// proxy. */
  type: z.literal('http-proxy'),
  /** One or more proxy URLs with an Israeli exit, tried in order (the next is used when one fails). */
  urls: z.array(proxyUrl(['http:', 'https:'], 'https://proxy.example.net:3128')).min(1),
  ...GeoProxyFields,
});
const GeoSocks = z.strictObject({
  type: z.literal('socks5'),
  urls: z.array(proxyUrl(['socks5:'], 'socks5://proxy.example.net:1080')).min(1),
  ...GeoProxyFields,
});

const BrowserNone = z.strictObject({ type: z.literal('none') });
const BrowserChrome = z.strictObject({
  type: z.literal('chrome'),
  /** Path to Chrome/Chromium. Empty: use the installed Google Chrome. */
  executablePath: z.string().optional(),
  /** Run with a visible (off-screen) window. Cloudflare challenges pass far more often headed. */
  headed: z.boolean().default(true),
});

const PublisherLocal = z.strictObject({
  type: z.literal('local'),
  host: z.string().default('0.0.0.0'),
  port: port.default(7700),
  /** Directory the rendered addon files are written to and served from. */
  dir: z.string().default('./data/site'),
});
const PublisherCloudflare = z.strictObject({
  type: z.literal('cloudflare'),
  /** Worker name; the addon is served at https://<workerName>.<your-subdomain>.workers.dev */
  workerName: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default('israel-tv'),
  accountIdEnv: envName.default('CLOUDFLARE_ACCOUNT_ID'),
  apiTokenEnv: envName.default('CLOUDFLARE_API_TOKEN'),
  /** Build directory for the rendered files before upload. */
  dir: z.string().default('./data/site'),
  /** Public base URL once deployed (used in /status links). Optional. */
  publicUrl: z.url().optional(),
  /**
   * Log every catalog, meta and stream request (no addresses: a salted daily hash) for the usage dashboard.
   * The Worker then answers those requests itself, so they count toward the free plan's 100,000 Worker
   * requests a day (catalogs and metadata are otherwise free static files).
   */
  requestLogs: z.boolean().default(true),
});

export const ConfigSchema = z.strictObject({
  /** Home database (SQLite file). Holds the id registry, numbering and last good data. */
  store: z.strictObject({ path: z.string().default('./data/israel-tv.sqlite') }).prefault({}),
  /**
   * Your own addon images: `logo.png` (square, ~256 px), `resolver-logo.png` (same) and `background.jpg` or
   * `background.png` (1920×1080). Any that are missing come from the bundled ones.
   */
  branding: z.strictObject({ dir: z.string().default('./branding') }).prefault({}),
  sources: z
    .strictObject({
      mako: z.boolean().default(true),
      reshet: z.boolean().default(true),
      kan: z.boolean().default(true),
      live: z.boolean().default(true),
    })
    .prefault({}),
  /** How to reach Israel-only content. `none` is right when this runs inside Israel. */
  geo: z
    .preprocess(withDefaultType('none'), z.discriminatedUnion('type', [GeoNone, GeoHttp, GeoSocks]))
    .prefault({ type: 'none' }),
  /** A real browser is needed only for Kan pages (Cloudflare challenge). `none` turns Kan VOD off. */
  browser: z
    .preprocess(withDefaultType('chrome'), z.discriminatedUnion('type', [BrowserNone, BrowserChrome]))
    .prefault({ type: 'chrome' }),
  publisher: z
    .preprocess(withDefaultType('local'), z.discriminatedUnion('type', [PublisherLocal, PublisherCloudflare]))
    .prefault({ type: 'local' }),
  /** Private stream resolver for Mako (and Kan relaying via the geo proxy). Run it on the viewer's network. */
  resolver: z
    .strictObject({
      enabled: z.boolean().default(true),
      host: z.string().default('0.0.0.0'),
      port: port.default(7701),
    })
    .prefault({}),
  /** Admin endpoints (/status, /refresh/<id>). Keep on the local network. */
  admin: z.strictObject({ host: z.string().default('0.0.0.0'), port: port.default(7702) }).prefault({}),
  schedule: z
    .strictObject({
      timezone: z.string().default('Asia/Jerusalem'),
      /** Nightly full run (cron syntax). */
      fullRun: z.string().default('30 3 * * *'),
      /** Checks of shows with a recent episode. */
      airingChecks: z.array(z.string()).default(['5 * * * *', '*/15 19-23,0 * * *']),
      /** Kan crawl slices (each reads a few pages; see scraping.browserPagesPerRun). */
      kanCrawl: z.string().default('*/10 * * * *'),
      /** A show counts as airing when it had an episode in this many days. */
      airingWindowDays: z.number().int().positive().default(14),
    })
    .prefault({}),
  scraping: z
    .strictObject({
      /** Pause between requests to the same site. */
      delayMs: z.number().int().min(0).default(1000),
      /** A run that finds fewer than this share of a source's previous shows is treated as failed. */
      minShareOfPrevious: z.number().min(0).max(1).default(0.8),
      /** Kan: browser pages per crawl slice, and the pause between pages (each page is a new browser session). */
      browserPagesPerRun: z.number().int().min(2, 'must be at least 2 (Kan has two lobby pages)').default(5),
      browserPageIntervalSec: z.number().int().min(0).default(75),
    })
    .prefault({}),
  /** Optional log file for `start` (stdout is used otherwise). Trimmed to its newest half above maxMB. */
  log: z.strictObject({ file: z.string().optional(), maxMB: z.number().positive().default(20) }).prefault({}),
  /** Optional: match shows to TMDB/IMDb so they also play when opened from other catalogs. */
  tmdb: z.strictObject({ apiKeyEnv: envName.default('TMDB_API_KEY') }).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type GeoConfig = Config['geo'];
export type BrowserConfig = Config['browser'];
export type PublisherConfig = Config['publisher'];

export class ConfigError extends Error {}

/** Sources turned on in the config, in a fixed order. */
export function enabledSources(config: Config): Source[] {
  return SOURCES.filter((s) => config.sources[s]);
}

/** The TMDB API key when TMDB matching is configured and the key is set. */
export function tmdbApiKey(
  config: Config,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return config.tmdb ? env[config.tmdb.apiKeyEnv] : undefined;
}

/** Validate a parsed config object; errors name the option and say how to fix it. */
export function parseConfig(raw: unknown, source = 'israel-tv.config.json'): Config {
  const r = ConfigSchema.safeParse(raw ?? {});
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => {
    const path = i.path.join('.') || '(root)';
    return `  - ${path}: ${i.message}`;
  });
  throw new ConfigError(
    `Invalid ${source}:\n${lines.join('\n')}\nSee docs/configuration.md for every option and its default.`,
  );
}

/** Which option needs each secret, for error messages. */
export function secretOwners(config: Config): { option: string; name: string }[] {
  const out: { option: string; name: string }[] = [];
  if (config.geo.type !== 'none') {
    if (config.geo.usernameEnv) out.push({ option: 'geo.usernameEnv', name: config.geo.usernameEnv });
    if (config.geo.passwordEnv) out.push({ option: 'geo.passwordEnv', name: config.geo.passwordEnv });
  }
  if (config.publisher.type === 'cloudflare') {
    out.push({ option: 'publisher.accountIdEnv', name: config.publisher.accountIdEnv });
    out.push({ option: 'publisher.apiTokenEnv', name: config.publisher.apiTokenEnv });
  }
  if (config.tmdb) out.push({ option: 'tmdb.apiKeyEnv', name: config.tmdb.apiKeyEnv });
  return out;
}

export function checkSecrets(
  config: Config,
  env: Record<string, string | undefined>,
  envFile?: string,
): void {
  const missing = secretOwners(config).filter((s) => !env[s.name]);
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing secrets: ${missing.map((m) => `${m.name} (needed by ${m.option})`).join(', ')}.\n` +
        `Add them to ${envFile ?? '.env next to israel-tv.config.json'} (see .env.example), ` +
        'or remove the option that needs them from the config.',
    );
  }
}
