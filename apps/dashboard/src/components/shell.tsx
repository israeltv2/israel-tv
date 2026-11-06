// The frame around every section: a sidebar on wide screens, a tab bar on phones, and one line on top that answers
// "is everything OK?" with links to whatever is not.
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import {
  Activity,
  ChevronDown,
  Cpu,
  Database,
  Ellipsis,
  LayoutDashboard,
  Monitor,
  Moon,
  OctagonAlert,
  Play,
  Rocket,
  Sun,
  Tv,
} from 'lucide-react';
import { useState } from 'react';
import { Ago, LoadError } from '#components/bits.tsx';
import { HealthDot, HealthPill, type HealthState, ProblemIcon } from '#components/health.tsx';
import { useApi } from '#lib/api.ts';
import { setTimeZone } from '#lib/format.ts';
import { type ThemePick, useTheme } from '#lib/theme.ts';
import { cn } from '#lib/utils.ts';

type Section = 'sources' | 'plays' | 'failures' | 'deploys' | 'system';

const NAV: { to: string; label: string; Icon: typeof Play; section?: Section; phone?: boolean }[] = [
  { to: '/', label: 'Overview', Icon: LayoutDashboard, phone: true },
  { to: '/sources', label: 'Sources', Icon: Database, section: 'sources', phone: true },
  { to: '/plays', label: 'Plays', Icon: Play, section: 'plays' },
  { to: '/failures', label: 'Failures', Icon: OctagonAlert, section: 'failures', phone: true },
  { to: '/live', label: 'Live now', Icon: Activity, phone: true },
  { to: '/deploys', label: 'Catalog & deploys', Icon: Rocket, section: 'deploys' },
  { to: '/system', label: 'System', Icon: Cpu, section: 'system' },
];

function useSectionHealth(): (s: Section | undefined) => HealthState | undefined {
  const { data } = useApi('health', undefined, { every: 30_000 });
  return (s) => {
    if (!s || !data) return undefined;
    const p = data.problems.filter((x) => x.section === s);
    return p.some((x) => x.severity === 'error') ? 'error' : p.length ? 'warn' : undefined;
  };
}

function ThemeSwitch() {
  const [pick, setPick] = useTheme();
  const order: ThemePick[] = ['system', 'light', 'dark'];
  const Icon = pick === 'light' ? Sun : pick === 'dark' ? Moon : Monitor;
  return (
    <button
      type="button"
      className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
      aria-label={`Theme: ${pick} (change)`}
      title={`Theme: ${pick}`}
      onClick={() => setPick(order[(order.indexOf(pick) + 1) % order.length] as ThemePick)}
    >
      <Icon className="size-4" />
    </button>
  );
}

