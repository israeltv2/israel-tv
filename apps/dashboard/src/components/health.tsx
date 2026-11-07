import { CircleAlert, CircleCheck, CircleHelp, CircleX, TriangleAlert } from 'lucide-react';
import { cn } from '#lib/utils.ts';

export type HealthState = 'ok' | 'warn' | 'error' | 'unknown';

const LOOK: Record<HealthState, { word: string; color: string; Icon: typeof CircleCheck }> = {
  ok: { word: 'OK', color: 'var(--ok)', Icon: CircleCheck },
  warn: { word: 'Degraded', color: 'var(--warn)', Icon: TriangleAlert },
  error: { word: 'Failing', color: 'var(--error)', Icon: CircleX },
  unknown: { word: 'Unknown', color: 'var(--unknown)', Icon: CircleHelp },
};

export function asHealth(s: string | undefined): HealthState {
  return s === 'ok' || s === 'warn' || s === 'error'
    ? s
    : s === 'pass'
      ? 'ok'
      : s === 'fail'
        ? 'error'
        : 'unknown';
}

/**
 * A run's status as a health colour. `stopped` (cut short by a restart, not a failure) and `running` are neither good
 * nor bad: grey.
 */
export function runHealth(status: string): HealthState {
  return status === 'ok' ? 'ok' : status === 'partial' ? 'warn' : status === 'failed' ? 'error' : 'unknown';
}

/** How a run's status reads: `stopped` says why. */
export function runLabel(status: string): string {
  return status === 'stopped' ? 'stopped for restart' : status;
}

/** Colour, icon and word together (never colour alone). */
export function HealthPill({
  state,
  label,
  className,
}: {
  state: HealthState;
  label?: string;
  className?: string;
}) {
  const { word, color, Icon } = LOOK[state];
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs', className)}
      style={{ color, background: `color-mix(in oklab, ${color} 13%, transparent)` }}
    >
      <Icon className="size-3.5" aria-hidden />
      {/* Hebrew names keep their own direction inside the left-to-right page. */}
      <bdi>{label ?? word}</bdi>
    </span>
  );
}

export function HealthDot({ state, className }: { state: HealthState; className?: string }) {
  return (
    <span
      role="img"
      aria-label={LOOK[state].word}
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ background: LOOK[state].color }}
    />
  );
}

export function ProblemIcon({ severity }: { severity: 'warn' | 'error' }) {
  return severity === 'error' ? (
    <CircleX className="size-4 shrink-0" style={{ color: 'var(--error)' }} aria-label="error" />
  ) : (
    <CircleAlert className="size-4 shrink-0" style={{ color: 'var(--warn)' }} aria-label="warning" />
  );
}
