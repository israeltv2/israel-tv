import type { Live } from '@israel-tv/admin-contract';
import { Link } from '@tanstack/react-router';
import { Radio } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Ago, Empty, PageHeader, SourceTag, Title } from '#components/bits.tsx';
import { HealthPill } from '#components/health.tsx';
import { Badge } from '#components/ui/badge.tsx';
import { Card } from '#components/ui/card.tsx';
import { get, subscribeLive } from '#lib/api.ts';
import { bytes, duration, num } from '#lib/format.ts';

/** What is playing now, pushed by the daemon (Server-Sent Events) while this section is open. */
export function LiveNow() {
  const [live, setLive] = useState<Live>();
  const [state, setState] = useState<'open' | 'retrying' | 'closed'>('closed');
  const [, tick] = useState(0);
  useEffect(() => {
    void get('live').then(setLive, () => undefined);
    const stop = subscribeLive(setLive, setState);
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      stop();
      clearInterval(t);
    };
  }, []);
  const sessions = live?.sessions ?? [];
  return (
    <section className="space-y-5">
      <PageHeader
        title="Live now"
        description="Plays and relay sessions through this home's helper, updated as they happen."
        action={
          <HealthPill
            state={state === 'open' ? 'ok' : state === 'retrying' ? 'warn' : 'unknown'}
            label={state === 'open' ? 'Connected' : state === 'retrying' ? 'Reconnecting…' : 'Paused'}
          />
        }
      />
      {sessions.length === 0 ? (
        <Card className="grid place-items-center py-14">
          <Radio className="mb-2 size-8 text-muted" aria-hidden />
          <Empty className="py-0">Nothing is playing through the helper right now.</Empty>
          {live ? (
            <p className="mt-1 text-muted text-xs">
              as of <Ago iso={live.at} />
            </p>
          ) : null}
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {sessions.map((s) => (
            <li key={s.playId}>
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Title className="block font-semibold">{s.title ?? s.showId ?? s.playId}</Title>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-muted text-xs">
                      <SourceTag source={s.source} />
                      {s.episodeId?.includes(':') ? (
                        <span className="num">
                          S{s.episodeId.split(':')[1]} E{s.episodeId.split(':')[2]}
                        </span>
                      ) : null}
                      <Badge>{s.kind === 'relay' ? 'relayed via proxy' : 'direct from the CDN'}</Badge>
                    </div>
                  </div>
                  <span className="relative mt-1 flex size-2.5">
                    <span
                      className="absolute inline-flex size-full animate-ping rounded-full opacity-60"
                      style={{ background: 'var(--ok)' }}
                    />
                    <span
                      className="relative inline-flex size-2.5 rounded-full"
                      style={{ background: 'var(--ok)' }}
                    />
                  </span>
                </div>
                <dl className="num mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-muted text-xs">Playing for</dt>
                    <dd>{duration((Date.now() - Date.parse(s.since)) / 1000)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted text-xs">Segments</dt>
                    <dd>{s.kind === 'relay' ? num(s.segments) : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted text-xs">Relayed</dt>
                    <dd>{s.kind === 'relay' ? bytes(s.bytes) : '—'}</dd>
                  </div>
                </dl>
                <Link
                  to="/trace/$playId"
                  params={{ playId: s.playId }}
                  className="mt-3 inline-block text-muted text-xs hover:underline"
                >
                  trace →
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
