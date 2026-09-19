"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { BosChart, type BosChartOption } from "@/components/charts/bos-chart";
import { chartAnimation, chartAxisText, chartFontFamily, chartPalette, chartSplitLine, chartTooltip } from "@/components/charts/chart-theme";
import { IconCalendarCheck, IconChartBar, IconChevronDown, IconCircleCheck, IconClock, IconFileDescription, IconFilter, IconInbox, IconPackages, IconUsersGroup } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { ApplicationCreateDialog } from "@/components/application-create-dialog";
import { ProfilePhoto } from "@/components/profile-photo";
import { DateRangePicker } from "@/components/date-picker";
import { RecordIdentity } from "@/components/page-patterns";
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorText, Field, FilterBar, LoadingState, PageHeader, SectionHeader, Select, StatusBadge, TableHead, TableShell, Td, TextInput, Th, cx, focusRing } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import { formatDuration } from "@/lib/duration";
import { formatAed, formatPct, type PersonalAttendance, type PersonalPerformance } from "@/lib/reports";
import styles from "./tl-dashboard.module.css";
import { TlCaseTimeline } from "./tl-case-timeline";
import { TlSparkline, type MetricHistory } from "./tl-sparkline";

type Case = { id: string; fileNumber: string; customer: string; caseOwner: string; pendingRole: string; outcome: string | null; bank: string; product: string; requestedAmount: string | null; routingLabel: string; statusLabel: string; currentBucket: string; bankStage: string; bankNumber: string | null; tatSeconds: number; delayed: boolean; updatedAt: string; reason: string | null; canReview: boolean };
type Bar = { name: string; count: number };
type StageBar = Bar & { stageId: string; label: string; workflowContext: string };
type Trend = { name: string; created: number; submitted: number };
type Staff = { id: string; name: string; hasPhoto: boolean; photoUpdatedAt: string; applications: number; cc: number; pf: number; submitted: number; completed: number; openCases: number; pendingApproval: number; delayed: number; approved: number; funded: number; conversion: number | null; pendingReview: number; earnings: Earnings; attendance: PersonalAttendance; target: { assigned: string | null; achieved: string | null; remaining: string | null; achievementPct: number | null; measurement: string | null } };
type Payload = { office: string; team: string; updatedAt: string; period: string; view: string; queue: string; queueLabel: string; cards: Array<{ key: string; label: string; count: number }>; items: Case[]; total: number; page: number; pageSize: number; attention: Case[]; returned: Case[]; charts: { trend: Trend[]; ownership: Bar[]; review: Bar[]; stages: StageBar[]; products: Bar[]; outcomes: Bar[]; tat: Bar[] }; staff: Staff[]; activity: Array<{ id: string; fileNumber: string; applicationId: string; event: string; at: string; reason: string | null }>; personalPerformance: PersonalPerformance; personalAttendance: PersonalAttendance };
type Earnings = { cardsBooked: number; pointsEarned: string; pointsReversed: string; pointsNet: string; loansBooked: number; loanAmount: string; commissionEarned: string; commissionReversed: string; commissionNet: string; pendingCases: number; closedCases: number };
type TimelineEvent = Payload["activity"][number] & { actor: string; source: string; previousState: string | null; newState: string | null; details: Record<string, unknown> | null };
type DashboardPayload = Omit<Payload, "activity"> & { ownTotal: number; teamTotal: number; filterOptions: { owners: Array<{ id: string; name: string }>; products: Array<{ id: string; name: string }>; stages: StageBar[]; outcomes: string[]; cases: Array<{ id: string; name: string; ownerId: string }> }; activity: TimelineEvent[]; metricHistory?: Record<string, MetricHistory | null>; ownStatus: Record<string, number>; teamStatus: Record<string, number>; ownEarnings: Earnings; teamEarnings: Earnings; hierarchy: { salesManager: string | null; teamLeader: string }; clawbacks: Array<{ case: string; ownerId: string; owner: string; ownerRole: string; type: string; original: string; deducted: string; net: string }> };

type CurrentWork = { total: number; open: number; booking: number; overdue: number; clawback: number; stages: Record<string, number> };
type WorkspacePayload = DashboardPayload & { currentWork: { own: CurrentWork; team: CurrentWork }; pendingBookingItems: Case[] };
const PIPELINE = [{ key: "created", label: "Created", icon: IconFileDescription }, { key: "tl_booking", label: "TL Booking", icon: IconInbox }, { key: "sm", label: "SM Approval", icon: IconCircleCheck }, { key: "coordinator", label: "Coordinator", icon: IconUsersGroup }, { key: "bank", label: "Bank Submitted", icon: IconPackages }, { key: "completed", label: "Completed", icon: IconCircleCheck }];
const businessLabels: Record<string, string> = { application_created: "Case created", internal_review_started: "Review started", internal_booked: "Booked by TL", internal_sm_approved: "Approved by Sales Manager", internal_returned: "Returned for correction", internal_resubmitted: "Resubmitted for review", legacy: "Earlier record", pending_review: "Pending TL review", sm_approved: "Approved by Sales Manager" };
function displayDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value)).replace(/\b(am|pm)\b/g, part => part.toUpperCase()); }
function humanState(value: string) { if (businessLabels[value.toLowerCase().replaceAll(" ", "_")]) return businessLabels[value.toLowerCase().replaceAll(" ", "_")]; return value.replace(/^internal[ _]/i, "").replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase()).replace(/\b(Sm|Tl|Se|Cod|Cc|Pf)\b/g, word => word.toUpperCase()); }
function Initials({ name }: { name: string }) { const parts = name.split(/\s+/).filter(part => /[\p{L}\p{N}]/u.test(part)); return <span className={styles.avatar} aria-hidden="true">{parts[0]?.[0]}{parts.length > 1 ? parts.at(-1)?.[0] : ""}</span>; }
function RangeControls({ label, from, to, onApply, onClear }: { label: string; from: string; to: string; onApply: (range: { from: string; to: string }) => void; onClear: () => void }) {
  const [draft, setDraft] = useState({ from, to });
  useEffect(() => setDraft({ from, to }), [from, to]);
  return <div className={styles.rangeControls}><DateRangePicker aria-label={label} from={draft.from} to={draft.to} onChange={setDraft} /><Button variant="secondary" disabled={Boolean(draft.from) !== Boolean(draft.to)} onClick={() => onApply(draft)}>Apply</Button><Button variant="ghost" onClick={() => { setDraft({ from: "", to: "" }); onClear(); }}>Clear filters</Button></div>;
}
function Pipeline({ counts, view }: { counts: CurrentWork; view: string }) {
  return <nav aria-label={`${view === "own" ? "My" : "Team"} current workflow`} className={styles.pipeline}>{PIPELINE.map(({ key, label, icon: Icon }) => <Link key={key} href={`/reports?workspace=cases&view=${view}&queue=stage_${key}`} className={focusRing} data-has-work={counts.stages[key] > 0}><Icon aria-hidden="true" /><strong>{counts.stages[key]}</strong><span>{label}</span></Link>)}</nav>;
}
function EarningsSummary({ values }: { values: Earnings }) {
  const labels: Record<string, string> = { cardsBooked: "Cards", pointsEarned: "Original Points", pointsReversed: "Points Clawback", pointsNet: "Net Points", loansBooked: "Loans", loanAmount: "Loan Amount", commissionEarned: "Original Commission", commissionReversed: "Commission Clawback", commissionNet: "Net Commission", pendingCases: "Current Workload", closedCases: "Completed/Closed" };
  return <div className={styles.earningGroups}>{[{ title: "Credit Cards", keys: ["cardsBooked", "pointsEarned", "pointsReversed", "pointsNet"] }, { title: "Personal Finance", keys: ["loansBooked", "loanAmount", "commissionEarned", "commissionReversed", "commissionNet"] }, { title: "Workload", keys: ["pendingCases", "closedCases"] }].map(group => <section key={group.title}><h3>{group.title}</h3>{group.title === "Workload" || group.keys.some(key => Number(values[key as keyof Earnings]) !== 0) ? <dl>{group.keys.map(key => <Metric key={key} label={labels[key]} value={key === "loanAmount" || key.startsWith("commission") ? formatAed(values[key as keyof Earnings]) : values[key as keyof Earnings]} />)}</dl> : <p className={styles.muted}>No {group.title === "Credit Cards" ? "card" : "loan"} earnings recorded for this period.</p>}</section>)}</div>;
}


