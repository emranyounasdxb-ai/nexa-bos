"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { DatePicker } from "@/components/date-picker";
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  FilterBar,
  PageHeader,
  Select,
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

function KpiButton({
  label,
  count,
  value,
  href,
}: {
  label: string;
  count?: number;
  value?: string | null;
  href: string;
}) {
  return (
    <Link
      href={href}
      aria-label={`${label} KPI`}
      className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{count ?? "—"}</p>
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
    <Card>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {rows.length === 0 ? (
        <EmptyState>No ranking rows for the selected period.</EmptyState>
      ) : (
        <TableShell>
          <TableHead>
            <tr>
              <Th>Rank</Th>
              <Th>Name</Th>
              <Th>Value</Th>
            </tr>
          </TableHead>
          <tbody>
            {rows.slice(0, 8).map((row) => (
              <tr key={row.id}>
                <Td>{row.rank}</Td>
                <Td>
                  <Link className="underline" href={hrefFor(row)}>
                    {row.name}
                  </Link>
                </Td>
                <Td>{typeof row.value === "number" ? row.value : formatAed(row.value)}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </Card>
  );
}

export function DashboardInner() {
  const { can } = useAuth();
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
    <section className="space-y-6">
      <PageHeader
        title="Performance / MIS"
        description={
          data
            ? `${data.period.label} · ${data.reportingScope ?? "No reporting scope"} · ${data.currency}`
            : "Management dashboard"
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void load()}>
              Refresh
            </Button>
            {can("Reports.ExportExcel") ? (
              <Button type="button" variant="secondary" onClick={() => void exportReport("xlsx")}>
                Excel
              </Button>
            ) : null}
            {can("Reports.ExportPDF") ? (
              <Button type="button" variant="secondary" onClick={() => void exportReport("pdf")}>
                PDF
              </Button>
            ) : null}
            {can("Reports.Print") ? (
              <Button type="button" variant="secondary" onClick={() => void exportReport("print")}>
                Print
              </Button>
            ) : null}
            {can("Reports.View") ? (
              <Button type="button" variant="secondary" onClick={() => router.push("/reports/compare")}>
                Compare
              </Button>
            ) : null}
          </div>
        }
      />
      <FilterBar>
        <label className="text-sm">
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
            <label className="text-sm">
              From
              <DatePicker
                aria-label="Custom period start"
                value={query.date_from}
                onChange={(value) => setQuery({ ...query, date_from: value })}
              />
            </label>
            <label className="text-sm">
              To
              <DatePicker
                aria-label="Custom period end"
                value={query.date_to}
                onChange={(value) => setQuery({ ...query, date_to: value })}
              />
            </label>
          </>
        ) : null}
        <label className="text-sm">
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
        <label className="text-sm">
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
        <label className="text-sm">
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
        <label className="text-sm">
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
        <label className="text-sm">
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
        <label className="text-sm">
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
        <label className="text-sm">
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
          <Button type="button" onClick={applyFilters}>
            Apply
          </Button>
        </div>
      </FilterBar>
      <ErrorText>{error}</ErrorText>
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiButton label="Submitted" count={data.kpis.submitted.count} value={data.kpis.submitted.value} href={drill("submitted")} />
            <KpiButton label="Approved" count={data.kpis.approved.count} value={data.kpis.approved.value} href={drill("approved")} />
            <KpiButton label="Booked" count={data.kpis.booked.count} value={data.kpis.booked.value} href={drill("booked")} />
            <KpiButton label="Funded" count={data.kpis.funded.count} value={data.kpis.funded.value} href={drill("funded")} />
            <KpiButton label="Pending" count={data.kpis.pending.count} href={drill("pending")} />
            <KpiButton label="Returned / Requirement Pending" count={data.kpis.returnedRequirementPending.count} href={drill("returned")} />
            <KpiButton label="Final Rejected" count={data.kpis.finalRejected.count} href={drill("final_rejected")} />
            <KpiButton label="Cancelled" count={data.kpis.cancelled.count} href={drill("cancelled")} />
            <KpiButton label="Withdrawn" count={data.kpis.withdrawn.count} href={drill("withdrawn")} />
            <KpiButton label="Completed" count={data.kpis.completed.count} href={drill("completed")} />
            <KpiButton label="PF Count / Value" count={data.kpis.personalFinance.count} value={data.kpis.personalFinance.value} href={drill("pf_value")} />
            <KpiButton label="CC Count" count={data.kpis.creditCard.count} href={drill("cc_count")} />
          </div>
          {data.targetsSummary && data.targetsSummary.items.length > 0 ? (
            <Card>
              <h3 className="text-sm font-semibold text-slate-900">Targets</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {data.targetsSummary.items.slice(0, 8).map((item) => (
                  <li key={item.id}>
                    {item.level} {item.entityName} · {item.productCode}
                    {item.bankCode ? ` / ${item.bankCode}` : ""} · actual {item.result?.actual} · achievement{" "}
                    {formatPct(item.result?.achievementPct)}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm">
                <Link className="underline" href="/targets">
                  Open targets
                </Link>
              </p>
            </Card>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="text-sm font-semibold text-slate-900">Conversions</h3>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <Link className="underline" href={drill("conversion_submitted_approved")}>
                    Submitted → Approved {formatPct(data.conversions.submittedToApproved)}
                  </Link>
                </li>
                <li>
                  <Link className="underline" href={drill("conversion_approved_booked")}>
                    Approved → Booked {formatPct(data.conversions.approvedToBooked)}
                  </Link>
                </li>
                <li>
                  <Link className="underline" href={drill("conversion_booked_funded")}>
                    Booked → Funded {formatPct(data.conversions.bookedToFunded)}
                  </Link>
                </li>
                <li>
                  <Link className="underline" href={drill("conversion_submitted_rejected")}>
                    Submitted → Final Rejected {formatPct(data.conversions.submittedToFinalRejected)}
                  </Link>
                </li>
                <li>
                  <Link className="underline" href={drill("conversion_submitted_cancelled_withdrawn")}>
                    Submitted → Cancelled / Withdrawn {formatPct(data.conversions.submittedToCancelledWithdrawn)}
                  </Link>
                </li>
              </ul>
            </Card>
            <Card>
              <h3 className="text-sm font-semibold text-slate-900">Active delays</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {(["Bank", "Customer", "Internal", "Other"] as const).map((type) => (
                  <li key={type}>
                    <Link
                      className="underline"
                      href={drill(`delay_${type.toLowerCase()}`)}
                      aria-label={`${type} delays`}
                    >
                      {type}: {data.activeDelays[type]}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <h3 className="text-sm font-semibold text-slate-900">Current stage breakdown</h3>
              {data.stageBreakdown.length === 0 ? (
                <EmptyState>No pending applications at the reporting cutoff.</EmptyState>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                {data.stageBreakdown.map((row) => (
                  <li key={`${row.stageId ?? "none"}:${row.name}`}>
                      <Link
                        className="underline"
                        href={drill("stage", row.stageId ? { stage_id: row.stageId } : {})}
                      >
                        {row.name}: {row.count}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <h3 className="text-sm font-semibold text-slate-900">Trend</h3>
              {data.trend.length === 0 ? (
                <EmptyState>No trend points yet.</EmptyState>
              ) : (
                <TableShell>
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
          <div className="grid gap-4 lg:grid-cols-2">
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
