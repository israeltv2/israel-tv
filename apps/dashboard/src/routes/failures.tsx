import { Link } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { Ago, Empty, LoadError, PageHeader, SourceTag } from '#components/bits.tsx';
import { Kpi } from '#components/kpi.tsx';
import { PlayList } from '#components/play-list.tsx';
import { Badge } from '#components/ui/badge.tsx';
import { Card, CardBody, CardHeader } from '#components/ui/card.tsx';
import { Skeleton } from '#components/ui/skeleton.tsx';
import { useApi } from '#lib/api.ts';
import { dayLabel, num, pct } from '#lib/format.ts';
import { SOURCES, sourceColor, sourceName } from '#lib/sources.ts';

const StackedDays = lazy(() => import('#components/charts.tsx').then((m) => ({ default: m.StackedDays })));

function MiniBars({ values, days }: { values: number[]; days: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-6 w-24 items-end gap-0.5" role="img" aria-label={`per day: ${values.join(', ')}`}>
      {values.map((v, i) => (
        <span
          key={days[i]}
          title={`${dayLabel(days[i] ?? '', 'weekday')}: ${v}`}
          className="flex-1 rounded-sm"
          style={{
            height: `${Math.max(v ? 15 : 6, (v / max) * 100)}%`,
            background: v ? 'var(--error)' : 'var(--surface-2)',
          }}
        />
      ))}
    </div>
  );
}

export function Failures() {
  const { data: f, error, refetch } = useApi('failures');
  const { data: o } = useApi('overview');
  if (error && !f) return <LoadError error={error} retry={() => void refetch()} />;
  if (!f) return <Skeleton className="h-96" />;
  // Failures whose cause was fixed since are listed (dimmed, with the fix) but not counted as open problems.
  const open = f.groups.filter((g) => !g.fixed);
  const fixedCount = f.groups.filter((g) => g.fixed).reduce((n, g) => n + g.n, 0);
  const total = open.reduce((n, g) => n + g.n, 0);
  const episodeOnly = open.filter((g) => g.blame === 'episode').reduce((n, g) => n + g.n, 0);
  const rows = f.days.map((day, i) => ({
    day,
    ...Object.fromEntries(
      SOURCES.map((s) => [s, open.filter((g) => g.source === s).reduce((n, g) => n + (g.perDay[i] ?? 0), 0)]),
    ),
  }));
  const used = SOURCES.filter((s) => open.some((g) => g.source === s));
  const attempts = (o?.home.d7.plays ?? 0) + (o?.home.d7.failures ?? 0);
  return (
    <section className="space-y-5">
      <PageHeader
        title="Failures"
        description="Plays that did not start, grouped by where and why. The project's own checks are not counted here."
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="Failed plays · 7 days"
          value={num(total)}
          {...(total ? { tone: 'var(--error)' } : {})}
          {...(fixedCount ? { sub: `and ${num(fixedCount)} from a cause fixed since` } : {})}
        />
        <Kpi
          label="Failure rate · 7 days"
          value={attempts ? pct(o?.failureRate7d ?? 0, 1) : '—'}
          sub={
            o?.sinceRelease && o.sinceRelease.plays + o.sinceRelease.failures
              ? `${num(o.sinceRelease.failures)} of ${num(o.sinceRelease.plays + o.sinceRelease.failures)} since this version`
              : attempts
                ? `of ${num(attempts)} plays`
                : 'no plays'
          }
        />
        <Kpi label="Kinds of failure" value={num(open.length)} sub="source · stage · status · reason" />
        <Kpi
          label="Single title refused"
          value={num(episodeOnly)}
          sub="one episode would not play; its source kept playing"
        />
      </div>
      <Card>
        <CardHeader title="Failures per day" description="By source, last 7 days" />
        <CardBody>
          {total ? (
            <Suspense fallback={<Skeleton className="h-[180px]" />}>
              <StackedDays
                rows={rows}
                height={180}
                caption="Failures per day by source"
                series={used.map((s) => ({ key: s, name: sourceName(s, true), color: sourceColor(s) }))}
              />
            </Suspense>
          ) : (
            <Empty>
              No failed plays in the last 7 days
              {fixedCount ? ' (apart from ones whose cause was fixed since)' : ''}.
            </Empty>
          )}
        </CardBody>
      </Card>
      {f.groups.length ? (
        <Card>
          <CardHeader
            title="Grouped"
            description="Most frequent first; the last one of each opens its trace"
          />
          <CardBody className="pt-2">
            <ul className="divide-y divide-border">
              {f.groups.map((g) => (
                <li
                  key={`${g.source}|${g.stage}|${g.status}|${g.reason}|${g.fixed ?? ''}`}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-2 py-3${g.fixed ? ' opacity-60' : ''}`}
                >
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="flex flex-wrap items-center gap-2">
                      <SourceTag source={g.source} />
                      <Badge>{g.stage}</Badge>
                      {g.status !== null ? <Badge className="num">HTTP {g.status}</Badge> : null}
                      {g.blame === 'episode' ? (
                        <Badge style={{ color: 'var(--warn)' }}>one title</Badge>
                      ) : null}
                      {g.fixed ? <Badge style={{ color: 'var(--ok)' }}>fixed</Badge> : null}
                    </div>
                    {g.plain ? <p className="mt-1 text-sm">{g.plain}</p> : null}
                    <p className="mt-0.5 break-words font-mono text-muted text-xs">
                      <bdi dir="auto">{g.reason || 'no reason recorded'}</bdi>
                    </p>
                    {g.fixed ? <p className="mt-0.5 text-[var(--ok)] text-xs">{g.fixed}</p> : null}
                  </div>
                  <MiniBars values={g.perDay} days={f.days} />
                  <div className="w-28 text-end">
                    <div className="num font-semibold">{num(g.n)}×</div>
                    {g.lastPlayId ? (
                      <Link
                        to="/trace/$playId"
                        params={{ playId: g.lastPlayId }}
                        className="text-muted text-xs hover:underline"
                      >
                        last <Ago iso={g.last} /> →
                      </Link>
                    ) : (
                      <span className="text-muted text-xs">
                        last <Ago iso={g.last} />
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title="Recent failures" description="Newest first" />
        <CardBody className="pt-2">
          <PlayList items={f.recent} empty="Nothing failed in the last 7 days." />
        </CardBody>
      </Card>
    </section>
  );
}
