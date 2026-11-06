import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Empty, LoadError, PageHeader, SourceTag, Title, When } from '#components/bits.tsx';
import { HealthDot, HealthPill } from '#components/health.tsx';
import { Badge } from '#components/ui/badge.tsx';
import { Card, CardBody } from '#components/ui/card.tsx';
import { Skeleton } from '#components/ui/skeleton.tsx';
import { useApi } from '#lib/api.ts';
import { clock, ms } from '#lib/format.ts';

const COMPONENT_COLOR: Record<string, string> = {
  resolver: 'var(--accent)',
  'mako-auth': 'var(--mako)',
  'geo-relay': 'var(--kan)',
  canary: 'var(--live)',
  ingest: 'var(--muted)',
};

/** Every event of one play on one timeline: when, which part, what happened, how long it took. */
export function TracePage() {
  const { playId } = useParams({ from: '/trace/$playId' });
  const { data: t, error, refetch } = useApi('trace', { playId });
  if (error && !t) return <LoadError error={error} retry={() => void refetch()} />;
  if (!t) return <Skeleton className="h-96" />;
  const first = t.events[0];
  const t0 = first ? Date.parse(first.ts) : 0;
  // Each event is written when its step ends: its bar runs from (end - latency) to its end.
  const ends = t.events.map((e) => Date.parse(e.ts) - t0);
  const span = Math.max(1, ...ends, ...t.events.map((e) => e.latencyMs ?? 0));
  const failed = t.events.some((e) => e.outcome === 'error');
  const show = t.events.find((e) => e.showId)?.showId;
  const episode = t.events.find((e) => e.episodeId)?.episodeId;
  return (
    <section className="space-y-5">
      <Link to="/failures" className="inline-flex items-center gap-1 text-muted text-sm hover:text-fg">
        <ArrowLeft className="size-4" /> Failures
      </Link>
      <PageHeader
        title="Play trace"
        description={
          <span className="font-mono text-xs">
            {t.playId}
            {playId.startsWith('probe-') || playId.startsWith('canary-') ? ' · internal check' : ''}
          </span>
        }
        action={
          t.events.length ? (
            <HealthPill state={failed ? 'error' : 'ok'} label={failed ? 'Failed' : 'Played'} />
          ) : null
        }
      />
      {!t.events.length ? (
        <Empty>No events for this play id (raw events are kept 30 days).</Empty>
      ) : (
        <>
          <Card>
            <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="min-w-0">
                <div className="text-muted text-xs">Show</div>
                <Title className="font-medium">{t.title ?? show ?? '—'}</Title>
              </div>
              <div>
                <div className="text-muted text-xs">Episode</div>
                <div className="num font-mono text-sm">{episode ?? '—'}</div>
              </div>
              <div>
                <div className="text-muted text-xs">Source</div>
                <SourceTag source={t.events.find((e) => e.source)?.source} short={false} />
              </div>
              <div>
                <div className="text-muted text-xs">Started</div>
                <When iso={first?.ts} className="text-sm" />
              </div>
            </CardBody>
          </Card>
          <Card>
            <ol className="divide-y divide-border">
              {t.events.map((e, i) => {
                const at = ends[i] ?? 0;
                const left = (Math.max(0, at - (e.latencyMs ?? 0)) / span) * 100;
                const width = Math.max(0.8, ((e.latencyMs ?? 0) / span) * 100);
                const detail = e.detail ?? {};
                const upstream = typeof detail.upstream === 'string' ? detail.upstream : undefined;
                const reason = typeof detail.reason === 'string' ? detail.reason : undefined;
                return (
                  <li key={`${e.ts}${e.kind}${String(i)}`} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="num w-20 shrink-0 font-mono text-muted text-xs" title={clock(e.ts)}>
                        +{ms(at)}
                      </span>
                      <HealthDot state={e.outcome === 'ok' ? 'ok' : 'error'} />
                      <Badge style={{ color: COMPONENT_COLOR[e.component] ?? 'inherit' }}>
                        {e.component}
                      </Badge>
                      <span className="font-medium text-sm">{e.kind.replace('_', ' ')}</span>
                      {e.status !== undefined ? (
                        <span className="num text-muted text-xs">HTTP {e.status}</span>
                      ) : null}
                      {e.latencyMs !== undefined ? (
                        <span className="num ms-auto text-muted text-xs">{ms(e.latencyMs)}</span>
                      ) : null}
                    </div>
                    <div className="relative mt-2 h-1.5 rounded-full bg-surface-2" aria-hidden>
                      <span
                        className="absolute inset-y-0 rounded-full"
                        style={{
                          left: `${left}%`,
                          width: `${Math.min(width, 100 - left)}%`,
                          background:
                            e.outcome === 'ok'
                              ? (COMPONENT_COLOR[e.component] ?? 'var(--accent)')
                              : 'var(--error)',
                        }}
                      />
                    </div>
                    {upstream || reason ? (
                      <p className="mt-2 break-words font-mono text-xs">
                        {upstream ? <span className="text-muted">{upstream}</span> : null}
                        {upstream && reason ? ' — ' : null}
                        {reason ? (
                          <span style={{ color: e.outcome === 'ok' ? undefined : 'var(--error)' }}>
                            {reason}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                    {Object.keys(detail).length ? (
                      <details className="group mt-1">
                        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-muted text-xs [&::-webkit-details-marker]:hidden">
                          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />{' '}
                          detail
                        </summary>
                        <pre className="mt-1 overflow-x-auto rounded-lg bg-surface-2 p-2 text-xs">
                          {JSON.stringify(detail, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </Card>
        </>
      )}
    </section>
  );
}
