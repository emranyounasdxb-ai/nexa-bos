"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { BosChart, DonutChart, RankedBarChart, type BosChartOption } from "@/components/charts";
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
import { formatDuration } from "@/lib/duration";
import type { CodApplicationSummary, CodDashboardWorkspace } from "@/lib/reports";

const queueLabels = {
  awaitingReview: "Awaiting review",
  bankSubmission: "Bank submission",
  missingBankNumber: "Missing bank number",
  misUpdate: "MIS update",
  requirements: "Requirements",
  returned: "Returned",
  delayed: "Delayed",
  recentUpdates: "Recent updates",
} as const;

type QueueKey = keyof typeof queueLabels;

const cardMetric = {
  newCases: "new_cases",
  awaitingSubmission: "awaiting_submission",
  missingBankNumber: "missing_bank_number",
  submitted: "submitted",
  requirementsPending: "requirements_pending",
  delayed: "delayed",
  approved: "approved",
  completedFunded: "completed_funded",
} as const;

function applicationsHref(metric: string, period: string) {
  return `/applications?dashboard_metric=${metric}&dashboard_period=${period}`;
}

function SummaryCard({
  label,
  count,
  metric,
  period,
}: {
  label: string;
  count: number;
  metric: string;
  period: string;
}) {
  return (
    <Link
      href={applicationsHref(metric, period)}
      aria-label={`${label} queue`}
      className="group min-w-0 rounded-[10px] border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.035)] transition hover:border-blue-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
        <IconArrowUpRight className="size-4 shrink-0 text-slate-300 group-hover:text-brand-primary" />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{count.toLocaleString("en-AE")}</p>
      <p className="mt-1 text-xs text-slate-500">Open authorized queue</p>
    </Link>
  );
}

function TrendChart({ rows }: { rows: CodDashboardWorkspace["charts"]["trend"] }) {
  const option = useMemo<BosChartOption>(() => ({
    ...chartAnimation,
    color: [chartPalette.blue, chartPalette.emerald],
    textStyle: { fontFamily: chartFontFamily },
    grid: { left: 8, right: 12, top: 52, bottom: 8, containLabel: true },
    legend: { ...chartLegend, top: 2, right: 2, data: ["Created", "Submitted"] },
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
    series: (["created", "submitted"] as const).map((key) => ({
      name: key === "created" ? "Created" : "Submitted",
      type: "line",
      data: rows.map((row) => row[key]),
      smooth: 0.25,
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { width: 2 },
    })),
  }), [rows]);
  const total = rows.reduce((sum, row) => sum + row.created + row.submitted, 0);
  return (
    <BosChart
      option={option}
      accessibleDescription="Created and submitted authorized office Applications over the last six months."
      empty={total === 0}
      emptyMessage="No created or submitted Applications are available for the last six months."
      testId="cod-created-submitted-chart"
      height={245}
    />
  );
}

function QueueRow({ item }: { item: CodApplicationSummary }) {
  return (
    <li className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link className="font-semibold text-brand-link hover:underline" href={`/applications/${item.id}`}>{item.localFileNumber}</Link>
          <p className="mt-0.5 truncate text-xs text-slate-500">Bank number: {item.bankCaseNumber ?? "Not assigned"}</p>
        </div>
        <Badge tone={item.delayed ? "amber" : undefined}>{item.stage}</Badge>
      </div>
      <dl className="mt-2 grid min-w-0 gap-x-3 gap-y-1 text-xs sm:grid-cols-2">
        <div className="min-w-0"><dt className="text-slate-500">Customer</dt><dd className="truncate font-medium text-slate-900">{item.customer}</dd></div>
        <div className="min-w-0"><dt className="text-slate-500">Case owner</dt><dd className="truncate font-medium text-slate-900">{item.caseOwner}{item.caseOwnerRole ? ` · ${item.caseOwnerRole}` : ""}</dd></div>
        <div className="min-w-0"><dt className="text-slate-500">Bank / Product</dt><dd className="truncate font-medium text-slate-900">{item.bank} · {item.product}</dd></div>
        <div><dt className="text-slate-500">TAT</dt><dd className="font-medium tabular-nums text-slate-900">{formatDuration(item.tatSeconds)}</dd></div>
      </dl>
      <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs">
        <time className="text-slate-500">Updated {new Intl.DateTimeFormat("en-AE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.lastUpdate))}</time>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {item.actions.slice(0, 2).map((action) => (
            <Link key={action.key} href={`/applications/${item.id}?tab=actions`} className="font-semibold text-brand-link hover:underline">{action.label}</Link>
          ))}
          <Link href={`/applications/${item.id}`} className="font-semibold text-brand-link hover:underline">Open Application</Link>
        </div>
      </div>
    </li>
  );
}

