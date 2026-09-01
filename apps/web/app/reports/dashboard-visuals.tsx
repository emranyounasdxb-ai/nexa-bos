import Link from "next/link";
import type { ReactNode } from "react";

import { RankedBarChart } from "@/components/charts";
import {
  IconArrowUpRight,
  IconChevronDown,
  IconMinus,
  IconTrendingDown,
  IconTrendingUp,
  type IconComponent,
} from "@/components/icons";
import { Badge, SectionHeader } from "@/components/ui";
import { formatPct, type DashboardPayload, type RankingRow } from "@/lib/reports";

export type MetricTone = "blue" | "green" | "amber" | "red" | "violet";
export type TrendDirection = { kind: "up" | "down" | "stable"; delta: number };

export const metricToneClasses: Record<MetricTone, { icon: string }> = {
  blue: { icon: "bg-blue-50 text-blue-700" },
  green: { icon: "bg-emerald-50 text-emerald-700" },
  amber: { icon: "bg-amber-50 text-amber-700" },
  red: { icon: "bg-red-50 text-red-700" },
  violet: { icon: "bg-violet-50 text-violet-700" },
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

export function comparisonDirection(current: number | undefined, previous: number | undefined): TrendDirection | null {
  if (current === undefined || previous === undefined) return null;
  const delta = current - previous;
  return { kind: delta === 0 ? "stable" : delta > 0 ? "up" : "down", delta };
}

export function DirectionIndicator({
  direction,
  comparisonLabel,
}: {
  direction: TrendDirection | null;
  comparisonLabel?: string;
}) {
  if (!direction || !comparisonLabel) {
    return <span className="text-xs font-medium text-slate-500">Formal period comparison unavailable</span>;
  }
  const style =
    direction.kind === "up"
      ? "bg-emerald-50 text-emerald-700"
      : direction.kind === "down"
        ? "bg-red-50 text-red-700"
        : "bg-slate-100 text-slate-600";
  const DirectionIcon = direction.kind === "up" ? IconTrendingUp : direction.kind === "down" ? IconTrendingDown : IconMinus;
  const delta = direction.delta > 0 ? `+${direction.delta}` : String(direction.delta);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${style}`}>
      <DirectionIcon className="size-3.5" />
      {delta} vs {comparisonLabel}
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
  icon: IconComponent;
  context?: ReactNode;
}) {
  const MetricIcon = icon;
  return (
    <Link
      href={href}
      aria-label={`${label} KPI`}
      className="group flex min-h-32 flex-col rounded-[10px] border border-slate-200/90 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.035)] transition hover:border-slate-300 hover:shadow-[0_3px_8px_rgba(15,23,42,0.07)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c81]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`inline-flex size-8 shrink-0 items-center justify-center rounded-md ${metricToneClasses[tone].icon}`}>
            <MetricIcon className="size-5" />
          </span>
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</p>
        </div>
        <IconArrowUpRight className="size-4 shrink-0 text-slate-300 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-slate-500" />
      </div>
      <div className="mt-2.5 flex min-w-0 items-end justify-between gap-3">
        <p className="text-3xl font-semibold leading-none tracking-tight text-slate-950">{count.toLocaleString()}</p>
        {value !== undefined ? <p className="truncate text-right text-xs font-medium tabular-nums text-slate-500">{formatCurrencyValue(value)}</p> : null}
      </div>
      <div className="mt-auto border-t border-slate-100 pt-2.5">{context ?? <span className="text-xs text-slate-500">Selected period</span>}</div>
    </Link>
  );
}

export function PipelineMetric({
  label,
  count,
  value,
  href,
  tone = "blue",
  icon,
}: {
  label: string;
  count: number;
  value?: string | null;
  href: string;
  tone?: MetricTone;
  icon: IconComponent;
}) {
  const MetricIcon = icon;
  return (
    <Link
      href={href}
      aria-label={`${label} KPI`}
      className="group flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2 hover:border-slate-300 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c81]"
    >
      <span aria-hidden="true" className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md ${metricToneClasses[tone].icon}`}>
        <MetricIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-slate-600">{label}</span>
        {value !== undefined ? <span className="block truncate text-xs text-slate-500">{formatCurrencyValue(value)}</span> : null}
      </span>
      <span className="text-base font-semibold tabular-nums text-slate-950">{count.toLocaleString()}</span>
    </Link>
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
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="mt-3" data-testid="stage-breakdown-panel">
      <RankedBarChart
        rows={ranked.map((row) => ({ id: row.stageId ?? row.name, label: row.name, value: row.count }))}
        accessibleDescription={`Top workflow stages by pending application count. ${total} pending applications across ${rows.length} stages.`}
        testId="stage-distribution-chart"
      />
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-500"><span>{total.toLocaleString()} pending applications</span><span>{rows.length} workflow stages</span></div>
      <details className="group mt-2 rounded-lg border border-slate-200 bg-slate-50/60">
        <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-[#0f4c81] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c81]"><span className="inline-flex w-full items-center justify-between gap-3">All stage details<IconChevronDown className="size-4 transition-transform group-open:rotate-180" /></span></summary>
        <div data-testid="stage-breakdown-scroll" className="max-h-48 overflow-y-auto border-t border-slate-200 bg-white p-1.5">
          {rows.map((row) => (
            <Link key={`${row.stageId ?? "none"}:${row.name}:detail`} className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50" href={drill("stage", row.stageId ? { stage_id: row.stageId } : {})}>
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
    <div className="mt-3 space-y-2">
      {rows.map(([label, value, metric, color]) => {
        const bounded = value === null || value === undefined ? 0 : Math.min(100, Math.max(0, value));
        return (
          <Link key={metric} href={drill(metric)} className="group block rounded-lg px-1 py-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c81]">
            <div className="mb-1 flex items-center justify-between gap-3 text-sm"><span className="font-medium text-slate-700 group-hover:text-[#0f4c81]">{label}</span><span className="shrink-0 font-semibold tabular-nums text-slate-950">{formatPct(value)}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${color}`} style={{ width: `${bounded}%` }} /></div>
          </Link>
        );
      })}
    </div>
  );
}

export function TargetProgress({ summary }: { summary: NonNullable<DashboardPayload["targetsSummary"]> }) {
  const visibleItems = summary.items.slice(0, 4);
  return (
    <div className="mt-3">
      <div className="grid gap-2">
      {visibleItems.map((item) => {
        const achievement = item.result?.achievementPct;
        const bounded = achievement === null || achievement === undefined ? 0 : Math.min(100, Math.max(0, achievement));
        return (
          <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><div className="flex items-center gap-2"><Badge>{item.level}</Badge><p className="truncate text-sm font-semibold text-slate-900">{item.entityName ?? "Company"}</p></div><p className="mt-1 truncate text-xs text-slate-500">{[item.bankCode, item.productCode].filter(Boolean).join(" / ") || "All products"}</p></div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-[#0f4c81]">{formatPct(achievement)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600" style={{ width: `${bounded}%` }} /></div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>Actual <strong className="font-semibold text-slate-800">{item.result?.actual ?? "—"}</strong></span>
              <span>Target <strong className="font-semibold text-slate-800">{item.result?.effectiveTarget ?? "—"}</strong></span>
              <span>Gap <strong className="font-semibold text-slate-800">{item.result?.gap ?? "—"}</strong></span>
            </div>
          </div>
        );
      })}
      </div>
      {summary.items.length > visibleItems.length ? (
        <p className="mt-2 text-xs text-slate-500">Showing {visibleItems.length} of {summary.items.length} targets. Open targets for full detail.</p>
      ) : null}
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
    <section className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/40">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5"><h3 className="text-sm font-semibold text-slate-950">{title}</h3>{rows.length > 0 ? <Badge>{Math.min(rows.length, 8)} shown</Badge> : null}</div>
      {rows.length === 0 ? <p className="px-3 py-4 text-sm text-slate-500">No ranking rows for the selected period.</p> : (
        <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto px-1.5 py-1">
          {rows.slice(0, 8).map((row) => (
            <Link key={row.id} href={hrefFor(row)} className="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c81]">
              <span className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${row.rank <= 3 ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>{row.rank}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800 group-hover:text-[#0f4c81]">{row.name}</span>{row.count !== null && row.count !== undefined ? <span className="block text-xs text-slate-500">{row.count.toLocaleString()} cases</span> : null}</span>
              <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-slate-950">{formatValue(row)}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export function DashboardPanelHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <SectionHeader title={title} description={description} actions={actions} />;
}
