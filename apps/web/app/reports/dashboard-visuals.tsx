import Link from "next/link";
import type { ReactNode } from "react";

import { Badge, Card, SectionHeader } from "@/components/ui";
import { formatPct, type DashboardPayload, type RankingRow } from "@/lib/reports";

export type MetricTone = "blue" | "green" | "amber" | "red" | "violet";
type MetricIconName = "inbox" | "check" | "funded" | "clock";
export type TrendDirection = { kind: "up" | "down" | "stable"; delta: number };

export const metricToneClasses: Record<MetricTone, { icon: string; bar: string; text: string }> = {
  blue: { icon: "bg-blue-50 text-blue-700", bar: "bg-blue-600", text: "text-blue-700" },
  green: { icon: "bg-emerald-50 text-emerald-700", bar: "bg-emerald-500", text: "text-emerald-700" },
  amber: { icon: "bg-amber-50 text-amber-700", bar: "bg-amber-500", text: "text-amber-700" },
  red: { icon: "bg-red-50 text-red-700", bar: "bg-red-500", text: "text-red-700" },
  violet: { icon: "bg-violet-50 text-violet-700", bar: "bg-violet-500", text: "text-violet-700" },
};

export function CompactEmpty({ children }: { children: ReactNode }) {
  return <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">{children}</p>;
}

function formatCurrencyValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const text = String(value);
  const match = text.match(/^(-?)(\d+)(\.\d+)?$/);
  if (!match) return `AED ${text}`;
  const [, sign, integer, fraction = ""] = match;
  return `AED ${sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction}`;
}

function MetricIcon({ name }: { name: MetricIconName }) {
  const paths: Record<MetricIconName, ReactNode> = {
    inbox: (
      <>
        <path d="M5 4.75h14v12.5H5z" />
        <path d="M5 13h3.25l1.5 2h4.5l1.5-2H19" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="m8.5 12 2.25 2.25 4.75-5" />
      </>
    ),
    funded: (
      <>
        <path d="M6 7.25h12v10.5H6z" />
        <path d="M8.5 10.25h7M8.5 13.75h4" />
        <path d="M9 7.25V5.5h6v1.75" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4.5l3 1.75" />
      </>
    ),
  };
  return (
    <svg aria-hidden="true" className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      {paths[name]}
    </svg>
  );
}

export function periodDirection(values: number[]): TrendDirection | null {
  if (values.length < 2) return null;
  const delta = values.at(-1)! - values.at(-2)!;
  return { kind: delta === 0 ? "stable" : delta > 0 ? "up" : "down", delta };
}

