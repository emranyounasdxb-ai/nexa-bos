"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { BosChart, type BosChartOption } from "@/components/charts/bos-chart";
import { chartAnimation, chartAxisText, chartFontFamily, chartPalette, chartSplitLine, chartTooltip } from "@/components/charts/chart-theme";
import { IconChevronDown } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { Badge, Button, ErrorText, Field, Select, cx, focusRing, primaryButtonClass } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import { formatDuration } from "@/lib/duration";
import { formatAed, formatPct, type PersonalAttendance, type PersonalPerformance } from "@/lib/reports";
import styles from "./tl-dashboard.module.css";

type Case = { id: string; fileNumber: string; customer: string; caseOwner: string; bank: string; product: string; requestedAmount: string | null; routingLabel: string; bankStage: string; bankNumber: string | null; tatSeconds: number; delayed: boolean; updatedAt: string; reason: string | null; canReview: boolean };
type Bar = { name: string; count: number };
type StageBar = Bar & { stageId: string; label: string; workflowContext: string };
type Trend = { name: string; created: number; submitted: number };
type Staff = { id: string; name: string; applications: number; cc: number; pf: number; submitted: number; approved: number; funded: number; conversion: number | null; pendingReview: number; target: { assigned: string | null; achieved: string | null; remaining: string | null; achievementPct: number | null; measurement: string | null } };
type Payload = { office: string; team: string; updatedAt: string; period: string; view: string; queue: string; queueLabel: string; cards: Array<{ key: string; label: string; count: number }>; items: Case[]; total: number; page: number; pageSize: number; attention: Case[]; returned: Case[]; charts: { trend: Trend[]; ownership: Bar[]; review: Bar[]; stages: StageBar[]; products: Bar[]; outcomes: Bar[]; tat: Bar[] }; staff: Staff[]; activity: Array<{ id: string; fileNumber: string; applicationId: string; event: string; at: string; reason: string | null }>; personalPerformance: PersonalPerformance; personalAttendance: PersonalAttendance };

const TABS = [{ key: "review", label: "Review" }, { key: "team", label: "Team Performance" }, { key: "analytics", label: "Analytics" }, { key: "personal", label: "My Performance & Attendance" }] as const;
type TabKey = (typeof TABS)[number]["key"];
const PRIORITY = ["pending_review", "resubmitted", "returned", "forwarded"];
const COLORS = [chartPalette.navy, chartPalette.blue, chartPalette.emerald, chartPalette.amber, chartPalette.slate500];

