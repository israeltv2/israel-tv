// Preloaded in CI test runs (NODE_OPTIONS="--pending-deprecation --import ./tools/fail-on-deprecation.mjs"): a
// deprecated Node API used anywhere fails the run, except the few listed here, each from a dependency we cannot
// change (named, so it is removed when that dependency moves on).
const ALLOWED = new Map([['DEP0111', 'process.binding() in lodash.isequal, via got-scraping → ow']]);

process.on('warning', (warning) => {
  if (warning.name !== 'DeprecationWarning' || ALLOWED.has(warning.code)) return;
  throw new Error(
    `Deprecated API in use (${warning.code ?? 'no code'}): ${warning.message}\n${warning.stack ?? ''}`,
  );
});
