// Time-series charts (Recharts, loaded with the sections that use them). Colours come from the CSS tokens, so
// both themes work; each chart also carries a hidden table for screen readers.
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts';
import { dayLabel, ms, num } from '#lib/format.ts';

export interface Series {
  key: string;
  name: string;
  color: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: TooltipContentProps<number, string> & { unit?: 'ms' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium">{typeof label === 'string' ? dayLabel(label, 'weekday') : label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="num font-medium">
            {unit === 'ms' ? ms(Number(p.value)) : num(Number(p.value))}
          </span>
        </div>
      ))}
    </div>
  );
}

function SrTable({
  rows,
  series,
  caption,
}: {
  rows: Record<string, unknown>[];
  series: Series[];
  caption: string;
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th>Day</th>
          {series.map((s) => (
            <th key={s.key}>{s.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r.day)}>
            <td>{String(r.day)}</td>
            {series.map((s) => (
              <td key={s.key}>{String(r[s.key] ?? 0)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const axis = {
  tickLine: false,
  axisLine: false,
} as const;

/** Bars per day, stacked by series (plays by source, failures by kind). */
export function StackedDays({
  rows,
  series,
  caption,
  height = 220,
}: {
  rows: Record<string, unknown>[];
  series: Series[];
  caption: string;
  height?: number;
}) {
  return (
    <figure aria-label={caption}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -8 }} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" {...axis} tickFormatter={(d: string) => dayLabel(d)} minTickGap={16} />
          <YAxis {...axis} allowDecimals={false} width={44} />
          <Tooltip content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} />} />
          {series.length > 1 ? (
            <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          ) : null}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId="a"
              fill={s.color}
              radius={i === series.length - 1 ? [3, 3, 0, 0] : 0}
              maxBarSize={28}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <SrTable rows={rows} series={series} caption={caption} />
    </figure>
  );
}

/** Lines per day (home vs public viewers, p50/p95 latency). */
export function DayLines({
  rows,
  series,
  caption,
  unit,
  height = 220,
}: {
  rows: Record<string, unknown>[];
  series: (Series & { dashed?: boolean })[];
  caption: string;
  unit?: 'ms';
  height?: number;
}) {
  return (
    <figure aria-label={caption}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" {...axis} tickFormatter={(d: string) => dayLabel(d)} minTickGap={16} />
          <YAxis
            {...axis}
            width={unit === 'ms' ? 60 : 44}
            allowDecimals={false}
            tickFormatter={(v: number) => (unit === 'ms' ? ms(v) : num(v))}
          />
          <Tooltip
            content={(p) => (
              <ChartTooltip {...(p as TooltipContentProps<number, string>)} {...(unit ? { unit } : {})} />
            )}
          />
          <Legend iconType="plainline" iconSize={12} wrapperStyle={{ fontSize: 12 }} />
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              {...(s.dashed ? { strokeDasharray: '4 3' } : {})}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <SrTable rows={rows} series={series} caption={caption} />
    </figure>
  );
}
