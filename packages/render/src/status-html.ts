// The public status page (/status): for viewers first, in plain words — is everything working, and what does it mean
// for watching — then a card per row, the live channels and, folded away, the details contributors need. Rendered
// from the status file alone (the same data as /status.json), pre-rendered; a few lines of script only make the
// times relative.

import { type Health, type StatusCatalog, type StatusFile, sitePaths } from '@israel-tv/core';
import { style } from './assets.ts';
import { fillChip } from './library-html.ts';
import { CATALOG_MARK, catalogAppName, catalogName, sourceName } from './names.ts';
import {
  bdi,
  esc,
  externalLinks,
  footer,
  head,
  israelTime,
  logoTile,
  num,
  siteNav,
  topBar,
  when,
} from './page.ts';
import { type PublicTextOptions, publicStatus } from './public-text.ts';

export type Level = Health | 'info';
type Source = StatusFile['sources'][number];

const list = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** Kan's archive is a long back catalogue read last: still filling is expected there, not a problem. */
const LATER = new Set(['iltv_kanarchive']);

/** How one row stands, in a word and a sentence. */
export function rowState(
  c: StatusCatalog,
  s: Source | undefined,
  status: StatusFile,
): { level: Level; label: string; line: string } {
  if (c.source === 'live') {
    const ch = status.live?.channels ?? [];
    const down = ch.filter((x) => x.state === 'down');
    const checked = ch.filter((x) => x.state !== 'unchecked');
    if (s?.health === 'error' && down.length === 0)
      return {
        level: 'error',
        label: 'Not checked lately',
        line: 'The daily check of the live channels has not run lately. They usually play anyway.',
      };
    if (checked.length > 0 && down.length === checked.length)
      return {
        level: 'error',
        label: 'Not playing',
        line: 'None of the live channels played in the last check.',
      };
    if (down.length)
      return {
        level: 'warn',
        label: `${down.length} not playing`,
        line: `${checked.length - down.length} of ${checked.length} checked channels played in the last check.`,
      };
    return {
      level: 'ok',
      label: 'Playing',
      line: checked.length
        ? `All ${checked.length} checked channels played in the last check.`
        : 'Every live stream is played once a day to make sure it works.',
    };
  }
  if (!s) return { level: 'info', label: 'Off', line: 'This instance does not read this channel.' };
  if (s.health === 'error')
    return {
      level: 'error',
      label: 'Not refreshing',
      line: 'Reading the channel’s site is failing. Everything already here still plays; the newest episodes may be missing until it is fixed.',
    };
  if (c.filling)
    return {
      level: LATER.has(c.id) ? 'info' : 'warn',
      label: 'Still filling',
      line: `${num(c.filling.inCatalog)} of ${num(c.filling.known)} shows are in so far; the rest arrive over the next days.${c.filling.inCatalog > 0 ? ' Shows already here play normally.' : ''}`,
    };
  // A Kan row whose source is amber only because another Kan row is still filling is fine.
  const fillingElsewhere =
    s.source === 'kan' && (status.catalogs ?? []).some((x) => x.source === 'kan' && x.filling);
  // A read that failed outright but is retried soon (Kan's slices: a bot check, the browser not starting).
  if (s.health === 'warn' && s.lastFullRun?.status === 'failed')
    return {
      level: 'warn',
      label: 'Paused',
      line: `Reading ${s.source === 'kan' ? 'Kan’s' : 'the channel’s'} site is paused for now and is tried again shortly. Everything here still plays.`,
    };
  if (s.health === 'warn' && !fillingElsewhere)
    return {
      level: 'warn',
      label: 'Partly refreshed',
      line: 'The last refresh missed some shows; they are tried again. Everything here still plays.',
    };
  return {
    level: 'ok',
    label: 'Up to date',
    line:
      c.source === 'mako'
        ? 'Shows and episodes are up to date. Episodes play through your own home helper.'
        : 'Shows and episodes are up to date.',
  };
}

export interface Overall {
  level: Level;
  title: string;
  detail: string;
}