function Disclosure({ title, children, defaultOpen = true, testId, className, aside, expanded, onExpandedChange }: { title: string; children: ReactNode; defaultOpen?: boolean; testId?: string; className?: string; aside?: ReactNode; expanded?: boolean; onExpandedChange?: (value: boolean) => void }) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = expanded ?? localOpen;
  const id = useId();
  return <section className={cx(styles.panel, className)} data-testid={testId}>
    <h2 className={styles.panelHeading}><button type="button" aria-expanded={open} aria-controls={id} onClick={() => { setLocalOpen(!open); onExpandedChange?.(!open); }} className={cx(focusRing, styles.disclosure)}><span>{title}</span><span className={styles.disclosureAside}>{aside}<IconChevronDown aria-hidden="true" className={cx("size-4 shrink-0 transition-transform", open && "rotate-180")} /></span></button></h2>
    {open ? <div id={id} className={styles.panelBody}>{children}</div> : null}
  </section>;
}
function Empty({ children }: { children: ReactNode }) { return <p className={styles.empty}>{children}</p>; }
function Metric({ label, value, prominent = false }: { label: string; value: ReactNode; prominent?: boolean }) {
  return <div className={cx(styles.metric, prominent && styles.prominentMetric)}><dt>{label}</dt><dd>{value}</dd></div>;
}
function Cases({ rows, compact = false }: { rows: Case[]; compact?: boolean }) {
  if (!rows.length) return <Empty>No Applications in this queue.</Empty>;
  return <ul className={cx(styles.caseList, compact && styles.compactCases)}>{rows.map(item => <li key={item.id} className={styles.caseRow}>
    <div className={styles.caseIdentity}><Link className={cx(focusRing, styles.fileLink)} href={`/applications/${item.id}`}>{item.fileNumber}</Link><span className={styles.customer}>{item.customer}</span><span className={styles.muted}>{item.caseOwner}</span></div>
    <div className={styles.caseProduct}><span>{item.bank}</span><span className={styles.muted}>{item.product}</span><span className={styles.muted}>{item.bankNumber ?? "Bank number not assigned"}</span></div>
    <div className={styles.caseStatus}><Badge>{item.routingLabel}</Badge><span>{item.bankStage}</span><span className={styles.waiting}>{item.delayed ? <span className={styles.delayed}>Delayed · </span> : null}{formatDuration(item.tatSeconds)} <span className={styles.muted}>case age</span></span></div>
    <div className={styles.caseActions}>{item.canReview ? <><Link href={`/applications/${item.id}?tab=actions#internal-review`} className={cx(focusRing, styles.forward)}>Forward to COD</Link><Link href={`/applications/${item.id}?tab=actions#internal-review`} className={cx(focusRing, styles.textLink)}>Return to SE</Link></> : <Link href={`/applications/${item.id}`} className={cx(focusRing, styles.textLink)}>Open Application</Link>}</div>
    <details className={styles.caseDetails}><summary className={focusRing}>Case details</summary><dl className={styles.inlineMetrics}><Metric label="Requested amount" value={formatAed(item.requestedAmount)} /><Metric label="Last updated" value={new Date(item.updatedAt).toLocaleString()} /></dl>{item.reason ? <p className={styles.returnReason}>Return reason: {item.reason}</p> : null}</details>
  </li>)}</ul>;
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
function TeamPerformance({ staff }: { staff: Staff[] }) {
  if (!staff.length) return <Empty>No SEs are currently assigned to this team.</Empty>;
  return <div data-testid="tl-member-targets"><ul className={styles.memberList}>{staff.map(person => {
    const target = person.target;
    const missing = target.achievementPct === null && target.assigned === null;
    const mixed = !missing && target.measurement === null;
    return <li key={person.id} data-testid={`tl-staff-row-${person.id}`} className={styles.memberRow}>
      <div className={styles.memberIdentity}><span aria-hidden="true" className={styles.avatar}>{person.name.split(" ").filter(Boolean).slice(0, 2).map(part => part[0]).join("")}</span><div><h3>{person.name}</h3><p className={styles.muted}>{missing ? "Target results unavailable" : mixed ? "Mixed target units · Average achievement" : `${target.measurement === "amount" ? "AED value" : "Application count"} · Average achievement`}</p></div>{!missing ? <Tooltip label={`Target basis for ${person.name}`} text="Achievement is the average of assigned target percentages at their configured milestones. Amount and count totals are kept separate. A full track is 100%; any overachievement is shown above it." align="right" /> : null}</div>
      <div className={styles.memberTarget}><dl className={styles.targetMetrics}><Metric label="Assigned" value={targetValue(target.assigned, target.measurement)} /><Metric label="Achieved" value={targetValue(target.achieved, target.measurement)} /><Metric label={target.remaining !== null && Number(target.remaining) < 0 ? "Exceeded by" : "Remaining"} value={targetValue(target.remaining === null ? null : String(Math.abs(Number(target.remaining))), target.measurement)} /></dl>{mixed ? <p className={styles.muted}>Totals are not combined across units.</p> : null}</div>
      <div className={styles.memberProgress}>{missing ? <p className={styles.muted}>Target results unavailable</p> : <Achievement value={target.achievementPct} label={`${person.name} target achievement`} />}</div>
      <dl className={styles.memberStats}>{[["Applications", person.applications], ["CC / PF", `${person.cc} / ${person.pf}`], ["Submitted", person.submitted], ["Bank Approved", person.approved], ["Funded", person.funded], ["Conversion", formatPct(person.conversion)], ["Pending Review", person.pendingReview]].map(([label, value]) => <Metric key={label} label={String(label)} value={value} />)}</dl>
    </li>;
  })}</ul></div>;
}
function TrendChart({ rows, href }: { rows: Trend[]; href: string }) {
  const empty = rows.every(row => row.created === 0 && row.submitted === 0);
  const option = useMemo<BosChartOption>(() => ({ ...chartAnimation, color: [chartPalette.navy, chartPalette.emerald], textStyle: { fontFamily: chartFontFamily }, grid: { left: 6, right: 12, top: 38, bottom: 8, containLabel: true }, tooltip: { ...chartTooltip, trigger: "axis", renderMode: "richText", confine: true }, legend: { top: 0, left: 0, data: ["Created", "Submitted"], textStyle: { ...chartAxisText, color: chartPalette.slate700 } }, xAxis: { type: "category", data: rows.map(row => row.name), axisLabel: { ...chartAxisText, color: chartPalette.slate700, formatter: (value: string) => value.split(" ")[0] }, axisTick: { show: false }, axisLine: { lineStyle: { color: chartPalette.slate300 } } }, yAxis: { type: "value", name: "Cases", min: 0, minInterval: 1, axisLabel: { ...chartAxisText, color: chartPalette.slate700 }, splitLine: chartSplitLine }, series: [{ name: "Created", type: "bar", data: rows.map(row => row.created), barMaxWidth: 32, itemStyle: { opacity: 0.8, borderRadius: [4, 4, 0, 0] } }, { name: "Submitted", type: "line", data: rows.map(row => row.submitted), smooth: false, symbolSize: 7, lineStyle: { width: 2.5 } }] }), [rows]);
  const summary = rows.map(row => `${row.name}: ${row.created} created and ${row.submitted} submitted`).join("; ");
  return <><p className={styles.chartNote}>Last six months · Created and bank-submitted cases</p>{empty ? <div data-testid="tl-trend-chart"><Empty>No created or submitted Applications in this six-month range.</Empty></div> : <BosChart option={option} height={260} accessibleDescription={`Applications trend. ${summary}`} testId="tl-trend-chart" />}<details className={styles.chartValues}><summary className={focusRing}>View monthly values</summary><dl>{rows.map(row => <div key={row.name}><dt>{row.name}</dt><dd>{row.created} created · {row.submitted} submitted</dd></div>)}</dl></details><Link href={href} className={cx(focusRing, styles.textLink)}>Review cases in selected period</Link></>;
}
function StageChart({ rows, href }: { rows: StageBar[]; href: string }) {
  const maximum = Math.max(1, ...rows.map(row => row.count));
  const summary = rows.map(row => `${row.workflowContext} · ${row.name}: ${row.count}`).join("; ");
  return <div data-testid="tl-stage-chart">{rows.some(row => row.count > 0) ? <><div className={styles.stageChart}><p role="img" aria-label={`Bank stage distribution by workflow context. ${summary}`} className="sr-only">Bank stages</p><p className={styles.chartNote}>All cases in scope · Track: 0–{maximum} {maximum === 1 ? "case" : "cases"}</p>{rows.map(row => <div key={row.stageId} className={styles.stageRow}><div className={styles.stageLabel}><span><strong>{row.name}</strong><small>{row.workflowContext}</small></span><span className={styles.stageValue}>{row.count}<Tooltip label={`About ${row.label}`} text={`${row.workflowContext} · ${row.name}: ${row.count} ${row.count === 1 ? "case" : "cases"}. Stages in different Workflow versions remain separate.`} align="right" /></span></div><div className={styles.countTrack} aria-hidden="true"><span style={{ width: `${row.count / maximum * 100}%` }} /></div></div>)}</div><Link href={href} className={cx(focusRing, styles.textLink)}>Open scoped cases</Link></> : <Empty>No cases at a bank stage yet.</Empty>}</div>;
}
function Distribution({ rows, label, testId }: { rows: Bar[]; label: string; testId: string }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return <div data-testid={testId}>{total ? <div className={styles.distribution}><div className={styles.distributionTrack} role="img" aria-label={`${label}. ${rows.map(row => `${row.name}: ${row.count}`).join("; ")}`}>{rows.map((row, index) => <span key={row.name} style={{ width: `${row.count / total * 100}%`, backgroundColor: COLORS[index % COLORS.length] }} />)}</div><dl>{rows.map((row, index) => <div key={row.name}><dt><span aria-hidden="true" style={{ backgroundColor: COLORS[index % COLORS.length] }} />{row.name}</dt><dd><strong>{row.count.toLocaleString()}</strong><span>{formatPct(row.count / total * 100)}</span></dd></div>)}</dl></div> : <Empty>No {label.toLowerCase()} data in this scope.</Empty>}</div>;
}
function minutes(value: number | null) {
  if (value === null) return "Not recorded";
  const hours = Math.floor(value / 60);
  return hours ? `${hours}h ${value % 60}m` : `${value}m`;
}
function PersonalPanels({ performance, attendance }: { performance: PersonalPerformance; attendance: PersonalAttendance }) {
  const target = performance.target;
  const metrics = performance.applicationMetrics;
  const today = attendance.today;
  const recorded = attendance.items.some(item => item.date === today.date);
  return <section aria-label="My performance and attendance" className={styles.personalGrid}>
    <Disclosure title="My Performance" testId="my-performance">
      {!target.count && !target.kpi ? <Empty>No target or KPI scorecard is assigned for this period.</Empty> : <><ul className={styles.personalTargets}>{target.items.map(item => <li key={item.id}><div className={styles.targetHeading}><h3>{item.productName ?? "All products"}</h3><span>{item.milestone.replaceAll("_", " ")} · {item.measurement === "amount" ? "AED" : "Cases"}</span></div><dl className={styles.targetMetrics}><Metric label="Target" value={targetValue(item.result?.effectiveTarget ?? null, item.measurement)} /><Metric label="Achieved" value={targetValue(item.result?.actual ?? null, item.measurement)} /><Metric label={item.result && Number(item.result.gap) < 0 ? "Exceeded by" : "Remaining"} value={targetValue(item.result ? String(Math.abs(Number(item.result.gap))) : null, item.measurement)} /></dl><Achievement value={item.result?.achievementPct ?? null} label={`${item.productName ?? "All products"} ${item.milestone} target achievement`} /></li>)}</ul><p className={styles.comparison}>Average achievement · This month {formatPct(performance.currentMonthTarget.achievementPct)} <span> / </span> Last month {formatPct(performance.previousMonthTarget.achievementPct)}</p>{target.kpi ? <div className={styles.kpiScore}><h3>{target.kpi.scorecardName}</h3><Badge>KPI score {target.kpi.score}</Badge><dl>{target.kpi.components.map(component => <Metric key={component.metric} label={component.label} value={`${component.actual ?? "—"} / ${component.baseline ?? "—"}`} />)}</dl></div> : null}</>}
      {metrics ? <div className={styles.personalApplications}><h3>My application performance</h3><p className={styles.comparison}>This month {metrics.currentMonthApplications} <span> / </span> Last month {metrics.previousMonthApplications}</p><dl className={styles.personalStats}>{[["Applications", metrics.applications.count], ["Submitted", metrics.submitted.count], ["Bank Approved", metrics.approved.count], ["Funded", metrics.funded.count], ["Rejected", metrics.rejected.count], ["Pending", metrics.pending.count], ["Credit Card", metrics.creditCard.count], ["Personal Finance", metrics.personalFinance.count]].map(([label, value]) => <Metric key={label} label={String(label)} value={value} />)}</dl></div> : null}
    </Disclosure>
    <Disclosure title="My Attendance" testId="my-attendance" aside={<Badge>{today.status}</Badge>}><p className={styles.chartNote}>Today · {today.date} · Read only</p><dl className={styles.dutyMetrics}><Metric prominent label="Duty" value={today.scheduledStart && today.scheduledEnd ? `${today.scheduledStart}–${today.scheduledEnd}` : "Not scheduled"} /><Metric prominent label="Check-in" value={today.actualCheckIn ?? "Not recorded"} /><Metric prominent label="Check-out" value={today.actualCheckOut ?? "Not recorded"} /><Metric prominent label="Worked" value={minutes(today.workedMinutes)} /></dl><dl className={styles.attendanceDetails}><Metric label="Late arrival" value={recorded ? minutes(today.lateMinutes) : "Not recorded"} /><Metric label="Early departure" value={recorded ? minutes(today.earlyDepartureMinutes) : "Not recorded"} /><Metric label="Overtime" value={today.overtimeConfigured ? minutes(today.overtimeMinutes) : "Not configured"} /></dl><div className={styles.monthSummary}><h3>{new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${attendance.month}T00:00:00Z`))}</h3><dl className={styles.personalStats}>{[["Present", attendance.summary.presentCount], ["Absent", attendance.summary.absentCount], ["Late", attendance.summary.lateCount], ["Leave", attendance.summary.leaveCount]].map(([label, value]) => <Metric key={label} label={String(label)} value={value} />)}</dl></div><details className={styles.monthDetail}><summary className={focusRing}>Monthly attendance view ({attendance.items.length})</summary>{attendance.items.length ? <ul>{attendance.items.map(item => <li key={item.id}><div><time>{item.date}</time><Badge>{item.status}</Badge></div><dl className={styles.inlineMetrics}><Metric label="In / Out" value={`${item.checkIn ?? "—"} / ${item.checkOut ?? "—"}`} /><Metric label="Worked" value={minutes(item.workedMinutes)} /></dl></li>)}</ul> : <Empty>No attendance records are available this month.</Empty>}</details></Disclosure>
  </section>;
}

export function TlDashboard() {
  const { can } = useAuth(); const search = useSearchParams();
  const [data, setData] = useState<Payload | null>(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [reload, setReload] = useState(0);
  const queueHeading = useRef<HTMLHeadingElement>(null); const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [queueOpen, setQueueOpen] = useState(true);
  const [queueFocusRequest, setQueueFocusRequest] = useState(0);
  const period = ["today", "mtd", "previous_month", "ytd"].includes(search.get("period") ?? "") ? search.get("period")! : "mtd";
  const view = ["own", "team", "combined"].includes(search.get("view") ?? "") ? search.get("view")! : "combined";
  const tab = (TABS.some(item => item.key === search.get("tab")) ? search.get("tab") : "review") as TabKey;
  const queue = search.get("queue") || "pending_review"; const page = Math.max(1, Number(search.get("page")) || 1);
  const query = new URLSearchParams({ period, view, queue, page: String(page) }).toString();
  useEffect(() => { let active = true; setLoading(true); apiGet<Payload>(`/api/v1/reports/tl-dashboard?${query}`, getBrowserApiUrl()).then(result => { if (active) { setData(result); setError(""); } }).catch((failure: unknown) => { if (active) { setData(null); setError(failure instanceof Error ? failure.message : "Unable to load TL dashboard."); } }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [query, reload]);
  function navigate(changes: Record<string, string>) {
    // Native history integrates with Next search params and commits consecutive filter changes synchronously.
    const next = new URLSearchParams(window.location.search);
    next.set("tab", changes.tab ?? next.get("tab") ?? tab); next.set("period", changes.period ?? next.get("period") ?? period); next.set("view", changes.view ?? next.get("view") ?? view); next.set("queue", changes.queue ?? next.get("queue") ?? queue); next.set("page", changes.page ?? "1");
    const href = `/reports?${next}`;
    if (`${window.location.pathname}${window.location.search}` !== href) window.history.pushState(null, "", href);
  }
  function selectTab(next: TabKey, focus = false) { if (next === "review") setQueueOpen(true); navigate({ tab: next }); if (focus) requestAnimationFrame(() => tabRefs.current[TABS.findIndex(item => item.key === next)]?.focus()); }
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length; selectTab(TABS[nextIndex].key, true); }
  function chooseQueue(key: string) { setQueueOpen(true); setQueueFocusRequest(value => value + 1); navigate({ queue: key }); }
  useEffect(() => { if (queueFocusRequest && queueOpen && !loading && queueHeading.current) { queueHeading.current.focus(); setQueueFocusRequest(0); } }, [queueFocusRequest, queueOpen, loading]);
  useEffect(() => { if (tab === "review") setQueueOpen(true); }, [tab]);
  const cards = data ? PRIORITY.flatMap(key => data.cards.filter(card => card.key === key)) : [];
  const bankCards = data?.cards.filter(card => !PRIORITY.includes(card.key)) ?? [];
  const cardLabel = (card: { key: string; label: string }) => card.key === "approved" ? "Bank Approved" : card.key === "forwarded" ? "Forwarded to COD" : card.label;
  const reviewHref = (key = "active") => `/reports?${new URLSearchParams({ tab: "review", period, view, queue: key, page: "1" })}`;
  return <section className={styles.dashboard} data-testid="tl-dashboard" aria-busy={loading}>
    <div className={styles.toolbar}><div className={styles.context}><p>{data?.office ?? "Loading office…"} · {data?.team ?? "Loading team…"}</p><span>My Team <span aria-hidden="true">·</span> {loading ? "Updating…" : data ? `Updated ${new Date(data.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Unavailable"}</span></div><div className={styles.toolbarControls}><Field label="Period"><Select aria-label="Period" value={period} onChange={event => navigate({ period: event.target.value })}><option value="today">Today</option><option value="mtd">This Month</option><option value="previous_month">Last Month</option><option value="ytd">YTD</option></Select></Field><Field label="Scope"><Select aria-label="Scope" value={view} onChange={event => navigate({ view: event.target.value })}><option value="own">My Cases</option><option value="team">Team Cases</option><option value="combined">Combined</option></Select></Field><Button variant="secondary" disabled={loading} onClick={() => setReload(value => value + 1)}>Refresh</Button>{can("Applications.Create") ? <Link className={primaryButtonClass} href="/applications?create=true">Create Application</Link> : null}</div></div>
    <ErrorText>{error}</ErrorText>
    <div role="tablist" aria-label="Team Leader dashboard workspaces" className={styles.tabs}>{TABS.map((item, index) => <button ref={node => { tabRefs.current[index] = node; }} key={item.key} type="button" role="tab" id={`tl-tab-${item.key}`} aria-controls={`tl-panel-${item.key}`} aria-selected={tab === item.key} tabIndex={tab === item.key ? 0 : -1} onClick={() => selectTab(item.key)} onKeyDown={event => onTabKeyDown(event, index)} className={cx(focusRing, styles.tab)}>{item.label}</button>)}</div>
    {data ? <div role="tabpanel" id={`tl-panel-${tab}`} aria-labelledby={`tl-tab-${tab}`} className={styles.workspace}>
      {tab === "review" ? <><div className={styles.cards} data-testid="tl-cards">{cards.map(card => <button type="button" key={card.key} aria-label={`${cardLabel(card)} queue`} aria-pressed={queue === card.key} onClick={() => chooseQueue(card.key)} className={cx(focusRing, styles.kpiCard)}><span>{cardLabel(card)}</span><strong>{card.count.toLocaleString()}</strong><small>{card.key === "forwarded" ? "Internal review complete" : card.key === "returned" ? "Awaiting SE correction" : card.key === "resubmitted" ? "Ready for another look" : "Ready for your review"}</small></button>)}</div>
        <div className={styles.bankStrip} data-testid="tl-bank-status" aria-label="Bank status">{bankCards.map(card => <button type="button" key={card.key} className={cx(focusRing, styles.bankMetric)} aria-label={`${cardLabel(card)} queue`} aria-pressed={queue === card.key} onClick={() => chooseQueue(card.key)}><span>{cardLabel(card)}</span><strong>{card.count.toLocaleString()}</strong></button>)}</div>
        <div className={styles.reviewGrid}><div className={styles.queueColumn}><Disclosure expanded={queueOpen} onExpandedChange={setQueueOpen} title={`${data.queueLabel} · Review queue`} testId="tl-review-queue" aside={<span className={styles.rowCount}>{data.total} cases</span>}><h2 ref={queueHeading} tabIndex={-1} className="sr-only">{data.queueLabel} review queue</h2><Cases rows={data.items} />{data.total > data.pageSize ? <nav aria-label="Review queue pagination" className={styles.pagination}><span>Page {data.page} of {Math.ceil(data.total / data.pageSize)}</span><div><Button variant="secondary" disabled={loading || page <= 1} onClick={() => navigate({ page: String(page - 1) })}>Previous</Button><Button variant="secondary" disabled={loading || page * data.pageSize >= data.total} onClick={() => navigate({ page: String(page + 1) })}>Next</Button></div></nav> : null}</Disclosure><Disclosure title="Returned · Awaiting correction" defaultOpen={false}><Cases rows={data.returned} /></Disclosure></div><aside className={styles.activityColumn}><Disclosure title="Recent team activity">{!data.activity.length ? <Empty>No recorded activity.</Empty> : <ol className={styles.activity}>{data.activity.map(event => <li key={event.id}><Link className={cx(focusRing, styles.fileLink)} href={`/applications/${event.applicationId}`}>{event.fileNumber}</Link><p>{event.event.replaceAll("_", " ")}</p>{event.reason ? <p className={styles.muted}>{event.reason}</p> : null}<time>{new Date(event.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></li>)}</ol>}</Disclosure><Disclosure title="Attention Required"><Cases rows={data.attention} compact /></Disclosure></aside></div>
      </> : null}
      {tab === "team" ? <><Disclosure title="Team targets & performance" testId="tl-team-performance" aside={<span className={styles.rowCount}>{data.staff.length} members</span>}><TeamPerformance staff={data.staff} /></Disclosure><Disclosure title="My vs Team Applications" defaultOpen={false}><Distribution rows={data.charts.ownership} label="My versus team Applications" testId="tl-ownership-chart" /></Disclosure></> : null}
      {tab === "analytics" ? <div className={styles.analyticsGrid}><Disclosure title="Applications trend" className={styles.trendPanel}><TrendChart rows={data.charts.trend} href={reviewHref("all")} /></Disclosure><Disclosure title="Bank Stage tracker" className={styles.stagePanel}><StageChart rows={data.charts.stages} href={reviewHref()} /></Disclosure><Disclosure title="Product mix"><p className={styles.chartNote}>Created in selected period</p><Distribution rows={data.charts.products} label="Product mix" testId="tl-product-chart" /></Disclosure><Disclosure title="Bank outcomes"><p className={styles.chartNote}>Cases created in selected period</p><Distribution rows={data.charts.outcomes} label="Bank outcomes" testId="tl-outcome-chart" /><Link href={reviewHref("approved")} className={cx(focusRing, styles.textLink)}>Review bank-approved cases</Link></Disclosure><Disclosure title="Waiting time & delays"><p className={styles.chartNote}>Active cases · Recorded delays</p><Distribution rows={data.charts.tat} label="Delay summary" testId="tl-tat-chart" /><Link href={reviewHref()} className={cx(focusRing, styles.textLink)}>Review active cases</Link></Disclosure><Disclosure title="Internal Review tracker" className={styles.internalPanel} defaultOpen={false}><p className={styles.chartNote}>All cases in scope · Internal routing</p><Distribution rows={data.charts.review} label="Internal review" testId="tl-review-chart" /></Disclosure></div> : null}
      {tab === "personal" ? <PersonalPanels performance={data.personalPerformance} attendance={data.personalAttendance} /> : null}
    </div> : loading ? <Empty>Loading Team Leader dashboard…</Empty> : null}
  </section>;
}
