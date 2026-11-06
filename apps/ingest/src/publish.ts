// Publish: render the site from the store, write only changed files, then hand the folder to the
// configured publisher (local: nothing more to do; cloudflare: wrangler deploy with an API token).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config, Health, PublisherConfig, Source, StatusFile } from '@israel-tv/core';
import { type LiveChannelRender, type RenderShow, renderSite, type SiteFiles } from '@israel-tv/render';
import type { Store } from '@israel-tv/store';
import { liveRender } from './live.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const VERSION = '1.0.0';

/** Catalog row for each source's warnings. */
const SOURCE_CATALOGS: Record<Source, string[]> = {
  mako: ['iltv_keshet12'],
  reshet: ['iltv_reshet13'],
  kan: ['iltv_kan11', 'iltv_kankids'],
  live: ['iltv_live'],
};

const HOURS = 3_600_000;

export function buildStatus(store: Store, sources: Source[], now = Date.now()): StatusFile {
  const all = store.listShows();
  const out: StatusFile['sources'] = [];
  for (const source of sources) {
    const shows = all.filter((s) => s.source === source && s.state === 'listed');
    const episodes = shows.reduce((n, s) => n + s.show.seasons.reduce((m, x) => m + x.episodes.length, 0), 0);
    // Kan is read in small crawl slices rather than full runs.
    const full = source === 'kan' ? store.lastRun('crawl', 'kan') : store.lastRun('full', source);
    const airing = store.lastRun('airing', source);
    const notes: string[] = [];
    let health: Health = 'ok';
    const lastOkFull =
      source === 'kan'
        ? store.lastGoodRun('crawl', 'kan')
        : full && full.status !== 'failed'
          ? full
          : undefined;
    if (!full) {
      health = 'warn';
      notes.push('no full run yet');
    } else if (full.status === 'failed') {
      // A Kan slice that hit a challenge backs off and retries; only a long run of them is an error.
      health = source === 'kan' ? 'warn' : 'error';
      notes.push(`last full run failed: ${full.error ?? 'unknown error'}`);
    } else if (full.status === 'partial') {
      health = 'warn';
      notes.push(`last full run partial: ${full.showsFailed} shows failed`);
    }
    // Time since the last good run; for a source that never had one, since its first attempt.
    const ref =
      lastOkFull ?? (full ? store.firstRun(source === 'kan' ? 'crawl' : 'full', source) : undefined);
    if (full && ref && now - Date.parse(ref.startedAt) > 36 * HOURS) {
      health = 'error';
      notes.push(
        lastOkFull ? 'no successful run in 36 hours' : 'never succeeded, first tried over 36 hours ago',
      );
    }
    if (source !== 'live' && shows.length === 0 && full) {
      health = 'error';
      notes.push('no shows');
    }
    out.push({
      source,
      health,
      shows: source === 'live' ? (full?.showsOk ?? 0) : shows.length,
      episodes,
      ...(full
        ? {
            lastFullRun: {
              at: full.startedAt,
              status: full.status,
              ...(full.error ? { error: full.error } : {}),
            },
          }
        : {}),
      ...(airing ? { lastAiringRun: { at: airing.startedAt, status: airing.status } } : {}),
      notes,
    });
  }
  const lastPublish = store.lastRun('publish', 'cloudflare');
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
    for (const c of SOURCE_CATALOGS[s.source as Source] ?? []) {
      out[c] = `עדכון ${s.source} נכשל ${day} · ${s.notes[0] ?? ''}`.trim();
    }
  }
  return out;
}

export function renderFromStore(store: Store, config: Config, live: LiveChannelRender[]): SiteFiles {
  const sources = (Object.keys(config.sources) as Source[]).filter((s) => config.sources[s]);
  const status = buildStatus(store, sources);
  const shows: RenderShow[] = store.listShows().map((r) => {
    const a = store.assignments(r.seriesId);
    return {
      seriesId: r.seriesId,
      catalog: r.catalog,
      title: r.title,
      show: r.show,
      seasons: a.seasons,
      episodes: a.episodes,
      latestAirDate: r.latestAirDate,
      latestEpisodeSeenAt: r.latestEpisodeSeenAt,
      state: r.state,
      tmdbId: r.tmdbId,
      imdbId: r.imdbId,
    };
  });
  return renderSite({
    version: VERSION,
    sources,
    shows,
    live,
    status,
    registry: store.registry(),
    catalogWarnings: catalogWarnings(status),
  });
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

const hash = (s: string | Buffer) => createHash('sha1').update(s).digest('hex');

const MARKER = '.israel-tv-site';

/** Status files carry a timestamp; compare them without it so a quiet run changes nothing. */
const comparable = (path: string, content: string | Buffer) =>
  path === 'status.json' || path === 'status.html'
    ? String(content)
        .replace(/"generatedAt":"[^"]*"/, '')
        .replace(/<p>Generated [^<]*<\/p>/, '')
    : content;

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
      same = hash(comparable(path, readFileSync(p))) === hash(comparable(path, content));
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
  const childEnv: NodeJS.ProcessEnv = {
    PATH: env.PATH,
    HOME: env.HOME,
    CLOUDFLARE_ACCOUNT_ID: env[p.accountIdEnv],
    CLOUDFLARE_API_TOKEN: env[p.apiTokenEnv],
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
    child.on('close', (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`wrangler deploy failed (exit ${code}):\n${out.slice(-2000)}`)),
    );
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
  const files = renderFromStore(store, config, config.sources.live ? liveRender() : []);
  const w = writeSite(config.publisher.dir, files);
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
