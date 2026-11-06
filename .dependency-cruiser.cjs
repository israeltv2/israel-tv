// Architecture boundaries, checked in CI (`pnpm boundaries`). They are the code-level form of "one job per part"
// (docs/architecture.md): the resolver plays from the published catalog and never touches ingest or the catalog
// database; the Workers run on Cloudflare and use no Node-only modules; packages never import apps; no cycles.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-cycles',
      severity: 'error',
      from: {},
      // A type-only import (e.g. a module naming the Daemon type it is given) is no runtime cycle.
      to: { circular: true, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'packages-not-apps',
      comment: 'Shared packages are building blocks: they never depend on an app.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'apps-not-each-other-except-ingest-resolver',
      comment:
        'Apps do not reach into each other; only ingest (a full instance) runs the resolver it ships with.',
      severity: 'error',
      from: { path: '^apps/(resolver|catalog)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'resolver-not-ingest-or-catalog-db',
      comment: 'The resolver plays from the published contract files only (docs/contract.md).',
      severity: 'error',
      from: { path: '^apps/resolver/' },
      to: { path: '^(apps/ingest|packages/(store|render|kan|reshet))/' },
    },
    {
      name: 'workers-no-node',
      comment:
        'The Cloudflare Workers (router and API) run without Node: no node: modules, no Node-only packages.',
      severity: 'error',
      from: { path: '^apps/catalog/src/' },
      to: {
        dependencyTypes: ['core'],
      },
    },
    {
      name: 'workers-only-worker-safe-packages',
      severity: 'error',
      from: { path: '^apps/catalog/src/' },
      to: { path: '^packages/(store|events|runtime|net|kan|mako|reshet|render)/' },
    },
    {
      name: 'workers-no-schemas',
      comment:
        'The Workers and the addon app use core only through its edge entry: the config/contract schemas (zod) stay out of the Worker bundle.',
      severity: 'error',
      from: { path: '^(apps/catalog/src|packages/addon/src)/' },
      to: { path: '^packages/core/src/(config|contract|model|index)\\.ts$' },
    },
    {
      name: 'router-imports-only-the-contract',
      comment: 'The data Worker’s router stays tiny and stable: it imports nothing but the router contract.',
      severity: 'error',
      from: { path: '^apps/catalog/src/router\\.ts$' },
      to: { pathNot: '^packages/core/src/router-contract\\.ts$' },
    },
    {
      name: 'dashboard-web-browser-only',
      comment:
        'The dashboard page runs in a browser: it imports its own modules, the contract (route table; types from the rest) and npm packages.',
      severity: 'error',
      from: { path: '^apps/dashboard/src/' },
      to: {
        pathNot: ['^apps/dashboard/src/', '^packages/admin-contract/', 'node_modules/'],
      },
    },
    {
      name: 'dashboard-not-ingest',
      comment: 'The dashboard knows the admin API only through its contract, never the daemon.',
      severity: 'error',
      from: { path: '^apps/dashboard/' },
      to: { path: '^(apps/(ingest|resolver|catalog)|packages/(store|events|runtime))/' },
    },
    {
      name: 'no-src-into-other-package',
      comment: 'Workspace packages are used by name, through their exports, never by path.',
      severity: 'error',
      from: { path: '^(apps|packages)/([^/]+)/' },
      to: {
        path: '^(apps|packages)/([^/]+)/',
        pathNot: ['^$1/$2/', 'node_modules'],
        dependencyTypes: ['local'],
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['node_modules', '/test/', 'spikes/', '/drizzle/', '/dist/'] },
    // TypeScript 7 has no JavaScript compiler API yet: sources are parsed with swc.
    parser: 'swc',
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default'],
      extensions: ['.ts', '.tsx', '.js'],
    },
    tsConfig: { fileName: 'tsconfig.base.json' },
  },
};
