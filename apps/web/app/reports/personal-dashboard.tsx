import { Badge, Card, SectionHeader } from "@/components/ui";
import { formatAed, formatPct, type PersonalAttendance, type PersonalPerformance } from "@/lib/reports";

function metricValue(value: string | null, measurement: string | null) {
  if (value === null) return "—";
  return measurement === "amount" ? formatAed(value) : Number(value).toLocaleString("en-AE");
}

function minutes(value: number | null) {
  if (value === null) return "—";
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</dt>
      <dd className="mt-1 truncate text-base font-semibold tabular-nums text-slate-950">{value}</dd>
    </div>
  );
}

export function MyPerformance({ data }: { data: PersonalPerformance }) {
  const target = data.target;
  const achievement = target.achievementPct;
  const bounded = Math.min(100, Math.max(0, achievement ?? 0));
  const current = data.currentMonthTarget.achievementPct;
  const previous = data.previousMonthTarget.achievementPct;
  const delta = current !== null && previous !== null ? Math.round((current - previous) * 100) / 100 : null;

  return (
    <div className="min-w-0" data-testid="my-performance">
    <Card className="min-w-0 p-4">
      <SectionHeader title="My Performance" description="Your assigned targets and authorized personal results." />
      {target.count === 0 && !target.kpi ? (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
          No target or KPI scorecard is assigned for this period.
        </p>
      ) : (
        <>
          <dl className="mt-3 grid gap-2 sm:grid-cols-3">
            <MiniMetric label="Assigned target" value={metricValue(target.assigned, target.measurement)} />
            <MiniMetric label="Achieved" value={metricValue(target.achieved, target.measurement)} />
            <MiniMetric label="Remaining" value={metricValue(target.remaining, target.measurement)} />
          </dl>
          <div className="mt-3 rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-slate-700">Achievement progress</span>
              <strong className="tabular-nums text-brand-primary">{formatPct(achievement)}</strong>
            </div>
            <div
              role="progressbar"
              aria-label="My target achievement"
              aria-valuenow={bounded}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
            >
              <div className="h-full rounded-full bg-blue-600" style={{ width: `${bounded}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Current month {formatPct(current)} · Previous month {formatPct(previous)}
              {delta === null ? "" : ` · ${delta > 0 ? "+" : ""}${delta}% change`}
            </p>
          </div>
          {target.kpi ? (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{target.kpi.scorecardName}</p>
                <Badge>KPI score {target.kpi.score}</Badge>
              </div>
              {target.kpi.components.length ? (
                <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                  {target.kpi.components.map((component) => (
                    <div key={component.metric} className="flex items-center justify-between gap-3 text-xs">
                      <dt className="truncate text-slate-600">{component.label}</dt>
                      <dd className="shrink-0 font-semibold tabular-nums text-slate-900">{component.actual ?? "—"} / {component.baseline ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {data.applicationMetrics ? (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <h3 className="text-sm font-semibold text-slate-950">My application performance</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Current month {data.applicationMetrics.currentMonthApplications} · Previous month {data.applicationMetrics.previousMonthApplications}
          </p>
          <dl className="mt-2 grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            <MiniMetric label="Applications" value={data.applicationMetrics.applications.count} />
            <MiniMetric label="Submitted" value={data.applicationMetrics.submitted.count} />
            <MiniMetric label="Approved" value={data.applicationMetrics.approved.count} />
            <MiniMetric label="Funded" value={data.applicationMetrics.funded.count} />
            <MiniMetric label="Rejected" value={data.applicationMetrics.rejected.count} />
            <MiniMetric label="Pending" value={data.applicationMetrics.pending.count} />
            <MiniMetric label="Credit Card" value={data.applicationMetrics.creditCard.count} />
            <MiniMetric label="Personal Finance" value={data.applicationMetrics.personalFinance.count} />
          </dl>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Sales figures are not shown because this account does not own Applications.</p>
      )}
    </Card>
    </div>
  );
}

export function MyAttendance({ data }: { data: PersonalAttendance }) {
  const today = data.today;
  return (
    <div className="min-w-0" data-testid="my-attendance">
    <Card className="min-w-0 p-4">
      <SectionHeader title="My Attendance" description="Read-only attendance for the current month." actions={<Badge>{today.status}</Badge>} />
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniMetric label="Duty" value={today.scheduledStart && today.scheduledEnd ? `${today.scheduledStart}–${today.scheduledEnd}` : "Not scheduled"} />
        <MiniMetric label="Check-in" value={today.actualCheckIn ?? "—"} />
        <MiniMetric label="Check-out" value={today.actualCheckOut ?? "—"} />
        <MiniMetric label="Worked" value={minutes(today.workedMinutes)} />
        <MiniMetric label="Late arrival" value={minutes(today.lateMinutes)} />
        <MiniMetric label="Early departure" value={minutes(today.earlyDepartureMinutes)} />
        <MiniMetric label="Overtime" value={today.overtimeConfigured ? minutes(today.overtimeMinutes) : "Not configured"} />
      </dl>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniMetric label="Present" value={data.summary.presentCount} />
        <MiniMetric label="Absent" value={data.summary.absentCount} />
        <MiniMetric label="Late" value={data.summary.lateCount} />
        <MiniMetric label="Leave" value={data.summary.leaveCount} />
      </dl>
      <details className="group mt-3 rounded-lg border border-slate-200">
        <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold text-brand-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary">
          Monthly attendance view ({data.items.length})
        </summary>
        {data.items.length ? (
          <ul className="grid gap-2 border-t border-slate-200 p-2 sm:grid-cols-2">
            {data.items.map((item) => (
              <li key={item.id} className="min-w-0 rounded-md bg-slate-50 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2"><time className="font-semibold text-slate-900">{item.date}</time><Badge>{item.status}</Badge></div>
                <p className="mt-1 text-xs text-slate-500">{item.checkIn ?? "—"}–{item.checkOut ?? "—"} · {minutes(item.workedMinutes)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-slate-200 px-3 py-4 text-sm text-slate-500">No attendance records are available this month.</p>
        )}
      </details>
    </Card>
    </div>
  );
}

export function PersonalPerformanceAttendance({ performance, attendance }: { performance: PersonalPerformance; attendance: PersonalAttendance }) {
  return (
    <section aria-label="My performance and attendance" className="grid min-w-0 gap-4 xl:grid-cols-2">
      <MyPerformance data={performance} />
      <MyAttendance data={attendance} />
    </section>
  );
}
