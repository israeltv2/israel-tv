// Small shared pieces: Hebrew-safe titles, source tags, times, empty and error states, copyable commands.
import { Check, Copy, RefreshCw } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { ago, utcTitle, when } from '#lib/format.ts';
import { sourceColor, sourceName } from '#lib/sources.ts';
import { cn } from '#lib/utils.ts';

/** A title in any direction: Hebrew show names keep their own order inside the English page. */
export function Title({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="auto" className={cn('min-w-0 truncate text-left', className)}>
      {children}
    </bdi>
  );
}

export function SourceTag({ source, short = true }: { source: string | undefined; short?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
      <span className="size-2 rounded-sm" style={{ background: sourceColor(source) }} aria-hidden />
      {sourceName(source, short)}
    </span>
  );
}

/** "5 min ago", with the local time and the UTC time on hover; refreshed every minute. */
export function Ago({ iso, className }: { iso: string | undefined; className?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <time dateTime={iso} title={iso ? `${when(iso)} · ${utcTitle(iso)}` : undefined} className={className}>
      {ago(iso)}
    </time>
  );
}

export function When({ iso, className }: { iso: string | undefined; className?: string }) {
  return (
    <time dateTime={iso} title={utcTitle(iso)} className={cn('num', className)}>
      {when(iso)}
    </time>
  );
}

export function Empty({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('py-6 text-center text-muted text-sm', className)}>{children}</p>;
}

/** A failed load: what failed, keeping whatever was shown before. */
export function LoadError({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
      style={{ borderColor: 'var(--error)', color: 'var(--error)' }}
    >
      <span>Could not load: {error instanceof Error ? error.message : String(error)}</span>
      {retry ? (
        <button type="button" onClick={retry} className="inline-flex items-center gap-1 underline">
          <RefreshCw className="size-3.5" /> retry
        </button>
      ) : null}
    </div>
  );
}

export function CopyCommand({ command }: { command: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 py-1.5 ps-3 pe-1.5">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">{command}</code>
      <button
        type="button"
        aria-label={`copy: ${command}`}
        className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-fg"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          });
        }}
      >
        {done ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

/** Section heading row with an optional right-hand slot. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-semibold text-xl tracking-tight">{title}</h1>
        {description ? <p className="mt-0.5 text-muted text-sm">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
