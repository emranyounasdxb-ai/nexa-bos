"use client";

import Link from "next/link";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { DateRangePicker } from "@/components/date-picker";
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
  IconFilter,
  IconInbox,
  IconRefresh,
} from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  ErrorText,
  PageHeader,
  Select,
  SectionHeader,
} from "@/components/ui";
import { apiGet, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import {
  formatAed,
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

function formatComparisonValue(value: string | number) {
  return typeof value === "number" ? value.toLocaleString("en-AE") : formatAed(value);
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
  const [activePanel, setActivePanel] = useState<"refine" | "compare" | null>(null);
  const [compareKind, setCompareKind] = useState("period");
  const [comparePeriod, setComparePeriod] = useState("month");
  const [compareMetric, setCompareMetric] = useState("funded_value");
  const [compareDimension, setCompareDimension] = useState("employee");
  const [compareLeftId, setCompareLeftId] = useState("");
  const [compareRightId, setCompareRightId] = useState("");
  const [compareDateFrom, setCompareDateFrom] = useState("");
  const [compareDateTo, setCompareDateTo] = useState("");
  const [compareFrom, setCompareFrom] = useState("");
  const [compareTo, setCompareTo] = useState("");
  const [comparisonResult, setComparisonResult] = useState<ReportComparisonPayload | null>(null);
  const [comparisonError, setComparisonError] = useState("");
  const [comparisonLoading, setComparisonLoading] = useState(false);
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
  const comparisonEntities = useMemo(() => {
    if (compareDimension === "employee") return filters?.employees;
    if (compareDimension === "team") return filters?.teams;
    if (compareDimension === "office") return filters?.offices;
    if (compareDimension === "bank") return filters?.banks;
    return filters?.products;
  }, [compareDimension, filters]);

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

  function togglePanel(panel: "refine" | "compare") {
    setActivePanel((current) => (current === panel ? null : panel));
  }

  async function runComparison() {
    setComparisonError("");
    setComparisonLoading(true);
    const params = new URLSearchParams({ kind: compareKind, metric: compareMetric });
    if (compareKind === "period") {
      params.set("period", comparePeriod);
      if (comparePeriod === "custom") {
        params.set("date_from", compareDateFrom);
        params.set("date_to", compareDateTo);
        params.set("compare_from", compareFrom);
        params.set("compare_to", compareTo);
      }
    } else {
      params.set("dimension", compareDimension);
      params.set("left_id", compareLeftId);
      params.set("right_id", compareRightId);
      params.set("period", "mtd");
    }
    try {
      setComparisonResult(
        await apiGet<ReportComparisonPayload>(`/api/v1/reports/comparisons?${params}`, api),
      );
    } catch (err) {
      setComparisonResult(null);
      setComparisonError(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      setComparisonLoading(false);
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
        description="Review application performance, pipeline movement, target progress, and items that may need attention."
      />
      <div data-testid="dashboard-filters" className="rounded-[10px] border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.035)]">
        <div className="flex min-w-0 flex-col gap-3 px-4 py-3 sm:px-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">Reporting filters</span>
            <span className="mt-0.5 block truncate text-xs text-slate-500">
              {query.period.toUpperCase()} period · {activeFilterCount === 0 ? "All permitted records" : `${activeFilterCount} scope filters active`}
            </span>
          </div>
          <div data-testid="dashboard-actions" className="flex min-w-0 flex-wrap items-center gap-2 md:flex-nowrap md:justify-end">
            <Button type="button" size="compact" aria-busy={loading && Boolean(data)} onClick={() => void load()}>
              {loading && data ? (
                <span className="inline-flex items-center gap-2">
                  <IconRefresh className="size-4 animate-spin" />
                  Refreshing…
                </span>
              ) : <><IconRefresh className="size-4" />Refresh</>}
            </Button>
            {can("Reports.View") ? (
              <Button
                type="button"
                size="compact"
                variant="secondary"
                aria-expanded={activePanel === "compare"}
                aria-controls="dashboard-compare-panel"
                onClick={() => togglePanel("compare")}
              >
                <IconArrowsDiff className="size-4" />
                Compare
                <IconChevronDown className={`size-3.5 transition-transform ${activePanel === "compare" ? "rotate-180" : ""}`} />
              </Button>
            ) : null}
            <Button
              type="button"
              size="compact"
              variant="secondary"
              aria-expanded={activePanel === "refine"}
              aria-controls="dashboard-refine-panel"
              onClick={() => togglePanel("refine")}
            >
              <IconFilter className="size-4" />
              Refine
              <IconChevronDown className={`size-3.5 transition-transform ${activePanel === "refine" ? "rotate-180" : ""}`} />
            </Button>
          </div>
        </div>

        {activePanel === "refine" ? (
          <div id="dashboard-refine-panel" data-testid="dashboard-refine-panel" className="grid gap-3 border-t border-slate-200 bg-slate-50/40 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <label className="text-sm font-medium text-slate-700">
            Reporting period
            <Select aria-label="Reporting period" value={query.period} onChange={(event) => setQuery({ ...query, period: event.target.value })}>
              {(filters?.periods ?? [{ key: "mtd", label: "MTD" }]).map((period) => (
                <option key={period.key} value={period.key}>{period.label}</option>
              ))}
            </Select>
          </label>
          {query.period === "custom" ? (
            <label className="text-sm font-medium text-slate-700">
              Custom period
              <DateRangePicker
                aria-label="Custom period"
                from={query.date_from}
                to={query.date_to}
                onChange={({ from: date_from, to: date_to }) =>
                  setQuery({ ...query, date_from, date_to })
                }
              />
            </label>
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
        ) : null}

        {activePanel === "compare" ? (
          <div id="dashboard-compare-panel" data-testid="dashboard-compare-panel" className="border-t border-slate-200 bg-slate-50/40 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-sm font-medium text-slate-700">
                Comparison type
                <Select aria-label="Comparison type" value={compareKind} onChange={(event) => setCompareKind(event.target.value)}>
                  <option value="period">Period vs period</option>
                  <option value="entity">Entity vs entity</option>
                </Select>
              </label>
              <label className="text-sm font-medium text-slate-700">
                Metric
                <Select aria-label="Comparison metric" value={compareMetric} onChange={(event) => setCompareMetric(event.target.value)}>
                  <option value="submitted_value">Submitted Value</option>
                  <option value="booked_value">Booked Value</option>
                  <option value="funded_value">Funded Value</option>
                  <option value="case_count">Case Count</option>
                </Select>
              </label>
              {compareKind === "period" ? (
                <label className="text-sm font-medium text-slate-700">
                  Period pair
                  <Select aria-label="Period pair" value={comparePeriod} onChange={(event) => setComparePeriod(event.target.value)}>
                    <option value="month">Current Month vs Previous Month</option>
                    <option value="quarter">Current Quarter vs Previous Quarter</option>
                    <option value="half_year">Current Half-Year vs Previous Half-Year</option>
                    <option value="year">Current Year vs Previous Year</option>
                    <option value="custom">Custom Period vs Custom Period</option>
                  </Select>
                </label>
              ) : (
                <label className="text-sm font-medium text-slate-700">
                  Dimension
                  <Select aria-label="Dimension" value={compareDimension} onChange={(event) => setCompareDimension(event.target.value)}>
                    <option value="employee">Employee</option>
                    <option value="team">Team</option>
                    <option value="office">Office</option>
                    <option value="bank">Bank</option>
                    <option value="product">Product</option>
                  </Select>
                </label>
              )}
              {compareKind === "entity" ? (
                <>
                  <label className="text-sm font-medium text-slate-700">
                    Left entity
                    <Select aria-label="Left entity" value={compareLeftId} onChange={(event) => setCompareLeftId(event.target.value)}>
                      <option value="">Select</option>
                      {comparisonEntities?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </Select>
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Right entity
                    <Select aria-label="Right entity" value={compareRightId} onChange={(event) => setCompareRightId(event.target.value)}>
                      <option value="">Select</option>
                      {comparisonEntities?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </Select>
                  </label>
                </>
              ) : null}
              {compareKind === "period" && comparePeriod === "custom" ? (
                <>
                  <label className="text-sm font-medium text-slate-700">
                    Current period
                    <DateRangePicker
                      aria-label="Current period"
                      from={compareDateFrom}
                      to={compareDateTo}
                      onChange={({ from, to }) => {
                        setCompareDateFrom(from);
                        setCompareDateTo(to);
                      }}
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Comparison period
                    <DateRangePicker
                      aria-label="Comparison period"
                      from={compareFrom}
                      to={compareTo}
                      onChange={({ from, to }) => {
                        setCompareFrom(from);
                        setCompareTo(to);
                      }}
                    />
                  </label>
                </>
              ) : null}
              <div className="flex items-end">
                <Button type="button" className="w-full" aria-busy={comparisonLoading} onClick={() => void runComparison()}>
                  <IconArrowsDiff className="size-4" />
                  {comparisonLoading ? "Comparing…" : "Run comparison"}
                </Button>
              </div>
            </div>
            <ErrorText>{comparisonError}</ErrorText>
            {comparisonResult ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3" data-testid="dashboard-comparison-result">
                <p className="text-xs text-slate-500">
                  {comparisonResult.kind} · {comparisonResult.reportingScope ?? "No reporting scope"}
                </p>
                <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-xs text-slate-500">Current</dt><dd className="font-semibold text-slate-900">{formatComparisonValue(comparisonResult.current)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Previous</dt><dd className="font-semibold text-slate-900">{formatComparisonValue(comparisonResult.previous)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Difference</dt><dd className="font-semibold text-slate-900">{formatComparisonValue(comparisonResult.absoluteDifference)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Percentage change</dt><dd className="font-semibold text-slate-900">{formatPct(comparisonResult.percentageChange)}</dd></div>
                </dl>
              </div>
            ) : null}
          </div>
        ) : null}

      </div>

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
                <SectionHeader title="Target performance" description="Progress against effective targets in scope." actions={<Link className="inline-flex items-center gap-1 text-sm font-semibold text-brand-link hover:underline" href="/targets">Open targets <IconArrowUpRight className="size-4" /></Link>} />
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
