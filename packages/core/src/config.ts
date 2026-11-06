// The one config file (`israel-tv.config.json`). Every option has a default except where noted; secrets
// are never written here, only the names of the environment variables (from `.env`) that hold them.

import { z } from 'zod';

const port = z.number().int().min(1).max(65535);
const envName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/, 'must be an environment variable name like MY_SECRET');

const GeoNone = z.strictObject({ type: z.literal('none') });
const GeoProxy = z.strictObject({
  /** `http-proxy` covers both http:// and https:// proxy URLs. */
  type: z.enum(['http-proxy', 'socks5']),
  /** One or more proxy URLs with an Israeli exit, tried in order (the next is used when one fails). */
  urls: z.array(z.url()).min(1),
  /** Env var names holding the proxy credentials. Leave both out for a proxy without a login. */
  usernameEnv: envName.optional(),
  passwordEnv: envName.optional(),
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
  port: port.default(7000),
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
});

export const ConfigSchema = z.strictObject({
  /** Home database (SQLite file). Holds the id registry, numbering and last good data. */
  store: z.strictObject({ path: z.string().default('./data/israel-tv.sqlite') }).prefault({}),
  sources: z
    .strictObject({
      mako: z.boolean().default(true),
      reshet: z.boolean().default(true),
      kan: z.boolean().default(true),
      live: z.boolean().default(true),
    })
    .prefault({}),
  /** How to reach Israel-only content. `none` is right when this runs inside Israel. */
  geo: z.discriminatedUnion('type', [GeoNone, GeoProxy]).prefault({ type: 'none' }),
  /** A real browser is needed only for Kan pages (Cloudflare challenge). `none` turns Kan VOD off. */
  browser: z.discriminatedUnion('type', [BrowserNone, BrowserChrome]).prefault({ type: 'chrome' }),
  publisher: z.discriminatedUnion('type', [PublisherLocal, PublisherCloudflare]).prefault({ type: 'local' }),
  /** Private stream resolver for Mako (and Kan relaying via the geo proxy). Run it on the viewer's network. */
  resolver: z
    .strictObject({
      enabled: z.boolean().default(true),
      host: z.string().default('0.0.0.0'),
      port: port.default(7001),
    })
    .prefault({}),
  /** Admin endpoints (/status, /refresh/<id>). Keep on the local network. */
  admin: z.strictObject({ host: z.string().default('0.0.0.0'), port: port.default(7002) }).prefault({}),
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
      browserPagesPerRun: z.number().int().positive().default(5),
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

/** Look up the secrets a config needs; reports every missing variable at once. */
export function requiredSecrets(config: Config): string[] {
  const names: string[] = [];
  if (config.geo.type !== 'none') {
    if (config.geo.usernameEnv) names.push(config.geo.usernameEnv);
    if (config.geo.passwordEnv) names.push(config.geo.passwordEnv);
  }
  if (config.publisher.type === 'cloudflare')
    names.push(config.publisher.accountIdEnv, config.publisher.apiTokenEnv);
  if (config.tmdb) names.push(config.tmdb.apiKeyEnv);
  return names;
}

export function checkSecrets(config: Config, env: Record<string, string | undefined>): void {
  const missing = requiredSecrets(config).filter((n) => !env[n]);
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing secrets in the environment: ${missing.join(', ')}.\n` +
        'Put them in .env (see .env.example), or remove the option that needs them from israel-tv.config.json.',
    );
  }
}
