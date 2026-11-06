# Contributing to Israel TV

Thanks for helping. The most common contributions are reporting a channel that stopped working, fixing the code that
reads a channel's site when it changes, and adding a channel. You need **no accounts and no credentials** for any of
them: tests run on recorded real responses, never against the live sites.

## Ways to help

- **Report** a show that is missing or does not play: the
  [broken source](https://github.com/israeltv2/israel-tv/issues/new?template=broken-source.yml) form (which show, which
  episode, inside or outside Israel, what the app showed).
- **Fix** a source whose site changed (see [Fix a broken source](#fix-a-broken-source)).
- **Add** a channel or a source (see [Add a channel](#add-a-channel)).
- **Improve the docs**: unclear words, missing steps.

## Set up (5 minutes)

Node.js 24.11+, git, and pnpm (`corepack enable`, or `npm i -g pnpm@12.15.0`):

```bash
git clone https://github.com/israeltv2/israel-tv.git && cd israel-tv
pnpm install
pnpm check           # typecheck, lint, boundaries, hygiene, tests — what CI runs
```

Run it locally with `pnpm start --no-initial-run` (or `pnpm smoke` to start the roles that need no account and fetch
their manifests). `pnpm israel-tv help` lists the commands.

## Project structure

| Folder                                                                         | One job                                                                                              |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [apps/ingest](apps/ingest)                                                     | Reads the sites, owns the catalog database, renders and publishes; the full instance's command line. |
| [apps/catalog](apps/catalog)                                                   | The two Cloudflare Workers: public data Worker (files + router) and private API Worker.              |
| [apps/resolver](apps/resolver)                                                 | The home helper: Mako passes and the geo relay; reads the catalog through its contract.              |
| [packages/mako](packages/mako), [reshet](packages/reshet), [kan](packages/kan) | One source each: how its site is read (parsers and fixtures).                                        |
| [packages/core](packages/core)                                                 | Config schema, ids, the contracts shared by everything.                                              |
| [packages/addon](packages/addon), [render](packages/render)                    | The addon app the catalog serves; the files it serves.                                               |
| [packages/store](packages/store), [events](packages/events)                    | The catalog database; usage and diagnostics events.                                                  |
| [packages/net](packages/net), [runtime](packages/runtime)                      | Polite fetching and proxies; config loading, logging, serving.                                       |

Each has a README with its responsibility, what it must not do, and how to test it alone. How the parts fit:
[docs/architecture.md](docs/architecture.md). Why things are as they are, with measurements:
[docs/decisions.md](docs/decisions.md).

**Imports:** other workspace packages only by name (`@israel-tv/core`, or a declared subpath like
`@israel-tv/core/router-contract`), never by path; inside a package, relative imports. The boundaries (the resolver
never touches ingest or the catalog database; the Workers use no Node built-ins; packages never import apps; no cycles)
are checked by `pnpm boundaries`.

## Fix a broken source

1. Find what changed: open the show's page on the broadcaster's site in a browser and compare with the recorded page
   in `packages/<source>/test/fixtures/`.
2. **Record** the new real response as a fixture (unedited, trimmed only of anything personal; never tickets or
   tokens) — see the source package's README for how.
3. Update the parser in `packages/<source>/src/` until the tests pass with both the old and the new fixture where the
   site serves both.
4. `pnpm check`. Ids and numbers come from the source, never from list position: existing episodes must keep theirs.

## Add a channel

Live channels are listed in [packages/core/src/live.ts](packages/core/src/live.ts) (direct streams, or Mako ids for
channels that need the home helper). A new on-demand source is a new package with the same shape as
[packages/reshet](packages/reshet): a client that lists shows and episodes, parsers with fixtures, and an adapter
registered in `apps/ingest`. Open an issue first to agree on the approach.

## Rules

- **Clean room:** other community addons for these sites have no license. Study the sites' public behaviour; never
  copy code from other addons.
- **Be polite to the sites:** at most one request a second; never contact them from tests or CI.
- **Failures are visible:** keep the last good data and report the problem on `/status`; never silently drop shows.
- **Privacy:** no personal data, real names, home addresses, IPs or secrets in code, fixtures, docs or commits. Secrets
  live in `.env`, outside the repository.
- **No funding links** of any kind.

## Commits and pull requests

- Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/) (`fix(kan): …`,
  `feat: …`, `docs: …`); they become the commit message and the changelog (CI checks the title).
- One topic per pull request; add or update tests; update the docs a change affects.
- Checklist: `pnpm check` passes · new behaviour has a test · docs updated · nothing personal or secret added.

Releases are made by the maintainers from the release pull request that release-please keeps open.

## Conduct and security

[Code of conduct](CODE_OF_CONDUCT.md). Security problems: please do not open a public issue — see
[SECURITY.md](SECURITY.md).
