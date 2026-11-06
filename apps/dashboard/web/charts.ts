// Time-series charts (uPlot): colours from the page's CSS variables, rebuilt when the theme or size changes.
import { html } from 'htm/preact';
import { useEffect, useRef } from 'preact/hooks';
import type uPlotType from 'uplot';

/** uPlot's minified build sets window.uPlot (loaded by index.html before this module). */
const uPlot = (globalThis as unknown as { uPlot: typeof uPlotType }).uPlot;

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const COLORS = ['--c1', '--c2', '--c3', '--c4', '--c5'];

export interface Series {
  label: string;
  values: number[];
}

/** A line chart over days (yyyy-mm-dd labels). An accessible summary goes in the aria-label. */
export function DayChart(props: { days: string[]; series: Series[]; title: string; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let plot: uPlotType | undefined;
    const draw = () => {
      plot?.destroy();
      const xs = props.days.map((d) => Date.parse(`${d}T12:00:00Z`) / 1000);
      plot = new uPlot(
        {
          width: el.clientWidth || 320,
          height: props.height ?? 180,
          legend: { show: props.series.length > 1 },
          axes: [
            { stroke: css('--muted'), grid: { stroke: css('--grid') } },
            { stroke: css('--muted'), grid: { stroke: css('--grid') }, size: 40 },
          ],
          series: [
            {},
            ...props.series.map((s, i) => ({
              label: s.label,
              stroke: css(COLORS[i % COLORS.length] ?? '--c1'),
              width: 2,
            })),
          ],
          scales: { x: { time: true } },
        },
        [xs, ...props.series.map((s) => s.values)],
        el,
      );
    };
    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', draw);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', draw);
      plot?.destroy();
    };
  }, [JSON.stringify(props.series), props.days.join()]);
  const total = props.series.map((s) => `${s.label}: ${s.values.reduce((a, b) => a + b, 0)}`).join(', ');
  if (props.days.length < 2)
    return html`<p class="muted small">Not enough days yet for a chart (${total}).</p>`;
  return html`<div class="chart" ref=${box} role="img" aria-label=${`${props.title} over ${props.days.length} days (${total})`}></div>`;
}

/** A tiny inline bar line (e.g. failures per day of the last week). */
export function Spark(props: { values: number[] }) {
  const max = Math.max(1, ...props.values);
  const w = 6;
  return html`<svg class="spark" width=${props.values.length * w} height="16" aria-hidden="true">
    ${props.values.map(
      (v, i) => html`<rect x=${i * w} y=${16 - (v / max) * 16} width=${w - 1} height=${(v / max) * 16} />`,
    )}
  </svg>`;
}
