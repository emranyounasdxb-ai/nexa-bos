"use client";

import { Fragment, useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorText } from "@/components/ui";
import { apiDownload } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { AssetHistoryRecord } from "@/lib/types";
import styles from "./lifecycle.module.css";

type Actor = { id?: string | null; name?: string | null; code?: string | null; designation?: string | null; office?: string | null; actionAt?: string | null; source?: string };
type Period = {
  id: string; kind: string; title: string; from: string | null; to: string | null;
  precision: "date" | "timestamp"; active: boolean; durationSeconds: number | null;
  durationDays: number | null; effectiveDate?: string | null; recordedAt?: string;
  office?: string | null; employee?: string | null; employeeCode?: string | null;
  location?: string | null; performedBy?: string | null; receivedBy?: string | null;
  condition?: string | null; endCondition?: string | null; status?: string | null;
  actor?: Actor | null; endActor?: Actor | null; endReason?: string | null; endActionCode?: string; actionCode?: string; excludedFromTotals?: boolean;
  reason?: string | null; note?: string | null; endNote?: string | null; contextSource?: string;
};
type Lifecycle = {
  registeredAt: string; asOf: string; assignments: number; assignedDays: number;
  assignedComplete: boolean; assigned: { seconds: number; complete: boolean }; stock: { seconds: number; complete: boolean };
  repair: { seconds: number; complete: boolean }; hasLegacyGaps: boolean; timeline: Period[];
};
export type LifecycleHistoryRecord = AssetHistoryRecord & { lifecycle?: Lifecycle };
const missing = "Not recorded";
function calendarDate(value: string | null | undefined) {
  if (!value) return missing;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function duration(seconds: number | null | undefined) {
  if (seconds == null) return missing;
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  return days ? `${days} ${days === 1 ? "day" : "days"}${hours ? ` ${hours} hr` : ""}` : hours ? `${hours} ${hours === 1 ? "hour" : "hours"}${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;
}
function Facts({ entries }: { entries: Array<[string, string | null | undefined]> }) {
  return <dl className={styles.facts}>{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || missing}</dd></div>)}</dl>;
}

function timestamp(value: string | null | undefined) {
  if (!value) return missing;
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).replace("Sept", "Sep").replace("am", "AM").replace("pm", "PM");
}
function stageLabel(row: Period) {
  return row.actionCode === "asset.office.transfer" ? "Office/Location Transfer" : row.title;
}
function periodLabel(row: Period) {
  const from = row.precision === "date" ? calendarDate(row.from) : timestamp(row.from);
  if (row.active) return `${from} → Current`;
  const sameDay = row.precision === "timestamp" && row.from && row.to && new Date(row.from).toDateString() === new Date(row.to).toDateString();
  const to = sameDay ? new Date(row.to!).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase() : row.precision === "date" ? calendarDate(row.to) : timestamp(row.to);
  return `${from} → ${to}`;
}
function ActorDetails({ label, actor, open = false }: { label: string; actor?: Actor | null; open?: boolean }) {
  return <section className={styles.detailSection}><h5>{label}</h5><Facts entries={[["Name", actor?.name], ["Employee code", actor?.code], ["Designation", actor?.designation], ["Office", actor?.office], ["Action date/time", timestamp(actor?.actionAt)]]} />{open ? <p className={styles.notice}>Current period is open.</p> : null}</section>;
}
function LifecycleDetails({ row, events, length }: { row: Period; events: Period[]; length?: string }) {
  const custodian = row.employee ? `${row.employee}${row.employeeCode ? ` · ${row.employeeCode}` : ""}` : row.location;
  return <div className={styles.expandedContent}>
    <div className={styles.detailsGrid}>
      <section className={styles.detailSection}><h5>Period and custody details</h5><Facts entries={[["Custodian / Location", custodian], ["Period", periodLabel(row)], ["Duration", length ?? (row.kind === "event" ? "Instant" : row.durationSeconds != null ? duration(row.durationSeconds) : row.durationDays != null ? `${row.durationDays} calendar days` : missing)], ["Office", row.office], ["Status", row.status], ...(row.effectiveDate ? [["Effective date", calendarDate(row.effectiveDate)]] as Array<[string, string]> : [])]} /></section>
      <section className={styles.detailSection}><h5>Condition and reason</h5><Facts entries={[["Start condition", row.condition], ["End condition", row.endCondition], ["Reason / note", [row.reason, row.note].filter(Boolean).join(" · ")], ["Closing reason / note", [row.endReason, row.endNote].filter(Boolean).join(" · ")]]} /></section>
      <ActorDetails label="Action opened/performed by" actor={row.actor} />
      {row.kind !== "event" ? <ActorDetails label="Action closed by" actor={row.endActor} open={row.active} /> : null}
    </div>
    {events.length ? <details className={styles.technical}><summary>Action history · {events.length}</summary><div className={styles.recordedActions}>{events.map(event => <section key={event.id} className={styles.detailSection}><h5>{event.title} · {event.precision === "date" ? calendarDate(event.from) : timestamp(event.from)}</h5><Facts entries={[["Office", event.office], ["Condition", event.condition], ["Reason / note", [event.reason, event.note].filter(Boolean).join(" · ")]]} /><ActorDetails label="Action performed by" actor={event.actor} /></section>)}</div></details> : null}
  </div>;
}

export function AssetLifecycle({ history }: { history: LifecycleHistoryRecord }) {
  const { can } = useAuth();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  function toggleRow(id: string) { setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  async function exportLifecycle(format: "xlsx" | "pdf" | "print" | "csv") {
    const printWindow = format === "print" ? window.open("", "_blank") : null;
    if (format === "print" && !printWindow) { setExportError("Allow popups to open the print view."); return; }
    if (printWindow) printWindow.opener = null;
    setExportBusy(true); setExportError("");
    try {
      const result = await apiDownload(`/api/v1/assets/${history.asset.id}/history/export`, getBrowserApiUrl(), { method: "POST", body: JSON.stringify({ format }) });
      if (printWindow) { printWindow.document.write(await result.blob.text()); const base = printWindow.document.createElement("base"); base.href = `${window.location.origin}/`; printWindow.document.head.prepend(base); printWindow.document.close(); }
      else { const url = URL.createObjectURL(result.blob); const link = document.createElement("a"); link.href = url; link.download = result.filename ?? `asset-lifecycle.${format}`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (error) { printWindow?.close(); setExportError(error instanceof Error ? error.message : "Lifecycle export failed"); }
    finally { setExportBusy(false); }
  }
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, [history]);
  const lifecycle = history.lifecycle;
  const periods = lifecycle?.timeline.filter(row => row.kind !== "event" && !row.excludedFromTotals) ?? [];
  const eventsFor = (row: Period) => lifecycle?.timeline.filter(event => event.kind === "event" && (event.from === row.from || (event.from && row.from && event.from > row.from && (!row.to || event.from <= row.to)))) ?? [];
  const extra = lifecycle ? Math.max(0, (now - Date.parse(lifecycle.asOf)) / 1000) : 0;
  const elapsedDays = lifecycle ? Math.max(0, Math.floor(now / 86400000) - Math.floor(Date.parse(lifecycle.asOf) / 86400000)) : 0;
  const operationalTotal = (kind: "stock" | "repair" | "assigned") => lifecycle ? lifecycle[kind].seconds + lifecycle.timeline.filter(row => row.kind === (kind === "assigned" ? "employee" : kind) && row.active && row.durationSeconds != null).length * extra : 0;
  const totalLabel = (kind: "stock" | "repair" | "assigned") => {
    if (!lifecycle) return missing;
    if (!lifecycle[kind].complete && !lifecycle.timeline.some(row => row.kind === (kind === "assigned" ? "employee" : kind) && row.durationSeconds != null)) return missing;
    return `${duration(operationalTotal(kind))}${lifecycle[kind].complete ? "" : " · recorded subtotal"}`;
  };
  return <div className={styles.lifecycleRoot}>
    <div className={styles.lifecycleHeading}><h3 className="text-base font-semibold text-text-primary">Asset Lifecycle History</h3><div className={styles.exportActions} hidden={!can("Assets.Export")}>{(["xlsx", "csv", "pdf", "print"] as const).map(format => <Button key={format} size="compact" variant="secondary" disabled={exportBusy || !lifecycle} onClick={() => void exportLifecycle(format)}>{format === "xlsx" ? "Excel" : format === "pdf" ? "PDF" : format === "csv" ? "CSV" : "Print"}</Button>)}</div></div>
    <ErrorText>{exportError}</ErrorText>
    {lifecycle ? <>
      <div className={styles.summary}>
        {[["Registered", timestamp(lifecycle.registeredAt)], ["Assignments", String(lifecycle.assignments)], ["Assigned Time", `${totalLabel("assigned")}${lifecycle.assignedDays ? ` + ${lifecycle.assignedDays} recorded calendar days` : ""}`], ["Stock Time", totalLabel("stock")], ["Repair Time", totalLabel("repair")]].map(([label, value]) => <div key={label}><span>{label}</span><strong title={value}>{value}</strong></div>)}
      </div>
      <div className={styles.desktopList}><table className={styles.lifecycleTable}><colgroup>{[15, 22, 27, 9, 10, 9, 8].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup><thead><tr>{["Stage / Event", "Custodian / Location", "Period", "Duration", "Office", "Status", "Details"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{periods.map(row => {
        const days = row.durationSeconds != null ? (row.durationSeconds + (row.active ? extra : 0)) / 86400 : row.durationDays != null ? row.durationDays + (row.active ? elapsedDays : 0) : null;
        const length = row.kind === "event" ? "Instant" : days == null ? missing : row.durationSeconds != null ? duration(days * 86400) : `${days} ${days === 1 ? "day" : "days"}`;
        return <Fragment key={row.id}><tr className={row.active ? styles.currentRow : undefined}><td title={stageLabel(row)}><strong>{stageLabel(row)}</strong>{row.active ? <span className={styles.currentLabel}>Current</span> : null}</td><td title={row.employee ? `${row.employee}${row.employeeCode ? ` · ${row.employeeCode}` : ""}` : row.location || missing}>{row.employee ? <span className={styles.custodian}>{row.employee}{row.employeeCode ? <span className={styles.employeeCode}> · {row.employeeCode}</span> : null}</span> : row.location || missing}</td><td title={periodLabel(row)}>{periodLabel(row)}</td><td title={length}>{length}</td><td title={row.office || missing}>{row.office || missing}</td><td>{row.status ? <Badge>{row.status}</Badge> : missing}</td><td><button type="button" className={styles.expandButton} aria-label={`${expanded.has(row.id) ? "Hide" : "Show"} details for ${row.title}`} aria-expanded={expanded.has(row.id)} aria-controls={`lifecycle-desktop-${row.id}`} onClick={() => toggleRow(row.id)}><span className={styles.chevron} data-expanded={expanded.has(row.id)} />{expanded.has(row.id) ? "Hide" : "View"}</button></td></tr>{expanded.has(row.id) ? <tr id={`lifecycle-desktop-${row.id}`}><td colSpan={7} className={styles.expandedCell}><LifecycleDetails row={row} events={eventsFor(row)} length={length} /></td></tr> : null}</Fragment>;
      })}</tbody></table></div>
      <div className={styles.mobileList}>{periods.map(row => {
        const days = row.durationSeconds != null ? (row.durationSeconds + (row.active ? extra : 0)) / 86400 : row.durationDays != null ? row.durationDays + (row.active ? elapsedDays : 0) : null;
        const length = row.kind === "event" ? "Instant" : days == null ? missing : row.durationSeconds != null ? duration(days * 86400) : `${days} ${days === 1 ? "day" : "days"}`;
        return <article key={row.id} className={styles.mobileCard}><div className={styles.sectionHeading}><h4 className="text-sm font-semibold text-text-primary">{stageLabel(row)}</h4>{row.active ? <Badge>Current</Badge> : null}</div><Facts entries={[["Custodian / Location", row.employee ? `${row.employee}${row.employeeCode ? ` · ${row.employeeCode}` : ""}` : row.location], ["Period", periodLabel(row)], ["Duration", length], ["Office", row.office], ["Status", row.status]]} /><button type="button" className={styles.expandButton} aria-expanded={expanded.has(row.id)} aria-controls={`lifecycle-mobile-${row.id}`} onClick={() => toggleRow(row.id)}><span className={styles.chevron} data-expanded={expanded.has(row.id)} />{expanded.has(row.id) ? "Hide details" : "View details"}</button>{expanded.has(row.id) ? <div id={`lifecycle-mobile-${row.id}`}><LifecycleDetails row={row} events={eventsFor(row)} length={length} /></div> : null}</article>;
      })}</div>
    </> : <Card><EmptyState>Lifecycle history is not available.</EmptyState></Card>}
  </div>;
}