const COLORS = [chartPalette.navy, chartPalette.blue, chartPalette.emerald, chartPalette.amber, chartPalette.slate500];

function Disclosure({ title, children, defaultOpen = true, testId, className, aside, expanded, onExpandedChange }: { title: string; children: ReactNode; defaultOpen?: boolean; testId?: string; className?: string; aside?: ReactNode; expanded?: boolean; onExpandedChange?: (value: boolean) => void }) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = expanded ?? localOpen;
  const id = useId();
  return <Card className={cx(styles.surface, className)} data-testid={testId}>
    <header className={styles.surfaceHeader}><SectionHeader title={title} actions={<span className={styles.disclosureAside}>{aside}<Button variant="ghost" type="button" aria-label={`${open ? "Collapse" : "Expand"} ${title}`} aria-expanded={open} aria-controls={id} onClick={() => { setLocalOpen(!open); onExpandedChange?.(!open); }} className={cx(focusRing, styles.surfaceToggle)}><IconChevronDown aria-hidden="true" className={cx("size-4 shrink-0 transition-transform", open && "rotate-180")} /></Button></span>} /></header>
    {open ? <div id={id} className={styles.surfaceBody}>{children}</div> : null}
  </Card>;
}
function Empty({ children }: { children: ReactNode }) { return <EmptyState kind="records">{children}</EmptyState>; }
function hasHistory(history?: MetricHistory | null) {
  return history?.points.some(point => point.value !== null && Number.isFinite(point.value)) ?? false;
}
function Metric({ label, value, prominent = false, history, trendKey, historyNoteId, missing = false }: { label: string; value: ReactNode; prominent?: boolean; history?: MetricHistory | null; trendKey?: string; historyNoteId?: string; missing?: boolean }) {
  const available = hasHistory(history);
  return <div className={cx(styles.metric, prominent && styles.prominentMetric, missing && styles.missingMetric)} data-testid={trendKey ? `tl-metric-${trendKey}` : undefined} data-history={trendKey ? available ? "available" : "unavailable" : undefined} aria-describedby={trendKey && !available ? historyNoteId : undefined}><dt>{label}</dt><dd>{value}</dd>{trendKey && (available || !historyNoteId) ? <dd className={styles.metricTrend}><TlSparkline history={history} label={label} metricKey={trendKey} /></dd> : null}</div>;
}
function ActivityFeed({ events }: { events: Payload["activity"] }) {
  const [expanded, setExpanded] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  if (!events.length) return <Empty>No recorded activity.</Empty>;
  return <><ol className={styles.activity} data-testid="tl-activity-list">{(expanded ? events : events.slice(0, 3)).map(event => <li key={event.id}><span data-amafh-icon-tile="" className={styles.eventIcon}><IconFileDescription aria-hidden="true" /></span><div><Link className={cx(focusRing, styles.fileLink)} href={`/applications/${event.applicationId}`}>{event.fileNumber}</Link><p>{humanState(event.event)}</p>{event.reason ? <p className={styles.muted}>{event.reason}</p> : null}<time>{displayDate(event.at)}</time></div></li>)}</ol>{events.length > 3 ? <button ref={button} type="button" className={cx(focusRing, styles.activityToggle)} aria-expanded={expanded} onClick={() => { setExpanded(!expanded); requestAnimationFrame(() => button.current?.focus()); }}>{expanded ? "Show fewer updates" : `Show all ${events.length} updates`}<IconChevronDown aria-hidden="true" className={expanded ? "rotate-180" : undefined} /></button> : null}</>;
}
function Cases({ rows, compact = false, selectedQueue = false, emptyTitle = "No cases in this queue.", emptyHint = "Choose another queue above to view your cases." }: { rows: Case[]; compact?: boolean; selectedQueue?: boolean; emptyTitle?: string; emptyHint?: string }) {
  if (!rows.length) return selectedQueue ? <EmptyState kind="search" title={emptyTitle} description={emptyHint} /> : <Empty>{emptyTitle}</Empty>;
  if (compact) return <ul className={styles.actionList}>{rows.map(item => <li key={item.id}><span className={styles.eventIcon}><IconInbox aria-hidden="true" /></span><div><Link className={cx(focusRing, styles.fileLink)} href={`/applications/${item.id}`}>{item.fileNumber}</Link><p>{item.customer}</p><small>{item.caseOwner} · {item.statusLabel}</small></div>{item.canReview && <Link className={cx(focusRing, styles.forward)} href={`/applications/${item.id}?tab=actions#internal-review`}>Book &amp; Send to SM</Link>}</li>)}</ul>;
  return <><div className={styles.desktopCases}><TableShell className={styles.caseTableWrap}><caption className="sr-only">Cases with ownership, workflow status, timing and available actions</caption><TableHead><tr>{["Case / Customer", "Case Owner", "Product", "Current Stage", "TAT / Outcome", "Bank File Number", "Actions"].map(label => <Th key={label}>{label}</Th>)}</tr></TableHead><tbody>{rows.map(item => <tr key={item.id}>
    <Td label="Case / Customer"><Link className={cx(focusRing, styles.fileLink)} href={`/applications/${item.id}`}>{item.fileNumber}</Link><p className={styles.customer}>{item.customer}</p><details><summary className={focusRing}>Details</summary><dl><Metric label="Requested amount" value={formatAed(item.requestedAmount)} /><Metric label="Bank workflow" value={item.bankStage} /><Metric label="Last updated" value={displayDate(item.updatedAt)} /></dl>{item.reason && <p>Return reason: {item.reason}</p>}</details></Td>
    <Td label="Case Owner"><span className={styles.caseOwner}><IconUsersGroup aria-hidden="true" />{item.caseOwner}</span></Td>
    <Td label="Product">{item.product}<p className={styles.muted}>{item.bank}</p></Td>
    <Td label="Current Stage"><StatusBadge value={item.statusLabel} />{!item.outcome && <p className={styles.muted}>Pending: {item.pendingRole}</p>}{!item.outcome && item.currentBucket === "bank" && !["Submitted", "Bank Submitted"].includes(item.bankStage) && <p className={styles.muted}>{item.bankStage}</p>}</Td>
    <Td label="TAT / Outcome"><span className={item.delayed ? styles.delayed : undefined}>{formatDuration(item.tatSeconds)}{item.delayed ? " · Overdue" : ""}</span><p className={styles.muted}>{item.outcome ?? "In progress"}</p></Td>
    <Td label="Bank File Number">{item.bankNumber ?? "—"}</Td>
    <Td label="Actions"><div className={styles.tableActions}><ButtonLink href={`/applications/${item.id}`} variant="secondary">Open Case</ButtonLink>{item.canReview && <><ButtonLink href={`/applications/${item.id}?tab=actions#internal-review`}>Book &amp; Send to SM</ButtonLink><ButtonLink href={`/applications/${item.id}?tab=actions#internal-review`} variant="secondary">Return for correction</ButtonLink></>}</div></Td>
  </tr>)}</tbody></TableShell></div><ul className={styles.mobileCases} aria-label="Case records">{rows.map(item => <li key={item.id}><Card className={styles.mobileCase} data-amafh-list-record=""><div className={styles.mobileCaseHead}><Link href={`/applications/${item.id}`} className={cx(focusRing, styles.mobileCaseIdentity)}><RecordIdentity icon={<IconFileDescription aria-hidden="true" />} title={item.fileNumber} subtitle={item.customer} /></Link><StatusBadge value={item.statusLabel} /></div><dl className={styles.mobileCaseFacts}><Metric label="Product" value={`${item.bank} · ${item.product}`} /><Metric label="Case Owner" value={item.caseOwner} /><Metric label="Turnaround" value={formatDuration(item.tatSeconds)} /><Metric label="Outcome" value={item.outcome ?? "In progress"} /></dl><div className={styles.mobileCaseFoot}><span>{item.bankNumber ?? "No bank file number"}</span><ButtonLink href={`/applications/${item.id}`} variant="secondary">Open Case</ButtonLink>{item.canReview && <ButtonLink href={`/applications/${item.id}?tab=actions#internal-review`}>Review Case</ButtonLink>}</div></Card></li>)}</ul></>;
}
function Achievement({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <p className={styles.muted}>Achievement unavailable</p>;
  const bounded = Math.max(0, Math.min(100, value));
  const extra = value > 100 ? `${formatPct(value - 100)} above target` : null;
  return <div className={styles.achievement}><div className={styles.progressCaption}><strong>{formatPct(value)}</strong><span>{extra ?? "achieved"}</span></div><div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bounded} aria-valuetext={`${formatPct(value)} achieved${extra ? `; ${extra}` : ""}`} className={styles.progressTrack}><span data-testid="target-progress-fill" className={styles.progressFill} style={{ width: `${bounded}%` }} /></div><div className={styles.progressScale} aria-hidden="true"><span>0%</span><span>100%</span></div></div>;
}
function targetValue(value: string | null, measurement: string | null) {
  if (value === null) return "—";
  return measurement === "amount" ? `AED ${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function StaffAttendance({ person }: { person: Staff }) {
  const { today, summary, items } = person.attendance;
  return <section className={styles.staffAttendance} aria-label={`Attendance — ${person.name}`}><div className={styles.attendanceHeading}><IconCalendarCheck aria-hidden="true" /><strong>{person.name}</strong><Badge>{today.status}</Badge></div><p className={styles.muted}>{today.date} · Current attendance</p><dl className={styles.workloadMetrics}><Metric label="Check-in" value={today.actualCheckIn ?? "—"} /><Metric label="Check-out" value={today.actualCheckOut ?? "—"} /><Metric label="Worked" value={minutes(today.workedMinutes)} /><Metric label="Present" value={summary.presentCount} /><Metric label="Absent" value={summary.absentCount} /><Metric label="Late" value={summary.lateCount} /></dl><details className={styles.monthDetail}><summary className={focusRing}>Monthly attendance details</summary>{items.length ? <ul>{items.map(item => <li key={item.id}><time>{item.date}</time><Badge>{item.status}</Badge><span>{item.checkIn ?? "—"} / {item.checkOut ?? "—"} · {minutes(item.workedMinutes)}</span></li>)}</ul> : <Empty>No attendance records are available this month.</Empty>}</details></section>;
}
function TeamPerformance({ staff }: { staff: Staff[] }) {
  if (!staff.length) return <Empty>No SEs are currently assigned to this team.</Empty>;
  return <div data-testid="tl-member-targets"><p className={styles.infoEmpty} data-testid="team-appraisal-unconfigured"><IconInbox aria-hidden="true" />No appraisal results available</p><ul className={styles.memberList}>{staff.map(person => {
    const target = person.target;
    const missing = target.achievementPct === null && target.assigned === null;
    const mixed = !missing && target.measurement === null;
    const historyNoteId = `tl-team-history-${person.id}`;
    return <li key={person.id} data-testid={`tl-staff-row-${person.id}`} className={styles.memberRow}>
      <div className={styles.memberIdentity}><ProfilePhoto userId={person.id} fullName={person.name} hasPhoto={person.hasPhoto} version={person.photoUpdatedAt} size="list" className={styles.avatar} /><div><h3>{person.name}</h3><p className={styles.muted}>{missing ? "Target results unavailable" : mixed ? "Mixed target units · Average achievement" : `${target.measurement === "amount" ? "AED value" : "Case count"} · Average achievement`}</p></div>{!missing ? <Tooltip label={`Target basis for ${person.name}`} text="Achievement is the average of assigned target percentages at their configured milestones. Amount and count totals are kept separate. A full track is 100%; any overachievement is shown above it." align="right" /> : null}</div>
      {!missing && <div className={styles.memberTarget}><dl className={styles.targetMetrics}><Metric label="Assigned" value={targetValue(target.assigned, target.measurement)} trendKey={`staff-${person.id}-assigned`} historyNoteId={historyNoteId} /><Metric label="Achieved" value={targetValue(target.achieved, target.measurement)} trendKey={`staff-${person.id}-achieved`} historyNoteId={historyNoteId} /><Metric label={target.remaining !== null && Number(target.remaining) < 0 ? "Exceeded by" : "Remaining"} value={targetValue(target.remaining === null ? null : String(Math.abs(Number(target.remaining))), target.measurement)} trendKey={`staff-${person.id}-remaining`} historyNoteId={historyNoteId} /></dl>{mixed ? <p className={styles.muted}>Totals are not combined across units.</p> : null}<div className={styles.memberProgress}><Achievement value={target.achievementPct} label={`${person.name} target achievement`} /></div></div>}
      <dl className={styles.memberStats}>{[["Cases", person.applications], ["CC / PF", `${person.cc} / ${person.pf}`], ["Submitted", person.submitted], ["Bank Approved", person.approved], ["Funded", person.funded], ["Conversion", formatPct(person.conversion)], ["Pending Review", person.pendingReview]].map(([label, value]) => <Metric key={label} label={String(label)} value={value} trendKey={`staff-${person.id}-${String(label).toLowerCase().replaceAll(" ", "-")}`} historyNoteId={historyNoteId} />)}</dl>
      <p id={historyNoteId} className={styles.historyNote}>Team target and performance totals reflect the selected period.</p>
      <dl className={styles.memberStats}><Metric label="Net Points" value={person.earnings.pointsNet} /><Metric label="Net Commission" value={formatAed(person.earnings.commissionNet)} /><Metric label="Points Clawback" value={person.earnings.pointsReversed} /><Metric label="Commission Clawback" value={formatAed(person.earnings.commissionReversed)} /></dl>
      <details className={styles.monthDetail}><summary className={focusRing}>Case Earnings &amp; Workload</summary><EarningsSummary values={person.earnings} /></details>
      <details className={styles.monthDetail}><summary className={focusRing}>Attendance — {person.name}</summary><StaffAttendance person={person} /></details>
    </li>;
  })}</ul></div>;
}
function TrendChart({ rows, href }: { rows: Trend[]; href: string }) {
  const empty = rows.every(row => row.created === 0 && row.submitted === 0);
const option = useMemo<BosChartOption>(() => ({ ...chartAnimation, color: [chartPalette.navy, chartPalette.emerald], textStyle: { fontFamily: chartFontFamily }, grid: { left: 32, right: 12, top: 40, bottom: 8, containLabel: true }, tooltip: { ...chartTooltip, trigger: "axis", renderMode: "richText", confine: true }, legend: { top: 0, left: 0, orient: "horizontal", align: "left", itemWidth: 18, itemHeight: 10, itemGap: 16, data: ["Created", "Submitted"], textStyle: { ...chartAxisText, lineHeight: 18, color: chartPalette.slate700 } }, xAxis: { type: "category", data: rows.map(row => row.name), axisLabel: { ...chartAxisText, color: chartPalette.slate700, formatter: (value: string) => value.split(" ")[0] }, axisTick: { show: false }, axisLine: { lineStyle: { color: chartPalette.slate300 } } }, yAxis: { type: "value", name: "Cases", nameTextStyle: chartAxisText, nameLocation: "middle", nameGap: 32, min: 0, minInterval: 1, axisLabel: { ...chartAxisText, color: chartPalette.slate700 }, splitLine: chartSplitLine }, series: [{ name: "Created", type: "bar", data: rows.map(row => row.created), barMaxWidth: 32, itemStyle: { opacity: 0.8, borderRadius: [4, 4, 0, 0] } }, { name: "Submitted", type: "line", data: rows.map(row => row.submitted), smooth: false, symbolSize: 7, lineStyle: { width: 2.5 } }] }), [rows]);
  const summary = rows.map(row => `${row.name}: ${row.created} created and ${row.submitted} submitted`).join("; ");
  return <><p className={styles.chartNote}>Last six months · Created and bank-submitted cases</p>{empty ? <div data-testid="tl-trend-chart"><Empty>Insights will appear when activity begins</Empty></div> : <BosChart option={option} height={260} accessibleDescription={`Applications trend. ${summary}`} testId="tl-trend-chart" />}<details className={styles.chartValues}><summary className={focusRing}>View monthly values</summary><dl>{rows.map(row => <div key={row.name}><dt>{row.name}</dt><dd>{row.created} created · {row.submitted} submitted</dd></div>)}</dl></details><Link href={href} className={cx(focusRing, styles.textLink)}>Review cases in selected period</Link></>;
}
function StageChart({ rows, href }: { rows: StageBar[]; href: string }) {
  const maximum = Math.max(1, ...rows.map(row => row.count));
  const summary = rows.map(row => `${row.workflowContext} · ${row.name}: ${row.count}`).join("; ");
  return <div data-testid="tl-stage-chart">{rows.some(row => row.count > 0) ? <><div className={styles.stageChart}><p role="img" aria-label={`Bank stage distribution by workflow context. ${summary}`} className="sr-only">Bank stages</p><p className={styles.chartNote}>All cases in scope · Track: 0–{maximum} {maximum === 1 ? "case" : "cases"}</p>{rows.map(row => <div key={row.stageId} className={styles.stageRow}><div className={styles.stageLabel}><span><strong>{row.name}</strong><small>{row.workflowContext}</small></span><span className={styles.stageValue}>{row.count}<Tooltip label={`About ${row.label}`} text={`${row.workflowContext} · ${row.name}: ${row.count} ${row.count === 1 ? "case" : "cases"}. Stages in different Workflow versions remain separate.`} align="right" /></span></div><div className={styles.countTrack} aria-hidden="true"><span style={{ width: `${row.count / maximum * 100}%` }} /></div></div>)}</div><Link href={href} className={cx(focusRing, styles.textLink)}>Open scoped cases</Link></> : <Empty>Insights will appear when activity begins</Empty>}</div>;
}
function Distribution({ rows, label, testId }: { rows: Bar[]; label: string; testId: string }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const positive = rows.filter(row => row.count > 0);
  const summary = `${label}. ${rows.map(row => `${row.name}: ${row.count}`).join("; ")}`;
  const ring = label === "Product mix" || label === "Bank outcomes";
  const SummaryIcon = label === "Product mix" ? IconPackages : label === "Bank outcomes" ? IconCircleCheck : label === "Delay summary" ? IconClock : IconUsersGroup;
  const option: BosChartOption = { ...chartAnimation, color: COLORS, tooltip: { ...chartTooltip, trigger: "item", renderMode: "richText", confine: true }, series: [{ type: "pie", radius: ["58%", "82%"], center: ["50%", "50%"], label: { show: false }, stillShowZeroSum: false, showEmptyCircle: false, itemStyle: { borderColor: "white", borderWidth: 3, borderRadius: 4 }, emphasis: { scaleSize: 4 }, data: rows.map(row => ({ name: row.name, value: row.count })) }] };
  return <div data-testid={testId}>{total ? <div className={styles.distribution}>
    {ring && positive.length > 1 ? <div className={styles.donut}><BosChart option={option} height={170} accessibleDescription={summary} /><span className={styles.donutTotal} aria-hidden="true"><strong>{total}</strong><small>cases</small></span></div> : positive.length === 1 ? <div className={styles.singleCategory} role="img" aria-label={summary}><span data-amafh-icon-tile="" className={styles.singleIcon}><SummaryIcon aria-hidden="true" /></span><span><strong>{positive[0].count.toLocaleString()}</strong><small>{positive[0].name}</small></span><span className={styles.singleShare}>100%<small>of recorded cases</small></span></div> : <div className={styles.comparisonBars} role="img" aria-label={summary}>{rows.map((row, index) => <div key={row.name}><span>{row.name}</span><div><span style={{ width: `${row.count / Math.max(1, ...rows.map(item => item.count)) * 100}%`, backgroundColor: COLORS[index % COLORS.length] }} /></div><strong>{row.count}</strong></div>)}</div>}
    <dl>{rows.map((row, index) => <div key={row.name}><dt><span aria-hidden="true" style={{ backgroundColor: COLORS[index % COLORS.length] }} />{row.name}</dt><dd><strong>{row.count.toLocaleString()}</strong><span>{formatPct(row.count / total * 100)}</span><Tooltip label={`${label}: ${row.name}`} text={`${row.count} cases; ${formatPct(row.count / total * 100)} of the ${total} recorded cases in this chart.`} align="right" /></dd></div>)}</dl>
    <TlSparkline label={label} metricKey={`${testId}-history`} />
  </div> : <><Empty>Insights will appear when activity begins</Empty><TlSparkline label={label} metricKey={`${testId}-history`} /></>}</div>;
}
function minutes(value: number | null) {
  if (value === null) return "Not recorded";
  const hours = Math.floor(value / 60);
  return hours ? `${hours}h ${value % 60}m` : `${value}m`;
}
function PersonalPanels({ performance, attendance, period, earnings }: { performance: PersonalPerformance; attendance: PersonalAttendance; period: string; earnings: Earnings }) {
  const performanceHistoryId = useId();
  const attendanceHistoryId = useId();
  const target = performance.target;
  const metrics = performance.applicationMetrics;
  const today = attendance.today;
  const recorded = attendance.items.some(item => item.date === today.date);
  function attendanceHistory(field: "workedMinutes" | "lateMinutes" | "earlyDepartureMinutes"): MetricHistory | null {
    if (!["today", "mtd"].includes(period)) return null;
    const lastDate = today.date;
    const firstDate = period === "today" ? lastDate : attendance.month;
    const start = new Date(`${firstDate}T00:00:00Z`);
    const end = new Date(`${lastDate}T00:00:00Z`);
    const points: MetricHistory["points"] = [];
    for (let date = start; date <= end; date = new Date(date.getTime() + 86400000)) {
      const day = date.toISOString().slice(0, 10);
      const row = attendance.items.find(item => item.date === day);
      points.push({ date: day, value: row ? row[field] : null });
    }
    return { unit: "minutes", basis: "Recorded daily attendance; gaps mean not recorded.", points };
  }
  const workedHistory = attendanceHistory("workedMinutes");
  const lateHistory = attendanceHistory("lateMinutes");
  const earlyHistory = attendanceHistory("earlyDepartureMinutes");
  const missingDaily = [["Worked", workedHistory], ["Late arrival", lateHistory], ["Early departure", earlyHistory]] as const;
  const missingDailyLabels = missingDaily.filter(([, history]) => !hasHistory(history)).map(([label]) => label);
  return <section aria-label="My performance and attendance" className={styles.performanceWorkspace}>
    <div className={styles.performanceSnapshot} aria-label="Personal performance snapshot"><Card><span>Cards booked</span><strong>{earnings.cardsBooked}</strong></Card><Card><span>Loans booked</span><strong>{earnings.loansBooked}</strong></Card><Card><span>Today&apos;s attendance</span><strong>{today.status}</strong></Card><Card><span>Worked today</span><strong>{minutes(today.workedMinutes)}</strong></Card></div>
    <div className={styles.personalGrid}>
    <Disclosure title="My Performance" testId="my-performance">
      <EarningsSummary values={earnings} />
      {!target.count && !target.kpi ? <Empty>No performance data for this period</Empty> : <><ul className={styles.personalTargets}>{target.items.map(item => <li key={item.id}><div className={styles.targetHeading}><h3>{item.productName ?? "All products"}</h3><span>{item.milestone.replaceAll("_", " ")} · {item.measurement === "amount" ? "AED" : "Cases"}</span></div><dl className={styles.targetMetrics}><Metric label="Target" value={targetValue(item.result?.effectiveTarget ?? null, item.measurement)} trendKey={`personal-target-${item.id}`} historyNoteId={performanceHistoryId} /><Metric label="Achieved" value={targetValue(item.result?.actual ?? null, item.measurement)} trendKey={`personal-achieved-${item.id}`} historyNoteId={performanceHistoryId} /><Metric label={item.result && Number(item.result.gap) < 0 ? "Exceeded by" : "Remaining"} value={targetValue(item.result ? String(Math.abs(Number(item.result.gap))) : null, item.measurement)} trendKey={`personal-remaining-${item.id}`} historyNoteId={performanceHistoryId} /></dl><Achievement value={item.result?.achievementPct ?? null} label={`${item.productName ?? "All products"} ${item.milestone} target achievement`} /></li>)}</ul><p className={styles.comparison}>Average achievement · This month {formatPct(performance.currentMonthTarget.achievementPct)} <span> / </span> Last month {formatPct(performance.previousMonthTarget.achievementPct)}</p>{target.kpi ? <div className={styles.kpiScore}><h3>{target.kpi.scorecardName}</h3><span data-history="unavailable" aria-describedby={performanceHistoryId}><Badge>KPI score {target.kpi.score}</Badge></span><dl>{target.kpi.components.map(component => <Metric key={component.metric} label={component.label} value={`${component.actual ?? "—"} / ${component.baseline ?? "—"}`} trendKey={`personal-kpi-${component.metric}`} historyNoteId={performanceHistoryId} />)}</dl></div> : null}</>}
      {metrics && metrics.applications.count > 0 ? <p className={styles.comparison}>Cases · This month {metrics.currentMonthApplications} / Last month {metrics.previousMonthApplications}</p> : null}
      {target.count || target.kpi || metrics ? <p id={performanceHistoryId} className={styles.historyNote}>Targets and KPI results reflect the selected period.</p> : null}
    </Disclosure>
    <Disclosure title="My Attendance" testId="my-attendance" aside={<Badge>{today.status}</Badge>}><p className={styles.chartNote}>Today · {today.date} · Read only</p>
      <dl className={styles.dutyMetrics}>
        <Metric prominent missing={!today.scheduledStart || !today.scheduledEnd} label="Duty" value={today.scheduledStart && today.scheduledEnd ? `${today.scheduledStart}–${today.scheduledEnd}` : "Not scheduled"} trendKey="attendance-duty" historyNoteId={attendanceHistoryId} />
        <Metric prominent missing={!today.actualCheckIn} label="Check-in" value={today.actualCheckIn ?? "Not recorded"} trendKey="attendance-check-in" historyNoteId={attendanceHistoryId} />
        <Metric prominent missing={!today.actualCheckOut} label="Check-out" value={today.actualCheckOut ?? "Not recorded"} trendKey="attendance-check-out" historyNoteId={attendanceHistoryId} />
        <Metric prominent missing={today.workedMinutes === null} label="Worked" value={minutes(today.workedMinutes)} trendKey="attendance-worked" history={workedHistory} historyNoteId={attendanceHistoryId} />
      </dl>
      <dl className={styles.attendanceDetails}><Metric label="Late arrival" value={recorded ? minutes(today.lateMinutes) : "Not recorded"} trendKey="attendance-late" history={lateHistory} historyNoteId={attendanceHistoryId} /><Metric label="Early departure" value={recorded ? minutes(today.earlyDepartureMinutes) : "Not recorded"} trendKey="attendance-early" history={earlyHistory} historyNoteId={attendanceHistoryId} /><Metric label="Overtime" value={today.overtimeConfigured ? minutes(today.overtimeMinutes) : "Not configured"} trendKey="attendance-overtime" historyNoteId={attendanceHistoryId} /></dl>
      <div className={styles.monthSummary}><h3>{new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${attendance.month}T00:00:00Z`))}</h3><dl className={styles.personalStats}>{[["Present", attendance.summary.presentCount], ["Absent", attendance.summary.absentCount], ["Late", attendance.summary.lateCount], ["Leave", attendance.summary.leaveCount]].map(([label, value]) => <Metric key={label} label={String(label)} value={value} trendKey={`attendance-month-${String(label).toLowerCase()}`} historyNoteId={attendanceHistoryId} />)}</dl></div>
      <p id={attendanceHistoryId} className={styles.historyNote}>Attendance uses recorded punches and the current schedule.{!["today", "mtd"].includes(period) ? " Choose Today or This Month to view daily attendance trends." : missingDailyLabels.length ? ` No recorded daily values for ${missingDailyLabels.join(", ")} in this period.` : " Missing punches are shown as not recorded."}</p>
      <details className={styles.monthDetail}><summary className={focusRing}>Monthly attendance view ({attendance.items.length})</summary>{attendance.items.length ? <ul>{attendance.items.map(item => <li key={item.id}><div><time>{item.date}</time><Badge>{item.status}</Badge></div><dl className={styles.inlineMetrics}><Metric label="In / Out" value={`${item.checkIn ?? "—"} / ${item.checkOut ?? "—"}`} /><Metric label="Worked" value={minutes(item.workedMinutes)} /></dl></li>)}</ul> : <Empty>No attendance records are available this month.</Empty>}</details>
    </Disclosure>
    </div>
  </section>;
}

