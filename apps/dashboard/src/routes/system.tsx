import { HardDrive, MemoryStick, Server, Timer } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Ago, Empty, LoadError, PageHeader, When } from '#components/bits.tsx';
import { HealthPill } from '#components/health.tsx';
import { Kpi } from '#components/kpi.tsx';
import { Card, CardBody, CardHeader } from '#components/ui/card.tsx';
import { Meter } from '#components/ui/progress.tsx';
import { Skeleton } from '#components/ui/skeleton.tsx';
import { useApi } from '#lib/api.ts';
import { compact, duration, mb, num, pct } from '#lib/format.ts';

const StackedDays = lazy(() => import('#components/charts.tsx').then((m) => ({ default: m.StackedDays })));

function Gauge({
  label,
  used,
  total,
  unit,
  warnAt,
  errorAt,
  note,
}: {
  label: string;
  used: number;
  total: number;
  unit: (n: number) => string;
  warnAt?: number;
  errorAt?: number;
  note?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="num text-muted text-xs">
          {unit(used)} of {unit(total)} · {pct(used / total)}
        </span>
      </div>
      <Meter
        value={used / total}
        label={label}
        {...(warnAt ? { warnAt } : {})}
        {...(errorAt ? { errorAt } : {})}
      />
      {note ? <p className="mt-1 text-muted text-xs">{note}</p> : null}
    </div>
  );
}

export function SystemPage() {
  const { data: s, error, refetch } = useApi('system');
  if (error && !s) return <LoadError error={error} retry={() => void refetch()} />;
  if (!s) return <Skeleton className="h-96" />;
  const q = s.quota;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className="space-y-5">
      <PageHeader
        title="System"
        description="The machine the service runs on, its databases and backups, and the free-plan limits."
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="Up for"
          icon={<Timer className="size-4" />}
          value={duration(s.uptimeSec)}
          sub={
            <>
              since <When iso={s.startedAt} />
            </>
          }
        />
        <Kpi
          label="Version"
          icon={<Server className="size-4" />}
          value={`v${s.version}`}
          sub={<span className="font-mono">{s.revision.slice(0, 12)}</span>}
        />
        <Kpi
          label="Service memory"
          icon={<MemoryStick className="size-4" />}
          value={mb(s.memoryMB.process)}
          sub={`Node ${s.node} · ${s.platform}`}
        />
        <Kpi
          label="Disk free"
          icon={<HardDrive className="size-4" />}
          value={s.diskFreeMB !== undefined ? mb(s.diskFreeMB) : '—'}
          {...(s.diskTotalMB ? { sub: `of ${mb(s.diskTotalMB)}` } : {})}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Machine" />
          <CardBody className="space-y-4">
            {s.diskFreeMB !== undefined && s.diskTotalMB ? (
              <Gauge label="Disk used" used={s.diskTotalMB - s.diskFreeMB} total={s.diskTotalMB} unit={mb} />
            ) : null}
            <Gauge
              label="Memory in use (whole machine)"
              used={s.memoryMB.totalSystem - s.memoryMB.availableSystem}
              total={s.memoryMB.totalSystem}
              unit={mb}
              warnAt={0.85}
              errorAt={0.95}
              note={`${mb(s.memoryMB.availableSystem)} available without swapping (file cache counts as available)`}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Cloudflare free plan · today"
            description={
              q ? (
                <>
                  Read <Ago iso={q.at} /> (hourly){q.day !== today ? ` · for ${q.day}` : ''}
                </>
              ) : undefined
            }
          />
          <CardBody className="space-y-4">
            {q ? (
              <>
                <Gauge label="Worker requests" used={q.requests} total={q.limits.requests} unit={compact} />
                <Gauge
                  label="Analytics Engine writes"
                  used={q.aeWrites}
                  total={q.limits.aeWrites}
                  unit={compact}
                />
                {q.byScript.length ? (
                  <p className="num text-muted text-xs">
                    {q.byScript.map((b) => `${b.script}: ${num(b.requests)}`).join(' · ')}
                  </p>
                ) : null}
                {q.warn ? (
                  <p className="text-xs" style={{ color: 'var(--warn)' }}>
                    {q.warn}
                  </p>
                ) : null}
                {q.readError ? (
                  <p className="text-xs" style={{ color: 'var(--error)' }}>
                    last read failed: {q.readError}
                  </p>
                ) : null}
              </>
            ) : (
              <Empty>Not read (local publisher, or no Cloudflare token on this instance).</Empty>
            )}
          </CardBody>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Databases" />
          <CardBody className="pt-2">
            <ul className="divide-y divide-border">
              {s.databases.map((d) => (
                <li key={d.name} className="flex items-center justify-between gap-3 py-2">
                  <span>{d.name}</span>
                  <span className="num text-sm">
                    {mb(d.sizeMB)}
                    {d.growthPerDayMB !== undefined ? (
                      <span className="text-muted text-xs"> · +{mb(d.growthPerDayMB)}/day</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Backup and restore check"
            description="Every night the catalog database is copied, and the copy is opened and checked on its own."
          />
          <CardBody className="space-y-2">
            {s.backup ? (
              <>
                <HealthPill
                  state={!s.backup.check || /^ok/i.test(s.backup.check) ? 'ok' : 'warn'}
                  label={s.backup.check ?? 'copied'}
                />
                <div className="text-sm">
                  <span className="font-mono text-xs">{s.backup.file}</span> · {mb(s.backup.sizeMB)}
                </div>
                <div className="text-muted text-xs">
                  <When iso={s.backup.at} /> · <Ago iso={s.backup.at} />
                </div>
              </>
            ) : (
              <Empty>No backup yet (the first runs with tonight's housekeeping).</Empty>
            )}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader
          title="Usage events written per day"
          description="One per meaningful action, never per video segment"
        />
        <CardBody>
          <Suspense fallback={<Skeleton className="h-[160px]" />}>
            <StackedDays
              rows={s.eventsPerDay.map((d) => ({ day: d.day, n: d.n }))}
              height={160}
              caption="Usage events per day"
              series={[{ key: 'n', name: 'Events', color: 'var(--accent)' }]}
            />
          </Suspense>
        </CardBody>
      </Card>
    </section>
  );
}
