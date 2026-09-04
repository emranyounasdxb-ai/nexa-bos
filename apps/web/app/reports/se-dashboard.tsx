"use client";

import Link from "next/link";
import { useMemo } from "react";

import { BosChart, RankedBarChart, type BosChartOption } from "@/components/charts";
import {
  chartAnimation,
  chartAxisText,
  chartFontFamily,
  chartLegend,
  chartPalette,
  chartSplitLine,
  chartTooltip,
} from "@/components/charts/chart-theme";
import { IconArrowUpRight } from "@/components/icons";
import { Badge, Card, SectionHeader } from "@/components/ui";
import { formatAed, formatPct, type SeApplicationSummary, type SeDashboardWorkspace } from "@/lib/reports";

function dashboardApplicationsHref(metric: string, period: string) {
  return `/applications?dashboard_metric=${metric}&dashboard_period=${period}`;
}

function SummaryCard({ label, count, value, href }: { label: string; count?: number; value?: string; href: string }) {
  return (
    <Link
      href={href}
      aria-label={`${label} summary`}
      className="group min-w-0 rounded-[10px] border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.035)] transition hover:border-blue-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
        <IconArrowUpRight className="size-4 shrink-0 text-slate-300 group-hover:text-brand-primary" />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{count?.toLocaleString("en-AE") ?? value ?? "—"}</p>
      {count !== undefined && value ? <p className="mt-1 truncate text-xs font-medium tabular-nums text-slate-500">{value}</p> : null}
    </Link>
  );
}

function ApplicationTrend({ rows }: { rows: SeDashboardWorkspace["trend"] }) {
  const option = useMemo<BosChartOption>(() => ({
    ...chartAnimation,
    color: [chartPalette.slate500, chartPalette.blue, chartPalette.violet, chartPalette.emerald],
    textStyle: { fontFamily: chartFontFamily },
    grid: { left: 8, right: 12, top: 58, bottom: 8, containLabel: true },
    legend: { ...chartLegend, top: 4, right: 4, data: ["Created", "Submitted", "Approved", "Funded"] },
    tooltip: { ...chartTooltip, trigger: "axis", renderMode: "richText" },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: rows.map((row) => new Intl.DateTimeFormat("en-AE", { month: "short" }).format(new Date(`${row.month}T00:00:00Z`))),
      axisLine: { lineStyle: { color: chartPalette.slate300 } },
      axisTick: { show: false },
      axisLabel: chartAxisText,
    },
    yAxis: { type: "value", min: 0, minInterval: 1, axisLine: { show: false }, axisTick: { show: false }, axisLabel: chartAxisText, splitLine: chartSplitLine },
    series: (["created", "submitted", "approved", "funded"] as const).map((key) => ({
      name: key.charAt(0).toUpperCase() + key.slice(1),
      type: "line",
      data: rows.map((row) => row[key]),
      smooth: 0.25,
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { width: 2 },
    })),
  }), [rows]);
  const total = rows.reduce((sum, row) => sum + row.created + row.submitted + row.approved + row.funded, 0);
  return (
    <div className="mt-3" data-testid="se-application-trend">
      <BosChart option={option} accessibleDescription="Created, submitted, approved and funded own Applications over the last six months." empty={total === 0} emptyMessage="No Application activity is available for the last six months." testId="se-application-trend-chart" height={250} />
    </div>
  );
}

