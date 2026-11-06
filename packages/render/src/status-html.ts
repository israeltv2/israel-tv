import type { StatusFile } from '@israel-tv/core';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const badge = (h: string) =>
  `<span class="b ${h}">${h === 'ok' ? 'OK' : h === 'warn' ? 'WARN' : 'ERROR'}</span>`;

/** A small self-contained status page (no scripts). */
export function renderStatusHtml(s: StatusFile): string {
  const sources = s.sources
    .map(
      (
        x,
      ) => `<tr><td>${esc(x.source)}</td><td>${badge(x.health)}</td><td>${x.shows}</td><td>${x.episodes}</td>
<td>${x.lastFullRun ? `${esc(x.lastFullRun.at)} ${esc(x.lastFullRun.status)}${x.lastFullRun.error ? `<br><small>${esc(x.lastFullRun.error)}</small>` : ''}` : '—'}</td>
<td>${x.lastAiringRun ? `${esc(x.lastAiringRun.at)} ${esc(x.lastAiringRun.status)}` : '—'}</td>
<td>${x.notes.map(esc).join('<br>')}</td></tr>`,
    )
    .join('');
  const failing = s.failingShows
    .map(
      (f) =>
        `<tr><td>${esc(f.id)}</td><td>${esc(f.title)}</td><td>${esc(f.error)}</td><td>${esc(f.lastOkAt)}</td></tr>`,
    )
    .join('');
  const warnings = s.warnings
    .map(
      (w) =>
        `<tr><td>${esc(w.at)}</td><td>${esc(w.id ?? '')}</td><td>${esc(w.code)}</td><td>${esc(w.message)}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Israel TV status</title><style>
body{font:14px/1.4 system-ui,sans-serif;margin:16px;background:#fff;color:#111}
@media (prefers-color-scheme:dark){body{background:#111;color:#eee}}
table{border-collapse:collapse;width:100%;margin:8px 0 24px}td,th{border-bottom:1px solid #8884;padding:4px 6px;text-align:start;vertical-align:top}
.b{padding:1px 6px;border-radius:4px;color:#fff;font-weight:600}.ok{background:#2a7}.warn{background:#c80}.error{background:#c33}
</style></head><body>
<h1>Israel TV ${badge(s.health)}</h1><p>Generated ${esc(s.generatedAt)}</p>
<h2>Sources</h2><table><tr><th>Source</th><th>Health</th><th>Shows</th><th>Episodes</th><th>Last full run</th><th>Last airing check</th><th>Notes</th></tr>${sources}</table>
<h2>Shows failing (last good data still served)</h2><table><tr><th>Id</th><th>Show</th><th>Error</th><th>Last OK</th></tr>${failing || '<tr><td colspan="4">None</td></tr>'}</table>
<h2>Recent warnings</h2><table><tr><th>When</th><th>Id</th><th>Code</th><th>Message</th></tr>${warnings || '<tr><td colspan="4">None</td></tr>'}</table>
</body></html>`;
}
