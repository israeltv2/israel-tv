// The admin API's routes, without any schema code: what the dashboard bundles at run time (the schemas, with zod,
// stay on the server and in tests; the dashboard takes only their types). Paths are under ADMIN_API.

export const ADMIN_API = '/api/v1';
/** Header a cookie-authenticated POST must carry (value from GET /session). */
export const CSRF_HEADER = 'x-israel-tv-csrf';

/** Every route: name → method and path (`:param` placeholders). */
export const routes = {
  session: { method: 'GET', path: '/session' },
  health: { method: 'GET', path: '/health' },
  overview: { method: 'GET', path: '/overview' },
  sources: { method: 'GET', path: '/sources' },
  plays: { method: 'GET', path: '/plays' },
  failures: { method: 'GET', path: '/failures' },
  trace: { method: 'GET', path: '/trace/:playId' },
  live: { method: 'GET', path: '/live' },
  liveStream: { method: 'GET', path: '/live/stream' },
  deploys: { method: 'GET', path: '/deploys' },
  system: { method: 'GET', path: '/system' },
  refresh: { method: 'POST', path: '/actions/refresh/:id' },
  canary: { method: 'POST', path: '/actions/canary' },
} as const;

export type RouteName = keyof typeof routes;

/** A route's path with its parameters filled in (each encoded). */
export function routePath(name: RouteName, params: Record<string, string> = {}): string {
  return `${ADMIN_API}${routes[name].path.replace(/:([A-Za-z]+)/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`route ${name} needs :${k}`);
    return encodeURIComponent(v);
  })}`;
}
