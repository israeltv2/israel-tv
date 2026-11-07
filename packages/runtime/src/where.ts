// Where things are and how to reach them, printed by the app itself (`israel-tv paths`, `israel-tv urls`, and at
// start), so no guide has to tell anyone to run an operating-system command to find a folder or an address.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type Config, roleOf } from '@israel-tv/core';
import { configLocation } from './config.ts';
import { lanAddresses } from './serve.ts';

/** This instance's files: the config, the secrets file and the data, with whether each exists yet. */
export function instancePaths(
  config: Config,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const { file, why } = configLocation(env);
  const mark = (p: string) => `${p}${existsSync(p) ? '' : '   (not created yet)'}`;
  const lines = [
    `Config folder (${why}): ${dirname(file)}`,
    `  config file   ${mark(file)}`,
    `  secrets file  ${mark(join(dirname(file), '.env'))}`,
  ];
  if (roleOf(config) !== 'resolver-only') {
    lines.push(`  catalog data  ${mark(config.store.path)}`, `  addon files   ${mark(config.publisher.dir)}`);
    lines.push(`  backups       ${mark(config.backup.dir)}`);
  }
  lines.push(`  usage events  ${mark(config.events.path)}`);
  if (config.log.file) lines.push(`  log files     ${mark(dirname(config.log.file))}`);
  lines.push(
    '',
    'Use another folder: set ISRAEL_TV_HOME to it (or ISRAEL_TV_CONFIG to a config file); relative paths in the',
    'config are taken from the config file’s folder.',
  );
  return lines;
}

/** The links to install in an app, as reachable from other devices on this network. */
export function instanceUrls(config: Config): string[] {
  const role = roleOf(config);
  const at = (host: string, port: number, path: string) =>
    lanAddresses(host).map((a) => `http://${a}:${port}${path}`);
  const lines: string[] = [];
  if (role !== 'resolver-only' && config.publisher.type === 'local')
    lines.push(
      `Addon (catalog):   ${at(config.publisher.host, config.publisher.port, '/manifest.json').join('  ')}`,
    );
  if (role === 'host' && config.publisher.type === 'cloudflare')
    lines.push(
      `Addon (catalog):   ${config.publisher.publicUrl ? `${config.publisher.publicUrl.replace(/\/+$/, '')}/manifest.json` : 'your workers.dev address (printed after the first publish)'}`,
    );
  if (config.resolver.enabled)
    lines.push(
      `Home helper (resolver): ${at(config.resolver.host, config.resolver.port, '/manifest.json').join('  ')}`,
    );
  if (role !== 'resolver-only')
    lines.push(
      `Dashboard (this network only): ${at(config.admin.host, config.admin.port, '/dash/').join('  ')}  (\`admin-url\` adds your token)`,
    );
  if (config.resolver.remote.enabled)
    lines.push(
      'Helper through your tunnel: `remote-url` prints the link with its token. Install that one instead of the home-network link: it works at home and away',
    );
  return lines;
}