/** The one line at the top: is everything working, and what it means for watching. */
export function overall(raw: StatusFile): Overall {
  const status = raw;
  const bySource = new Map(status.sources.map((s) => [s.source, s]));
  const rows = (status.catalogs ?? []).map((c) => ({ c, st: rowState(c, bySource.get(c.source), status) }));
  const down = (status.live?.channels ?? []).filter((x) => x.state === 'down');
  const liveLine = down.length
    ? ` ${down.length === 1 ? 'One live channel is' : `${down.length} live channels are`} not playing right now.`
    : '';
  if (status.publish)
    return {
      level: 'error',
      title: 'The catalog is not being updated right now',
      detail: `Everything already in it still plays. New episodes will show up once updating works again.${liveLine}`,
    };
  const failing = [
    ...new Set(
      (rows.length
        ? rows.filter((r) => r.st.level === 'error' && r.c.source !== 'live').map((r) => r.c.source)
        : status.sources.filter((s) => s.health === 'error' && s.source !== 'live').map((s) => s.source)
      ).map((s) => sourceName(s)),
    ),
  ];
  if (failing.length)
    return {
      level: 'error',
      title: `${list(failing)} ${failing.length === 1 ? 'is' : 'are'} not being refreshed`,
      detail: `Shows already in the catalog still play; the newest episodes may be missing until it is fixed.${liveLine}`,
    };
  const filling = rows.filter((r) => r.c.filling && !LATER.has(r.c.id));
  const warn = rows.filter((r) => r.st.level === 'warn' && !r.c.filling);
  if (warn.length || down.length || (!rows.length && status.health === 'warn' && !filling.length))
    return {
      level: 'warn',
      title: 'Mostly working',
      detail: `You can watch as usual.${
        warn.filter((r) => r.c.source !== 'live').length
          ? ` The last refresh of ${list([...new Set(warn.filter((r) => r.c.source !== 'live').map((r) => sourceName(r.c.source)))])} missed a few shows; they are tried again.`
          : ''
      }${liveLine}`,
    };
  if (filling.length)
    return {
      level: 'info',
      title: `${list([...new Set(filling.map((r) => sourceName(r.c.source)))])} shows are still being added`,
      detail:
        'Everything else is up to date. A new row fills over a few days; the shows already in it play normally.',
    };
  return {
    level: 'ok',
    title: 'Everything is working',
    detail: 'All channels are up to date and the live channels are playing.',
  };
}

const DAY_WORD: Record<string, string> = {
  ok: 'all good',
  warn: 'some problems',
  error: 'failed',
  none: 'no refresh',
};

function historyBar(days: string[], values: (Health | null)[] | undefined): string {
  if (!values?.length) return '';
  const count = (h: Health | null) => values.filter((v) => v === h).length;
  const label = `Last ${values.length} days: ${count('ok')} good, ${count('warn')} with problems, ${count('error')} failed, ${count(null)} without a refresh`;
  const dayLabel = (d: string) =>
    new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      Date.parse(`${d}T12:00:00Z`),
    );
  return `<div class="hist-wrap"><div class="hist" role="img" aria-label="${esc(label)}">${values
    .map(
      (v, i) =>
        `<span class="d ${v ?? 'none'}" title="${esc(`${dayLabel(days[i] ?? '')}: ${DAY_WORD[v ?? 'none']}`)}"></span>`,
    )
    .join(
      '',
    )}</div><div class="hist-legend small muted"><span>${values.length} days ago</span><span>${count('ok')} of ${values.length - count(null)} days fine</span><span>Today</span></div></div>`;
}

/** Source notes shown on a row's card as well as in the details. */
const VIEWER_NOTE = /bot check|no longer offered/i;

