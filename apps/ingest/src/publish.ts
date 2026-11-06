// Publish: render the site from the store, write only changed files, then hand the folder to the
// configured publisher (local: nothing more to do; cloudflare: wrangler deploy with an API token).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALOGS,
  type Config,
  enabledSources,
  type Health,
  HOUR_MS,
  type PublisherConfig,
  type Source,
  type StatusFile,
  sitePaths,
} from '@israel-tv/core';
import { type LiveChannelRender, type RenderShow, renderSite, type SiteFiles } from '@israel-tv/render';
import type { RunKind, ShowRow, Store } from '@israel-tv/store';
import { liveRender } from './live.ts';
import { episodeCount } from './runner.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const VERSION = '1.0.0';

/** How each source is read, for judging its health. Kan is read in small crawl slices that may back off. */
const READS: Record<Source, { kind: RunKind; failedIs: Health; lastGood: 'latest' | 'any' }> = {
  mako: { kind: 'full', failedIs: 'error', lastGood: 'latest' },
  reshet: { kind: 'full', failedIs: 'error', lastGood: 'latest' },
  kan: { kind: 'crawl', failedIs: 'warn', lastGood: 'any' },
  live: { kind: 'full', failedIs: 'error', lastGood: 'latest' },
};

export function buildStatus(
  store: Store,
  sources: Source[],
  now = Date.now(),
  all: ShowRow[] = store.listShows(),
): StatusFile {
  const out: StatusFile['sources'] = [];
  for (const source of sources) {
    const read = READS[source];
    const shows = all.filter((s) => s.source === source && s.state === 'listed');
    const episodes = shows.reduce((n, s) => n + episodeCount(s.show), 0);
    const last = store.lastRun(read.kind, source);
    const airing = store.lastRun('airing', source);
    const notes: string[] = [];
    let health: Health = 'ok';
    const lastGood =
      read.lastGood === 'any'
        ? store.lastGoodRun(read.kind, source)
        : last && last.status !== 'failed'
          ? last
          : undefined;
    if (!last) {
      health = 'warn';
      const limited = store.lastRun(read.kind, `${source}:limited`);
      notes.push(
        limited
          ? 'only a limited test run (--limit) so far; the full run follows at schedule.fullRun'
          : 'no full run yet',
      );
    } else if (last.status === 'failed') {
      health = read.failedIs;
      notes.push(`last full run failed: ${last.error ?? 'unknown error'}`);
    } else if (last.status === 'partial') {
      health = 'warn';
      notes.push(
        `last full run partial: ${last.showsFailed} ${last.showsFailed === 1 ? 'show' : 'shows'} failed`,
      );
    }
    // Time since the last good run; for a source that never had one, since its first attempt.
    const everGood = store.lastGoodRun(read.kind, source);
    const ref = everGood ?? (last ? store.firstRun(read.kind, source) : undefined);
    if (last && ref && now - Date.parse(ref.startedAt) > 36 * HOUR_MS) {
      health = 'error';
      notes.push(
        lastGood ? 'no successful run in 36 hours' : 'never succeeded, first tried over 36 hours ago',
      );
    }
    if (source === 'live') {
      if (last) notes.push(`${last.showsOk} channels answering (Mako channels are checked at play time)`);
    } else if (shows.length === 0 && last) {
      health = 'error';
      notes.push('no shows');
    }
    out.push({
      source,
      health,
      shows: source === 'live' ? (last?.showsOk ?? 0) : shows.length,
      episodes,
      ...(last
        ? {
            lastFullRun: {
              at: last.startedAt,
              status: last.status,
              ...(last.error ? { error: last.error } : {}),
            },
          }
        : {}),
      ...(airing ? { lastAiringRun: { at: airing.startedAt, status: airing.status } } : {}),
      notes,
    });
  }
  const lastPublish = store.lastRun('publish', 'cloudflare') ?? store.lastRun('publish', 'local');
  const publishNote =
    lastPublish?.status === 'failed'
      ? `last publish failed (${lastPublish.startedAt}): ${(lastPublish.error ?? '').split('\n')[0]}`
      : undefined;
  const failingShows = all
    .filter((s) => s.lastError && s.state === 'listed')
    .map((s) => ({ id: s.seriesId, title: s.title, error: s.lastError ?? '', lastOkAt: s.lastOkAt }));
  const warnings = store.recentWarnings(50).map((w) => ({
    at: w.createdAt,
    code: w.code,
    message: w.message,
    ...(w.seriesId ? { id: w.seriesId } : {}),
  }));
  const worst: Health =
    out.some((s) => s.health === 'error') || publishNote
      ? 'error'
      : out.some((s) => s.health === 'warn') || failingShows.length > 0
        ? 'warn'
        : 'ok';
  return {
    generatedAt: new Date(now).toISOString(),
    health: worst,
    ...(publishNote ? { publish: publishNote } : {}),
    sources: out,
    failingShows,
    warnings,
  };
}

