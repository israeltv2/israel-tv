import type { PlayLine } from '@israel-tv/admin-contract';
import { Link } from '@tanstack/react-router';
import { Empty, SourceTag, Title, When } from '#components/bits.tsx';
import { HealthDot } from '#components/health.tsx';
import { Poster } from '#components/poster.tsx';
import { ms } from '#lib/format.ts';

/** Plays and failures, newest first; each opens its trace. */
export function PlayList({ items, empty }: { items: PlayLine[]; empty: string }) {
  if (!items.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y divide-border">
      {items.map((p) => (
        <li key={`${p.playId}${p.at}`}>
          <Link
            to="/trace/$playId"
            params={{ playId: p.playId }}
            className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
          >
            <HealthDot state={p.outcome === 'ok' ? 'ok' : 'error'} />
            <Poster art={p} source={p.source} title={p.title ?? p.showId} className="w-7" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <Title className="font-medium">{p.title ?? p.showId ?? p.playId}</Title>
                {p.episodeId?.includes(':') ? (
                  <span className="num shrink-0 text-muted text-xs">
                    S{p.episodeId.split(':')[1]} E{p.episodeId.split(':')[2]}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 text-muted text-xs">
                <SourceTag source={p.source} />
                <When iso={p.at} />
                {p.reason ? (
                  <span className="truncate" style={{ color: 'var(--error)' }}>
                    {p.status ? `HTTP ${p.status} · ` : ''}
                    {p.reason}
                  </span>
                ) : null}
              </div>
            </div>
            <span className="num shrink-0 text-muted text-xs">
              {p.outcome === 'ok' ? ms(p.latencyMs) : ''}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