export function TlDashboard() {
  const { user } = useAuth();
  const search = useSearchParams();
  const [data, setData] = useState<WorkspacePayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [memberSection, setMemberSection] = useState("cases");
  const section = ["dashboard", "cases", "team", "performance", "timeline"].includes(search.get("workspace") ?? "") ? search.get("workspace")! : "dashboard";
  const view = search.get("view") === "team" || section === "team" ? "team" : "own";
  const period = ["today", "mtd", "previous_month", "ytd"].includes(search.get("period") ?? "") ? search.get("period")! : "mtd";
  const dateFrom = search.get("date_from") ?? "", dateTo = search.get("date_to") ?? "";
  const member = search.get("member_id") ?? "";
  const page = Math.max(1, Number(search.get("page")) || 1);
  const query = new URLSearchParams({ period, view: section === "dashboard" ? "combined" : view, queue: search.get("queue") || "all", page: String(page) });
  for (const key of ["date_from", "date_to", "member_id", "search", "owner_id", "product_id", "stage_id", "outcome"]) {
    if (search.get(key)) query.set(key, search.get(key)!);
  }
  const queryString = query.toString();
  useEffect(() => {
    let active = true;
    setLoading(true);
    apiGet<WorkspacePayload>(`/api/v1/reports/tl-dashboard?${queryString}`, getBrowserApiUrl())
      .then(result => { if (active) { setData(result); setLastUpdatedAt(result.updatedAt); setError(""); } })
      .catch((failure: unknown) => { if (active) { setData(null); setError(failure instanceof Error ? failure.message : "Unable to load TL workspace."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [queryString, reload]);
  useEffect(() => { if (search.get("create") === "1") { setCreateOpen(true); const next = new URLSearchParams(window.location.search); next.delete("create"); window.history.replaceState(null, "", `/reports?${next}`); } }, [search]);
  useEffect(() => { const open = () => setCreateOpen(true); window.addEventListener("nexa-create-case", open); return () => window.removeEventListener("nexa-create-case", open); }, []);
  useEffect(() => {
    const refresh = () => setReload(value => value + 1);
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("nexa-cases-changed", refresh);
    document.addEventListener("visibilitychange", visible);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 30000);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("nexa-cases-changed", refresh); document.removeEventListener("visibilitychange", visible); window.clearInterval(timer); };
  }, []);
  function navigate(changes: Record<string, string>) {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
    next.set("page", changes.page ?? "1");
    if (changes.view) { next.delete("member_id"); next.delete("owner_id"); }
    window.history.pushState(null, "", `/reports?${next}`);
  }
  const visibleStaff = data?.staff.filter(person => !member || person.id === member) ?? [];
  const titles: Record<string, string> = { dashboard: "Dashboard", cases: "Cases", team: "My Team", performance: "Performance & Attendance", timeline: "Timeline" };
  const memberFilter = <Select aria-label="Team member" value={member} onChange={event => navigate({ member_id: event.target.value })}><option value="">All direct SE members</option>{data?.staff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</Select>;
  const ownershipTabs = section !== "dashboard" && section !== "team" ? <div role="tablist" aria-label={section === "performance" ? "Performance ownership" : section === "timeline" ? "Timeline ownership" : "Case ownership"} className={styles.ownershipTabs}>{[{ key: "own", label: section === "performance" ? "My Performance" : section === "timeline" ? "My Timeline" : "My Cases" }, { key: "team", label: section === "performance" ? "Team Performance" : section === "timeline" ? "Team Timeline" : "Team Cases" }].map(item => <Button key={item.key} role="tab" aria-selected={view === item.key} variant={view === item.key ? "primary" : "secondary"} onClick={() => navigate({ view: item.key })}>{item.label}</Button>)}</div> : null;
  const pagination = data && data.total > data.pageSize ? <nav aria-label="Case pagination" className={styles.pagination}><span>Page {data.page} of {Math.ceil(data.total / data.pageSize)} · {data.total} cases</span><div><Button variant="secondary" disabled={loading || page <= 1} onClick={() => navigate({ page: String(page - 1) })}>Previous</Button><Button variant="secondary" disabled={loading || page * data.pageSize >= data.total} onClick={() => navigate({ page: String(page + 1) })}>Next</Button></div></nav> : null;
  const clawbacks = data?.clawbacks.filter(row => (row.ownerRole === "TL") === (view === "own") && (!member || row.ownerId === member)) ?? [];
  const clearFilters = () => navigate(Object.fromEntries(["date_from", "date_to", "member_id", "search", "owner_id", "product_id", "stage_id", "outcome", "case_id", "event_type", "queue"].map(key => [key, ""])));
  const appliedFilters = [
    ["Search", search.get("search")],
    ["Owner", data?.filterOptions.owners.find(item => item.id === search.get("owner_id"))?.name],
    ["Product", data?.filterOptions.products.find(item => item.id === search.get("product_id"))?.name],
    ["Stage", data?.filterOptions.stages.find(item => item.stageId === search.get("stage_id"))?.name],
    ["Outcome", search.get("outcome") ? humanState(search.get("outcome")!) : null],
    ["Queue", search.get("queue") && search.get("queue") !== "all" ? data?.queueLabel : null],
    ["Member", data?.staff.find(item => item.id === member)?.name],
    ["Date range", dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : null],
    ["Case", data?.filterOptions.cases.find(item => item.id === search.get("case_id"))?.name],
    ["Event", search.get("event_type") ? humanState(search.get("event_type")!) : null],
  ].filter((item): item is string[] => Boolean(item[1]));
  const clawbackPanel = clawbacks.length ? <Disclosure title="Case Owner Clawbacks"><ul className={styles.reversalList}>{clawbacks.map((row, index) => <li key={`${row.case}-${row.type}-${index}`}><strong>{row.case} · {row.owner} ({row.ownerRole})</strong><p>{row.type === "card_points" ? "Points" : "Commission"}: {row.original} original · {row.deducted} deducted · {row.net} net</p></li>)}</ul></Disclosure> : <p className={styles.infoEmpty}><IconCircleCheck aria-hidden="true" />No clawbacks recorded for this period.</p>;
  return <section className={styles.dashboard} data-testid="tl-dashboard" data-workspace={section} aria-busy={loading}>
    <PageHeader title={titles[section]} frameTitle={titles[section]} description={data ? `${data.office} · ${data.team}${section === "timeline" && lastUpdatedAt ? ` · Updated ${displayDate(lastUpdatedAt)}` : ""}` : undefined} actions={<div className={styles.sectionActions}>{section !== "timeline" && <Select aria-label="Period" value={period} onChange={event => navigate({ period: event.target.value, date_from: "", date_to: "" })}><option value="today">Today</option><option value="mtd">This Month</option><option value="previous_month">Last Month</option><option value="ytd">YTD</option></Select>}<Button variant="secondary" disabled={loading} onClick={() => setReload(value => value + 1)}>Refresh</Button></div>} />
    {section !== "timeline" && <p className={styles.updateNote} data-testid="tl-last-update">Last update: {lastUpdatedAt ? <time dateTime={lastUpdatedAt}>{new Date(lastUpdatedAt).toLocaleTimeString()}</time> : "—"}</p>}
    <ErrorText>{error}</ErrorText>
    {section !== "dashboard" && section !== "timeline" && <div className={styles.controlSurface}><div className={styles.controlToolbar}>{ownershipTabs}<FilterBar className={styles.scopeFilters}>{view === "team" && memberFilter}<RangeControls label={section === "performance" ? "Performance date range" : "Case date range"} from={dateFrom} to={dateTo} onApply={range => navigate({ date_from: range.from, date_to: range.to })} onClear={clearFilters} /></FilterBar></div>{appliedFilters.length > 0 && <div className={styles.appliedFilters} aria-label="Applied filters"><span>Filtered by</span>{appliedFilters.map(([label, value]) => <Badge key={label}>{label}: {value}</Badge>)}<Button variant="ghost" onClick={clearFilters}>Clear filters</Button></div>}</div>}
    {data ? <div className={styles.workspace}>
      {section === "dashboard" && <>
        <nav className={styles.actionSummary} aria-label="Actionable case summary">{[
          { label: "Needs TL Action", key: "booking", queue: "booking", icon: IconInbox },
          { label: "Pending SM", key: "sm", queue: "stage_sm", icon: IconCircleCheck },
          { label: "With Coordinator", key: "coordinator", queue: "coordinator", icon: IconUsersGroup },
          { label: "Overdue", key: "overdue", queue: "overdue", icon: IconClock },
          { label: "Clawbacks", key: "clawback", queue: "clawback", icon: IconChartBar },
        ].map(({ label, key, queue, icon: Icon }) => {
          const own = key in data.currentWork.own.stages ? data.currentWork.own.stages[key] : Number(data.currentWork.own[key as "booking" | "overdue" | "clawback"]);
          const team = key in data.currentWork.team.stages ? data.currentWork.team.stages[key] : Number(data.currentWork.team[key as "booking" | "overdue" | "clawback"]);
          return <Link key={key} href={`/reports?workspace=cases&view=${team ? "team" : "own"}&queue=${queue}`} className={focusRing} data-tone={key === "overdue" ? "warning" : key === "booking" ? "brand" : "neutral"}><Card className={styles.summaryCard}><span className={styles.summaryLabel}><Icon aria-hidden="true" />{label}</span><strong>{own + team}</strong><small>My {own} · Team {team}{key === "clawback" ? " · In period" : " · Current"}</small></Card></Link>;
        })}</nav>
        <Card className={styles.overviewSurface}><SectionHeader title="Case overview" description="Your cases and direct team, for the selected period" actions={<ButtonLink href="/reports?workspace=cases&queue=all" variant="secondary">View all cases</ButtonLink>} /><div className={styles.overviewColumns}>{[{ title: "My Cases", view: "own", counts: data.ownStatus, work: data.currentWork.own }, { title: "Team Cases", view: "team", counts: data.teamStatus, work: data.currentWork.team }].map(cohort => <section className={styles.overviewColumn} key={cohort.view} data-testid={`tl-${cohort.view}-status`}><div className={styles.overviewIdentity}><span className={styles.eventIcon}>{cohort.view === "team" ? <IconUsersGroup aria-hidden="true" /> : <IconFileDescription aria-hidden="true" />}</span><div><h3>{cohort.title}</h3><p className={styles.muted}>{cohort.view === "own" ? "Owned by you" : "Your direct SE members"}</p></div><Link href={`/reports?workspace=cases&view=${cohort.view}&queue=all`} className={cx(focusRing, styles.overviewTotal)}><strong>{cohort.work.total}</strong><span>{cohort.work.open} open</span></Link></div><dl className={styles.overviewMetrics}>{["Created", "TL Booked", "Bank Submitted", "Completed/Closed"].map(label => <Metric key={label} label={label} value={cohort.counts[label]} />)}</dl></section>)}</div></Card>
        <Disclosure title="Current Workflow" aside={<span className={styles.muted}>Current states · All dates</span>}><p className={styles.muted}>Created → TL Booking → SM Approval → Coordinator → Bank Submitted → Completed</p>{data.currentWork.team.total > 0 && <div className={styles.pipelineGroup}><h3>Team Cases</h3><Pipeline counts={data.currentWork.team} view="team" /></div>}{data.currentWork.own.total > 0 && <div className={styles.pipelineGroup}><h3>My Cases</h3><Pipeline counts={data.currentWork.own} view="own" /></div>}{data.currentWork.own.total + data.currentWork.team.total === 0 && <Empty>No cases yet. Create a case to begin.</Empty>}{["own", "team"].map(cohort => data.currentWork[cohort as "own" | "team"].stages.returned > 0 && <Link key={cohort} className={cx(focusRing, styles.textLink)} href={`/reports?workspace=cases&view=${cohort}&queue=stage_returned`}>{data.currentWork[cohort as "own" | "team"].stages.returned} {cohort === "own" ? "own" : "team"} cases on hold / returned</Link>)}</Disclosure>
        <div className={styles.dashboardMain}><Disclosure title="Pending TL Booking" testId="tl-pending-booking" aside={<span className={styles.countBadge}>{data.currentWork.own.booking + data.currentWork.team.booking}</span>}><Cases compact rows={data.pendingBookingItems} emptyTitle="No cases awaiting TL booking." /><div className={styles.queueShortcuts}><Link className={cx(focusRing, styles.textLink)} href="/reports?workspace=cases&view=own&queue=booking">My booking queue ({data.currentWork.own.booking})</Link><Link className={cx(focusRing, styles.textLink)} href="/reports?workspace=cases&view=team&queue=booking">Team booking queue ({data.currentWork.team.booking})</Link></div></Disclosure><Disclosure title="Recent Case Activity"><ActivityFeed events={data.activity} /><Link className={cx(focusRing, styles.textLink)} href="/reports?workspace=timeline&view=team">Open timeline</Link></Disclosure></div>
        <div className={styles.dashboardMain}><Disclosure title="Team Performance"><dl className={styles.summaryMetrics}><Metric label="Cards booked" value={data.teamEarnings.cardsBooked} /><Metric label="Net points" value={data.teamEarnings.pointsNet} /><Metric label="Loans booked" value={data.teamEarnings.loansBooked} /><Metric label="Net commission" value={formatAed(data.teamEarnings.commissionNet)} /></dl><ul className={styles.teamPreview}>{data.staff.slice(0, 3).map(person => <li key={person.id}><Initials name={person.name} /><Link className={cx(focusRing, styles.fileLink)} href={`/reports?workspace=team&view=team&member_id=${person.id}`}>{person.name}</Link><span>{person.openCases} open · {person.pendingApproval} pending</span></li>)}</ul>{!data.staff.length && <Empty>No direct SE members assigned.</Empty>}<Link className={cx(focusRing, styles.textLink)} href="/reports?workspace=performance&view=team">View team performance</Link></Disclosure><Disclosure title="My Earnings"><dl className={styles.summaryMetrics}><Metric label="Cards booked" value={data.ownEarnings.cardsBooked} /><Metric label="Net points" value={data.ownEarnings.pointsNet} /><Metric label="Loans booked" value={data.ownEarnings.loansBooked} /><Metric label="Net commission" value={formatAed(data.ownEarnings.commissionNet)} /></dl><Link className={cx(focusRing, styles.textLink)} href="/reports?workspace=performance&view=own">View my performance</Link></Disclosure></div>
        {data.charts.trend.some(row => row.created > 0 || row.submitted > 0) && <Disclosure title="CC / PF Insights" defaultOpen={false}><TrendChart rows={data.charts.trend} href="/reports?workspace=cases" /><StageChart rows={data.charts.stages} href="/reports?workspace=cases" /><Distribution rows={data.charts.products} label="Product mix" testId="tl-product-chart" /></Disclosure>}
      </>}
      {section === "cases" && <>
        <details className={styles.filterDrawer}><summary className={focusRing}><IconFilter aria-hidden="true" />Case Filters</summary><FilterBar className={cx(styles.filterGrid, styles.caseFilters)}>
          <Field label="Search"><TextInput aria-label="Search cases" value={search.get("search") ?? ""} onChange={event => navigate({ search: event.target.value })} placeholder="Case, customer or Bank File Number" /></Field>
          <Field label="Case Owner"><Select aria-label="Case Owner" value={search.get("owner_id") ?? ""} onChange={event => navigate({ owner_id: event.target.value })}><option value="">All case owners</option>{data.filterOptions.owners.filter(person => view === "own" ? !data.staff.some(staff => staff.id === person.id) : data.staff.some(staff => staff.id === person.id)).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</Select></Field>
          <Field label="Product"><Select aria-label="Product" value={search.get("product_id") ?? ""} onChange={event => navigate({ product_id: event.target.value })}><option value="">All products</option>{data.filterOptions.products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
          <Field label="Stage"><Select aria-label="Stage" value={search.get("stage_id") ?? ""} onChange={event => navigate({ stage_id: event.target.value })}><option value="">All stages</option>{data.filterOptions.stages.map(item => <option key={item.stageId} value={item.stageId}>{item.workflowContext} · {item.name}</option>)}</Select></Field>
          <Field label="Outcome"><Select aria-label="Outcome" value={search.get("outcome") ?? ""} onChange={event => navigate({ outcome: event.target.value })}><option value="">All outcomes</option><option value="in_progress">In progress</option>{data.filterOptions.outcomes.map(item => <option key={item} value={item}>{item === "Completed" ? "Completed/Closed" : item}</option>)}</Select></Field>
          <Field label="Booking queue"><Select aria-label="Booking queue" value={search.get("queue") ?? "all"} onChange={event => navigate({ queue: event.target.value })}><option value="all">All cases</option><option value="booking">Needs TL booking</option><option value="pending_review">Created · Pending TL booking</option><option value="resubmitted">Resubmitted</option><option value="returned">On Hold/Returned</option><option value="forwarded">Pending SM Approval</option><option value="submitted">Submitted in period</option><option value="funded">Completed/Funded in period</option><option value="overdue">Overdue</option><option value="clawback">Clawbacks in period</option>{PIPELINE.map(item => <option key={item.key} value={`stage_${item.key}`}>Current · {item.label}</option>)}<option value="stage_returned">Current · On Hold/Returned</option><option value="stage_closed">Current · Other Closed Outcomes</option><option value="coordinator">With Coordinator</option></Select></Field>
        </FilterBar></details>
        <Disclosure title={view === "own" ? "My Cases" : "Team Cases"} testId="tl-review-queue" aside={<span>{data.total} cases</span>}><Cases rows={data.items} selectedQueue emptyTitle="No records match the selected filters" emptyHint="Clear filters or choose another ownership view." />{pagination}</Disclosure>
      </>}
      {section === "team" && <>
        <Card className={styles.teamSurface}><SectionHeader title="Team structure" description="Sales Manager, Team Leader and direct team members" actions={<Badge>{data.staff.length} team members</Badge>} /><div className={styles.managerTrail}>{[{ name: data.hierarchy.salesManager ?? "Sales Manager not assigned", role: "SM" }, { name: data.hierarchy.teamLeader, role: "TL" }].map(person => <div className={styles.managerPill} key={person.role}><Initials name={person.name} /><span><strong>{person.name}</strong><small>{person.role}</small></span></div>)}</div><ul className={styles.memberDirectory}>{data.staff.map(person => <li key={person.id}><Card className={styles.memberCard} data-selected={member === person.id}><button className={cx(focusRing, styles.memberSelect)} aria-label={`${person.name} · SE`} aria-pressed={member === person.id} onClick={() => { setMemberSection("cases"); navigate({ member_id: member === person.id ? "" : person.id, queue: "all" }); }}><ProfilePhoto userId={person.id} fullName={person.name} hasPhoto={person.hasPhoto} version={person.photoUpdatedAt} size="list" className={styles.avatar} /><span><strong>{person.name}</strong><small className={styles.roleBadge}>Sales Executive</small></span><IconChevronDown aria-hidden="true" className="size-4" /></button><dl className={styles.memberCardFacts}>{[["Open", person.openCases], ["Pending", person.pendingApproval], ["Submitted", person.submitted], ["Completed", person.completed]].map(([label, value]) => <Metric key={label} label={String(label)} value={value} />)}</dl><p className={styles.memberCardFoot}>{person.earnings.pendingCases} current workload · {person.delayed} delayed</p></Card></li>)}</ul>{!data.staff.length && <Empty>No direct SE members assigned.</Empty>}</Card>
        {member ? <section className={styles.memberWorkspace}><Card className={styles.memberDetailToolbar}><SectionHeader title={visibleStaff[0]?.name ?? "Selected team member"} description="Authorized team member details" /><div role="tablist" aria-label="Selected member details" className={styles.ownershipTabs}>{["cases", "performance", "attendance", "clawbacks"].map(item => <Button key={item} role="tab" aria-selected={memberSection === item} variant={memberSection === item ? "primary" : "secondary"} onClick={() => setMemberSection(item)}>{humanState(item)}</Button>)}</div></Card>{memberSection === "cases" && <Disclosure title="Selected Member Cases"><Cases rows={data.items} emptyTitle="No cases for this member." />{pagination}</Disclosure>}{memberSection === "performance" && <Disclosure title="Selected Member Performance"><TeamPerformance staff={visibleStaff} /></Disclosure>}{memberSection === "attendance" && visibleStaff.map(person => <StaffAttendance key={person.id} person={person} />)}{memberSection === "clawbacks" && clawbackPanel}</section> : <Empty>Select an SE to review their cases, performance, attendance and clawbacks.</Empty>}
      </>}
      {section === "performance" && (view === "own" ? <><p className={styles.infoEmpty}><IconInbox aria-hidden="true" />No appraisal results available</p><PersonalPanels performance={data.personalPerformance} attendance={data.personalAttendance} period={period} earnings={data.ownEarnings} />{clawbackPanel}</> : <><Disclosure title="Team Summary"><p className={styles.muted}>Direct SE members · Your own performance remains separate</p><EarningsSummary values={data.teamEarnings} /></Disclosure><Disclosure title="Team Performance & Attendance" testId="tl-team-performance"><TeamPerformance staff={visibleStaff} /></Disclosure>{clawbackPanel}</>)}
      {section === "timeline" && (loading ? <LoadingState>Loading authorized cases…</LoadingState> : <TlCaseTimeline caseOptions={data.filterOptions.cases} staff={data.staff} view={view} />)}
    </div> : loading ? <LoadingState>Loading TL workspace…</LoadingState> : null}
    <ApplicationCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={created => { setCreateOpen(false); setReload(value => value + 1); navigate({ workspace: "cases", view: created.caseOwnerId === user?.id ? "own" : "team", queue: "booking" }); }} />
  </section>;
}
