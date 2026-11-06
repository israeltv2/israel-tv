// israel-tv-resolver: the resolver on its own (role "resolver-only"). Run `node apps/resolver/src/cli.ts help`.
// A full instance runs the resolver itself (apps/ingest's `start`); this entry point is for an install that only
// plays, from someone's published catalog.
import { parseArgs } from 'node:util';
import { ConfigError, roleOf, secretOwners } from '@israel-tv/core';
import { loadConfig, registerSecretNames } from '@israel-tv/runtime';
import { checkProxy, printEvents, remoteUrl } from './commands.ts';
import { checkCatalog } from './server.ts';
import { runResolverOnly } from './standalone.ts';

const HELP = `israel-tv-resolver <command>

  start            Run the home resolver (and the remote one, when enabled) from resolver.catalogUrl
  check-catalog    Check that resolver.catalogUrl is an Israel TV catalog this resolver understands
  check-proxy      Check that the geo proxy (outside Israel) exits in Israel
  remote-url       Print the away-from-home install link (resolver.remote)
  events           Recent plays and failures: --errors, --play <id>, --kind <k>, --since 2h, --show <id>, --limit <n>
  help             This text

Config: israel-tv.config.json with "role": "resolver-only" (see examples/resolver-only). Secrets: .env.`;

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      play: { type: 'string' },
      kind: { type: 'string' },
      errors: { type: 'boolean' },
      since: { type: 'string' },
      show: { type: 'string' },
      limit: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const cmd = values.help ? 'help' : (positionals[0] ?? 'help');
  if (cmd === 'help') {
    console.log(HELP);
    return 0;
  }
  const { config } = loadConfig(process.env, { needSecrets: cmd === 'start' });
  if (roleOf(config) !== 'resolver-only')
    throw new ConfigError(
      'this is the resolver-only entry point: set "role": "resolver-only" in the config (a full instance runs its resolver with `pnpm start`)',
    );
  registerSecretNames([...secretOwners(config).map((o) => o.name), config.resolver.remote.tokenEnv]);
  if (cmd === 'start') return runResolverOnly(config);
  if (cmd === 'check-proxy') return checkProxy(config);
  if (cmd === 'events') return printEvents(config, values);
  if (cmd === 'remote-url') {
    console.log(remoteUrl(config));
    return 0;
  }
  if (cmd === 'check-catalog') {
    const problem = await checkCatalog(config.resolver.catalogUrl ?? '');
    console.log(problem ?? 'catalog ok');
    return problem ? 1 : 0;
  }
  console.error(`unknown command ${cmd}\n\n${HELP}`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(process.env.ISRAEL_TV_DEBUG ? (err.stack ?? err.message) : err.message);
    process.exit(1);
  },
);
