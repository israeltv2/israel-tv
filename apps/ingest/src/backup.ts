// Nightly backup of the catalog database (the one that holds the ids and the numbering), keeping a week.
// One consistent copy per day (`VACUUM INTO`), named israel-tv-YYYY-MM-DD.sqlite; older ones are removed. Only
// files this produced (that name pattern, in the backup folder) are ever removed.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Config } from '@israel-tv/core';
import type { Store } from '@israel-tv/store';

const NAME = /^israel-tv-(\d{4}-\d{2}-\d{2})\.sqlite$/;

export function backupCatalog(
  store: Store,
  opts: Config['backup'],
  now = Date.now(),
): { file?: string; bytes?: number; removed: string[] } {
  if (opts.keepDays === 0) return { removed: [] };
  mkdirSync(opts.dir, { recursive: true });
  const day = new Date(now).toISOString().slice(0, 10);
  const file = join(opts.dir, `israel-tv-${day}.sqlite`);
  if (existsSync(file)) rmSync(file);
  store.backupTo(file);
  const oldest = new Date(now - (opts.keepDays - 1) * 86_400_000).toISOString().slice(0, 10);
  const removed: string[] = [];
  for (const f of readdirSync(opts.dir)) {
    const m = NAME.exec(f);
    if (m?.[1] && m[1] < oldest) {
      rmSync(join(opts.dir, f));
      removed.push(f);
    }
  }
  return { file, bytes: statSync(file).size, removed };
}

/**
 * A restore check of a backup copy: it opens on its own, passes SQLite's integrity check, and holds the series ids.
 * Run after each nightly backup; the result shows on the dashboard.
 */
export function checkBackup(file: string): string {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = (db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string })
      .integrity_check;
    const series = (db.prepare('select count(*) as n from series').get() as { n: number }).n;
    return integrity === 'ok'
      ? `ok: opens, integrity ok, ${series} series`
      : `failed: integrity ${integrity}`;
  } finally {
    db.close();
  }
}
