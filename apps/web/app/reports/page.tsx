"use client";

import Link from "next/link";
import { Suspense, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { DatePicker } from "@/components/date-picker";
import {
  Badge,
  Button,
  Card,
  ErrorText,
  FilterBar,
  LoadingState,
  PageHeader,
  Select,
  SectionHeader,
  TableHead,
  TableShell,
  Td,
  Th,
} from "@/components/ui";
import { apiDownload, apiGet, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import {
  formatAed,
  formatPct,
  queryFromSearch,
  toSearchParams,
  type DashboardPayload,
  type FilterOptions,
  type RankingRow,
  type ReportQuery,
} from "@/lib/reports";

function CompactEmpty({ children }: { children: ReactNode }) {
  return <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">{children}</p>;
}

function KpiButton({
  label,
  count,
  value,
  href,
  tone = "blue",
}: {
  label: string;
  count?: number;
  value?: string | null;
  href: string;
  tone?: "blue" | "green" | "amber" | "red";
}) {
  const toneClass = {
    blue: "bg-blue-50 text-[#0f4c81]",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
  }[tone];
  return (
    <Link
      href={href}
      aria-label={`${label} KPI`}
      className="group rounded-xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300 hover:bg-slate-50/60"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-semibold leading-5 text-slate-600">{label}</p>
        <span
          aria-hidden="true"
          className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-bold ${toneClass}`}
        >
          {label.charAt(0)}
        </span>
      </div>
      <p className="mt-2.5 text-2xl font-semibold tracking-tight text-slate-900">{count ?? "—"}</p>
      {value !== undefined ? <p className="mt-1 text-sm text-slate-600">{formatAed(value)}</p> : null}
    </Link>
  );
}

function RankingTable({
  title,
  rows,
  hrefFor,
}: {
  title: string;
  rows: RankingRow[];
  hrefFor: (row: RankingRow) => string;
}) {
  return (
    <Card className="self-start">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">Top results for the selected ranking metric.</p>
        </div>
        {rows.length > 0 ? <Badge>{Math.min(rows.length, 8)} shown</Badge> : null}
      </div>
      {rows.length === 0 ? (
        <CompactEmpty>No ranking rows for the selected period.</CompactEmpty>
      ) : (
        <TableShell className="mt-4 max-h-80 overflow-y-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10">
          <TableHead>
            <tr>
              <Th className="w-20">Rank</Th>
              <Th>Name</Th>
              <Th className="text-right">Value</Th>
            </tr>
          </TableHead>
          <tbody>
            {rows.slice(0, 8).map((row) => (
              <tr key={row.id}>
                <Td>
                  <span className="inline-flex size-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                    {row.rank}
                  </span>
                </Td>
                <Td>
                  <Link className="font-medium text-[#0f4c81] hover:underline" href={hrefFor(row)}>
                    {row.name}
                  </Link>
                </Td>
                <Td className="text-right font-semibold text-slate-900">
                  {typeof row.value === "number" ? row.value : formatAed(row.value)}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </Card>
  );
}

export function DashboardInner() {
  const { can, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const api = getBrowserApiUrl();
  const [query, setQuery] = useState<ReportQuery>(() => queryFromSearch(searchParams.toString()));
  const [filters, setFilters] = useState<FilterOptions | null>(null);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const qs = useMemo(() => toSearchParams(query), [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const options = await apiGet<FilterOptions>("/api/v1/reports/filters", api);
      setFilters(options);
      const dashboard = await apiGet<DashboardPayload>(`/api/v1/reports/dashboard?${qs}`, api);
      setData(dashboard);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to load dashboard");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, qs]);

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

  if (!can("Dashboard.View")) {
    return <ErrorText>Dashboard permission is required.</ErrorText>;
  }

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
          <div
            data-testid="dashboard-actions"
            className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1.5"
          >
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
      <div className="relative overflow-hidden rounded-xl bg-slate-900 px-5 py-4 text-white sm:px-6">
        <div className="relative z-10 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-200">NEXA BOS overview</p>
          <h2 className="mt-1.5 text-lg font-semibold sm:text-xl">Welcome back, {user?.fullName ?? "NEXA user"}.</h2>
          <p className="mt-1.5 text-sm leading-5 text-slate-300">
            Review live operational performance using the existing reporting scope and period filters below.
          </p>
        </div>
        <div aria-hidden="true" className="absolute -right-10 -top-16 size-48 rounded-full border border-white/10" />
        <div aria-hidden="true" className="absolute -right-2 top-8 size-28 rounded-full border border-white/10" />
      </div>
      <FilterBar className="gap-3 lg:grid-cols-4 xl:grid-cols-5">
        <label className="text-sm font-medium text-slate-700">
          Reporting period
          <Select
            aria-label="Reporting period"
            value={query.period}
            onChange={(event) => setQuery({ ...query, period: event.target.value })}
          >
            {(filters?.periods ?? [{ key: "mtd", label: "MTD" }]).map((period) => (
              <option key={period.key} value={period.key}>
                {period.label}
              </option>
            ))}
          </Select>
        </label>
        {query.period === "custom" ? (
          <>
            <label className="text-sm font-medium text-slate-700">
              From
              <DatePicker
                aria-label="Custom period start"
                value={query.date_from}
                onChange={(value) => setQuery({ ...query, date_from: value })}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              To
              <DatePicker
                aria-label="Custom period end"
                value={query.date_to}
                onChange={(value) => setQuery({ ...query, date_to: value })}
              />
            </label>
          </>
        ) : null}
        <label className="text-sm font-medium text-slate-700">
          Office
          <Select
            aria-label="Office"
            value={query.office_id}
            onChange={(event) => setQuery({ ...query, office_id: event.target.value })}
          >
            <option value="">All offices</option>
            {filters?.offices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Department
          <Select
            aria-label="Department"
            value={query.department_id}
            onChange={(event) => setQuery({ ...query, department_id: event.target.value })}
          >
            <option value="">All departments</option>
            {filters?.departments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Team
          <Select
            aria-label="Team"
            value={query.team_id}
            onChange={(event) => setQuery({ ...query, team_id: event.target.value })}
          >
            <option value="">All teams</option>
            {filters?.teams.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Employee / Case Owner
          <Select
            aria-label="Employee"
            value={query.employee_id}
            onChange={(event) => setQuery({ ...query, employee_id: event.target.value })}
          >
            <option value="">All employees</option>
            {filters?.employees.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Bank
          <Select
            aria-label="Bank"
            value={query.bank_id}
            onChange={(event) => setQuery({ ...query, bank_id: event.target.value })}
          >
            <option value="">All banks</option>
            {filters?.banks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Product
          <Select
            aria-label="Product"
            value={query.product_id}
            onChange={(event) => setQuery({ ...query, product_id: event.target.value })}
          >
            <option value="">All products</option>
            {filters?.products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Ranking metric
          <Select
            aria-label="Ranking metric"
            value={query.ranking_metric}
            onChange={(event) => setQuery({ ...query, ranking_metric: event.target.value })}
          >
            <option value="submitted_value">Submitted Value</option>
            <option value="booked_value">Booked Value</option>
            <option value="funded_value">Funded Value</option>
            <option value="case_count">Case Count</option>
          </Select>
        </label>
        <div className="flex items-end">
          <Button type="button" className="w-full" onClick={applyFilters}>
            Apply
          </Button>
        </div>
      </FilterBar>
      <ErrorText>{error}</ErrorText>
      {loading ? <LoadingState>Loading dashboard metrics…</LoadingState> : null}
      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <KpiButton label="Submitted" count={data.kpis.submitted.count} value={data.kpis.submitted.value} href={drill("submitted")} />
            <KpiButton tone="green" label="Approved" count={data.kpis.approved.count} value={data.kpis.approved.value} href={drill("approved")} />
            <KpiButton tone="green" label="Booked" count={data.kpis.booked.count} value={data.kpis.booked.value} href={drill("booked")} />
            <KpiButton tone="green" label="Funded" count={data.kpis.funded.count} value={data.kpis.funded.value} href={drill("funded")} />
            <KpiButton tone="amber" label="Pending" count={data.kpis.pending.count} href={drill("pending")} />
            <KpiButton tone="amber" label="Returned / Requirement Pending" count={data.kpis.returnedRequirementPending.count} href={drill("returned")} />
            <KpiButton tone="red" label="Final Rejected" count={data.kpis.finalRejected.count} href={drill("final_rejected")} />
            <KpiButton tone="red" label="Cancelled" count={data.kpis.cancelled.count} href={drill("cancelled")} />
            <KpiButton tone="red" label="Withdrawn" count={data.kpis.withdrawn.count} href={drill("withdrawn")} />
            <KpiButton tone="green" label="Completed" count={data.kpis.completed.count} href={drill("completed")} />
            <KpiButton label="PF Count / Value" count={data.kpis.personalFinance.count} value={data.kpis.personalFinance.value} href={drill("pf_value")} />
            <KpiButton label="CC Count" count={data.kpis.creditCard.count} href={drill("cc_count")} />
          </div>
          {data.targetsSummary && data.targetsSummary.items.length > 0 ? (
            <Card className="self-start">
              <SectionHeader
                title="Targets"
                description="Current target performance within the selected reporting scope."
                actions={
                  <Link className="text-sm font-semibold text-[#0f4c81] hover:underline" href="/targets">
                    Open targets →
                  </Link>
                }
              />
              <TableShell className="mt-4 max-h-80 overflow-y-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10">
                <TableHead>
                  <tr>
                    <Th>Scope</Th>
                    <Th>Bank / product</Th>
                    <Th className="text-right">Actual</Th>
                    <Th className="text-right">Target</Th>
                    <Th className="text-right">Achievement</Th>
                  </tr>
                </TableHead>
                <tbody>
                  {data.targetsSummary.items.slice(0, 8).map((item) => (
                    <tr key={item.id}>
                      <Td>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{item.level}</Badge>
                          <span className="font-medium text-slate-900">{item.entityName ?? "Company"}</span>
                        </div>
                      </Td>
                      <Td>{[item.bankCode, item.productCode].filter(Boolean).join(" / ") || "All products"}</Td>
                      <Td className="text-right font-medium text-slate-900">{item.result?.actual ?? "—"}</Td>
                      <Td className="text-right">{item.result?.effectiveTarget ?? "—"}</Td>
                      <Td className="text-right font-semibold text-[#0f4c81]">
                        {formatPct(item.result?.achievementPct)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </Card>
          ) : null}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card className="self-start">
              <h3 className="text-base font-semibold text-slate-900">Conversions</h3>
              <p className="mt-1 text-sm text-slate-500">Selected-period movement through the application funnel.</p>
              <div className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                {[
                  ["Submitted → Approved", data.conversions.submittedToApproved, "conversion_submitted_approved"],
                  ["Approved → Booked", data.conversions.approvedToBooked, "conversion_approved_booked"],
                  ["Booked → Funded", data.conversions.bookedToFunded, "conversion_booked_funded"],
                  ["Submitted → Final Rejected", data.conversions.submittedToFinalRejected, "conversion_submitted_rejected"],
                  [
                    "Submitted → Cancelled / Withdrawn",
                    data.conversions.submittedToCancelledWithdrawn,
                    "conversion_submitted_cancelled_withdrawn",
                  ],
                ].map(([label, value, metric]) => (
                  <Link
                    key={String(metric)}
                    className="flex items-center justify-between gap-4 px-3 py-2.5 text-sm hover:bg-slate-50"
                    href={drill(String(metric))}
                  >
                    <span className="font-medium text-slate-700">{label}</span>
                    <span className="shrink-0 font-semibold text-[#0f4c81]">{formatPct(value as number | null)}</span>
                  </Link>
                ))}
              </div>
            </Card>
            <Card className="self-start">
              <h3 className="text-base font-semibold text-slate-900">Action drivers</h3>
              <p className="mt-1 text-sm text-slate-500">Active delays grouped by the party currently responsible.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {(["Bank", "Customer", "Internal", "Other"] as const).map((type) => (
                  <Link
                    key={type}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3 text-sm hover:border-slate-300 hover:bg-slate-50"
                    href={drill(`delay_${type.toLowerCase()}`)}
                    aria-label={`${type} delays`}
                  >
                    <span className="font-medium text-slate-700">{type}</span>
                    <span className="inline-flex min-w-8 items-center justify-center rounded-md bg-white px-2 py-1 font-semibold text-slate-900 shadow-sm">
                      {data.activeDelays[type]}
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
            <Card className="self-start">
              <div data-testid="stage-breakdown-panel">
                <SectionHeader
                  title="Current stage breakdown"
                  description="Pending applications grouped by their current workflow stage."
                  actions={data.stageBreakdown.length > 0 ? <Badge>{data.stageBreakdown.length} stages</Badge> : null}
                />
                {data.stageBreakdown.length === 0 ? (
                  <CompactEmpty>No pending applications at the reporting cutoff.</CompactEmpty>
                ) : (
                  <div
                    data-testid="stage-breakdown-scroll"
                    className="mt-4 max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10"
                  >
                    <table className="min-w-full text-left text-sm [&_tbody_tr]:border-t [&_tbody_tr]:border-slate-100 [&_tbody_tr:hover]:bg-slate-50/80">
                      <TableHead>
                        <tr>
                          <Th>Stage</Th>
                          <Th className="text-right">Applications</Th>
                        </tr>
                      </TableHead>
                      <tbody>
                        {data.stageBreakdown.map((row) => (
                          <tr key={`${row.stageId ?? "none"}:${row.name}`}>
                            <Td>
                              <Link
                                className="font-medium text-[#0f4c81] hover:underline"
                                href={drill("stage", row.stageId ? { stage_id: row.stageId } : {})}
                              >
                                {row.name}
                              </Link>
                            </Td>
                            <Td className="text-right font-semibold text-slate-900">{row.count}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Card>
            <Card className="self-start">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Trend</h3>
                  <p className="mt-1 text-sm text-slate-500">Submitted and funded applications over time.</p>
                </div>
                {data.trend.length > 0 ? <Badge>{data.trend.length} periods</Badge> : null}
              </div>
              {data.trend.length === 0 ? (
                <CompactEmpty>No trend points yet.</CompactEmpty>
              ) : (
                <TableShell className="mt-4 max-h-72 overflow-y-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10">
                  <TableHead>
                    <tr>
                      <Th>Month</Th>
                      <Th>Submitted</Th>
                      <Th>Funded</Th>
                    </tr>
                  </TableHead>
                  <tbody>
                    {data.trend.map((row) => (
                      <tr key={row.month}>
                        <Td>{row.month}</Td>
                        <Td>{row.submitted}</Td>
                        <Td>{row.funded}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
              )}
            </Card>
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <RankingTable
              title="Top employees"
              rows={data.rankings.employees}
              hrefFor={(row) => `/reports/employees/${row.id}?${toSearchParams(query)}`}
            />
            <RankingTable
              title="Top teams"
              rows={data.rankings.teams}
              hrefFor={(row) => drill("funded", { team_id: row.id })}
            />
            <RankingTable
              title="Top offices"
              rows={data.rankings.offices}
              hrefFor={(row) => drill("funded", { office_id: row.id })}
            />
            <RankingTable
              title="Top bank / product"
              rows={data.rankings.bankProducts}
              hrefFor={(row) =>
                drill("funded", {
                  bank_id: row.bankId ?? "",
                  product_id: row.productId ?? "",
                })
              }
            />
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
