import { cn } from '#lib/utils.ts';

/** A bar from 0 to 1, coloured by how full it is (or a fixed colour). */
export function Meter({
  value,
  label,
  className,
  color,
  warnAt = 0.75,
  errorAt = 0.9,
}: {
  value: number;
  label: string;
  className?: string;
  color?: string;
  warnAt?: number;
  errorAt?: number;
}) {
  const v = Math.max(0, Math.min(1, value));
  const tone = color ?? (v >= errorAt ? 'var(--error)' : v >= warnAt ? 'var(--warn)' : 'var(--ok)');
  return (
    // biome-ignore lint/a11y/useSemanticElements: a styled bar with the meter role (a native <meter> cannot take the theme's colours everywhere)
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-2', className)}
    >
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${v * 100}%`, background: tone }}
      />
    </div>
  );
}