function HealthBanner() {
  const { data, error, dataUpdatedAt } = useApi('health', undefined, { every: 30_000 });
  const [open, setOpen] = useState(false);
  if (error && !data) return <LoadError error={error} />;
  if (!data) return <div className="h-11" />;
  const state = data.state as HealthState;
  const shown = open ? data.problems : data.problems.slice(0, 2);
  return (
    <div
      role="status"
      className="rounded-xl border px-3 py-2"
      style={{
        borderColor: `color-mix(in oklab, var(--${state === 'ok' ? 'ok' : state}) 35%, var(--border))`,
        background: `color-mix(in oklab, var(--${state === 'ok' ? 'ok' : state}) 6%, var(--surface))`,
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <HealthPill
          state={state}
          label={state === 'ok' ? 'All good' : state === 'warn' ? 'Needs a look' : 'Something is broken'}
        />
        <span className="text-muted text-xs">
          checked <Ago iso={new Date(dataUpdatedAt || Date.parse(data.checkedAt)).toISOString()} />
        </span>
        {state === 'ok' ? (
          <span className="text-sm">Sources fresh, plays working, publishes going out.</span>
        ) : null}
      </div>
      {data.problems.length ? (
        <ul className="mt-2 space-y-1">
          {shown.map((p) => (
            <li key={`${p.section}|${p.message}`} className="flex items-start gap-2 text-sm">
              <ProblemIcon severity={p.severity} />
              <Link to={`/${p.section}`} className="min-w-0 hover:underline">
                <bdi dir="auto">{p.message}</bdi>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {data.problems.length > 2 ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1 inline-flex items-center gap-1 text-muted text-xs hover:text-fg"
          aria-expanded={open}
        >
          <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
          {open ? 'fewer' : `${data.problems.length - 2} more`}
        </button>
      ) : null}
    </div>
  );
}

function NavLink({
  item,
  health,
  compact,
  onPick,
}: {
  item: (typeof NAV)[number];
  health?: HealthState | undefined;
  compact?: boolean;
  onPick?: () => void;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const active =
    item.to === '/'
      ? path === '/'
      : path.startsWith(item.to) || (item.to === '/failures' && path.startsWith('/trace'));
  return (
    <Link
      to={item.to}
      aria-current={active ? 'page' : undefined}
      {...(onPick ? { onClick: onPick } : {})}
      className={cn(
        compact
          ? 'flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px]'
          : 'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm',
        active ? 'bg-surface-2 font-medium text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      <span className="relative">
        <item.Icon className={compact ? 'size-5' : 'size-4'} aria-hidden />
        {health ? <HealthDot state={health} className="-end-1 -top-0.5 absolute size-1.5" /> : null}
      </span>
      <span className="truncate">{compact && item.to === '/deploys' ? 'Catalog' : item.label}</span>
    </Link>
  );
}

export function Shell() {
  const session = useApi('session', undefined, { every: 300_000 });
  const health = useSectionHealth();
  const [more, setMore] = useState(false);
  if (session.data) setTimeZone(session.data.timeZone);
  const signedOut = session.error && !session.data;
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="hidden border-border border-e bg-surface lg:block">
        <div className="sticky top-0 flex h-dvh flex-col px-3 py-4">
          <div className="mb-5 flex items-center gap-2 px-2">
            <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-fg">
              <Tv className="size-4" />
            </span>
            <div className="leading-tight">
              <div className="font-semibold">Israel TV</div>
              <div className="text-muted text-xs">Owner dashboard</div>
            </div>
          </div>
          <nav aria-label="Sections" className="flex flex-col gap-0.5">
            {NAV.map((n) => (
              <NavLink key={n.to} item={n} health={health(n.section)} />
            ))}
          </nav>
          <div className="mt-auto space-y-1 px-2 text-muted text-xs">
            {session.data ? (
              <>
                <div>
                  {session.data.role} · {session.data.publisher} publisher
                </div>
                <div className="font-mono">rev {session.data.revision.slice(0, 7)}</div>
              </>
            ) : null}
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-border border-b bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
            <div className="flex items-center gap-2 lg:hidden">
              <span className="grid size-7 place-items-center rounded-md bg-accent text-accent-fg">
                <Tv className="size-3.5" />
              </span>
              <span className="font-semibold">Israel TV</span>
            </div>
            <div className="hidden text-muted text-sm lg:block">
              {session.data?.publicUrl ? (
                <a
                  href={`${session.data.publicUrl}/status`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-fg"
                >
                  {new URL(session.data.publicUrl).host}
                </a>
              ) : null}
            </div>
            <ThemeSwitch />
          </div>
        </header>
        <main className="mx-auto max-w-6xl space-y-5 px-4 pt-4 pb-28 lg:pb-10">
          {signedOut ? <LoadError error={session.error} /> : <HealthBanner />}
          <Outlet />
        </main>
      </div>
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-30 border-border border-t bg-surface/95 px-2 pt-1 pb-[max(env(safe-area-inset-bottom),0.25rem)] backdrop-blur lg:hidden"
      >
        {more ? (
          <div className="absolute end-2 bottom-full mb-2 w-52 rounded-xl border border-border bg-surface p-1 shadow-lg">
            {NAV.filter((n) => !n.phone).map((n) => (
              <NavLink key={n.to} item={n} health={health(n.section)} onPick={() => setMore(false)} />
            ))}
          </div>
        ) : null}
        <div className="flex items-stretch gap-1">
          {NAV.filter((n) => n.phone).map((n) => (
            <NavLink key={n.to} item={n} health={health(n.section)} compact />
          ))}
          <button
            type="button"
            onClick={() => setMore((m) => !m)}
            aria-expanded={more}
            className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] text-muted hover:bg-surface-2"
          >
            <span className="relative">
              <Ellipsis className="size-5" aria-hidden />
              {NAV.some((n) => !n.phone && health(n.section)) ? (
                <HealthDot
                  state={NAV.some((n) => !n.phone && health(n.section) === 'error') ? 'error' : 'warn'}
                  className="-end-1 -top-0.5 absolute size-1.5"
                />
              ) : null}
            </span>
            More
          </button>
        </div>
      </nav>
    </div>
  );
}
