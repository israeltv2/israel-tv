import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Config, ConfigError, checkSecrets, parseConfig } from '@israel-tv/core';

export const DEFAULT_CONFIG_FILE = 'israel-tv.config.json';

/**
 * Load `israel-tv.config.json` (or the file in ISRAEL_TV_CONFIG). A missing file means "all defaults",
 * which is a working setup inside Israel. Relative paths in the config are resolved from its folder.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): {
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
  checkSecrets(config, env);
  const base = found ? resolve(found, '..') : process.cwd();
  config.store.path = resolve(base, config.store.path);
  config.publisher.dir = resolve(base, config.publisher.dir);
  if (config.log.file) config.log.file = resolve(base, config.log.file);
  return { config, file: found };
}
