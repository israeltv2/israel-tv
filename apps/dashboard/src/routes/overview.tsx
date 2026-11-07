import { Link } from '@tanstack/react-router';
import { Cloud, Eye, Gauge, Play, RefreshCcw, Timer } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Ago, Empty, LoadError, PageHeader, SourceTag, Title } from '#components/bits.tsx';
import { asHealth, HealthPill } from '#components/health.tsx';
import { Kpi } from '#components/kpi.tsx';
import { Poster } from '#components/poster.tsx';
import { Sparkline } from '#components/sparkline.tsx';
import { Card, CardBody, CardHeader } from '#components/ui/card.tsx';
import { Meter } from '#components/ui/progress.tsx';
import { Skeleton } from '#components/ui/skeleton.tsx';
import { useApi } from '#lib/api.ts';
import { compact, num, pct, when } from '#lib/format.ts';

const DayLines = lazy(() => import('#components/charts.tsx').then((m) => ({ default: m.DayLines })));

export function Overview() {
  const { data: o, error, refetch } = useApi('overview');
  if (error && !o) return <LoadError error={error} retry={() => void refetch()} />;
  if (!o) return <OverviewSkeleton />;
  const home = o.home;
  const plays = home.perDay.map((d) => d.plays);
  const fresh = o.freshness.filter((f) => !f.stale && f.health === 'ok').length;
  const worst =
    o.freshness.find((f) => f.health === 'error' || f.stale) ?? o.freshness.find((f) => f.health === 'warn');
  // Days before counting started, and the public addon's days not read yet (it is counted a day later), have no
  // point: no data is not zero plays.
  const homeSince = home.countedSince;
  const publicSince = o.public.countedSince;
  const rows = home.perDay.map((d, i) => ({
    day: d.day,
    home: homeSince && d.day >= homeSince ? d.plays : null,
    public:
      publicSince && d.day >= publicSince && o.public.lastDay && d.day <= o.public.lastDay
        ? (o.public.perDay[i]?.plays ?? 0)
        : null,
  }));
  const shown = [homeSince, ...(o.public.counted ? [publicSince] : [])];
  // Hatched up to the first day any line has data.
  const noDataBefore = shown.every(Boolean) ? (shown as string[]).sort()[0] : undefined;
  const attempts = home.d7.plays + home.d7.failures;
  return (
    <section className="space-y-5">
      <PageHeader
        title="Overview"
        description="Plays and viewers from this home's helper and the public addon, and how fresh the catalog is."
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Kpi
          label="Plays today"
          icon={<Play className="size-4" />}
          value={num(home.today.plays)}
          sub={`${num(home.d7.plays)} in 7 days · home`}
        >
          <Sparkline values={plays} label="plays per day, last 30 days" />
        </Kpi>
        <Kpi
          label="Viewers"
          icon={<Eye className="size-4" />}
          value={num(home.today.uniqueClients)}
          sub={
            o.public.counted
              ? `home today · public ${num(o.public.d7.uniqueClients)}/day`
              : 'home today · public not counted'
          }
        >
          <Sparkline
            values={home.perDay.map((d) => d.unique)}
            label="home viewers per day"
            color="var(--live)"
          />
        </Kpi>
        <Kpi
          label="Minutes watched"
          icon={<Timer className="size-4" />}
          value={home.d7.minutesWatched ? num(home.d7.minutesWatched) : '—'}
          sub={
            home.d7.minutesWatched
              ? '7 days · relayed plays (direct plays cannot be timed)'
              : 'only plays relayed through the proxy can be timed; none in 7 days'
          }
        >
          {home.d7.minutesWatched ? (
            <Sparkline
              values={home.perDay.map((d) => d.minutes)}
              label="minutes watched per day"
              color="var(--kan)"
            />
          ) : null}
        </Kpi>
        <Kpi
          label="Failure rate"
          icon={<Gauge className="size-4" />}
          value={attempts ? pct(o.failureRate7d, o.failureRate7d < 0.1 ? 1 : 0) : '—'}
          sub={
            <>
              {attempts
                ? `${num(home.d7.failures)} of ${num(attempts)} plays · 7 days`
                : 'no plays in 7 days'}
              {o.sinceRelease ? (
                <span className="block">
                  since this version ({when(o.sinceRelease.at)}):{' '}
                  {o.sinceRelease.plays + o.sinceRelease.failures
                    ? `${num(o.sinceRelease.failures)} of ${num(o.sinceRelease.plays + o.sinceRelease.failures)}`
                    : 'no plays yet'}
                </span>
              ) : null}
            </>
          }
          {...(o.failureRate7d > 0.1 && attempts >= 5 ? { tone: 'var(--error)' } : {})}
        >
          <Sparkline
            values={home.perDay.map((d) => d.failures)}
            label="failures per day"
            color="var(--error)"
          />
        </Kpi>
        <Kpi
          label="Catalog freshness"
          icon={<RefreshCcw className="size-4" />}
          value={`${fresh}/${o.freshness.length}`}
          sub={
            <>
              sources fresh · published <Ago iso={o.lastPublishAt} />
            </>
          }
        >
          {worst ? (
            <Link to="/sources" className="text-xs hover:underline">
              <HealthPill
                state={worst.stale ? 'error' : asHealth(worst.health)}
                label={`${worst.source}${worst.stale ? ' stale' : ''}`}
              />
            </Link>
          ) : (
            <div className="flex gap-1">
              {o.freshness.map((f) => (
                <HealthPill key={f.source} state="ok" label={f.source} />
              ))}
            </div>
          )}
        </Kpi>
        <Kpi
          label="Cloudflare today"
          icon={<Cloud className="size-4" />}
          value={o.quota ? compact(o.quota.requests) : '—'}
          sub={
            o.quota
              ? `of ${compact(o.quota.requestsLimit)} free requests`
              : 'not read yet (local publisher, or no token)'
          }
        >
          {o.quota ? (
            <Meter value={o.quota.requests / o.quota.requestsLimit} label="Cloudflare requests used today" />
          ) : null}
        </Kpi>
      </div>

      <Card>
        <CardHeader
          title="Plays per day"
          description={
            o.public.counted
              ? `Home: plays through this helper. Public: stream requests to the public addon${o.public.lastDay ? ` (counted to ${o.public.lastDay})` : ''}.`
              : 'Plays through this helper (the public addon is not counted on this instance).'
          }
        />
        <CardBody>
          <Suspense fallback={<Skeleton className="h-[220px]" />}>
            <DayLines
              rows={rows}
              noDataBefore={noDataBefore}
              caption="Plays per day, last 30 days"
              series={[
                { key: 'home', name: 'Home', color: 'var(--accent)' },
                ...(o.public.counted
                  ? [{ key: 'public', name: 'Public addon', color: 'var(--reshet)', dashed: true }]
                  : []),
              ]}
            />
          </Suspense>
          {o.public.note ? (
            <p className="mt-2 text-xs" style={{ color: 'var(--error)' }}>
              {o.public.note}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Top shows"
            description="This home, last 7 days"
            action={
              <Link to="/plays" className="text-muted text-xs hover:text-fg">
                All plays →
              </Link>
            }
          />
          <CardBody className="pt-3">
            {home.topShows.length ? (
              <ol className="space-y-2.5">
                {home.topShows.slice(0, 6).map((s, i) => (
                  <li key={s.showId} className="flex items-center gap-3">
                    <span className="num w-4 text-end text-muted text-xs">{i + 1}</span>
                    <Poster art={s} source={s.source} title={s.title} className="w-8" />
                    <div className="min-w-0 flex-1">
                      <Title className="block font-medium">{s.title ?? s.showId}</Title>
                      <SourceTag source={s.source} />
                    </div>
                    <span className="num font-medium">{num(s.plays)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>No plays in the last 7 days.</Empty>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Sources"
            description="Last good read, against how often each is read"
            action={
              <Link to="/sources" className="text-muted text-xs hover:text-fg">
                Details →
              </Link>
            }
          />
          <CardBody className="pt-3">
            <ul className="divide-y divide-border">
              {o.freshness.map((f) => (
                <li key={f.source} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <SourceTag source={f.source} short={false} />
                    <div className="text-muted text-xs">
                      read <Ago iso={f.lastGoodAt} />
                      {f.cadenceHours ? ` · every ${f.cadenceHours} h` : ''}
                    </div>
                  </div>
                  <HealthPill
                    state={f.stale ? 'error' : asHealth(f.health)}
                    {...(f.stale ? { label: 'Stale' } : {})}
                  />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <section className="space-y-5" aria-busy="true">
      <Skeleton className="h-8 w-40" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={String(i)} className="h-32" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </section>
  );
}
