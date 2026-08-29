"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { DatePicker } from "@/components/date-picker";
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  PageHeader,
  Select,
  TableHead,
  TableShell,
  Td,
  Th,
} from "@/components/ui";
import { apiGet, ApiClientError } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";
import { formatAed, formatPct, queryFromSearch } from "@/lib/reports";

type Profile = {
  reportingScope: string | null;
  period: { key: string; label: string };
  employee: {
    employeeCode: string;
    fullName: string;
    userCode: string;
    designation: string | null;
    office: string | null;
    department: string | null;
    team: string | null;
    reportingManager: string | null;
    joiningDate: string;
    employmentStatus: string;
  };
  kpis: {
    submitted: { count: number; value: string };
    approved: { count: number; value: string };
    booked: { count: number; value: string };
    funded: { count: number; value: string };
    pending: { count: number };
    personalFinance: { count: number; value: string };
    creditCard: { count: number; value: string | null };
    totalBusinessValue: string;
    finalRejected: { count: number };
    cancelled: { count: number };
    withdrawn: { count: number };
    completed: { count: number };
  };
  conversions: Record<string, number | null>;
  stageBreakdown: { name: string; count: number }[];
  ranking: { rank: number; value: string | number } | null;
  applications: { id: string; applicationCode: string; currentStage: string; productCode: string }[];
  attendanceSummary: {
    presentCount: number;
    absentCount: number;
    leaveCount: number;
    lateCount: number;
    averageLateMinutes: number;
    averageTimeIn: string | null;
    averageTimeOut: string | null;
    earlyExitCount: number;
    earlyExitMinutes: number;
    attendancePercent: number | null;
    attendanceScore: number;
    attendanceImpact: number;
  } | null;
  targetsKpi: {
    currency: string;
    targets: {
      id: string;
      productCode: string | null;
      bankCode: string | null;
      milestone: string;
      measurement: string;
      prorate: boolean;
      result: {
        target: string;
        effectiveTarget: string;
        actual: string;
        achievementPct: number | null;
        gap: string;
        dailyRequiredRunRate: string | null;
      } | null;
    }[];
    kpi: {
      scorecardName: string;
      score: string;
      components: {
        metric: string;
        label: string;
        weightPercent: string;
        actual: string | null;
        baseline: string | null;
        achievementPct: number | null;
        weightedContribution: string;
        direction: string;
      }[];
    } | null;
  } | null;
};

