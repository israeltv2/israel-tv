// The dashboard's sections. Hebrew titles go in <bdi dir="auto"> so they lay out right-to-left inside English rows.
import type {
  Deploys,
  Failures,
  Live,
  Overview,
  Plays,
  Sources,
  System,
  Trace,
} from '@israel-tv/admin-contract';
import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { api } from './api.ts';
import { DayChart, Spark } from './charts.ts';

const n = (x: number | undefined) => (x === undefined ? '—' : new Intl.NumberFormat('en').format(x));
const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const when = (iso: string | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const ago = (iso: string | undefined) => {
  if (!iso) return '—';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 60
    ? `${m} min ago`
    : m < 48 * 60
      ? `${Math.round(m / 60)} h ago`
      : `${Math.round(m / 1440)} days ago`;
};
const Title = (props: { text?: string | undefined; id: string }) =>
  html`<bdi dir="auto">${props.text || props.id}</bdi>`;

function Kpi(props: { label: string; value: string; sub?: string }) {
  return html`<div class="kpi"><div class="kpi-v">${props.value}</div><div class="kpi-l">${props.label}</div>${
    props.sub ? html`<div class="muted small">${props.sub}</div>` : ''
  }</div>`;
}

export function OverviewView(props: { o: Overview; showPublic: boolean }) {
  const { home, public: pub } = props.o;
  const days = home.perDay.map((d) => d.day);
  return html`<section>
    <h2>This home <span class="muted small">(your home helper)</span></h2>
    <div class="kpis">
      <${Kpi} label="plays today" value=${n(home.today.plays)} />
      <${Kpi} label="plays, 7 days" value=${n(home.d7.plays)} sub=${`${n(home.d30.plays)} in 30 days`} />
      <${Kpi} label="devices a day" value=${n(home.d7.uniqueClients)} sub="average, 7 days" />
      <${Kpi} label="minutes relayed, 7 days" value=${n(home.d7.minutesWatched)} />
      <${Kpi} label="failure rate, 7 days" value=${pct(props.o.failureRate7d)} />
    </div>
    <${DayChart}
      title="Plays per day at home"
      days=${days}
      series=${[
        { label: 'plays', values: home.perDay.map((d) => d.plays) },
        { label: 'failures', values: home.perDay.map((d) => d.failures) },
      ]}
    />
    <h3>Most played this week</h3>
    ${home.topShows.length ? html`<ol class="list">${home.topShows.map((s) => html`<li><${Title} text=${s.title} id=${s.showId} /> <span class="muted">${s.source} · ${n(s.plays)}</span></li>`)}</ol>` : html`<p class="muted">No plays yet.</p>`}
  </section>
  ${
    props.showPublic
      ? html`  <section>
    <h2>Public link <span class="muted small">(all users, anonymous)</span></h2>
    ${pub.counted ? '' : html`<p class="warn">${pub.note ?? 'Not counted yet (Analytics Engine).'}</p>`}
    <div class="kpis">
      <${Kpi} label="stream requests, 7 days" value=${n(pub.d7.plays)} sub=${`${n(pub.d30.plays)} in 30 days`} />
      <${Kpi} label="devices a day" value=${n(pub.d7.uniqueClients)} sub="average, 7 days" />
      <${Kpi} label="last day counted" value=${pub.lastDay ?? '—'} />
    </div>
    <${DayChart} title="Public stream requests per day" days=${pub.perDay.map((d) => d.day)} series=${[{ label: 'requests', values: pub.perDay.map((d) => d.plays) }]} />
    <p class="muted small">It cannot see other people's home helpers, or browsing of rows and show pages.</p>
  </section>`
      : ''
  }`;
}

export function SourcesView(props: { s: Sources }) {
  const [msg, setMsg] = useState('');
  return html`<section>
    <h2>Sources</h2>
    <div class="table">
      ${props.s.sources.map(
        (s) => html`<div class="row">
          <div><strong>${s.source}</strong> <span class=${`badge ${s.health}`}>${s.health}</span>${s.stale ? html` <span class="badge red">stale</span>` : ''}</div>
          <div class="muted small">last good read ${ago(s.lastGoodAt)}${s.cadenceHours ? ` · expected every ${s.cadenceHours} h` : ''} · last full run ${ago(s.lastFullRun)}</div>
          ${s.canary ? html`<div class="small">canary <span class=${`badge ${s.canary.outcome === 'ok' ? 'green' : 'red'}`}>${s.canary.outcome}</span> ${ago(s.canary.at)}${s.canary.step ? ` · failed at ${s.canary.step}` : ''} <span class="muted">${s.canary.detail ?? ''}</span></div>` : ''}
          ${s.notes.map((x) => html`<div class="small warn">${x}</div>`)}
        </div>`,
      )}
    </div>
    <p>
      <button
        onClick=${async () => {
          setMsg('starting…');
          setMsg((await api.canary()).message);
        }}
      >
        Run the playback canary now
      </button>
      <span class="muted small"> ${msg}</span>
    </p>
    <h3>Proxy</h3>
    <p class="small">
      ${props.s.proxy.servers.length ? props.s.proxy.servers.join(', ') : 'none (inside Israel)'}
      ${props.s.proxy.lastError ? html`<br /><span class="warn">last error ${ago(props.s.proxy.lastErrorAt)}: ${props.s.proxy.lastError}</span>` : ''}
    </p>
    ${
      props.s.kan
        ? html`<h3>Kan reading</h3><p class="small">${n(props.s.kan.pending)} episode pages still to read, ${n(props.s.kan.shows)} shows known${props.s.kan.backoffUntil ? html` · <span class="warn">pausing until ${when(props.s.kan.backoffUntil)}</span>` : ''}</p>`
        : ''
    }
  </section>`;
}

export function PlaysView(props: { p: Plays }) {
  const days = [...new Set(props.p.bySourcePerDay.map((r) => r.day))].sort();
  const sources = [...new Set(props.p.bySourcePerDay.map((r) => r.source))].sort();
  const series = sources.map((src) => ({
    label: src,
    values: days.map((d) => props.p.bySourcePerDay.find((r) => r.day === d && r.source === src)?.plays ?? 0),
  }));
  const t = props.p.firstPlaylistMs;
  return html`<section>
    <h2>Plays</h2>
    ${days.length ? html`<${DayChart} title="Plays per day by source" days=${days} series=${series} />` : html`<p class="muted">No plays in the last 30 days.</p>`}
    <div class="kpis">
      <${Kpi} label="time to first playlist, median" value=${t.p50 === undefined ? '—' : `${n(t.p50)} ms`} />
      <${Kpi} label="95th percentile" value=${t.p95 === undefined ? '—' : `${n(t.p95)} ms`} sub=${`${n(t.n)} plays, 7 days`} />
    </div>
    <h3>Top episodes this week</h3>
    ${props.p.topEpisodes.length ? html`<ol class="list">${props.p.topEpisodes.map((e) => html`<li><${Title} text=${e.title} id=${e.episodeId} /> <span class="muted">${e.episodeId.split(':').slice(1).join('×')} · ${n(e.plays)}</span></li>`)}</ol>` : html`<p class="muted">None yet.</p>`}
  </section>`;
}

export function FailuresView(props: { f: Failures }) {
  return html`<section>
    <h2>Failures <span class="muted small">(7 days)</span></h2>
    ${
      props.f.groups.length
        ? html`<div class="table">${props.f.groups.map(
            (g) => html`<div class="row">
            <div><strong>${g.source || '—'}</strong> · ${g.stage}${g.status !== null ? ` · HTTP ${g.status}` : ''} <span class="badge red">${n(g.n)}</span> <${Spark} values=${g.perDay} /></div>
            <div class="small muted">${g.reason || 'no reason given'} · last ${ago(g.last)}${g.lastPlayId ? html` · <a href=${`#/trace/${g.lastPlayId}`}>trace</a>` : ''}</div>
          </div>`,
          )}</div>`
        : html`<p class="muted">No failures in the last 7 days.</p>`
    }
  </section>`;
}

export function TraceView(props: { t: Trace }) {
  return html`<section>
    <h2>Play <code>${props.t.playId}</code></h2>
    ${
      props.t.events.length
        ? html`<ol class="list trace">${props.t.events.map(
            (e) => html`<li>
            <span class="muted small">${when(e.ts)}</span> <strong>${e.kind}</strong> · ${e.component}
            <span class=${`badge ${e.outcome === 'ok' ? 'green' : 'red'}`}>${e.outcome}</span>
            ${e.status !== undefined ? ` HTTP ${e.status}` : ''}${e.latencyMs !== undefined ? ` · ${e.latencyMs} ms` : ''}
            ${e.detail ? html`<pre class="small">${JSON.stringify(e.detail, null, 1)}</pre>` : ''}
          </li>`,
          )}</ol>`
        : html`<p class="muted">No events for this play (kept 30 days).</p>`
    }
  </section>`;
}

export function LiveView(props: { l: Live | undefined; down: boolean }) {
  const l = props.l;
  return html`<section>
    <h2>Playing now ${props.down ? html`<span class="badge red">live view disconnected</span>` : html`<span class="badge green">live</span>`}</h2>
    ${
      !l || l.sessions.length === 0
        ? html`<p class="muted">Nothing is playing through this home helper.</p>`
        : html`<div class="table">${l.sessions.map(
            (s) => html`<div class="row">
            <div><${Title} text=${s.title} id=${s.showId ?? s.playId} /> <span class="badge">${s.kind === 'relay' ? 'via Israel' : 'Mako'}</span></div>
            <div class="small muted">${s.source ?? ''} · since ${when(s.since)}${s.kind === 'relay' ? ` · ${n(s.segments)} segments, ${n(Math.round(s.bytes / 1_048_576))} MB` : ''} · <a href=${`#/trace/${s.playId}`}>trace</a></div>
          </div>`,
          )}</div>`
    }
  </section>`;
}

export function DeploysView(props: { d: Deploys }) {
  const [id, setId] = useState('');
  const [msg, setMsg] = useState('');
  const cf = props.d.cloudflare;
  return html`<section>
    <h2>Catalog</h2>
    <div class="table">${props.d.catalog.map((c) => html`<div class="row"><strong>${c.source}</strong> <span class="muted">${n(c.shows)} shows · ${n(c.episodes)} episodes</span></div>`)}</div>
    <p class="small">Last publish: ${props.d.lastPublish ? html`${when(props.d.lastPublish.at)} <span class=${`badge ${props.d.lastPublish.status === 'ok' ? 'green' : 'red'}`}>${props.d.lastPublish.status}</span> <span class="muted">${props.d.lastPublish.detail ?? ''}</span>` : '—'}</p>
    <form
      class="inline"
      onSubmit=${async (e: Event) => {
        e.preventDefault();
        if (!/^iltv_[a-z0-9]+_\d+$/.test(id)) return setMsg('a show id looks like iltv_mako_12');
        setMsg('…');
        setMsg((await api.refresh(id)).message);
      }}
    >
      <label>Refresh one show <input value=${id} placeholder="iltv_mako_12" onInput=${(e: Event) => setId((e.target as HTMLInputElement).value.trim())} /></label>
      <button>Refresh</button> <span class="muted small">${msg}</span>
    </form>
    ${
      cf
        ? html`<h3>Cloudflare</h3>
          <p class="small">Public data Worker <code>${cf.dataWorker}</code> ${cf.dataVersion ? html`version <code>${cf.dataVersion.slice(0, 8)}</code>` : ''}<br />
          Private API Worker <code>${cf.apiWorker}</code> ${cf.apiVersion ? html`version <code>${cf.apiVersion.slice(0, 8)}</code>` : ''}</p>
          <p class="small muted">Roll back from a terminal on this computer (not from here):</p>
          <pre class="small">${cf.commands.join('\n')}</pre>`
        : ''
    }
  </section>`;
}

export function SystemView(props: { s: System }) {
  const s = props.s;
  return html`<section>
    <h2>System</h2>
    <div class="kpis">
      <${Kpi} label="revision" value=${s.revision.slice(0, 12)} sub=${`Node ${s.node}`} />
      <${Kpi} label="running for" value=${s.uptimeSec < 7200 ? `${Math.round(s.uptimeSec / 60)} min` : `${Math.round(s.uptimeSec / 3600)} h`} />
      <${Kpi} label="memory" value=${`${n(Math.round(s.memoryMB.process))} MB`} sub=${`${n(Math.round(s.memoryMB.freeSystem))} MB free`} />
      <${Kpi} label="disk free" value=${s.diskFreeMB === undefined ? '—' : `${n(Math.round(s.diskFreeMB / 1024))} GB`} />
    </div>
    <h3>Databases</h3>
    <ul class="list">${s.databases.map((d) => html`<li>${d.name}: ${d.sizeMB} MB${d.growthPerDayMB !== undefined ? html` <span class="muted">(+${d.growthPerDayMB.toFixed(3)} MB a day)</span>` : ''}</li>`)}</ul>
    <h3>Backup</h3>
    <p class="small">${s.backup ? html`${s.backup.file}, ${when(s.backup.at)}, ${s.backup.sizeMB} MB · restore check: <span class=${s.backup.check?.startsWith('ok') ? 'ok' : 'warn'}>${s.backup.check ?? 'not checked yet'}</span>` : 'No backup yet (made nightly).'}</p>
    <${DayChart} title="Usage events per day" days=${s.eventsPerDay.map((d) => d.day)} series=${[{ label: 'events', values: s.eventsPerDay.map((d) => d.n) }]} height=${120} />
  </section>`;
}
