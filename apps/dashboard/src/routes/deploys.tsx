import { useState } from 'react';
import { ActionButton } from '#components/actions.tsx';
import { Ago, CopyCommand, Empty, LoadError, PageHeader, SourceTag, Title, When } from '#components/bits.tsx';
import { HealthPill } from '#components/health.tsx';
import { Card, CardBody, CardHeader } from '#components/ui/card.tsx';
import { Skeleton } from '#components/ui/skeleton.tsx';
import { useApi } from '#lib/api.ts';
import { duration, num } from '#lib/format.ts';

const runState = (s: string) =>
  s === 'ok' ? 'ok' : s === 'running' ? 'unknown' : s === 'partial' ? 'warn' : 'error';

function RefreshShow() {
  const [id, setId] = useState('');
  const valid = /^iltv_[a-z]+_\d+$/.test(id.trim());
  return (
    <div className="space-y-2">
      <label htmlFor="refresh-id" className="block text-muted text-xs">
        Series id (from the show's address in the addon, e.g. iltv_mako_15)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="refresh-id"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="iltv_mako_15"
          spellCheck={false}
          className="h-8 w-44 rounded-lg border border-border bg-surface px-2.5 font-mono text-xs"
        />
        {valid ? (
          <ActionButton action="refresh" params={{ id: id.trim() }} invalidate={['deploys', 'sources']}>
            Read it again and publish
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
}

export function Deploys() {
  const { data: d, error, refetch } = useApi('deploys');
  if (error && !d) return <LoadError error={error} retry={() => void refetch()} />;
  if (!d) return <Skeleton className="h-96" />;
  const shows = d.catalog.reduce((n, c) => n + c.shows, 0);
  const episodes = d.catalog.reduce((n, c) => n + c.episodes, 0);
  return (
    <section className="space-y-5">
      <PageHeader
        title="Catalog & deploys"
        description="What is published, when it went out, and how to roll it back."
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="In the catalog"
            description={`${num(shows)} shows and channels · ${num(episodes)} episodes`}
          />
          <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {d.catalog.map((c) => (
              <div key={c.source} className="rounded-lg bg-surface-2 p-3">
                <SourceTag source={c.source} />
                <div className="num mt-1 font-semibold text-xl">{num(c.shows)}</div>
                <div className="num text-muted text-xs">
                  {c.source === 'live' ? 'channels' : `${num(c.episodes)} episodes`}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Last publish" />
          <CardBody className="space-y-2">
            {d.lastPublish ? (
              <>
                <HealthPill state={runState(d.lastPublish.status)} label={d.lastPublish.status} />
                <div className="text-sm">
                  <When iso={d.lastPublish.at} /> · <Ago iso={d.lastPublish.at} className="text-muted" />
                </div>
                {d.lastPublish.detail ? (
                  <p className="break-words text-xs" style={{ color: 'var(--error)' }}>
                    {d.lastPublish.detail}
                  </p>
                ) : null}
              </>
            ) : (
              <Empty>Nothing published yet.</Empty>
            )}
          </CardBody>
        </Card>
      </div>

      {d.cloudflare ? (
        <Card>
          <CardHeader
            title="Versions on Cloudflare"
            description="Data (the catalog files) and code (the API) roll back separately. Run these where the service runs; each asks before it changes anything."
          />
          <CardBody className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-muted text-xs">Data Worker</div>
              <div className="font-mono text-sm">{d.cloudflare.dataWorker}</div>
              <div className="truncate font-mono text-muted text-xs">
                {d.cloudflare.dataVersion ?? 'version unknown'}
              </div>
              {d.cloudflare.commands
                .filter((c) => c.includes(' data'))
                .map((c) => (
                  <CopyCommand key={c} command={c} />
                ))}
            </div>
            <div className="space-y-2">
              <div className="text-muted text-xs">API Worker (no public address)</div>
              <div className="font-mono text-sm">{d.cloudflare.apiWorker}</div>
              <div className="truncate font-mono text-muted text-xs">
                {d.cloudflare.apiVersion ?? 'version unknown'}
              </div>
              {d.cloudflare.commands
                .filter((c) => c.includes(' api'))
                .map((c) => (
                  <CopyCommand key={c} command={c} />
                ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Publishes" description="Newest first" />
          <CardBody className="pt-2">
            {d.publishes.length ? (
              <ol className="relative space-y-3 border-border border-s ps-4">
                {d.publishes.map((p) => (
                  <li key={p.at} className="relative">
                    <span
                      className="-start-[21px] absolute top-1.5 size-2.5 rounded-full border-2 border-surface"
                      style={{
                        background: `var(--${runState(p.status) === 'unknown' ? 'unknown' : runState(p.status)})`,
                      }}
                      aria-hidden
                    />
                    <div className="flex flex-wrap items-center gap-x-2 text-sm">
                      <When iso={p.at} />
                      <span className="text-muted text-xs">
                        {p.status}
                        {p.seconds !== undefined ? ` · ${duration(p.seconds)}` : ''}
                      </span>
                    </div>
                    {p.detail ? (
                      <p className="break-words text-xs" style={{ color: 'var(--error)' }}>
                        {p.detail}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>No publishes yet.</Empty>
            )}
          </CardBody>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Refresh one show"
              description="Reads it again now (all seasons) and publishes at once."
            />
            <CardBody>
              <RefreshShow />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Catalog check"
              description={
                d.audit ? (
                  <>
                    The publisher's own check of {num(d.audit.metas)} show pages · <Ago iso={d.audit.at} />
                  </>
                ) : undefined
              }
            />
            <CardBody className="pt-2">
              {!d.audit ? (
                <Empty>Runs after the next publish.</Empty>
              ) : d.audit.problems.length ? (
                <ul className="space-y-2 text-sm">
                  {d.audit.problems.map((p) => (
                    <li key={p.check}>
                      <span className="font-medium">{p.check}</span>{' '}
                      <span className="num text-muted">×{p.count}</span>
                      <div className="truncate text-muted text-xs">{p.examples.join(' · ')}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <HealthPill state="ok" label="Every published show page passed" />
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Shows failing to read" description="Their last good data is still published" />
        <CardBody className="pt-2">
          {d.failingShows.length ? (
            <ul className="divide-y divide-border">
              {d.failingShows.map((s) => (
                <li key={s.id} className="py-2">
                  <div className="flex items-center justify-between gap-3">
                    <Title className="font-medium">{s.title}</Title>
                    <span className="shrink-0 font-mono text-muted text-xs">{s.id}</span>
                  </div>
                  <p className="break-words text-xs" style={{ color: 'var(--error)' }}>
                    {s.error}
                  </p>
                  <p className="text-muted text-xs">
                    last good read <Ago iso={s.lastOkAt} />
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Every show read well on its last try.</Empty>
          )}
        </CardBody>
      </Card>
    </section>
  );
}