function card(c: StatusCatalog, status: StatusFile, logos: boolean): string {
  const s = status.sources.find((x) => x.source === c.source);
  const st = rowState(c, s, status);
  const live = c.source === 'live';
  // The live row has no single channel: the site's own icon, in the same tile.
  const tile = live
    ? `<span class="logo-tile" style="--s:44px"><img src="/${sitePaths.faviconSvg}" alt="" width="44" height="44"></span>`
    : logos
      ? logoTile(CATALOG_MARK[c.id], 44)
      : '';
  const sched = status.schedule;
  const facts: string[] = [];
  if (live) {
    const ch = status.live?.channels ?? [];
    facts.push(`<li><span>Channels</span><strong>${num(ch.length || c.shows)}</strong></li>`);
    if (status.live) facts.push(`<li><span>Last checked</span>${when(status.live.at)}</li>`);
  } else {
    facts.push(
      c.filling && c.shows === 0
        ? `<li class="wide">${fillChip(c.filling, 'en')}</li>`
        : `<li><span>Shows</span><strong>${num(c.shows)}</strong></li><li><span>Episodes</span><strong>${num(c.episodes)}</strong></li>`,
    );
    const last = s?.lastFullRun;
    if (last)
      facts.push(
        `<li><span>${c.source === 'kan' ? 'Last read' : 'Last full refresh'}</span>${
          last.status === 'running' && c.source !== 'kan' ? 'running now' : when(last.at)
        }</li>`,
      );
    if (s?.lastAiringRun) facts.push(`<li><span>New episodes checked</span>${when(s.lastAiringRun.at)}</li>`);
  }
  // Notes a viewer can use as they are (plain words, no ids): Kan's bot check, episodes Kan no longer offers.
  const said = (s?.notes ?? []).filter((n) => VIEWER_NOTE.test(n) && !/iltv_/.test(n));
  let next = '';
  if (c.source === 'kan') next = 'A few pages at a time, all day long.';
  else if (sched?.nextFullRun)
    next = `${live ? 'Next check' : 'Next full refresh'} <time datetime="${esc(sched.nextFullRun)}" data-daily data-future>${`at ${esc(sched.fullRunTime ?? israelTime(sched.nextFullRun))} Israel time`}</time>${
      !live && sched.airingChecksPerDay
        ? `; shows on the air are checked for new episodes about ${sched.airingChecksPerDay >= 24 ? 'every hour, more often in the evening' : `${sched.airingChecksPerDay} times a day`}.`
        : '.'
    }`;
  return `<article class="card row-card" aria-labelledby="row-${esc(c.id)}">
<div class="row-head">${tile}
<div class="row-title"><h3 id="row-${esc(c.id)}">${esc(catalogName(c.id, 'en'))}</h3><span class="muted small"><bdi lang="he" dir="rtl">${esc(catalogAppName(c.id))}</bdi></span></div>
<span class="pill ${st.level}">${esc(st.label)}</span></div>
<p class="row-line">${esc(st.line)}</p>
<ul class="facts">${facts.join('')}</ul>
${next ? `<p class="small muted next">${next}</p>` : ''}
${said.length ? `<ul class="small muted said">${said.map((n) => `<li>${esc(n.replace(/^./, (x) => x.toUpperCase()))}.</li>`).join('')}</ul>` : ''}
${historyBar(status.history?.days ?? [], status.history?.sources[c.source])}
</article>`;
}

function liveGrid(status: StatusFile, logos: boolean): string {
  const live = status.live;
  if (!live?.channels.length) return '';
  const word = { up: 'Playing', down: 'Not playing', unchecked: 'Not checked' } as const;
  const cls = { up: 'ok', down: 'error', unchecked: 'info' } as const;
  return `<section aria-labelledby="live-h" class="live"><div class="wrap">
<h2 id="live-h">Live channels</h2>
<p class="muted">Every live stream is played once a day. Last check: ${when(live.at)}${
    live.abroad ? ', from outside Israel' : ''
  }. Channels marked <strong>home helper</strong> play only through your own <a href="/#helper">home helper</a>.</p>
<ul class="channels">${live.channels
    .map(
      (ch) => `<li class="ch">${logoTile(logos ? { logo: ch.id } : undefined, 40)}
<span class="ch-name">${bdi(ch.name)}${ch.helper ? '<span class="tag">home helper</span>' : ''}${ch.israelOnly ? '<span class="tag">Israel only</span>' : ''}</span>
<span class="pill ${cls[ch.state]}">${word[ch.state]}</span></li>`,
    )
    .join('')}</ul></div></section>`;
}

const WARNING_WORDS: Record<string, string> = {
  'source-note': 'Notes from reading the channels’ sites',
  'source-renumbered': 'A channel renumbered an episode (ours keeps its number)',
  'episode-number-taken': 'Two episodes claimed the same number',
  'image-failed': 'Images that could not be copied',
};
const warningWord = (code: string) =>
  WARNING_WORDS[code] ?? code.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

