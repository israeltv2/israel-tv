// The typed client for the admin API. Paths come from the contract's route table (no schema code in the bundle);
// answers are typed by the contract's Responses. The browser sends the sign-in cookie itself; changes carry the
// CSRF value from /session.
import type { Live, Responses } from '@israel-tv/admin-contract';
import { CSRF_HEADER, type RouteName, routePath } from '@israel-tv/admin-contract/routes';
import { QueryClient, useQuery } from '@tanstack/react-query';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type GetRoute = Exclude<RouteName, 'refresh' | 'canary' | 'liveStream'>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { accept: 'application/json', ...init?.headers },
  });
  const body = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
  if (r.status === 404 && path.endsWith('/session'))
    throw new ApiError(
      404,
      'Not signed in on this browser. Open the dashboard link once (`israel-tv admin-url`).',
    );
  if (!r.ok && !(init?.method === 'POST' && 'accepted' in body))
    throw new ApiError(r.status, body.error ?? body.message ?? `HTTP ${r.status}`);
  return body as T;
}

export function get<K extends GetRoute>(name: K, params?: Record<string, string>): Promise<Responses[K]> {
  return request<Responses[K]>(routePath(name, params));
}

let csrf: string | undefined;

export async function post(
  name: 'refresh' | 'canary',
  params?: Record<string, string>,
): Promise<Responses['refresh']> {
  csrf ??= (await get('session')).csrf;
  return request<Responses['refresh']>(routePath(name, params), {
    method: 'POST',
    headers: { [CSRF_HEADER]: csrf },
  });
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
      retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 2,
    },
  },
});

/** One API answer, refreshed every minute and when the tab comes back. */
export function useApi<K extends GetRoute>(
  name: K,
  params?: Record<string, string>,
  opts: { every?: number } = {},
) {
  return useQuery({
    queryKey: [name, params ?? {}],
    queryFn: () => get(name, params),
    ...(opts.every ? { refetchInterval: opts.every } : {}),
  });
}

/** Live sessions over Server-Sent Events while mounted and the tab is visible; the last snapshot otherwise. */
export function subscribeLive(
  onData: (l: Live) => void,
  onState: (s: 'open' | 'retrying' | 'closed') => void,
): () => void {
  let es: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = 2000;
  const open = () => {
    if (document.hidden) return;
    es = new EventSource(routePath('liveStream'), { withCredentials: true });
    es.addEventListener('live', (e) => {
      delay = 2000;
      onState('open');
      onData(JSON.parse((e as MessageEvent<string>).data) as Live);
    });
    es.onerror = () => {
      es?.close();
      es = undefined;
      onState('retrying');
      retry = setTimeout(open, delay);
      delay = Math.min(delay * 2, 60_000);
    };
  };
  const visibility = () => {
    if (document.hidden) {
      es?.close();
      es = undefined;
      onState('closed');
    } else if (!es) open();
  };
  document.addEventListener('visibilitychange', visibility);
  open();
  return () => {
    document.removeEventListener('visibilitychange', visibility);
    clearTimeout(retry);
    es?.close();
  };
}
