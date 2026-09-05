"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { cx, focusRing } from "@/components/ui";
import styles from "./tl-dashboard.module.css";

export type MetricHistory = { unit: string; basis: string; points: Array<{ date: string; value: number | null }> };

/** Small, keyboard-readable history. Null points are gaps, never zero or interpolated. */
export function TlSparkline({ history, label, metricKey }: { history?: MetricHistory | null; label: string; metricKey: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [show, setShow] = useState(false);
  const tooltipId = useId();
  const points = history?.points ?? [];
  const available = points.some(point => point.value !== null && Number.isFinite(point.value));
  if (!available) return <span className={styles.trendUnavailable} data-testid={`tl-sparkline-${metricKey}`} data-state="unavailable" aria-label={`${label}: Trend unavailable`}>Trend unavailable</span>;
  const index = Math.min(active ?? points.length - 1, points.length - 1);
  const selected = points[index];
  const maximum = Math.max(1, ...points.map(point => point.value ?? 0));
  const minimum = Math.min(0, ...points.map(point => point.value ?? 0));
  const x = (position: number) => points.length === 1 ? 60 : 4 + position / (points.length - 1) * 112;
  const y = (value: number) => 29 - (value - minimum) / (maximum - minimum) * 24;
  const path = points.map((point, position) => {
    if (point.value === null) return "";
    const connected = position > 0 && points[position - 1].value !== null;
    return `${connected ? "L" : "M"}${x(position)},${y(point.value)}`;
  }).join(" ");
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); setShow(false); return; }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    setActive(event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, index + (event.key === "ArrowRight" ? 1 : -1))));
    setShow(true);
  }
  return <div className={cx(styles.sparkline, focusRing)} role="group" aria-roledescription="sparkline" aria-label={`${label} trend`} aria-describedby={show ? tooltipId : undefined} tabIndex={0} data-testid={`tl-sparkline-${metricKey}`} data-state="available" onFocus={() => setShow(true)} onBlur={() => setShow(false)} onKeyDown={onKeyDown} onMouseLeave={event => { if (!event.currentTarget.contains(document.activeElement)) setShow(false); }}>
    <svg viewBox="0 0 120 34" preserveAspectRatio="none" aria-hidden="true">
      <path d="M4,29 L116,29" className={styles.sparkBaseline} />
      <path d={path} className={styles.sparkPath} />
      {points.map((point, position) => <g key={point.date} data-date={point.date} data-value={point.value === null ? "null" : point.value}>
        {point.value !== null ? <circle cx={x(position)} cy={y(point.value)} r={show && index === position ? 2.5 : 1.5} className={styles.sparkDot} /> : null}
        <rect x={Math.max(0, x(position) - (points.length === 1 ? 60 : 56 / (points.length - 1)))} y={0} width={points.length === 1 ? 120 : 112 / (points.length - 1)} height={34} fill="transparent" onMouseEnter={() => { setActive(position); setShow(true); }} />
      </g>)}
    </svg>
    {show ? <span role="tooltip" id={tooltipId} className={styles.sparkTooltip}><time>{selected.date}</time><strong>{selected.value === null ? "Unavailable" : `${selected.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${history!.unit}`}</strong><span>{history!.basis}</span></span> : null}
  </div>;
}