function ProfileInner() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const api = getBrowserApiUrl();
  const initial = queryFromSearch(searchParams.toString());
  const [period, setPeriod] = useState(initial.period || "mtd");
  const [dateFrom, setDateFrom] = useState(initial.date_from);
  const [dateTo, setDateTo] = useState(initial.date_to);
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const query = new URLSearchParams({ period });
    if (period === "custom") {
      query.set("date_from", dateFrom);
      query.set("date_to", dateTo);
    }
    try {
      setError("");
      setData(await apiGet<Profile>(`/api/v1/reports/employees/${params.id}?${query}`, api));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiClientError ? err.message : "Unable to load profile");
    }
  }, [api, dateFrom, dateTo, params.id, period]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-6">
      <PageHeader
        title={data?.employee.fullName ?? "Employee performance"}
        description={data ? `${data.employee.employeeCode} · ${data.employee.userCode}` : undefined}
        actions={
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Reporting period
          <Select aria-label="Reporting period" value={period} onChange={(event) => setPeriod(event.target.value)}>
            <option value="mtd">MTD</option>
            <option value="today">Today</option>
            <option value="previous_month">Previous Month</option>
            <option value="qtd">QTD</option>
            <option value="previous_quarter">Previous Quarter</option>
            <option value="half_year">Half-Year</option>
            <option value="ytd">YTD</option>
            <option value="since_joining">Since Joining</option>
            <option value="custom">Custom</option>
          </Select>
        </label>
        {period === "custom" ? (
          <>
            <label className="text-sm">
              From
              <DatePicker aria-label="From" value={dateFrom} onChange={setDateFrom} />
            </label>
            <label className="text-sm">
              To
              <DatePicker aria-label="To" value={dateTo} onChange={setDateTo} />
            </label>
          </>
        ) : null}
        <Button type="button" onClick={() => void load()}>
          Apply
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
      {data ? (
        <>
          <dl className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 text-sm md:grid-cols-3">
            <div>
              <dt className="text-slate-500">Designation</dt>
              <dd>{data.employee.designation ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Office</dt>
              <dd>{data.employee.office ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Department</dt>
              <dd>{data.employee.department ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Team</dt>
              <dd>{data.employee.team ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Reporting manager</dt>
              <dd>{data.employee.reportingManager ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Joining date</dt>
              <dd>{data.employee.joiningDate}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Employment status</dt>
              <dd>{data.employee.employmentStatus}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Ranking</dt>
              <dd>{data.ranking ? `#${data.ranking.rank}` : "—"}</dd>
            </div>
          </dl>
          {data.attendanceSummary ? (
            <Card>
              <h3 className="text-sm font-semibold">Attendance summary</h3>
              <dl className="mt-3 grid gap-3 text-sm md:grid-cols-3">
                <div>
                  <dt className="text-slate-500">Present</dt>
                  <dd>{data.attendanceSummary.presentCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Absent</dt>
                  <dd>{data.attendanceSummary.absentCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Leave</dt>
                  <dd>{data.attendanceSummary.leaveCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Late</dt>
                  <dd>
                    {data.attendanceSummary.lateCount} (avg {data.attendanceSummary.averageLateMinutes} min)
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Average time in</dt>
                  <dd>{data.attendanceSummary.averageTimeIn ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Average time out</dt>
                  <dd>{data.attendanceSummary.averageTimeOut ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Early exit</dt>
                  <dd>
                    {data.attendanceSummary.earlyExitCount} ({data.attendanceSummary.earlyExitMinutes} min)
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Attendance %</dt>
                  <dd>
                    {data.attendanceSummary.attendancePercent == null
                      ? "—"
                      : `${data.attendanceSummary.attendancePercent}%`}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Attendance score / impact</dt>
                  <dd>
                    {data.attendanceSummary.attendanceScore} / {data.attendanceSummary.attendanceImpact}
                  </dd>
                </div>
              </dl>
            </Card>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <p className="text-xs uppercase text-slate-500">Submitted</p>
              <p className="mt-2 text-xl font-semibold">{data.kpis.submitted.count}</p>
              <p className="text-sm">{formatAed(data.kpis.submitted.value)}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-slate-500">Approved</p>
              <p className="mt-2 text-xl font-semibold">{data.kpis.approved.count}</p>
              <p className="text-sm">{formatAed(data.kpis.approved.value)}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-slate-500">Booked</p>
              <p className="mt-2 text-xl font-semibold">{data.kpis.booked.count}</p>
              <p className="text-sm">{formatAed(data.kpis.booked.value)}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-slate-500">Funded</p>
              <p className="mt-2 text-xl font-semibold">{data.kpis.funded.count}</p>
              <p className="text-sm">{formatAed(data.kpis.funded.value)}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-slate-500">Pending</p>
              <p className="mt-2 text-xl font-semibold">{data.kpis.pending.count}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-slate-500">PF</p>
              <p className="mt-2 text-xl font-semibold">{data.kpis.personalFinance.count}</p>
              <p className="text-sm">{formatAed(data.kpis.personalFinance.value)}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-slate-500">CC Count</p>
              <p className="mt-2 text-xl font-semibold">{data.kpis.creditCard.count}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-slate-500">Total business value</p>
              <p className="mt-2 text-xl font-semibold">{formatAed(data.kpis.totalBusinessValue)}</p>
            </Card>
          </div>
          <Card>
            <h3 className="text-sm font-semibold">Conversions</h3>
            <p className="mt-2 text-sm">Submitted → Approved {formatPct(data.conversions.submittedToApproved)}</p>
            <p className="text-sm">Approved → Booked {formatPct(data.conversions.approvedToBooked)}</p>
            <p className="text-sm">Booked → Funded {formatPct(data.conversions.bookedToFunded)}</p>
          </Card>
          {data.targetsKpi ? (
            <Card>
              <h3 className="text-sm font-semibold">Targets / KPI</h3>
              {data.targetsKpi.targets.length === 0 ? (
                <EmptyState>No active targets for this period.</EmptyState>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {data.targetsKpi.targets.map((item) => (
                    <li key={item.id}>
                      {item.productCode}
                      {item.bankCode ? ` / ${item.bankCode}` : " overall"} · {item.milestone} · target{" "}
                      {item.measurement === "amount"
                        ? formatAed(item.result?.effectiveTarget)
                        : item.result?.effectiveTarget}{" "}
                      · actual {item.measurement === "amount" ? formatAed(item.result?.actual) : item.result?.actual} ·
                      achievement {formatPct(item.result?.achievementPct)} · gap {item.result?.gap} · daily run-rate{" "}
                      {item.result?.dailyRequiredRunRate ?? "—"}
                    </li>
                  ))}
                </ul>
              )}
              {data.targetsKpi.kpi ? (
                <div className="mt-4 text-sm">
                  <p className="font-semibold">
                    KPI score {data.targetsKpi.kpi.score} ({data.targetsKpi.kpi.scorecardName})
                  </p>
                  <ul className="mt-2 space-y-1">
                    {data.targetsKpi.kpi.components.map((row) => (
                      <li key={row.metric}>
                        {row.label}: actual {row.actual ?? "—"} · achievement {formatPct(row.achievementPct)} · weight{" "}
                        {row.weightPercent}% · contribution {row.weightedContribution}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          ) : null}
          <Card>
            <h3 className="text-sm font-semibold">Current stage breakdown</h3>
            {data.stageBreakdown.length === 0 ? (
              <EmptyState>No pending applications.</EmptyState>
            ) : (
              <ul className="mt-2 text-sm">
                {data.stageBreakdown.map((row, index) => (
                  <li key={`${row.name}-${index}`}>
                    {row.name}: {row.count}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <TableShell>
            <TableHead>
              <tr>
                <Th>Application</Th>
                <Th>Product</Th>
                <Th>Stage</Th>
              </tr>
            </TableHead>
            <tbody>
              {data.applications.map((item) => (
                <tr key={item.id}>
                  <Td>
                    <Link className="underline" href={`/applications/${item.id}`}>
                      {item.applicationCode}
                    </Link>
                  </Td>
                  <Td>{item.productCode}</Td>
                  <Td>{item.currentStage}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </>
      ) : null}
    </section>
  );
}

export default function EmployeeProfilePage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <ProfileInner />
    </Suspense>
  );
}
