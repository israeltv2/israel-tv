# @israel-tv/runtime — what every Node process shares: config loading, logging, serving, paths

Every Israel TV process (a full instance from `apps/ingest`, or a resolver-only one from `apps/resolver`) loads
the same config the same way, logs the same way with secrets kept out, and listens on ports the same way. This
package holds that once, so both entry points behave alike on Windows, macOS and Linux.

## Responsibility

- Finding the config folder: `ISRAEL_TV_CONFIG` (a file), else `ISRAEL_TV_HOME`, else the platform's usual
  folder; reading `israel-tv.config.json` and the `.env` next to it; resolving relative paths against that folder.
- Environment-only settings for containers (`ISRAEL_TV_CATALOG_URL`, `ISRAEL_TV_PROXY`) when no config file sets
  them; checking that a config does not mix roles; checking that secrets are present.
- Warning when `.env` is readable by other users (macOS, Linux).
- JSON logging (pino) with a `component` field, rotated files when `log.file` is set; secret values and secret
  keys are redacted from every line.
- Listening with a clear message when a port is taken; the addresses other devices can use; waiting for a stop
  signal.

## Must not

- Be used by the Workers (`workers-only-worker-safe-packages`): it uses Node modules.
- Print or log a secret value.
- Know about sources, the catalog database or HTTP routes; import an app.

## Inputs and outputs

- `loadConfig(env?, { needSecrets? })` → `{ config, file }` — the validated config with absolute paths.
- `configLocation(env?)`, `platformHome(...)`, `DEFAULT_CONFIG_FILE` — where the config is, and why.
- `withEnvSettings(raw, env, hasFile)`, `checkRole(config)` — environment settings and the role check.
- `createLogger(logConfig, env?)` → `Logger` (`log`, `for(component)`, `flush`); `Log` type.
- `registerSecretNames(names)`, `secretValues(env)`, `scrub(value, secrets)` — keeping secrets out of logs.
- `listen(fetch, host, port, option)`, `lanAddresses(host)`, `stopSignal(log)` — serving.
- `instancePaths(config)`, `instanceUrls(config)` — what `paths` and `urls` print.

## Run and test it alone

```bash
pnpm --filter @israel-tv/runtime test
pnpm --filter @israel-tv/runtime typecheck
pnpm israel-tv paths      # where this computer's config, secrets file and data are
pnpm israel-tv urls       # the install links, as other devices on the network see them
```

## Related

- [../../docs/architecture.md](../../docs/architecture.md)
- [../../docs/contract.md](../../docs/contract.md)
- [../../docs/configuration.md](../../docs/configuration.md)
- [../../docs/operations.md](../../docs/operations.md)
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md)
