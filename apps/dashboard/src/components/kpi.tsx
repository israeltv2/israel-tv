import type { ReactNode } from 'react';
import { Card } from '#components/ui/card.tsx';
import { cn } from '#lib/utils.ts';

/** One headline number: label, value, a line of context and an optional sparkline or meter. */
export function Kpi({
  label,
  value,
  sub,
  icon,
  children,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  tone?: string;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col gap-1 p-4', className)}>
      <div className="flex items-center justify-between gap-2 text-muted text-xs">
        <span className="font-medium">{label}</span>
        {icon}
      </div>
      <div
        className="num font-semibold text-[26px] leading-tight tracking-tight"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </div>
      {sub ? <div className="text-muted text-xs">{sub}</div> : null}
      {children ? <div className="mt-1">{children}</div> : null}
    </Card>
  );
}
