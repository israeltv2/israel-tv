import { lazy, Suspense } from 'react';
import { Empty, LoadError, PageHeader, SourceTag, Title } from '#components/bits.tsx';
import { Kpi } from '#components/kpi.tsx';
import { PlayList } from '#components/play-list.tsx';
import { Poster } from '#components/poster.tsx';
import { Card, CardBody, CardHeader } from '#components/ui/card.tsx';
import { Skeleton } from '#components/ui/skeleton.tsx';
import { useApi } from '#lib/api.ts';
import { ms, num } from '#lib/format.ts';
import { SOURCES, sourceColor, sourceName } from '#lib/sources.ts';

const StackedDays = lazy(() => import('#components/charts.tsx').then((m) => ({ default: m.StackedDays })));
const DayLines = lazy(() => import('#components/charts.tsx').then((m) => ({ default: m.DayLines })));

export function Plays() {
  const { data: p, error, refetch } = useApi('plays');
  const { data: o } = useApi('overview');
  if (error && !p) return <LoadError error={error} retry={() => void refetch()} />;
  if (!p) return <Skeleton className="h-96" />;
  const days = o?.home.perDay.map((d) => d.day) ?? [...new Set(p.bySourcePerDay.map((r) => r.day))].sort();
  const bySource = days.map((day) => ({
    day,
    ...Object.fromEntries(
      SOURCES.map((s) => [s, p.bySourcePerDay.find((r) => r.day === day && r.source === s)?.plays ?? 0]),
    ),
  }));
  const used = SOURCES.filter((s) => p.bySourcePerDay.some((r) => r.source === s && r.plays > 0));
  return (
    <section className="space-y-5">
      <PageHeader
        title="Plays"
        description="What this home watched through its helper, and how fast plays start."
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="Plays · 7 days"
          value={num(o?.home.d7.plays)}
          sub={`${num(o?.home.d30.plays)} in 30 days`}
        />
        <Kpi label="Start time · median" value={ms(p.firstPlaylistMs.p50)} sub="request to first playlist" />
        <Kpi
          label="Start time · p95"
          value={ms(p.firstPlaylistMs.p95)}
          sub={`${num(p.firstPlaylistMs.n)} plays measured`}
          {...((p.firstPlaylistMs.p95 ?? 0) > 3000 ? { tone: 'var(--warn)' } : {})}
        />
        <Kpi label="Shows watched · 7 days" value={num(p.topShows.length)} sub="with at least one play" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Plays by source" description="Per day, last 30 days" />
          <CardBody>
            <Suspense fallback={<Skeleton className="h-[220px]" />}>
              <StackedDays
                rows={bySource}
                caption="Plays per day by source"
                series={(used.length ? used : SOURCES).map((s) => ({
                  key: s,
                  name: sourceName(s, true),
                  color: sourceColor(s),
                }))}
              />
            </Suspense>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Time to first playlist"
            description="Median and 95th percentile per day, last 14 days"
          />
          <CardBody>
            <Suspense fallback={<Skeleton className="h-[220px]" />}>
              <DayLines
                rows={p.latencyPerDay.map((d) => ({ day: d.day, p50: d.p50 ?? null, p95: d.p95 ?? null }))}
                caption="Time to first playlist per day"
                unit="ms"
                series={[
                  { key: 'p50', name: 'Median', color: 'var(--accent)' },
                  { key: 'p95', name: 'p95', color: 'var(--warn)', dashed: true },
                ]}
              />
            </Suspense>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Most watched shows" description="This home, last 7 days" />
        <CardBody>
          {p.topShows.length ? (
            <ol className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
              {p.topShows.map((s) => (
                <li key={s.showId} className="min-w-0">
                  <Poster url={s.poster} source={s.source} className="w-full" />
                  <Title className="mt-1.5 block font-medium text-sm">{s.title ?? s.showId}</Title>
                  <div className="flex items-center justify-between gap-2">
                    <SourceTag source={s.source} />
                    <span className="num text-muted text-xs">{num(s.plays)}</span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>No plays in the last 7 days.</Empty>
          )}
        </CardBody>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Most played episodes" description="Last 7 days" />
          <CardBody className="pt-2">
            {p.topEpisodes.length ? (
              <ul className="divide-y divide-border">
                {p.topEpisodes.map((e) => {
                  const [, season, episode] = e.episodeId.split(':');
                  return (
                    <li key={e.episodeId} className="flex items-center gap-3 py-2">
                      <Poster url={e.poster} source={e.source} className="w-7" />
                      <div className="min-w-0 flex-1">
                        <Title className="block font-medium">{e.title ?? e.episodeId}</Title>
                        <span className="num text-muted text-xs">
                          {season ? `S${season} E${episode}` : e.episodeId}
                        </span>
                      </div>
                      <span className="num font-medium">{num(e.plays)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty>No episodes played in the last 7 days.</Empty>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent plays" description="Newest first; open one for its trace" />
          <CardBody className="pt-2">
            <PlayList items={p.recent} empty="No plays in the last 14 days." />
          </CardBody>
        </Card>
      </div>
    </section>
  );
}
