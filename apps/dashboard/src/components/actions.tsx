import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '#components/ui/button.tsx';
import { post } from '#lib/api.ts';

/** A safe action (POST with the CSRF value) and what the daemon answered. */
export function ActionButton({
  action,
  params,
  children,
  invalidate,
}: {
  action: 'canary' | 'refresh';
  params?: Record<string, string>;
  children: ReactNode;
  invalidate?: string[];
}) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => post(action, params),
    onSuccess: () => {
      for (const k of invalidate ?? [])
        setTimeout(() => void qc.invalidateQueries({ queryKey: [k] }), 30_000);
    },
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={() => m.mutate()} disabled={m.isPending}>
        {m.isPending ? <LoaderCircle className="animate-spin" /> : null}
        {children}
      </Button>
      {m.data ? (
        <span
          className="text-xs"
          role="status"
          style={{ color: m.data.accepted ? 'var(--ok)' : 'var(--warn)' }}
        >
          {m.data.message}
        </span>
      ) : m.error ? (
        <span className="text-xs" role="alert" style={{ color: 'var(--error)' }}>
          {m.error.message}
        </span>
      ) : null}
    </div>
  );
}
