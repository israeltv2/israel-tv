// Talks to the admin API (/api/v1). The session gives the CSRF value every change must carry.
import type {
  Action,
  Deploys,
  Failures,
  Live,
  Overview,
  Plays,
  Session,
  Sources,
  System,
  Trace,
} from '@israel-tv/admin-contract';

const BASE = '/api/v1';
let csrf = '';

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (r.status === 404 && path === '/session')
    throw new Error(
      'Not signed in: open the link `pnpm israel-tv admin-url` prints (once; it is kept for 30 days).',
    );
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

async function post(path: string): Promise<Action> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-israel-tv-csrf': csrf, 'content-type': 'application/json' },
    body: '{}',
  });
  const body = (await r.json().catch(() => ({}))) as Partial<Action> & { error?: string };
  return { accepted: r.ok, message: body.message ?? body.error ?? `HTTP ${r.status}` };
}

export const api = {
  async session(): Promise<Session> {
    const s = await get<Session>('/session');
    csrf = s.csrf;
    return s;
  },
  overview: () => get<Overview>('/overview'),
  sources: () => get<Sources>('/sources'),
  plays: () => get<Plays>('/plays'),
  failures: () => get<Failures>('/failures'),
  trace: (playId: string) => get<Trace>(`/trace/${encodeURIComponent(playId)}`),
  live: () => get<Live>('/live'),
  deploys: () => get<Deploys>('/deploys'),
  system: () => get<System>('/system'),
  refresh: (id: string) => post(`/actions/refresh/${encodeURIComponent(id)}`),
  canary: () => post('/actions/canary'),
  /** Live sessions as they change; returns a function that closes the stream. */
  liveStream(on: (l: Live) => void, onDown: () => void): () => void {
    const es = new EventSource(`${BASE}/live/stream`);
    es.addEventListener('live', (e) => on(JSON.parse((e as MessageEvent<string>).data) as Live));
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) onDown();
    };
    return () => es.close();
  },
};
