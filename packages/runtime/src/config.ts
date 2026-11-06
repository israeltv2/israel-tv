import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { type Config, ConfigError, checkSecrets, parseConfig, roleOf } from '@israel-tv/core';

export const DEFAULT_CONFIG_FILE = 'israel-tv.config.json';

/** The platform's usual folder for an app's own files (config, `.env` and data together, so it moves as one). */
export function platformHome(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'israel-tv');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'israel-tv');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'israel-tv');
}

/**
 * Where this instance's config file is, and why: ISRAEL_TV_CONFIG (an explicit file), else ISRAEL_TV_HOME (a
 * folder), else an israel-tv.config.json in the current folder, else the platform's usual folder.
 */
export function configLocation(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): { file: string; why: string } {
  if (env.ISRAEL_TV_CONFIG) return { file: resolve(env.ISRAEL_TV_CONFIG), why: 'ISRAEL_TV_CONFIG' };
  if (env.ISRAEL_TV_HOME)
    return { file: join(resolve(env.ISRAEL_TV_HOME), DEFAULT_CONFIG_FILE), why: 'ISRAEL_TV_HOME' };
  const here = join(cwd, DEFAULT_CONFIG_FILE);
  if (existsSync(here)) return { file: here, why: 'the current folder' };
  return { file: join(platformHome(env), DEFAULT_CONFIG_FILE), why: "this computer's usual app folder" };
}

/**
 * Load the config (see configLocation). A missing file means "all defaults", which is a working setup inside
 * Israel. Relative paths in the config, and the `.env` file, are taken from the config's folder.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  opts: { needSecrets?: boolean } = {},
): {
  config: Config;
  file: string | undefined;
} {
  const { file } = configLocation(env);
  let raw: unknown = {};
  let found: string | undefined;
  if (existsSync(file)) {
    found = file;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new ConfigError(`${file} is not valid JSON: ${(err as Error).message}`);
    }
  } else if (env.ISRAEL_TV_CONFIG) {
    throw new ConfigError(`ISRAEL_TV_CONFIG points to ${file}, which does not exist.`);
  }
  // Secrets: .env next to the config file. Existing variables win.
  const base = dirname(file);
  const envFile = join(base, '.env');
  if (env === process.env && existsSync(envFile)) {
    process.loadEnvFile(envFile);
    warnIfShared(envFile);
  }
  const config = parseConfig(raw, found ?? DEFAULT_CONFIG_FILE);
  checkRole(config);
  if (opts.needSecrets !== false) checkSecrets(config, env, envFile);
  config.store.path = resolve(base, config.store.path);
  config.publisher.dir = resolve(base, config.publisher.dir);
  config.branding.dir = resolve(base, config.branding.dir);
  config.events.path = resolve(base, config.events.path);
  config.backup.dir = resolve(base, config.backup.dir);
  if (config.log.file) config.log.file = resolve(base, config.log.file);
  // The publish folder is emptied of stale files on every publish: it must not hold the database or log.
  const inside = (p: string) => p === config.publisher.dir || p.startsWith(config.publisher.dir + sep);
  for (const [name, p] of [
    ['store.path', config.store.path],
    ['log.file', config.log.file],
  ] as const) {
    if (p && inside(p)) {
      throw new ConfigError(
        `${name} (${p}) is inside publisher.dir (${config.publisher.dir}); use separate folders.`,
      );
    }
  }
  return { config, file: found };
}

/**
 * The secrets file should be readable by its owner only. On macOS and Linux, say so when it is not (Windows keeps
 * per-user folders private by default; the config folder is under the user's own AppData).
 */
function warnIfShared(file: string): void {
  if (process.platform === 'win32') return;
  const mode = statSync(file).mode & 0o077;
  if (mode)
    console.error(
      `warning: ${file} can be read by other users of this computer; make it private: chmod 600 "${file}"`,
    );
}

/** Each role only uses (and so only needs) its own settings; say so plainly when the config mixes them. */
export function checkRole(config: Config): void {
  const role = roleOf(config);
  const problems: string[] = [];
  if (role === 'resolver-only') {
    if (!config.resolver.catalogUrl)
      problems.push('set resolver.catalogUrl to the public catalog you use (its manifest URL)');
    if (config.publisher.type === 'cloudflare')
      problems.push(
        'remove publisher (a resolver-only instance publishes nothing; no Cloudflare token needed)',
      );
    if (config.tmdb) problems.push('remove tmdb (matching happens where the catalog is made)');
    if (!config.resolver.enabled)
      problems.push('resolver.enabled is false, so this instance would do nothing');
  }
  if (role === 'local-only' && config.publisher.type !== 'local')
    problems.push(
      'the local-only role serves the catalog on this network: set "publisher": { "type": "local" }',
    );
  if (role === 'host' && config.publisher.type !== 'cloudflare')
    problems.push(
      'the host role publishes to Cloudflare: set "publisher": { "type": "cloudflare" } (or use role "local-only" for a catalog on this network)',
    );
  if (role !== 'resolver-only' && config.resolver.catalogUrl)
    problems.push('resolver.catalogUrl is only for role "resolver-only" (this instance has its own catalog)');
  if (problems.length) throw new ConfigError(`role "${role}": ${problems.join('; ')}.`);
}
