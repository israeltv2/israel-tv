import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { type Config, ConfigError, checkSecrets, parseConfig } from '@israel-tv/core';

export const DEFAULT_CONFIG_FILE = 'israel-tv.config.json';

/**
 * Load `israel-tv.config.json` (or the file in ISRAEL_TV_CONFIG). A missing file means "all defaults",
 * which is a working setup inside Israel. Relative paths in the config are resolved from its folder.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  opts: { needSecrets?: boolean } = {},
): {
  config: Config;
  file: string | undefined;
} {
  const file = resolve(env.ISRAEL_TV_CONFIG ?? DEFAULT_CONFIG_FILE);
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
  // Secrets: .env next to the config file (or in the current folder). Existing variables win.
  const envFile = resolve(found ? resolve(found, '..') : process.cwd(), '.env');
  if (env === process.env && existsSync(envFile)) process.loadEnvFile(envFile);
  const config = parseConfig(raw, found ?? DEFAULT_CONFIG_FILE);
  if (opts.needSecrets !== false) checkSecrets(config, env, envFile);
  const base = found ? resolve(found, '..') : process.cwd();
  config.store.path = resolve(base, config.store.path);
  config.publisher.dir = resolve(base, config.publisher.dir);
  config.branding.dir = resolve(base, config.branding.dir);
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