export function catalogWarnings(status: StatusFile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of status.sources) {
    if (s.health !== 'error') continue;
    const day = s.lastFullRun?.at.slice(0, 10) ?? '';
    for (const c of CATALOGS.filter((x) => x.source === s.source).map((x) => x.id)) {
      out[c] = `עדכון ${s.source} נכשל ${day} · ${s.notes[0] ?? ''}`.trim();
    }
  }
  return out;
}

export function renderFromStore(store: Store, config: Config, live: LiveChannelRender[]): SiteFiles {
  const rows = store.listShows();
  const status = buildStatus(store, activeSources(config), Date.now(), rows);
  const registry = store.registry();
  const seasonsBy = groupBy(registry.seasons, (x) => x.seriesId);
  const episodesBy = groupBy(registry.episodes, (x) => x.seriesId);
  const shows: RenderShow[] = rows.map((r) => ({
    seriesId: r.seriesId,
    catalog: r.catalog,
    title: r.title,
    show: r.show,
    seasons: (seasonsBy.get(r.seriesId) ?? []).map(({ key, number, kind }) => ({ key, number, kind })),
    episodes: (episodesBy.get(r.seriesId) ?? []).map(({ key, season, episode }) => ({
      key,
      season,
      episode,
    })),
    latestAirDate: r.latestAirDate,
    latestEpisodeSeenAt: r.latestEpisodeSeenAt,
    state: r.state,
    tmdbId: r.tmdbId,
    imdbId: r.imdbId,
  }));
  return renderSite({
    version: VERSION,
    sources: enabledSources(config),
    shows,
    live,
    status,
    registry,
    catalogWarnings: catalogWarnings(status),
  });
}

function groupBy<T>(list: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

const HEADERS_FILE = `/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=600
/manifest.json
  Cache-Control: public, max-age=3600
/streams/*
  Cache-Control: public, max-age=300
/status*
  Cache-Control: no-store
`;

function* walk(dir: string): Generator<string> {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const MARKER = '.israel-tv-site';

/** Status files carry a timestamp; compare them without it so a quiet run changes nothing. */
const comparable = (content: string) => content.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '');

/**
 * Write the site to `dir`, touching only files whose content changed, and delete files no longer
 * rendered. The folder is marked as ours on first write; a non-empty folder without the mark is never
 * cleaned (so a misconfigured `publisher.dir` cannot delete other files).
 */
export function writeSite(
  dir: string,
  files: SiteFiles,
): { written: number; deleted: number; total: number; changed: string[] } {
  mkdirSync(dir, { recursive: true });
  const marked = existsSync(join(dir, MARKER));
  if (!marked && readdirSync(dir).length > 0) {
    throw new Error(
      `${dir} is not empty and was not created by israel-tv; set publisher.dir to an empty or new folder`,
    );
  }
  if (!marked)
    writeFileSync(join(dir, MARKER), 'Rendered addon files. Everything here is replaced on each publish.\n');
  const all = new Map(files);
  all.set('_headers', HEADERS_FILE);
  all.set('.assetsignore', `${MARKER}\n`);
  let deleted = 0;
  const changed: string[] = [];
  for (const [path, content] of all) {
    const p = join(dir, path);
    let same = false;
    try {
      const old = readFileSync(p);
      same =
        path === sitePaths.status || path === sitePaths.statusPage
          ? comparable(old.toString()) === comparable(content)
          : old.equals(Buffer.from(content));
    } catch {}
    if (!same) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
      changed.push(path);
    }
  }
  for (const p of walk(dir)) {
    const rel = relative(dir, p).split('\\').join('/');
    if (rel !== MARKER && !all.has(rel)) {
      rmSync(p);
      deleted++;
    }
  }
  return { written: changed.length, deleted, total: all.size, changed };
}

/** A publishing problem the user can fix (credentials, permissions); printed without a stack trace. */
export class PublishError extends Error {
  override name = 'PublishError';
}

