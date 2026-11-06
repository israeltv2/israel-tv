// The sources the catalog reads, with the names and colours the dashboard uses everywhere.
export const SOURCES = ['mako', 'reshet', 'kan', 'live'] as const;

export const SOURCE_INFO: Record<string, { name: string; short: string; color: string }> = {
  mako: { name: 'Keshet 12 · Mako', short: 'Mako', color: 'var(--mako)' },
  reshet: { name: 'Reshet 13', short: 'Reshet', color: 'var(--reshet)' },
  kan: { name: 'Kan', short: 'Kan', color: 'var(--kan)' },
  live: { name: 'Live channels', short: 'Live', color: 'var(--live)' },
};

export function sourceName(s: string | undefined, short = false): string {
  if (!s) return 'unknown';
  const i = SOURCE_INFO[s];
  return i ? (short ? i.short : i.name) : s;
}

export function sourceColor(s: string | undefined): string {
  return (s && SOURCE_INFO[s]?.color) || 'var(--unknown)';
}