export function DirectionIndicator({ direction }: { direction: TrendDirection | null }) {
  if (!direction) return <span className="text-xs font-medium text-slate-500">Prior period unavailable</span>;
  const style =
    direction.kind === "up"
      ? "bg-emerald-50 text-emerald-700"
      : direction.kind === "down"
        ? "bg-red-50 text-red-700"
        : "bg-slate-100 text-slate-600";
  const symbol = direction.kind === "up" ? "↗" : direction.kind === "down" ? "↘" : "→";
  const delta = direction.delta > 0 ? `+${direction.delta}` : String(direction.delta);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${style}`}>
      <span aria-hidden="true">{symbol}</span>
      {delta} vs prior period
    </span>
  );
}

export function KpiCard({
  label,
  count,
  value,
  href,
  tone,
  icon,
  context,
}: {
  label: string;
  count: number;
  value?: string | null;
  href: string;
  tone: MetricTone;
  icon: MetricIconName;
  context?: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={`${label} KPI`}
      className="group flex min-h-44 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c81]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`inline-flex size-11 items-center justify-center rounded-xl ${metricToneClasses[tone].icon}`}>
          <MetricIcon name={icon} />
        </div>
        <span aria-hidden="true" className="text-lg text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500">→</span>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{count.toLocaleString()}</p>
      <div className="mt-1 flex min-h-10 items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-600">{label}</p>
        {value !== undefined ? <p className="text-right text-xs font-medium text-slate-500">{formatCurrencyValue(value)}</p> : null}
      </div>
      <div className="mt-auto border-t border-slate-100 pt-3">{context ?? <span className="text-xs text-slate-500">Selected period</span>}</div>
    </Link>
  );
}

export function PipelineMetric({
  label,
  count,
  value,
  href,
  tone = "blue",
}: {
  label: string;
  count: number;
  value?: string | null;
  href: string;
  tone?: MetricTone;
}) {
  return (
    <Link
      href={href}
      aria-label={`${label} KPI`}
      className="group flex min-w-0 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 hover:border-slate-300 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c81]"
    >
      <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${metricToneClasses[tone].bar}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-slate-600">{label}</span>
        {value !== undefined ? <span className="block truncate text-xs text-slate-500">{formatCurrencyValue(value)}</span> : null}
      </span>
      <span className="text-lg font-semibold tabular-nums text-slate-950">{count.toLocaleString()}</span>
    </Link>
  );
}

export function TrendChart({ rows }: { rows: DashboardPayload["trend"] }) {
  if (rows.length === 0) return <CompactEmpty>No trend points yet.</CompactEmpty>;

  const width = 760;
  const height = 280;
  const inset = { left: 48, right: 18, top: 20, bottom: 44 };
  const plotWidth = width - inset.left - inset.right;
  const plotHeight = height - inset.top - inset.bottom;
  const maximum = Math.max(0, ...rows.flatMap((row) => [row.submitted, row.funded]));
  const scaleMaximum = maximum || 1;
  const x = (index: number) => inset.left + (rows.length === 1 ? plotWidth / 2 : (index / (rows.length - 1)) * plotWidth);
  const y = (value: number) => inset.top + plotHeight - (value / scaleMaximum) * plotHeight;
  const line = (key: "submitted" | "funded") => rows.map((row, index) => `${x(index)},${y(row[key])}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(rows.length / 6));
  const axisValues = maximum === 0 ? [0] : [maximum, Math.round(maximum / 2), 0];

  return (
    <div className="mt-4" data-testid="dashboard-trend-chart">
      <svg className="h-auto min-h-64 w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Application trend with ${rows.length} reporting ${rows.length === 1 ? "period" : "periods"}`}>
        {axisValues.map((value, index) => {
          const lineY = maximum === 0 ? inset.top + plotHeight : inset.top + (index / 2) * plotHeight;
          return (
            <g key={`${value}:${index}`}>
              <line x1={inset.left} x2={width - inset.right} y1={lineY} y2={lineY} stroke="#e2e8f0" strokeWidth="1" />
              <text x={inset.left - 10} y={lineY + 4} fill="#64748b" fontSize="12" textAnchor="end">{value}</text>
            </g>
          );
        })}
        <polyline points={line("submitted")} fill="none" stroke="#2563eb" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        <polyline points={line("funded")} fill="none" stroke="#10b981" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        {rows.map((row, index) => (
          <g key={row.month}>
            <circle cx={x(index)} cy={y(row.submitted)} r="4" fill="white" stroke="#2563eb" strokeWidth="2"><title>{`${row.month}: ${row.submitted} submitted`}</title></circle>
            <circle cx={x(index)} cy={y(row.funded)} r="4" fill="white" stroke="#10b981" strokeWidth="2"><title>{`${row.month}: ${row.funded} funded`}</title></circle>
            {(index % labelEvery === 0 || index === rows.length - 1) && <text x={x(index)} y={height - 14} fill="#64748b" fontSize="12" textAnchor="middle">{row.month}</text>}
          </g>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-full bg-blue-600" />Submitted</span>
        <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-full bg-emerald-500" />Funded</span>
        {rows.length === 1 ? <span className="text-slate-500">One reporting period; direction unavailable.</span> : null}
      </div>
    </div>
  );
}

export function StageDistribution({
  rows,
  drill,
}: {
  rows: DashboardPayload["stageBreakdown"];
  drill: (metric: string, extra?: Record<string, string>) => string;
}) {
  if (rows.length === 0) {
    return (
      <div data-testid="stage-breakdown-panel">
        <CompactEmpty>No pending applications at the reporting cutoff.</CompactEmpty>
      </div>
    );
  }
  const ranked = [...rows].sort((left, right) => right.count - left.count);
  const maximum = Math.max(...ranked.map((row) => row.count), 1);
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="mt-4" data-testid="stage-breakdown-panel">
      <div className="space-y-3" data-testid="stage-distribution-chart">
        {ranked.slice(0, 6).map((row, index) => (
          <Link key={`${row.stageId ?? "none"}:${row.name}`} href={drill("stage", row.stageId ? { stage_id: row.stageId } : {})} className="group block rounded-lg px-1 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c81]">
            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-slate-700 group-hover:text-[#0f4c81]"><span className="mr-2 text-xs tabular-nums text-slate-400">{String(index + 1).padStart(2, "0")}</span>{row.name}</span>
              <span className="shrink-0 font-semibold tabular-nums text-slate-950">{row.count}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${(row.count / maximum) * 100}%` }} /></div>
          </Link>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500"><span>{total.toLocaleString()} pending applications</span><span>{rows.length} workflow stages</span></div>
      <details className="group mt-3 rounded-lg border border-slate-200 bg-slate-50/60">
        <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-[#0f4c81] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c81]"><span className="inline-flex w-full items-center justify-between gap-3">All stage details<span aria-hidden="true" className="transition-transform group-open:rotate-180">⌄</span></span></summary>
        <div data-testid="stage-breakdown-scroll" className="max-h-64 overflow-y-auto border-t border-slate-200 bg-white p-2">
          {rows.map((row) => (
            <Link key={`${row.stageId ?? "none"}:${row.name}:detail`} className="flex items-center justify-between gap-4 rounded-md px-2 py-2 text-sm hover:bg-slate-50" href={drill("stage", row.stageId ? { stage_id: row.stageId } : {})}>
              <span className="font-medium text-slate-700">{row.name}</span><span className="shrink-0 font-semibold tabular-nums text-slate-950">{row.count}</span>
            </Link>
          ))}
        </div>
      </details>
    </div>
  );
}

export function ConversionSummary({ values, drill }: { values: DashboardPayload["conversions"]; drill: (metric: string) => string }) {
  const rows = [
    ["Submitted → Approved", values.submittedToApproved, "conversion_submitted_approved", "bg-blue-600"],
    ["Approved → Booked", values.approvedToBooked, "conversion_approved_booked", "bg-violet-500"],
    ["Booked → Funded", values.bookedToFunded, "conversion_booked_funded", "bg-emerald-500"],
    ["Submitted → Final Rejected", values.submittedToFinalRejected, "conversion_submitted_rejected", "bg-red-500"],
    ["Submitted → Cancelled / Withdrawn", values.submittedToCancelledWithdrawn, "conversion_submitted_cancelled_withdrawn", "bg-amber-500"],
  ] as const;
  return (
    <div className="mt-4 space-y-3">
      {rows.map(([label, value, metric, color]) => {
        const bounded = value === null || value === undefined ? 0 : Math.min(100, Math.max(0, value));
        return (
          <Link key={metric} href={drill(metric)} className="group block rounded-lg px-1 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c81]">
            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm"><span className="font-medium text-slate-700 group-hover:text-[#0f4c81]">{label}</span><span className="shrink-0 font-semibold tabular-nums text-slate-950">{formatPct(value)}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${color}`} style={{ width: `${bounded}%` }} /></div>
          </Link>
        );
      })}
    </div>
  );
}