/** Terminal colour codes (wrangler prints them even with NO_COLOR). */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** wrangler's own error line, e.g. "Authentication failed (status: 400) [code: 9106]", first; then a hint. */
function publishError(
  out: string,
  code: number | null,
  p: { apiTokenEnv: string; accountIdEnv: string },
): PublishError {
  const lines = out
    .replace(ANSI, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const at = lines.findIndex((l) => /^✘|\[ERROR\]/.test(l));
  const head = at >= 0 ? (lines[at] ?? '').replace(/^✘\s*/, '').replace(/^\[ERROR\]\s*/, '') : undefined;
  // The line after the error usually carries the cause ("Authentication failed (status: 400) …").
  const next = at >= 0 ? lines[at + 1] : undefined;
  const reason = head
    ? `${head}${next && /^[A-Za-z]/.test(next) ? ` ${next}` : ''}`
    : (lines.at(-1) ?? `wrangler exited with ${code}`);
  return new PublishError(
    `Cloudflare deploy failed: ${reason}\n` +
      `Check ${p.apiTokenEnv} and ${p.accountIdEnv} in .env, that the token may edit Workers scripts, and that ` +
      `your workers.dev subdomain exists (README, "Reachable from anywhere").\n` +
      `wrangler said:\n${lines.slice(-12).join('\n')}`,
  );
}

export interface DeployResult {
  ms: number;
  detail: string;
  url?: string;
}

/** Run `wrangler deploy` for the catalog Worker with the site folder as its static assets. */
async function deployCloudflare(
  p: Extract<PublisherConfig, { type: 'cloudflare' }>,
  env: NodeJS.ProcessEnv,
): Promise<DeployResult> {
  const t0 = Date.now();
  const cwd = join(REPO_ROOT, 'apps/catalog');
  const wrangler = join(cwd, 'node_modules/.bin/wrangler');
  const token = env[p.apiTokenEnv];
  const account = env[p.accountIdEnv];
  // Without the configured token wrangler would fall back to any login stored on this machine and deploy to
  // that (possibly unrelated) account. Refuse instead, and give wrangler a home of its own so it never sees
  // a stored login.
  if (!token || !account) {
    throw new PublishError(
      `Cloudflare deploy refused: ${p.apiTokenEnv} and ${p.accountIdEnv} must be set (see .env.example)`,
    );
  }
  const wranglerHome = join(dirname(p.dir), '.wrangler-home');
  mkdirSync(wranglerHome, { recursive: true });
  const childEnv: NodeJS.ProcessEnv = {
    PATH: env.PATH,
    HOME: wranglerHome,
    XDG_CONFIG_HOME: join(wranglerHome, 'config'),
    CLOUDFLARE_ACCOUNT_ID: account,
    CLOUDFLARE_API_TOKEN: token,
    WRANGLER_SEND_METRICS: 'false',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };
  const args = ['deploy', '--name', p.workerName, '--assets', p.dir];
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(wrangler, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(publishError(out, code, p))));
  });
  const url = /https:\/\/[^\s]+\.workers\.dev/.exec(output)?.[0];
  const uploaded = /Uploaded (\d+) files?/.exec(output)?.[0] ?? 'no asset changes';
  return { ms: Date.now() - t0, detail: uploaded, ...(url ? { url } : {}) };
}

export async function deploy(config: Config, env: NodeJS.ProcessEnv = process.env): Promise<DeployResult> {
  const p = config.publisher;
  if (p.type === 'local') return { ms: 0, detail: `served from ${p.dir} by the local server` };
  return deployCloudflare(p, env);
}

/**
 * Render, write the changed files and deploy them. A deploy that failed last time is retried even when
 * nothing changed since. Every attempt is recorded, so a failing publish shows on /status.
 */
export async function publishSite(
  store: Store,
  config: Config,
  log: (line: string) => void,
): Promise<boolean> {
  const t0 = Date.now();
  const kind = config.publisher.type;
  let w: ReturnType<typeof writeSite>;
  try {
    w = writeSite(
      config.publisher.dir,
      renderFromStore(store, config, config.sources.live ? liveRender() : []),
    );
  } catch (err) {
    // Render/write problems (disk full, permissions) are publish failures too, visible on /status.
    const runId = store.startRun('publish', kind);
    store.finishRun(runId, {
      status: 'failed',
      error: `writing ${config.publisher.dir} failed: ${(err as Error).message}`,
    });
    log(`publish failed: writing ${config.publisher.dir}: ${(err as Error).message}`);
    return false;
  }
  const retry = store.lastRun('publish', kind)?.status === 'failed';
  if (w.changed.length === 0 && w.deleted === 0 && !retry) {
    log('publish: nothing changed');
    return true;
  }
  const runId = store.startRun('publish', kind);
  try {
    const d = await deploy(config);
    store.finishRun(runId, { status: 'ok' });
    log(
      `publish: ${w.written} of ${w.total} files changed, ${w.deleted} removed; ${d.detail}${d.url ? ` → ${d.url}/manifest.json` : ''} (${Math.round((Date.now() - t0) / 1000)} s)`,
    );
    return true;
  } catch (err) {
    store.finishRun(runId, { status: 'failed', error: (err as Error).message });
    log(`publish failed: ${(err as Error).message}`);
    return false;
  }
}

/** Sources that actually run: Kan needs a browser as well as `sources.kan`. */
export function activeSources(config: Config): Source[] {
  return enabledSources(config).filter((s) => s !== 'kan' || config.browser.type !== 'none');
}
