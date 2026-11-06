// The owner's dashboard: one page, sections chosen by the address's #, data from /api/v1, live sessions over
// Server-Sent Events (only while the tab is visible).
import type { Live, Session } from '@israel-tv/admin-contract';
import { html } from 'htm/preact';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api } from './api.ts';
import {
  DeploysView,
  FailuresView,
  LiveView,
  OverviewView,
  PlaysView,
  SourcesView,
  SystemView,
  TraceView,
} from './views.ts';

const TABS = [
  ['', 'Overview'],
  ['sources', 'Sources'],
  ['plays', 'Plays'],
  ['failures', 'Failures'],
  ['live', 'Live'],
  ['deploys', 'Catalog & deploys'],
  ['system', 'System'],
] as const;

const route = () => location.hash.replace(/^#\/?/, '');

function useRoute(): string {
  const [r, setR] = useState(route());
  useEffect(() => {
    const on = () => setR(route());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}

/** Loads one section's data (again every minute while shown); data from another section is never shown. */
function useData<T>(load: () => Promise<T>, key: string): { data?: T; error?: string } {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key: '' });
  useEffect(() => {
    let alive = true;
    setState({ key });
    const run = () =>
      load().then(
        (data) => alive && setState({ key, data }),
        (err: Error) => alive && setState({ key, error: err.message }),
      );
    void run();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void run();
    }, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [key]);
  if (state.key !== key) return {};
  return {
    ...(state.data !== undefined ? { data: state.data } : {}),
    ...(state.error ? { error: state.error } : {}),
  };
}

function Section(props: { r: string; session: Session }) {
  const [name, arg = ''] = props.r.split('/');
  const loaders: Record<string, () => Promise<unknown>> = {
    '': api.overview,
    sources: api.sources,
    plays: api.plays,
    failures: api.failures,
    deploys: api.deploys,
    system: api.system,
    trace: () => api.trace(arg),
  };
  if (name === 'live') return html`<${LiveSection} />`;
  const load = loaders[name ?? ''] ?? api.overview;
  const { data, error } = useData(load, props.r);
  if (error) return html`<p class="warn pad">${error}</p>`;
  if (!data) return html`<p class="muted pad">Loading…</p>`;
  switch (name) {
    case 'sources':
      return html`<${SourcesView} s=${data} />`;
    case 'plays':
      return html`<${PlaysView} p=${data} />`;
    case 'failures':
      return html`<${FailuresView} f=${data} />`;
    case 'deploys':
      return html`<${DeploysView} d=${data} />`;
    case 'system':
      return html`<${SystemView} s=${data} />`;
    case 'trace':
      return html`<${TraceView} t=${data} />`;
    default:
      return html`<${OverviewView} o=${data} showPublic=${props.session.publisher === 'cloudflare'} />`;
  }
}

function LiveSection() {
  const [live, setLive] = useState<Live | undefined>(undefined);
  const [down, setDown] = useState(false);
  useEffect(() => {
    let close: (() => void) | undefined;
    const open = () => {
      close?.();
      setDown(false);
      close = api.liveStream(setLive, () => setDown(true));
    };
    const onVisible = () => (document.visibilityState === 'visible' ? open() : close?.());
    open();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      close?.();
    };
  }, []);
  return html`<${LiveView} l=${live} down=${down} />`;
}

function App() {
  const r = useRoute();
  const [session, setSession] = useState<Session | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => {
    api.session().then(setSession, (e: Error) => setError(e.message));
  }, []);
  if (error) return html`<p class="warn pad">${error}</p>`;
  if (!session) return html`<p class="muted pad">Loading…</p>`;
  const current = r.split('/')[0] ?? '';
  return html`<header>
      <h1>Israel TV</h1>
      <span class="muted small">${session.role} · ${session.revision.slice(0, 7)}</span>
      <nav>${TABS.map(([path, label]) => html`<a href=${`#/${path}`} aria-current=${current === path ? 'page' : undefined}>${label}</a>`)}</nav>
    </header>
    <main><${Section} r=${r} session=${session} /></main>`;
}

const root = document.getElementById('app');
if (root) render(html`<${App} />`, root);
