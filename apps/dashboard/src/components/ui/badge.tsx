import type { ComponentProps } from 'react';
import { cn } from '#lib/utils.ts';

export function Badge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-medium text-[11px] leading-none',
        className,
      )}
      {...props}
    />
  );
}