function QueueWorkspace({ data }: { data: CodDashboardWorkspace["queues"] }) {
  const [active, setActive] = useState<QueueKey>("awaitingReview");
  const items = data[active];
  const keys = Object.keys(queueLabels) as QueueKey[];
  return (
    <Card className="min-w-0 p-4" data-testid="cod-queues">
      <SectionHeader title="Operational queues" description="Current authorized office work, routed through controlled Application actions." actions={<Badge>{items.length} shown</Badge>} />
      <div role="tablist" aria-label="COD operational queues" className="mt-3 flex max-w-full gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
        {keys.map((key, index) => (
          <button
            key={key}
            id={`cod-queue-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={active === key}
            aria-controls="cod-queue-panel"
            tabIndex={active === key ? 0 : -1}
            className={`min-h-8 shrink-0 rounded-md px-2.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary ${active === key ? "bg-white text-brand-primary shadow-sm" : "text-slate-600 hover:bg-white/70"}`}
            onClick={() => setActive(key)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const nextIndex = event.key === "Home"
                ? 0
                : event.key === "End"
                  ? keys.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + keys.length) % keys.length;
              const next = keys[nextIndex];
              setActive(next);
              document.getElementById(`cod-queue-tab-${next}`)?.focus();
            }}
          >
            {queueLabels[key]} <span className="tabular-nums">({data[key].length})</span>
          </button>
        ))}
      </div>
      <div id="cod-queue-panel" role="tabpanel" aria-labelledby={`cod-queue-tab-${active}`} className="mt-3">
        {items.length ? <ul className="grid min-w-0 gap-2 xl:grid-cols-2">{items.map((item) => <QueueRow key={item.id} item={item} />)}</ul> : <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-5 text-sm text-slate-500">No Applications are currently in this authorized queue.</p>}
      </div>
    </Card>
  );
}

export function CodDashboard({ data, period }: { data: CodDashboardWorkspace; period: string }) {
  return (
    <div data-testid="cod-dashboard" className="space-y-4">
      <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8" data-testid="cod-summary-cards">
        <SummaryCard label="New Cases" count={data.kpis.newCases} metric={cardMetric.newCases} period={period} />
        <SummaryCard label="Awaiting Submission" count={data.kpis.awaitingSubmission} metric={cardMetric.awaitingSubmission} period={period} />
        <SummaryCard label="Missing Bank Number" count={data.kpis.missingBankNumber} metric={cardMetric.missingBankNumber} period={period} />
        <SummaryCard label="Submitted" count={data.kpis.submitted} metric={cardMetric.submitted} period={period} />
        <SummaryCard label="Requirements Pending" count={data.kpis.requirementsPending} metric={cardMetric.requirementsPending} period={period} />
        <SummaryCard label="Delayed" count={data.kpis.delayed} metric={cardMetric.delayed} period={period} />
        <SummaryCard label="Approved" count={data.kpis.approved} metric={cardMetric.approved} period={period} />
        <SummaryCard label="Completed / Funded" count={data.kpis.completedFunded} metric={cardMetric.completedFunded} period={period} />
      </div>

      <QueueWorkspace data={data.queues} />

      <section aria-label="COD operational charts" className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Card className="min-w-0 p-4"><SectionHeader title="Workflow pipeline" description="Open office cases across configured Workflow stages." /><div className="mt-3"><RankedBarChart rows={data.charts.pipeline.map((row) => ({ id: row.stageId, label: row.name, value: row.count }))} accessibleDescription="Open authorized office cases by configured Workflow stage." testId="cod-pipeline-chart" /></div></Card>
        <Card className="min-w-0 p-4"><SectionHeader title="Created vs Submitted" description="Authorized office activity over the last six months." /><div className="mt-3"><TrendChart rows={data.charts.trend} /></div></Card>
        <Card className="min-w-0 p-4"><SectionHeader title="Outcomes" description="Approved, funded and terminal outcomes in the selected period." /><div className="mt-3"><RankedBarChart rows={data.charts.outcomes.map((row) => ({ id: row.name, label: row.name, value: row.count }))} accessibleDescription="Authorized office outcomes for the selected period." testId="cod-outcomes-chart" /></div></Card>
        <Card className="min-w-0 p-4"><SectionHeader title="Bank / Product workload" description="Current open office workload by Bank and Product." /><div className="mt-3"><RankedBarChart rows={data.charts.workload.map((row) => ({ id: row.name, label: row.name, value: row.count }))} accessibleDescription="Current authorized office workload grouped by Bank and Product." testId="cod-workload-chart" /></div></Card>
        <Card className="min-w-0 p-4"><SectionHeader title="On-time vs delayed TAT" description="Current open cases using recorded delay state." /><div className="mt-3"><DonutChart rows={data.charts.tat.map((row) => ({ name: row.name, value: row.count }))} accessibleDescription="Current open authorized office cases split by recorded delay state." testId="cod-tat-chart" /></div></Card>
        <Card className="min-w-0 p-4"><SectionHeader title="Requirement and delay reasons" description="Recorded operational reason categories for current queues." /><div className="mt-3"><RankedBarChart rows={data.charts.requirementReasons.map((row) => ({ id: row.name, label: row.name, value: row.count }))} accessibleDescription="Current requirement and delay reason categories." testId="cod-requirement-chart" /></div></Card>
      </section>

      <div data-testid="cod-staff-workload">
        <Card className="min-w-0 p-4">
          <SectionHeader title="Office staff workload" description="Authorized SM, TL and SE case workload; TL and SE downline is marked explicitly." actions={<Badge>{data.staff.length} staff</Badge>} />
          {data.staff.length ? (
            <ul className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {data.staff.map((person) => (
                <li key={person.id} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                  <div className="flex min-w-0 items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-950">{person.name}</p><p className="truncate text-xs text-slate-500">{person.role}{person.team ? ` · ${person.team}` : ""}</p></div>{person.downline ? <Badge tone="blue">Downline</Badge> : <Badge>Office</Badge>}</div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs"><div><dt className="text-slate-500">Open cases</dt><dd className="font-semibold tabular-nums text-slate-900">{person.openCases}</dd></div><div><dt className="text-slate-500">Delayed</dt><dd className="font-semibold tabular-nums text-slate-900">{person.delayedCases}</dd></div></dl>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-5 text-sm text-slate-500">No active SM, TL or SE staff are assigned to this office.</p>}
        </Card>
      </div>

      <div data-testid="cod-personal-activity">
        <Card className="min-w-0 p-4">
          <SectionHeader title="My operational activity" description="Immutable Application events recorded for the selected period." />
          <dl className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">Cases reviewed</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{data.activity.reviewed}</dd><p className="mt-1 text-[11px] text-slate-500">Distinct cases with a recorded COD operation</p></div>
            <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">Submitted</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{data.activity.submitted}</dd></div>
            <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">Stage updates</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{data.activity.stageUpdates}</dd></div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
