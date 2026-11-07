import type { Sources as SourcesData } from '@israel-tv/admin-contract';
import { ChevronRight, Globe } from 'lucide-react';
import { ActionButton } from '#components/actions.tsx';
import { Ago, Empty, LoadError, PageHeader, SourceTag, When } from '#components/bits.tsx';
import { CanaryStrip } from '#components/canary-strip.tsx';
import { asHealth, HealthPill } from '#components/health.tsx';
import { Badge } from '#components/ui/badge.tsx';
import { Card, CardBody, CardHeader } from '#components/ui/card.tsx';
import { Meter } from '#components/ui/progress.tsx';
import { Skeleton } from '#components/ui/skeleton.tsx';
import { useApi } from '#lib/api.ts';
import { duration, num, pct } from '#lib/format.ts';

type Source = SourcesData['sources'][number];

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="num truncate font-medium">{children}</dd>
    </div>
  );
}

function Fold({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-muted transition-transform group-open:rotate-90" aria-hidden />
        {summary}
      </summary>
      <div className="border-border border-t px-3 py-2">{children}</div>
    </details>
  );
}

function SourceCard({ s }: { s: Source }) {
  const late =
    s.lastGoodAt && s.cadenceHours ? (Date.now() - Date.parse(s.lastGoodAt)) / 3_600_000 / s.cadenceHours : 0;
  const c = s.canary;
  // Notes the boxes below already show in full are not repeated.
  const notes = s.notes.filter(
    (n) => !(s.emptyShows.length && /nothing to watch/.test(n)) && !(s.blocked && /bot protection/.test(n)),
  );
  return (
    <Card>
      <CardHeader
        title={<SourceTag source={s.source} short={false} />}
        action={
          <HealthPill
            state={s.stale ? 'error' : asHealth(s.health)}
            {...(s.stale ? { label: 'Stale in the addon' } : {})}
          />
        }
      />
      <CardBody className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={s.source === 'live' ? 'Channels' : 'Shows'}>{num(s.shows)}</Stat>
          <Stat label="Episodes">{s.source === 'live' ? '—' : num(s.episodes)}</Stat>
          <Stat label="Last good read">
            <Ago iso={s.lastGoodAt} />
            {s.cadenceHours ? (
              <span className="font-normal text-muted text-xs"> / {s.cadenceHours} h</span>
            ) : null}
          </Stat>
          {s.source === 'kan' ? (
            <Stat label="Last slice">
              <Ago iso={s.runs[0]?.at} />
              <span className="font-normal text-muted text-xs"> · read in slices</span>
            </Stat>
          ) : s.source === 'live' ? (
            <Stat label="Channels checked">
              <Ago iso={s.lastFullRun} />
            </Stat>
          ) : (
            <Stat label="Last airing check">
              <Ago iso={s.lastAiringRun} />
            </Stat>
          )}
        </dl>
        {s.cadenceHours && s.lastGoodAt ? (
          <div>
            <div className="mb-1 flex justify-between text-muted text-xs">
              <span>Time since the last good read, against twice the expected rhythm</span>
              <span className="num">{pct(Math.min(late / 2, 1))}</span>
            </div>
            <Meter value={late / 2} label="freshness" warnAt={0.5} errorAt={1} />
          </div>
        ) : null}

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">Playback canary</span>
            {c ? (
              <span className="text-muted">
                last <Ago iso={c.at} />
              </span>
            ) : (
              <span className="text-muted">not run yet</span>
            )}
          </div>
          <CanaryStrip runs={s.canaryHistory} />
          {c ? (
            <p className="mt-1.5 text-xs">
              <HealthPill
                state={c.outcome === 'ok' ? 'ok' : 'error'}
                label={c.outcome === 'ok' ? 'Plays' : `Fails at ${c.step ?? '?'}`}
              />{' '}
              <span className="text-muted">
                <bdi dir="auto">{c.detail}</bdi>
              </span>
            </p>
          ) : null}
          {c?.unavailable?.length ? (
            <p className="mt-1 text-xs" style={{ color: 'var(--warn)' }}>
              Episode unavailable (the source itself plays): {c.unavailable.join(', ')}
            </p>
          ) : null}
        </div>

        {notes.length ? (
          <ul className="space-y-1 text-sm">
            {notes.map((n) => (
              <li key={n} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-muted" aria-hidden />
                <bdi dir="auto">{n}</bdi>
              </li>
            ))}
          </ul>
        ) : null}

        {s.blocked ? (
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
            <div className="font-medium">Refused by the site's bot protection in the last full read</div>
            <div className="text-muted text-xs">
              {s.blocked.recovered.length} read on a retry · {s.blocked.pending.length} still waiting ·{' '}
              {s.blocked.attempts} {s.blocked.attempts === 1 ? 'retry' : 'retries'} so far
              {s.blocked.nextAt ? (
                <>
                  {' '}
                  · next <Ago iso={s.blocked.nextAt} />
                </>
              ) : null}
            </div>
            {s.blocked.pending.length ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {s.blocked.pending.map((t) => (
                  <Badge key={t}>
                    <bdi dir="auto">{t}</bdi>
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-2">
          {s.emptyShows.length ? (
            <Fold
              summary={
                <span>
                  {num(s.emptyShows.length)} {s.emptyShows.length === 1 ? 'show' : 'shows'} listed by the site
                  with nothing to watch <span className="text-muted">(not in the catalog)</span>
                </span>
              }
            >
              <ul className="columns-1 gap-6 text-sm sm:columns-2" dir="rtl">
                {s.emptyShows.map((t) => (
                  <li key={t} className="break-inside-avoid py-0.5">
                    {t}
                  </li>
                ))}
              </ul>
            </Fold>
          ) : null}
          {s.runs.length ? (
            <Fold summary={<span>Recent reads ({s.runs.length})</span>}>
              <div className="-mx-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-xs">
                  <thead className="text-muted">
                    <tr className="text-start">
                      <th className="px-3 py-1 text-start font-medium">When</th>
                      <th className="px-3 py-1 text-start font-medium">Kind</th>
                      <th className="px-3 py-1 text-start font-medium">Status</th>
                      <th className="px-3 py-1 text-end font-medium">Shows ok / failed</th>
                      <th className="px-3 py-1 text-end font-medium">New</th>
                      <th className="px-3 py-1 text-end font-medium">Took</th>
                    </tr>
                  </thead>
                  <tbody className="num">
                    {s.runs.map((r) => (
                      <tr key={`${r.at}${r.kind}`} className="border-border border-t" title={r.error}>
                        <td className="px-3 py-1">
                          <When iso={r.at} />
                        </td>
                        <td className="px-3 py-1">{r.kind}</td>
                        <td className="px-3 py-1">
                          <HealthPill
                            state={
                              r.status === 'ok'
                                ? 'ok'
                                : r.status === 'running'
                                  ? 'unknown'
                                  : r.status === 'partial'
                                    ? 'warn'
                                    : 'error'
                            }
                            label={r.status}
                          />
                        </td>
                        <td className="px-3 py-1 text-end">
                          {r.showsOk} / {r.showsFailed}
                        </td>
                        <td className="px-3 py-1 text-end">{r.newEpisodes ? `+${r.newEpisodes}` : '—'}</td>
                        <td className="px-3 py-1 text-end">
                          {r.seconds !== undefined ? duration(r.seconds) : '…'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Fold>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

export function Sources() {
  const { data, error, refetch } = useApi('sources');
  if (error && !data) return <LoadError error={error} retry={() => void refetch()} />;
  return (
    <section className="space-y-5">
      <PageHeader
        title="Sources"
        description="Each broadcaster's health, the daily playback canary, the geo proxy and the Kan reader."
        action={
          <ActionButton action="canary" invalidate={['sources', 'health']}>
            Run the canary now
          </ActionButton>
        }
      />
      {!data ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : (
        <>
          {data.sources.length === 0 ? (
            <Card>
              <Empty>No sources are read on this instance (all are off in the config).</Empty>
            </Card>
          ) : null}
          <div className="grid gap-5 lg:grid-cols-2">
            {data.sources.map((s) => (
              <SourceCard key={s.source} s={s} />
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader
                title={
                  <span className="inline-flex items-center gap-2">
                    <Globe className="size-4 text-muted" /> Geo proxy exits
                  </span>
                }
                description="What the relay saw through each exit since the service started."
              />
              <CardBody>
                {data.proxy.exits.length ? (
                  <ul className="divide-y divide-border">
                    {data.proxy.exits.map((e) => {
                      const total = e.ok + e.errors;
                      const state =
                        total === 0 ? 'unknown' : e.errors === 0 ? 'ok' : e.ok === 0 ? 'error' : 'warn';
                      return (
                        <li key={e.server} className="flex flex-wrap items-center justify-between gap-2 py-2">
                          <div className="min-w-0">
                            <div className="truncate font-mono text-xs">{new URL(e.server).host}</div>
                            <div className="text-muted text-xs">
                              {total ? `${num(e.ok)} ok · ${num(e.errors)} refused` : 'not used yet'}
                              {e.lastError ? ` · last error ${e.lastError}` : ''}
                            </div>
                          </div>
                          <HealthPill state={state} {...(state === 'unknown' ? { label: 'Idle' } : {})} />
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <Empty>No geo proxy configured (correct inside Israel).</Empty>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title="Kan reader"
                description="Kan is read in small, slow slices through the browser."
              />
              <CardBody>
                {data.kan ? (
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>Shows read through</span>
                        <span className="num font-medium">
                          {num(data.kan.showsDone)} / {num(data.kan.shows)}
                        </span>
                      </div>
                      <Meter
                        value={data.kan.shows ? data.kan.showsDone / data.kan.shows : 0}
                        label="Kan shows read through"
                        color="var(--kan)"
                      />
                    </div>
                    <p className="text-muted text-sm">
                      {num(data.kan.pending)} episode {data.kan.pending === 1 ? 'page' : 'pages'} waiting.
                      {data.kan.backoffUntil && Date.parse(data.kan.backoffUntil) > Date.now() ? (
                        <>
                          {' '}
                          Backing off until <When iso={data.kan.backoffUntil} />.
                        </>
                      ) : null}
                    </p>
                  </div>
                ) : (
                  <Empty>Kan is not read on this instance.</Empty>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </section>
  );
}
