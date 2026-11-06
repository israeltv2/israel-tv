// Sections are routes in the address's hash (#/sources, #/trace/<playId>), so the daemon serves one page and a link
// to a trace can be pasted. Each section's code (and the chart library) loads when it is first opened.
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router';
import { Shell } from '#components/shell.tsx';

const root = createRootRoute({ component: Shell });
const parent = () => root;

const routeTree = root.addChildren([
  createRoute({
    getParentRoute: parent,
    path: '/',
    component: lazyRouteComponent(() => import('#routes/overview.tsx'), 'Overview'),
  }),
  createRoute({
    getParentRoute: parent,
    path: '/sources',
    component: lazyRouteComponent(() => import('#routes/sources.tsx'), 'Sources'),
  }),
  createRoute({
    getParentRoute: parent,
    path: '/plays',
    component: lazyRouteComponent(() => import('#routes/plays.tsx'), 'Plays'),
  }),
  createRoute({
    getParentRoute: parent,
    path: '/failures',
    component: lazyRouteComponent(() => import('#routes/failures.tsx'), 'Failures'),
  }),
  createRoute({
    getParentRoute: parent,
    path: '/trace/$playId',
    component: lazyRouteComponent(() => import('#routes/trace.tsx'), 'TracePage'),
  }),
  createRoute({
    getParentRoute: parent,
    path: '/live',
    component: lazyRouteComponent(() => import('#routes/live.tsx'), 'LiveNow'),
  }),
  createRoute({
    getParentRoute: parent,
    path: '/deploys',
    component: lazyRouteComponent(() => import('#routes/deploys.tsx'), 'Deploys'),
  }),
  createRoute({
    getParentRoute: parent,
    path: '/system',
    component: lazyRouteComponent(() => import('#routes/system.tsx'), 'SystemPage'),
  }),
]);

export const router = createRouter({ routeTree, history: createHashHistory(), defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