export function TargetProgress({ summary }: { summary: NonNullable<DashboardPayload["targetsSummary"]> }) {
  return (
    <div className="mt-4 grid max-h-[26rem] gap-3 overflow-y-auto pr-1">
      {summary.items.slice(0, 8).map((item) => {
        const achievement = item.result?.achievementPct;
        const bounded = achievement === null || achievement === undefined ? 0 : Math.min(100, Math.max(0, achievement));
        return (
          <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge>{item.level}</Badge><p className="truncate text-sm font-semibold text-slate-900">{item.entityName ?? "Company"}</p></div><p className="mt-1.5 truncate text-xs text-slate-500">{[item.bankCode, item.productCode].filter(Boolean).join(" / ") || "All products"}</p></div>
              <span className="shrink-0 text-base font-semibold tabular-nums text-[#0f4c81]">{formatPct(achievement)}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600" style={{ width: `${bounded}%` }} /></div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <span className="text-slate-500">Actual <strong className="block font-semibold text-slate-800">{item.result?.actual ?? "—"}</strong></span>
              <span className="text-slate-500">Target <strong className="block font-semibold text-slate-800">{item.result?.effectiveTarget ?? "—"}</strong></span>
              <span className="text-slate-500">Gap <strong className="block font-semibold text-slate-800">{item.result?.gap ?? "—"}</strong></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RankingList({ title, rows, metric, hrefFor }: { title: string; rows: RankingRow[]; metric: string; hrefFor: (row: RankingRow) => string }) {
  const formatValue = (row: RankingRow) =>
    metric === "case_count"
      ? typeof row.value === "number"
        ? row.value.toLocaleString()
        : row.value
      : formatCurrencyValue(row.value);
  return (
    <Card className="self-start p-0 sm:p-0">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5"><h3 className="text-base font-semibold text-slate-950">{title}</h3>{rows.length > 0 ? <Badge>{Math.min(rows.length, 8)} shown</Badge> : null}</div>
      {rows.length === 0 ? <div className="px-4 pb-4"><CompactEmpty>No ranking rows for the selected period.</CompactEmpty></div> : (
        <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto px-2 py-1">
          {rows.slice(0, 8).map((row) => (
            <Link key={row.id} href={hrefFor(row)} className="group flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c81]">
              <span className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${row.rank <= 3 ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>{row.rank}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800 group-hover:text-[#0f4c81]">{row.name}</span>{row.count !== null && row.count !== undefined ? <span className="block text-xs text-slate-500">{row.count.toLocaleString()} cases</span> : null}</span>
              <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-slate-950">{formatValue(row)}</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

export function DashboardPanelHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <SectionHeader title={title} description={description} actions={actions} />;
}
