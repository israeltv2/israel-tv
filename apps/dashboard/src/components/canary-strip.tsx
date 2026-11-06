import { when } from '#lib/format.ts';

interface Run {
  at: string;
  outcome: string;
  step?: string | undefined;
  episodeId?: string | undefined;
  statuses?: string | undefined;
  unavailable: number;
}

/** One bar per canary run, oldest to newest (like a status page's uptime strip). */
export function CanaryStrip({ runs, slots = 20 }: { runs: Run[]; slots?: number }) {
  const shown = runs.slice(-slots);
  const pad = slots - shown.length;
  return (
    <ul className="flex h-7 items-stretch gap-[3px]" aria-label="playback canary, oldest to newest">
      {Array.from({ length: pad }, (_, i) => (
        <li key={`pad-${String(i)}`} className="flex-1 rounded-[3px] bg-surface-2" aria-hidden />
      ))}
      {shown.map((r) => {
        const color = r.outcome !== 'ok' ? 'var(--error)' : r.unavailable ? 'var(--warn)' : 'var(--ok)';
        const what =
          r.outcome !== 'ok'
            ? `failed at ${r.step ?? '?'}${r.statuses ? ` (${r.statuses})` : ''}`
            : r.unavailable
              ? `played after ${r.unavailable} unavailable ${r.unavailable === 1 ? 'title' : 'titles'}`
              : `played ${r.statuses ?? ''}`;
        return (
          <li
            key={r.at}
            title={`${when(r.at)} · ${what}${r.episodeId ? ` · ${r.episodeId}` : ''}`}
            aria-label={`${when(r.at)}: ${what}`}
            className="flex-1 rounded-[3px]"
            style={{ background: color }}
          />
        );
      })}
    </ul>
  );
}
