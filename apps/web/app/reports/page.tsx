"use client";

import Link from "next/link";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { DatePicker } from "@/components/date-picker";
import { DonutChart, TimeSeriesChart } from "@/components/charts";
import {
  IconArrowBack,
  IconArrowBackUp,
  IconArrowUpRight,
  IconArrowsDiff,
  IconBan,
  IconBook2,
  IconCashBanknote,
  IconChevronDown,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconCreditCard,
  IconFileSpreadsheet,
  IconFileTypePdf,
  IconFilter,
  IconInbox,
  IconPrinter,
  IconRefresh,
} from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  cx,
  ErrorText,
  focusRing,
  PageHeader,
  Select,
  SectionHeader,
} from "@/components/ui";
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

function DashboardSkeleton() {
  return (
    <div
      data-testid="dashboard-loading-skeleton"
      role="status"
      aria-label="Loading dashboard metrics"
      className="space-y-4"
    >
      <span className="sr-only">Loading dashboard metrics…</span>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-[10px] border border-slate-200 bg-white p-4">
            <div className="h-3 w-20 rounded bg-slate-200" />
            <div className="mt-4 h-6 w-28 rounded bg-slate-200" />
            <div className="mt-3 h-3 w-32 rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
        <div className="h-44 animate-pulse rounded-[10px] border border-slate-200 bg-white p-4">
          <div className="h-4 w-36 rounded bg-slate-200" />
          <div className="mt-5 h-28 rounded-lg bg-slate-100" />
        </div>
        <div className="h-44 animate-pulse rounded-[10px] border border-slate-200 bg-white p-4">
          <div className="h-4 w-32 rounded bg-slate-200" />
          <div className="mt-5 grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="h-12 rounded-lg bg-slate-100" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardExportMenu({
  canExportExcel,
  canExportPdf,
  canPrint,
  onExport,
}: {
  canExportExcel: boolean;
  canExportPdf: boolean;
  canPrint: boolean;
  onExport: (format: "xlsx" | "pdf" | "print") => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const options = [
    { format: "xlsx" as const, label: "Excel", icon: IconFileSpreadsheet, visible: canExportExcel },
    { format: "pdf" as const, label: "PDF", icon: IconFileTypePdf, visible: canExportPdf },
    { format: "print" as const, label: "Print", icon: IconPrinter, visible: canPrint },
  ].filter((option) => option.visible);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsideInteraction(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      containerRef.current
        ?.querySelector<HTMLButtonElement>("[data-dashboard-export-trigger]")
        ?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsideInteraction);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideInteraction);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    containerRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open]);

  if (options.length === 0) return null;

  function moveMenuFocus(event: ReactKeyboardEvent<HTMLButtonElement>, direction: -1 | 1) {
    event.preventDefault();
    const items = Array.from(
      containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    const currentIndex = items.indexOf(event.currentTarget);
    items[(currentIndex + direction + items.length) % items.length]?.focus();
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        data-dashboard-export-trigger
        type="button"
        size="compact"
        variant="secondary"
        aria-label="Export dashboard"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "dashboard-export-menu" : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <IconFileSpreadsheet className="size-4" />
        Export
        <IconChevronDown className={cx("size-3.5", open && "rotate-180")} />
      </Button>
      {open ? (
        <div
          id="dashboard-export-menu"
          role="menu"
          aria-label="Dashboard export formats"
          className="absolute right-0 top-full z-20 mt-1 min-w-36 rounded-lg border border-slate-200 bg-white p-1 shadow-[0_10px_24px_rgba(15,23,42,0.12)]"
        >
          {options.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.format}
                type="button"
                role="menuitem"
                className={cx(
                  focusRing,
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900",
                )}
                onClick={() => {
                  setOpen(false);
                  onExport(option.format);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") moveMenuFocus(event, 1);
                  if (event.key === "ArrowUp") moveMenuFocus(event, -1);
                }}
              >
                <Icon className="size-4" />
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function DashboardInner() {
  const { can } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const api = getBrowserApiUrl();
  const [query, setQuery] = useState<ReportQuery>(() => queryFromSearch(searchParams.toString()));
  const [appliedQuery, setAppliedQuery] = useState<ReportQuery>(() => queryFromSearch(searchParams.toString()));
  const [filters, setFilters] = useState<FilterOptions | null>(null);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [comparison, setComparison] = useState<ReportComparisonPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadVersion, setReloadVersion] = useState(0);
  const requestIdRef = useRef(0);
  const lastAutomaticLoadRef = useRef("");

  const qs = useMemo(() => toSearchParams(appliedQuery), [appliedQuery]);
  const comparisonQs = useMemo(() => comparisonSearch(appliedQuery), [appliedQuery]);
  const activeFilterCount = useMemo(
    () =>
      [query.office_id, query.department_id, query.team_id, query.employee_id, query.bank_id, query.product_id].filter(Boolean)
        .length,
    [query],
  );

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");

    let dashboardCommitted = false;
    let comparisonSettled = false;
    let nextComparison: ReportComparisonPayload | null = null;

    const filtersRequest = apiGet<FilterOptions>("/api/v1/reports/filters", api);
    const dashboardRequest = apiGet<DashboardPayload>(`/api/v1/reports/dashboard?${qs}`, api);
    const comparisonRequest = comparisonQs
      ? apiGet<ReportComparisonPayload>(`/api/v1/reports/comparisons?${comparisonQs}`, api).catch(() => null)
      : Promise.resolve(null);

    void filtersRequest
      .then((options) => {
        if (requestId === requestIdRef.current) setFilters(options);
      })
      .catch((err) => {
        if (requestId === requestIdRef.current) {
          setError(err instanceof ApiClientError ? err.message : "Unable to load dashboard filters");
        }
      });

    void comparisonRequest.then((result) => {
      comparisonSettled = true;
      nextComparison = result;
      if (requestId === requestIdRef.current && dashboardCommitted) setComparison(result);
    });

    try {
      const dashboard = await dashboardRequest;
      if (requestId !== requestIdRef.current) return;
      dashboardCommitted = true;
      setData(dashboard);
      setComparison(comparisonSettled ? nextComparison : null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof ApiClientError ? err.message : "Unable to load dashboard");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [api, comparisonQs, qs]);

  useEffect(() => {
    const automaticLoadKey = `${qs}|${comparisonQs ?? ""}|${reloadVersion}`;
    if (lastAutomaticLoadRef.current === automaticLoadKey) return;
    lastAutomaticLoadRef.current = automaticLoadKey;
    void load();
  }, [comparisonQs, load, qs, reloadVersion]);

  function applyFilters() {
    setAppliedQuery({ ...query });
    setReloadVersion((version) => version + 1);
    router.replace(`/reports?${toSearchParams(query)}`);
  }

  async function exportReport(format: "xlsx" | "pdf" | "print") {
    try {
      const result = await apiDownload("/api/v1/reports/export", api, {
        method: "POST",
        body: JSON.stringify({
          format,
          report: "dashboard",
          period: appliedQuery.period,
          date_from: appliedQuery.date_from || null,
          date_to: appliedQuery.date_to || null,
          office_id: appliedQuery.office_id || null,
          department_id: appliedQuery.department_id || null,
          team_id: appliedQuery.team_id || null,
          employee_id: appliedQuery.employee_id || null,
          bank_id: appliedQuery.bank_id || null,
          product_id: appliedQuery.product_id || null,
          stage_id: appliedQuery.stage_id || null,
          terminal_outcome: appliedQuery.terminal_outcome || null,
          ranking_metric: appliedQuery.ranking_metric,
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
    return `/reports/drill-down?${toSearchParams(appliedQuery, { metric, ...extra })}`;
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
    <section className="space-y-4">
      <PageHeader
        title="Dashboard"
        description={
          data
            ? `${data.period.label} · ${data.reportingScope ?? "No reporting scope"} · ${data.currency}`
            : "Management overview"
        }
        actions={
          <div data-testid="dashboard-actions" className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" size="compact" aria-busy={loading && Boolean(data)} onClick={() => void load()}>
              {loading && data ? (
                <span className="inline-flex items-center gap-2">
                  <IconRefresh className="size-4 animate-spin" />
                  Refreshing…
                </span>
              ) : <><IconRefresh className="size-4" />Refresh</>}
            </Button>
            {can("Reports.View") ? (
              <Button type="button" size="compact" variant="secondary" onClick={() => router.push("/reports/compare")}>
                <IconArrowsDiff className="size-4" />
                Compare
              </Button>
            ) : null}
            <DashboardExportMenu
              canExportExcel={can("Reports.ExportExcel")}
              canExportPdf={can("Reports.ExportPDF")}
              canPrint={can("Reports.Print")}
              onExport={(format) => void exportReport(format)}
            />
          </div>
        }
      />

      <details data-testid="dashboard-filters" className="group rounded-[10px] border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.035)]">
        <summary className="cursor-pointer list-none px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c81] sm:px-5">
          <span className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-semibold text-slate-900">Reporting filters</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                {query.period.toUpperCase()} period · {activeFilterCount === 0 ? "All permitted records" : `${activeFilterCount} scope filters active`}
              </span>
            </span>
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#0f4c81]">
              <IconFilter className="size-4" />
              Refine
              <IconChevronDown className="size-4 transition-transform group-open:rotate-180" />
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
            <Button type="button" className="w-full" onClick={applyFilters}><IconFilter className="size-4" />Apply filters</Button>
          </div>
        </div>
      </details>

      <ErrorText>{error}</ErrorText>
      {loading && !data ? <DashboardSkeleton /> : null}
      {data ? (
        <div data-testid="dashboard-overview" className="space-y-4">
          <div data-testid="dashboard-kpi-charts" className="space-y-4">
            <div data-testid="dashboard-kpi-grid" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Submitted" count={data.kpis.submitted.count} value={data.kpis.submitted.value} href={drill("submitted")} tone="blue" icon={IconInbox} context={<DirectionIndicator direction={submittedDirection} comparisonLabel={comparisonLabel} />} />
              <KpiCard label="Approved" count={data.kpis.approved.count} value={data.kpis.approved.value} href={drill("approved")} tone="violet" icon={IconCircleCheck} context={<span className="text-xs font-medium text-slate-500">Approval conversion {formatPct(data.conversions.submittedToApproved)}</span>} />
              <KpiCard label="Funded" count={data.kpis.funded.count} value={data.kpis.funded.value} href={drill("funded")} tone="green" icon={IconCashBanknote} context={<DirectionIndicator direction={fundedDirection} comparisonLabel={comparisonLabel} />} />
              <KpiCard label="Pending" count={data.kpis.pending.count} href={drill("pending")} tone="amber" icon={IconClock} context={<span className="text-xs font-medium text-slate-500">Open at reporting cutoff</span>} />
            </div>

            <Card className="p-3 sm:p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">Pipeline snapshot</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Selected-period outcomes and product mix.</p>
                </div>
                <Badge>{data.currency}</Badge>
              </div>
              <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                <PipelineMetric label="Booked" count={data.kpis.booked.count} value={data.kpis.booked.value} href={drill("booked")} tone="green" icon={IconBook2} />
                <PipelineMetric label="Returned / Requirement Pending" count={data.kpis.returnedRequirementPending.count} href={drill("returned")} tone="amber" icon={IconArrowBackUp} />
                <PipelineMetric label="Final Rejected" count={data.kpis.finalRejected.count} href={drill("final_rejected")} tone="red" icon={IconCircleX} />
                <PipelineMetric label="Cancelled" count={data.kpis.cancelled.count} href={drill("cancelled")} tone="red" icon={IconBan} />
                <PipelineMetric label="Withdrawn" count={data.kpis.withdrawn.count} href={drill("withdrawn")} tone="red" icon={IconArrowBack} />
                <PipelineMetric label="Completed" count={data.kpis.completed.count} href={drill("completed")} tone="green" icon={IconCircleCheck} />
                <PipelineMetric label="PF Count / Value" count={data.kpis.personalFinance.count} value={data.kpis.personalFinance.value} href={drill("pf_value")} icon={IconCashBanknote} />
                <PipelineMetric label="CC Count" count={data.kpis.creditCard.count} href={drill("cc_count")} icon={IconCreditCard} />
              </div>
            </Card>

            <div data-testid="dashboard-charts-grid">
              <Card className="min-w-0 p-4 sm:p-4">
                <SectionHeader title="Application performance trend" description="Submitted and funded applications over authoritative reporting periods." actions={data.trend.length > 0 ? <Badge>{data.trend.length} {data.trend.length === 1 ? "period" : "periods"}</Badge> : null} />
                <TimeSeriesChart rows={data.trend} />
              </Card>
            </div>
          </div>

          <div data-testid="dashboard-analysis-grid" className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
            <Card className="min-w-0 p-4 sm:p-4">
              <SectionHeader title="Stage distribution" description="Largest current workflow queues at the reporting cutoff." />
              <StageDistribution rows={data.stageBreakdown} drill={drill} />
            </Card>
            <Card className="min-w-0 p-4 sm:p-4">
              <SectionHeader title="Conversion summary" description="Selected-period movement through the application funnel." />
              <ConversionSummary values={data.conversions} drill={drill} />
            </Card>
            <Card className="min-w-0 p-4 sm:p-4">
              <SectionHeader title="Attention required" description="Active delay drivers that may need management action." />
              <div className="mt-2 grid min-w-0 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <DonutChart
                  rows={(["Bank", "Customer", "Internal", "Other"] as const).map((type) => ({
                    name: type,
                    value: data.activeDelays[type],
                  }))}
                  accessibleDescription={`${data.activeDelays.total} active delays split across Bank, Customer, Internal and Other drivers.`}
                  testId="dashboard-delay-chart"
                />
                <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-1">
                  {(["Bank", "Customer", "Internal", "Other"] as const).map((type) => (
                    <Link key={type} href={drill(`delay_${type.toLowerCase()}`)} aria-label={`${type} delays`} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-sm hover:bg-white">
                      <span className="text-slate-600">{type}</span>
                      <strong className="tabular-nums text-slate-950">{data.activeDelays[type]}</strong>
                    </Link>
                  ))}
                </div>
              </div>
            </Card>
            {data.targetsSummary && data.targetsSummary.items.length > 0 ? (
              <Card className="min-w-0 p-4 sm:p-4">
                <SectionHeader title="Target performance" description="Progress against effective targets in scope." actions={<Link className="inline-flex items-center gap-1 text-sm font-semibold text-[#0f4c81] hover:underline" href="/targets">Open targets <IconArrowUpRight className="size-4" /></Link>} />
                <TargetProgress summary={data.targetsSummary} />
              </Card>
            ) : (
              <Card className="min-w-0 p-4 sm:p-4">
                <SectionHeader title="Target performance" description="Progress against effective targets in scope." />
                <CompactEmpty>No target results for the selected period.</CompactEmpty>
              </Card>
            )}
          </div>

          <Card className="p-3.5 sm:p-4">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Performance rankings</h2>
                <p className="mt-0.5 text-sm text-slate-500">Leaders for the selected ranking metric.</p>
              </div>
              <Badge>{appliedQuery.ranking_metric.replaceAll("_", " ")}</Badge>
            </div>
            <div className="grid items-start gap-2.5 md:grid-cols-2 xl:grid-cols-4">
              <RankingList title="Top employees" rows={data.rankings.employees} metric={data.rankings.metric} hrefFor={(row) => `/reports/employees/${row.id}?${toSearchParams(appliedQuery)}`} />
              <RankingList title="Top teams" rows={data.rankings.teams} metric={data.rankings.metric} hrefFor={(row) => drill("funded", { team_id: row.id })} />
              <RankingList title="Top offices" rows={data.rankings.offices} metric={data.rankings.metric} hrefFor={(row) => drill("funded", { office_id: row.id })} />
              <RankingList title="Top bank / product" rows={data.rankings.bankProducts} metric={data.rankings.metric} hrefFor={(row) => drill("funded", { bank_id: row.bankId ?? "", product_id: row.productId ?? "" })} />
            </div>
          </Card>
        </div>
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