function ApplicationRow({ item, reasons }: { item: SeApplicationSummary; reasons?: string[] }) {
  return (
    <li className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link className="font-semibold text-brand-link hover:underline" href={`/applications/${item.id}`}>{item.localFileNumber}</Link>
          <p className="mt-0.5 truncate text-xs text-slate-500">Bank case: {item.bankCaseNumber ?? "Not assigned"}</p>
        </div>
        <Badge>{item.stage}</Badge>
      </div>
      <p className="mt-2 truncate text-sm font-medium text-slate-900">{item.customer}</p>
      <p className="truncate text-xs text-slate-500">{item.bank} · {item.product}</p>
      {reasons?.length ? <div className="mt-2 flex flex-wrap gap-1">{reasons.map((reason) => <Badge key={reason} tone="amber">{reason}</Badge>)}</div> : null}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <time>{new Intl.DateTimeFormat("en-AE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.lastUpdate))}</time>
        <Link className="font-semibold text-brand-link hover:underline" href={`/applications/${item.id}`}>Open Application</Link>
      </div>
    </li>
  );
}

export function SeDashboard({ data, period }: { data: SeDashboardWorkspace; period: string }) {
  const target = data.targetProgress;
  return (
    <div data-testid="se-dashboard" className="space-y-4">
      <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" data-testid="se-summary-cards">
        <SummaryCard label="My Applications" count={data.kpis.applications.count} href={dashboardApplicationsHref("applications", period)} />
        <SummaryCard label="Submitted" count={data.kpis.submitted.count} value={formatAed(data.kpis.submitted.value)} href={dashboardApplicationsHref("submitted", period)} />
        <SummaryCard label="Approved" count={data.kpis.approved.count} value={formatAed(data.kpis.approved.value)} href={dashboardApplicationsHref("approved", period)} />
        <SummaryCard label="Funded" count={data.kpis.funded.count} value={formatAed(data.kpis.funded.value)} href={dashboardApplicationsHref("funded", period)} />
        <SummaryCard label="In Progress" count={data.kpis.inProgress.count} href={dashboardApplicationsHref("in_progress", period)} />
        <SummaryCard label="Target Achievement" value={formatPct(data.kpis.targetAchievementPct)} href={dashboardApplicationsHref("applications", period)} />
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Card className="min-w-0 p-4">
          <SectionHeader title="My Application Trend" description="Created, submitted, approved and funded over the last six months." />
          <ApplicationTrend rows={data.trend} />
        </Card>
        <Card className="min-w-0 p-4">
          <SectionHeader title="My Cases by Stage" description="Your open cases across configured Workflow stages." />
          <div className="mt-3"><RankedBarChart rows={data.stages.map((stage) => ({ id: stage.stageId, label: stage.name, value: stage.count }))} accessibleDescription="Own open cases across configured Workflow stages." limit={10} testId="se-stage-chart" /></div>
        </Card>
        <Card className="min-w-0 p-4">
          <SectionHeader title="My Product Mix" description="Your Applications by configured Product." />
          <div className="mt-3"><RankedBarChart rows={data.products.map((product) => ({ id: product.code, label: `${product.code} · ${product.name}`, value: product.count }))} accessibleDescription="Own Applications split by configured Product." limit={10} testId="se-product-chart" /></div>
        </Card>
        <Card className="min-w-0 p-4" >
          <SectionHeader title="My Target Progress" description="Assigned, achieved and remaining target for the selected period." actions={<Badge>{formatPct(target.achievementPct)}</Badge>} />
          {target.count ? (
            <div className="mt-4">
              <div role="progressbar" aria-label="SE target progress" aria-valuenow={Math.min(100, Math.max(0, target.achievementPct ?? 0))} aria-valuemin={0} aria-valuemax={100} className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, Math.max(0, target.achievementPct ?? 0))}%` }} /></div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div><dt className="text-xs text-slate-500">Assigned</dt><dd className="mt-1 font-semibold tabular-nums text-slate-950">{target.measurement === "amount" ? formatAed(target.assigned) : target.assigned ?? "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">Achieved</dt><dd className="mt-1 font-semibold tabular-nums text-slate-950">{target.measurement === "amount" ? formatAed(target.achieved) : target.achieved ?? "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">Remaining</dt><dd className="mt-1 font-semibold tabular-nums text-slate-950">{target.measurement === "amount" ? formatAed(target.remaining) : target.remaining ?? "—"}</dd></div>
              </dl>
            </div>
          ) : <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">No target is assigned for this period.</p>}
        </Card>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Card className="min-w-0 p-4">
          <SectionHeader title="Action Required" description="Your own cases that may need attention." actions={data.actionRequired.length ? <Badge tone="amber">{data.actionRequired.length}</Badge> : null} />
          {data.actionRequired.length ? <ul className="mt-3 grid gap-2">{data.actionRequired.map((item) => <ApplicationRow key={item.id} item={item} reasons={item.reasons} />)}</ul> : <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">No own cases currently require action.</p>}
        </Card>
        <Card className="min-w-0 p-4">
          <SectionHeader title="Recent Applications" description="Your latest own Application records." actions={data.recentApplications.length ? <Badge>{data.recentApplications.length}</Badge> : null} />
          {data.recentApplications.length ? <ul className="mt-3 grid gap-2">{data.recentApplications.map((item) => <ApplicationRow key={item.id} item={item} />)}</ul> : <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">No Applications are available in your own scope.</p>}
        </Card>
      </div>
    </div>
  );
}
