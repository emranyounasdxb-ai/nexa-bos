"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { DatePicker } from "@/components/date-picker";
import { DonutChart, TimeSeriesChart } from "@/components/charts";
import { Badge, Button, Card, ErrorText, LoadingState, PageHeader, Select, SectionHeader } from "@/components/ui";
import { apiDownload, apiGet, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import {
  formatPct,
  queryFromSearch,
  toSearchParams,
  type DashboardPayload,
  type FilterOptions,
  type ReportComparisonPayload,
  type ReportQuery,
} from "@/lib/reports";
import {
  CompactEmpty,
  ConversionSummary,
  DirectionIndicator,
  KpiCard,
  metricToneClasses,
  type MetricTone,
  comparisonDirection,
  PipelineMetric,
  RankingList,
  StageDistribution,
  TargetProgress,
} from "./dashboard-visuals";

const comparisonPeriodFor: Partial<Record<string, string>> = {
  mtd: "month",
  qtd: "quarter",
  half_year: "half_year",
  ytd: "year",
};

function comparisonSearch(query: ReportQuery): string | null {
  const period = comparisonPeriodFor[query.period];
  if (!period || query.stage_id || query.terminal_outcome) return null;
  const params = new URLSearchParams({ kind: "period", period, metric: "funded_value" });
  for (const key of ["office_id", "department_id", "team_id", "employee_id", "bank_id", "product_id"] as const) {
    if (query[key]) params.set(key, query[key]);
  }
  return params.toString();
}

export function DashboardInner() {
  const { can, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const api = getBrowserApiUrl();
  const [query, setQuery] = useState<ReportQuery>(() => queryFromSearch(searchParams.toString()));
  const [filters, setFilters] = useState<FilterOptions | null>(null);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [comparison, setComparison] = useState<ReportComparisonPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const qs = useMemo(() => toSearchParams(query), [query]);
  const comparisonQs = useMemo(() => comparisonSearch(query), [query]);
  const activeFilterCount = useMemo(
    () =>
      [query.office_id, query.department_id, query.team_id, query.employee_id, query.bank_id, query.product_id].filter(Boolean)
        .length,
    [query],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setComparison(null);
    try {
      const [options, dashboard] = await Promise.all([
        apiGet<FilterOptions>("/api/v1/reports/filters", api),
        apiGet<DashboardPayload>(`/api/v1/reports/dashboard?${qs}`, api),
      ]);
      setFilters(options);
      setData(dashboard);
      if (comparisonQs) {
        try {
          setComparison(
            await apiGet<ReportComparisonPayload>(`/api/v1/reports/comparisons?${comparisonQs}`, api),
          );
        } catch {
          setComparison(null);
        }
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to load dashboard");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, comparisonQs, qs]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyFilters() {
    router.replace(`/reports?${toSearchParams(query)}`);
  }

  async function exportReport(format: "xlsx" | "pdf" | "print") {
    try {
      const result = await apiDownload("/api/v1/reports/export", api, {
        method: "POST",
        body: JSON.stringify({
          format,
          report: "dashboard",
          period: query.period,
          date_from: query.date_from || null,
          date_to: query.date_to || null,
          office_id: query.office_id || null,
          department_id: query.department_id || null,
          team_id: query.team_id || null,
          employee_id: query.employee_id || null,
          bank_id: query.bank_id || null,
          product_id: query.product_id || null,
          stage_id: query.stage_id || null,
          terminal_outcome: query.terminal_outcome || null,
          ranking_metric: query.ranking_metric,
        }),
      });
      if (format === "print") {
        const html = await result.blob.text();
        const popup = window.open("", "_blank");
        popup?.document.write(html);
        popup?.document.close();
        return;
      }
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename ?? `nexa-bos-dashboard.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  }

  function drill(metric: string, extra: Record<string, string> = {}) {
    return `/reports/drill-down?${toSearchParams(query, { metric, ...extra })}`;
  }

  if (!can("Dashboard.View")) return <ErrorText>Dashboard permission is required.</ErrorText>;

  const submittedDirection = comparisonDirection(
    comparison?.currentKpis?.submitted.count,
    comparison?.previousKpis?.submitted.count,
  );
  const fundedDirection = comparisonDirection(
    comparison?.currentKpis?.funded.count,
    comparison?.previousKpis?.funded.count,
  );
  const comparisonLabel = comparison?.previousPeriod?.label;

  return (
    <section className="space-y-5">
      <PageHeader
        title="Dashboard"
        description={
          data
            ? `${data.period.label} · ${data.reportingScope ?? "No reporting scope"} · ${data.currency}`
            : "Management overview"
        }
        actions={
          <div data-testid="dashboard-actions" className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1.5">
            <Button type="button" className="min-w-20" onClick={() => void load()}>
              Refresh
            </Button>
            {can("Reports.ExportExcel") ? (
              <Button type="button" variant="secondary" className="min-w-20" onClick={() => void exportReport("xlsx")}>
                Excel
              </Button>
            ) : null}
            {can("Reports.ExportPDF") ? (
              <Button type="button" variant="secondary" className="min-w-20" onClick={() => void exportReport("pdf")}>
                PDF
              </Button>
            ) : null}
            {can("Reports.Print") ? (
              <Button type="button" variant="secondary" className="min-w-20" onClick={() => void exportReport("print")}>
                Print
              </Button>
            ) : null}
            {can("Reports.View") ? (
              <Button type="button" variant="secondary" className="min-w-20" onClick={() => router.push("/reports/compare")}>
                Compare
              </Button>
            ) : null}
          </div>
        }
      />

      <details data-testid="dashboard-filters" className="group rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <summary className="cursor-pointer list-none px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c81] sm:px-5">
          <span className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-semibold text-slate-900">Reporting filters</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                {query.period.toUpperCase()} period · {activeFilterCount === 0 ? "All permitted records" : `${activeFilterCount} scope filters active`}
              </span>
            </span>
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#0f4c81]">
              Refine <span aria-hidden="true" className="transition-transform group-open:rotate-180">⌄</span>
            </span>
          </span>
        </summary>
        <div className="grid gap-3 border-t border-slate-200 bg-slate-50/40 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <label className="text-sm font-medium text-slate-700">
            Reporting period
            <Select aria-label="Reporting period" value={query.period} onChange={(event) => setQuery({ ...query, period: event.target.value })}>
              {(filters?.periods ?? [{ key: "mtd", label: "MTD" }]).map((period) => (
                <option key={period.key} value={period.key}>{period.label}</option>
              ))}
            </Select>
          </label>
          {query.period === "custom" ? (
            <>
              <label className="text-sm font-medium text-slate-700">
                From
                <DatePicker aria-label="Custom period start" value={query.date_from} onChange={(value) => setQuery({ ...query, date_from: value })} />
              </label>
              <label className="text-sm font-medium text-slate-700">
                To
                <DatePicker aria-label="Custom period end" value={query.date_to} onChange={(value) => setQuery({ ...query, date_to: value })} />
              </label>
            </>
          ) : null}
          <label className="text-sm font-medium text-slate-700">
            Office
            <Select aria-label="Office" value={query.office_id} onChange={(event) => setQuery({ ...query, office_id: event.target.value })}>
              <option value="">All offices</option>
              {filters?.offices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Department
            <Select aria-label="Department" value={query.department_id} onChange={(event) => setQuery({ ...query, department_id: event.target.value })}>
              <option value="">All departments</option>
              {filters?.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Team
            <Select aria-label="Team" value={query.team_id} onChange={(event) => setQuery({ ...query, team_id: event.target.value })}>
              <option value="">All teams</option>
              {filters?.teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Employee / Case Owner
            <Select aria-label="Employee" value={query.employee_id} onChange={(event) => setQuery({ ...query, employee_id: event.target.value })}>
              <option value="">All employees</option>
              {filters?.employees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Bank
            <Select aria-label="Bank" value={query.bank_id} onChange={(event) => setQuery({ ...query, bank_id: event.target.value })}>
              <option value="">All banks</option>
              {filters?.banks.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}
            </Select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Product
            <Select aria-label="Product" value={query.product_id} onChange={(event) => setQuery({ ...query, product_id: event.target.value })}>
              <option value="">All products</option>
              {filters?.products.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}
            </Select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Ranking metric
            <Select aria-label="Ranking metric" value={query.ranking_metric} onChange={(event) => setQuery({ ...query, ranking_metric: event.target.value })}>
              <option value="submitted_value">Submitted Value</option>
              <option value="booked_value">Booked Value</option>
              <option value="funded_value">Funded Value</option>
              <option value="case_count">Case Count</option>
            </Select>
          </label>
          <div className="flex items-end">
            <Button type="button" className="w-full" onClick={applyFilters}>Apply filters</Button>
          </div>
        </div>
      </details>

      <ErrorText>{error}</ErrorText>
      {loading ? <LoadingState>Loading dashboard metrics…</LoadingState> : null}
      {data ? (
        <>
          <div data-testid="dashboard-overview" className="space-y-5">
            <div className="relative overflow-hidden rounded-xl bg-slate-950 px-5 py-4 text-white sm:px-6">
            <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-200">Executive overview</p>
                <h2 className="mt-1 text-lg font-semibold">Welcome back, {user?.fullName ?? "NEXA user"}.</h2>
                <p className="mt-1 text-sm text-slate-300">Live performance for {data.period.label} within your reporting scope.</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">{data.activeDelays.total.toLocaleString()} active delays</span>
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">{data.stageBreakdown.length.toLocaleString()} active stages</span>
              </div>
            </div>
            <div aria-hidden="true" className="absolute -right-10 -top-20 size-52 rounded-full border border-white/10" />
            </div>

            <div data-testid="dashboard-kpi-charts" className="space-y-5">
            <div data-testid="dashboard-kpi-grid" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Submitted" count={data.kpis.submitted.count} value={data.kpis.submitted.value} href={drill("submitted")} tone="blue" icon="inbox" context={<DirectionIndicator direction={submittedDirection} comparisonLabel={comparisonLabel} />} />
            <KpiCard label="Approved" count={data.kpis.approved.count} value={data.kpis.approved.value} href={drill("approved")} tone="violet" icon="check" context={<span className="text-xs font-medium text-slate-500">Approval conversion {formatPct(data.conversions.submittedToApproved)}</span>} />
            <KpiCard label="Funded" count={data.kpis.funded.count} value={data.kpis.funded.value} href={drill("funded")} tone="green" icon="funded" context={<DirectionIndicator direction={fundedDirection} comparisonLabel={comparisonLabel} />} />
            <KpiCard label="Pending" count={data.kpis.pending.count} href={drill("pending")} tone="amber" icon="clock" context={<span className="text-xs font-medium text-slate-500">Open at reporting cutoff</span>} />
            </div>

            <Card className="p-4 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Pipeline snapshot</h2>
                <p className="mt-0.5 text-sm text-slate-500">Operational outcomes and product mix for the selected period.</p>
              </div>
              <Badge>{data.currency}</Badge>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <PipelineMetric label="Booked" count={data.kpis.booked.count} value={data.kpis.booked.value} href={drill("booked")} tone="green" />
              <PipelineMetric label="Returned / Requirement Pending" count={data.kpis.returnedRequirementPending.count} href={drill("returned")} tone="amber" />
              <PipelineMetric label="Final Rejected" count={data.kpis.finalRejected.count} href={drill("final_rejected")} tone="red" />
              <PipelineMetric label="Cancelled" count={data.kpis.cancelled.count} href={drill("cancelled")} tone="red" />
              <PipelineMetric label="Withdrawn" count={data.kpis.withdrawn.count} href={drill("withdrawn")} tone="red" />
              <PipelineMetric label="Completed" count={data.kpis.completed.count} href={drill("completed")} tone="green" />
              <PipelineMetric label="PF Count / Value" count={data.kpis.personalFinance.count} value={data.kpis.personalFinance.value} href={drill("pf_value")} />
              <PipelineMetric label="CC Count" count={data.kpis.creditCard.count} href={drill("cc_count")} />
            </div>
            </Card>

            <div data-testid="dashboard-charts-grid" className="grid min-w-0 items-start gap-5 xl:grid-cols-3">
            <Card className="min-w-0 xl:col-span-2">
              <SectionHeader title="Application performance trend" description="Submitted and funded applications over authoritative reporting periods." actions={data.trend.length > 0 ? <Badge>{data.trend.length} {data.trend.length === 1 ? "period" : "periods"}</Badge> : null} />
              <TimeSeriesChart rows={data.trend} />
            </Card>
            <Card className="min-w-0">
              <SectionHeader title="Stage distribution" description="Largest current workflow queues at the reporting cutoff." />
              <StageDistribution rows={data.stageBreakdown} drill={drill} />
              </Card>
            </div>
            </div>
          </div>

          <div className="grid min-w-0 items-start gap-5 xl:grid-cols-3">
            <Card className="min-w-0">
              <SectionHeader title="Conversion summary" description="Selected-period movement through the application funnel." />
              <ConversionSummary values={data.conversions} drill={drill} />
            </Card>
            <Card className="min-w-0">
              <SectionHeader title="Attention required" description="Open exceptions that may need management action." />
              <div className="mt-4 grid grid-cols-2 gap-3">
                {([
                  ["Pending", data.kpis.pending.count, drill("pending"), "amber"],
                  ["Returned", data.kpis.returnedRequirementPending.count, drill("returned"), "amber"],
                  ["Final rejected", data.kpis.finalRejected.count, drill("final_rejected"), "red"],
                ] as const).map(([label, count, href, tone]) => (
                  <Link key={label} href={href} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 hover:border-slate-300 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c81]">
                    <span className={`block text-2xl font-semibold tabular-nums ${metricToneClasses[tone as MetricTone].text}`}>{count.toLocaleString()}</span>
                    <span className="mt-1 block text-sm font-medium text-slate-600">{label}</span>
                  </Link>
                ))}
                <div className="col-span-2 rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2.5">
                  <span className="text-lg font-semibold tabular-nums text-violet-700">{data.activeDelays.total.toLocaleString()}</span>
                  <span className="ml-2 text-sm font-medium text-slate-600">Active delays across all drivers</span>
                </div>
              </div>
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active delay drivers</p>
                <DonutChart
                  rows={(["Bank", "Customer", "Internal", "Other"] as const).map((type) => ({
                    name: type,
                    value: data.activeDelays[type],
                  }))}
                  accessibleDescription={`${data.activeDelays.total} active delays split across Bank, Customer, Internal and Other drivers.`}
                  testId="dashboard-delay-chart"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(["Bank", "Customer", "Internal", "Other"] as const).map((type) => (
                    <Link key={type} href={drill(`delay_${type.toLowerCase()}`)} aria-label={`${type} delays`} className="flex items-center justify-between rounded-lg border border-slate-200 px-2.5 py-2 text-sm hover:bg-slate-50">
                      <span className="text-slate-600">{type}</span>
                      <strong className="tabular-nums text-slate-950">{data.activeDelays[type]}</strong>
                    </Link>
                  ))}
                </div>
              </div>
            </Card>
            {data.targetsSummary && data.targetsSummary.items.length > 0 ? (
              <Card>
                <SectionHeader title="Target performance" description="Progress against effective targets in scope." actions={<Link className="text-sm font-semibold text-[#0f4c81] hover:underline" href="/targets">Open targets →</Link>} />
                <TargetProgress summary={data.targetsSummary} />
              </Card>
            ) : (
              <Card>
                <SectionHeader title="Target performance" description="Progress against effective targets in scope." />
                <CompactEmpty>No target results for the selected period.</CompactEmpty>
              </Card>
            )}
          </div>

          <div>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Performance rankings</h2>
                <p className="mt-1 text-sm text-slate-500">Compact leaders for the selected ranking metric.</p>
              </div>
              <Badge>{query.ranking_metric.replaceAll("_", " ")}</Badge>
            </div>
            <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
              <RankingList title="Top employees" rows={data.rankings.employees} metric={data.rankings.metric} hrefFor={(row) => `/reports/employees/${row.id}?${toSearchParams(query)}`} />
              <RankingList title="Top teams" rows={data.rankings.teams} metric={data.rankings.metric} hrefFor={(row) => drill("funded", { team_id: row.id })} />
              <RankingList title="Top offices" rows={data.rankings.offices} metric={data.rankings.metric} hrefFor={(row) => drill("funded", { office_id: row.id })} />
              <RankingList title="Top bank / product" rows={data.rankings.bankProducts} metric={data.rankings.metric} hrefFor={(row) => drill("funded", { bank_id: row.bankId ?? "", product_id: row.productId ?? "" })} />
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <DashboardInner />
    </Suspense>
  );
}
