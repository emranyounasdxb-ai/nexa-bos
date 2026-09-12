"use client";

import { RecordFrame } from "@/components/page-patterns";
import styles from "./employee-report.module.css";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { DateRangePicker } from "@/components/date-picker";
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
  applications: {
    id: string;
    applicationCode: string;
    currentStage: string;
    bankCode: string;
    productCode: string;
    productVariantCode: string | null;
  }[];
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
    <section className="space-y-4">
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
          <label className="text-sm">
            Custom period
            <DateRangePicker
              aria-label="Custom period"
              from={dateFrom}
              to={dateTo}
              onChange={({ from, to }) => {
                setDateFrom(from);
                setDateTo(to);
              }}
            />
          </label>
        ) : null}
        <Button type="button" onClick={() => void load()}>
          Apply
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
      {data ? (
        <RecordFrame summary={<Card>
          <h2 className="text-[18px] font-medium">{data.employee.fullName}</h2>
          <p className="mt-1 text-xs text-text-secondary">{data.employee.employeeCode} · {data.employee.userCode}</p>
          <dl className="mt-4 grid gap-3 text-sm">
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
        </Card>}>
          {data.attendanceSummary ? (
            <Card>
              <h3 className="text-lg font-semibold">Attendance summary</h3>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
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
          <div className="grid grid-cols-2 gap-3 rounded-[20px] bg-surface p-3 2xl:grid-cols-3 [&>[data-amafh-card]]:border-0 [&>[data-amafh-card]]:!bg-surface-subtle">
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
            <h3 className="text-lg font-semibold">Conversions</h3>
            <dl className={styles.conversions}>
              <div><dt>Submitted → Approved</dt><dd>{formatPct(data.conversions.submittedToApproved)}</dd></div>
              <div><dt>Approved → Booked</dt><dd>{formatPct(data.conversions.approvedToBooked)}</dd></div>
              <div><dt>Booked → Funded</dt><dd>{formatPct(data.conversions.bookedToFunded)}</dd></div>
            </dl>
          </Card>
          {data.targetsKpi ? (
            <Card>
              <h3 className="text-lg font-semibold">Targets / KPI</h3>
              {data.targetsKpi.targets.length === 0 ? (
                <EmptyState>No active targets for this period.</EmptyState>
              ) : (
                <ul className={styles.results}>
                  {data.targetsKpi.targets.map((item) => (
                    <li key={item.id}>
                      <h4>{item.productCode}{item.bankCode ? ` / ${item.bankCode}` : " overall"} · {item.milestone}</h4>
                      <dl>
                        <div><dt>Target</dt><dd>{item.measurement === "amount" ? formatAed(item.result?.effectiveTarget) : item.result?.effectiveTarget}</dd></div>
                        <div><dt>Actual</dt><dd>{item.measurement === "amount" ? formatAed(item.result?.actual) : item.result?.actual}</dd></div>
                        <div><dt>Achievement</dt><dd>{formatPct(item.result?.achievementPct)}</dd></div>
                        <div><dt>Gap</dt><dd>{item.result?.gap}</dd></div>
                        <div><dt>Daily run-rate</dt><dd>{item.result?.dailyRequiredRunRate ?? "—"}</dd></div>
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
              {data.targetsKpi.kpi ? (
                <div className="mt-4 text-sm">
                  <p className="font-semibold">
                    KPI score {data.targetsKpi.kpi.score} ({data.targetsKpi.kpi.scorecardName})
                  </p>
                  <ul className={styles.results}>
                    {data.targetsKpi.kpi.components.map((row) => (
                      <li key={row.metric}>
                        <h4>{row.label}:</h4>
                        <dl>
                          <div><dt>Actual</dt><dd>{row.actual ?? "—"}</dd></div>
                          <div><dt>Achievement</dt><dd>{formatPct(row.achievementPct)}</dd></div>
                          <div><dt>Weight</dt><dd>{row.weightPercent}%</dd></div>
                          <div><dt>Contribution</dt><dd>{row.weightedContribution}</dd></div>
                        </dl>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          ) : null}
          <Card>
            <h3 className="text-lg font-semibold">Current stage breakdown</h3>
            {data.stageBreakdown.length === 0 ? (
              <EmptyState>No pending applications.</EmptyState>
            ) : (
              <ul className={styles.stages}>
                {data.stageBreakdown.map((row, index) => (
                  <li key={`${row.name}-${index}`}>
                    <span>{row.name}</span><strong>{row.count}</strong>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <TableShell className={styles.records}>
            <TableHead>
              <tr>
                <Th>Application</Th>
                <Th>Bank / Product / Variant</Th>
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
                  <Td>
                    {item.bankCode} / {item.productCode} / {item.productVariantCode ?? "Legacy"}
                  </Td>
                  <Td>{item.currentStage}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </RecordFrame>
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