function detailsBlock(summary: string, body: string, open = false): string {
  return `<details${open ? ' open' : ''}><summary>${summary}</summary><div class="body">${body}</div></details>`;
}

function contributorDetails(status: StatusFile): string {
  const parts: string[] = [];
  const name = (src: string) => esc(sourceName(src));
  if (status.publish || status.tmdb)
    parts.push(
      detailsBlock(
        'Publishing and matching',
        `<ul>${status.publish ? `<li>${esc(status.publish)}</li>` : ''}${status.tmdb ? `<li>${esc(status.tmdb)}</li>` : ''}</ul>`,
        true,
      ),
    );
  parts.push(
    detailsBlock(
      `Shows that could not be refreshed <span class="count">${status.failingShows.length}</span>`,
      status.failingShows.length
        ? `<p class="small muted">Their last good episodes are still in the catalog.</p><div class="table-scroll"><table><thead><tr><th>Show</th><th>Problem</th><th>Last good read</th></tr></thead><tbody>${status.failingShows
            .map(
              (f) => `<tr><td>${bdi(f.title)}</td><td>${esc(f.error)}</td><td>${when(f.lastOkAt)}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : '<p class="muted">None: every show was read in its last refresh.</p>',
    ),
  );
  const notes = status.sources.filter((s) => s.notes.length || s.lastFullRun?.error);
  if (notes.length)
    parts.push(
      detailsBlock(
        'Notes from the last runs',
        notes
          .map(
            (s) =>
              `<h3>${name(s.source)}</h3><ul>${[
                ...(s.lastFullRun?.error ? [`Last run: ${s.lastFullRun.error}`] : []),
                ...s.notes,
              ]
                .map((n) => `<li><bdi dir="auto">${esc(n)}</bdi></li>`)
                .join('')}</ul>`,
          )
          .join(''),
      ),
    );
  const blocked = status.sources.filter(
    (s) => s.blocked && (s.blocked.pending.length || s.blocked.recovered.length),
  );
  if (blocked.length)
    parts.push(
      detailsBlock(
        'Refused by a site’s bot protection',
        blocked
          .map(
            (s) =>
              `<h3>${name(s.source)}</h3><p>${s.blocked?.pending.length ? `Still waiting (${s.blocked.pending.length}): ${s.blocked.pending.map(bdi).join(', ')}` : 'Nothing waiting.'}${
                s.blocked?.nextAt ? ` Next try ${when(s.blocked.nextAt, 'en', { future: true })}.` : ''
              }</p>${s.blocked?.recovered.length ? `<p class="small muted">Read on a retry: ${s.blocked.recovered.map(bdi).join(', ')}</p>` : ''}`,
          )
          .join(''),
      ),
    );
  const empty = status.sources.filter((s) => s.emptyShows?.length);
  if (empty.length)
    parts.push(
      detailsBlock(
        `Listed by a channel with nothing to watch <span class="count">${empty.reduce((n, s) => n + (s.emptyShows?.length ?? 0), 0)}</span>`,
        `<p class="small muted">The channel’s site lists these, but has no episodes to play; they are left out of the catalog until it does.</p>${empty
          .map(
            (s) =>
              `<h3>${name(s.source)}</h3><ul class="names" lang="he" dir="rtl">${(s.emptyShows ?? []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`,
          )
          .join('')}`,
      ),
    );
  const a = status.audit;
  parts.push(
    detailsBlock(
      'Catalog check',
      a
        ? `<p>${num(a.metas)} shows checked ${when(a.at)}: ${a.problems.length ? `${a.problems.length} kind${a.problems.length === 1 ? '' : 's'} of problem.` : 'no problems.'}</p>${
            a.problems.length
              ? `<div class="table-scroll"><table><thead><tr><th>Check</th><th>Count</th><th>Examples</th></tr></thead><tbody>${a.problems
                  .map(
                    (p) =>
                      `<tr><td>${esc(p.check)}</td><td>${num(p.count)}</td><td>${p.examples.map((x) => `<code>${esc(x)}</code>`).join(' ')}</td></tr>`,
                  )
                  .join('')}</tbody></table></div>`
              : ''
          }`
        : '<p class="muted">Not run yet.</p>',
    ),
  );
  const groups = new Map<string, StatusFile['warnings']>();
  for (const w of status.warnings) groups.set(w.code, [...(groups.get(w.code) ?? []), w]);
  parts.push(
    detailsBlock(
      `Recent warnings <span class="count">${status.warnings.length}</span>`,
      status.warnings.length
        ? [...groups]
            .map(
              ([code, ws]) =>
                `<details class="inner"><summary>${esc(warningWord(code))} <span class="count">${ws.length}</span></summary><div class="body"><ul class="warn-list">${ws
                  .map(
                    (w) =>
                      `<li><span class="small muted">${when(w.at)}${w.id ? ` · <code>${esc(w.id)}</code>` : ''}</span><br><bdi dir="auto">${esc(w.message)}</bdi></li>`,
                  )
                  .join('')}</ul></div></details>`,
            )
            .join('')
        : '<p class="muted">None.</p>',
    ),
  );
  return parts.join('');
}

const STATUS_CSS = style('status.css');

const LEVEL_ICON: Record<Level, string> = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 7v6M12 17h.01"/><circle cx="12" cy="12" r="9.5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

/** The rows to show: the status file's own, or (an older file without them) one per source. */
function rowsOf(status: StatusFile): StatusCatalog[] {
  if (status.catalogs?.length) return status.catalogs;
  return status.sources.map((s) => ({
    id: s.source === 'live' ? 'iltv_live' : s.source,
    name: sourceName(s.source),
    source: s.source,
    shows: s.shows,
    episodes: s.episodes,
  }));
}

/** The public status page. */
export function renderStatusHtml(raw: StatusFile, opts: PublicTextOptions = {}): string {
  const status = publicStatus(raw, opts);
  const o = overall(status);
  // The channel tiles are published with the live row.
  const logos = !!status.live;
  const rows = rowsOf(status);
  return externalLinks(
    `${head(
      {
        lang: 'en',
        title: 'Israel TV status: is everything working?',
        description: `${o.title}. Live status of Israel TV, the free Stremio and Nuvio addon for Keshet 12, Reshet 13, Kan and Israeli live channels: what is up to date, what is playing, and the last 30 days.`,
        path: 'status',
      },
      STATUS_CSS,
    )}<body>
${topBar('en', siteNav('en', 'status', [{ href: '/#install', label: 'Install', optional: true }]))}
<main id="main">
<div class="wrap hero-status">
<div class="overall ${o.level}" role="status"><div class="dot">${LEVEL_ICON[o.level]}</div>
<div><h1>${esc(o.title)}</h1><p>${esc(o.detail)}</p></div></div>
<p class="updated">Updated ${when(status.generatedAt)}. Something not playing? <a href="https://github.com/israeltv2/israel-tv/issues/new?template=broken-source.yml">Tell us</a>.</p>
</div>
<section class="rows" aria-labelledby="rows-h"><div class="wrap">
<h2 id="rows-h">Channels</h2>
<div class="grid two three">${rows.map((c) => card(c, status, logos)).join('')}</div>
${status.history ? `<div class="legend" aria-hidden="true"><span><i style="background:var(--ok)"></i>All good</span><span><i style="background:var(--warn)"></i>Some problems</span><span><i style="background:var(--error)"></i>Failed</span><span><i style="background:var(--none)"></i>No refresh</span><span>One bar per day</span></div>` : ''}
</div></section>
${liveGrid(status, logos)}
<section aria-labelledby="details-h"><div class="wrap">
<h2 id="details-h">Details for contributors</h2>
<p class="muted">What the last runs found, for anyone helping to fix things. The same data, machine-readable: <a href="/${sitePaths.status}">status.json</a> (<a href="https://github.com/israeltv2/israel-tv/blob/main/docs/operations.md#the-public-status-page">what the fields mean</a>).</p>
${contributorDetails(status)}
</div></section>
</main>
${footer('en')}
</body></html>
`,
    'en',
  );
}
