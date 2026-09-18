"use client";

import { Fragment, useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorText, SectionHeader } from "@/components/ui";
import { formatLocalDateTime, humanizeTechnicalLabel } from "@/lib/presentation";
import { apiDownload } from "@/lib/api";
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
function ActorDetails({ label, actor }: { label: string; actor?: Actor | null }) {
  return <section><h5 className="text-sm font-semibold text-text-primary">{label}</h5><Facts entries={[["Name / employee code", actor?.name ? `${actor.name}${actor.code ? ` · ${actor.code}` : ""}` : null], ["Designation", actor?.designation], ["Office", actor?.office], ["Action date / time", timestamp(actor?.actionAt)]]} />{actor?.source ? <p className="mt-2 text-xs text-text-secondary">{actor.source}</p> : null}</section>;
}
function LifecycleDetails({ row }: { row: Period }) {
  return <div className={styles.expandedContent}>
    <Facts entries={[["Condition at start", row.condition], ["Condition at end", row.endCondition], ["Reason / note", [row.reason, row.note].filter(Boolean).join(" · ")], ["Closing reason / note", [row.endReason, row.endNote].filter(Boolean).join(" · ")], ...(row.effectiveDate ? [["Effective business date", calendarDate(row.effectiveDate)]] as Array<[string, string]> : [])]} />
    <div className={styles.actors}><ActorDetails label={row.actionCode === "asset.allocate" ? "Action opened by · Issued by" : row.actionCode === "asset.return" ? "Action performed by · Received by" : "Action opened / performed by"} actor={row.actor} />{row.kind !== "event" && !row.active ? <ActorDetails label={row.endActionCode === "asset.return" ? "Action closed by · Received by" : row.endActionCode?.includes("transfer") ? "Action closed by · Transferred by" : "Action closed by"} actor={row.endActor} /> : null}</div>
    {row.excludedFromTotals ? <p className="text-sm text-text-secondary">This legacy custody record overlaps recorded states and is excluded from totals.</p> : null}
    {row.contextSource?.startsWith("Legacy") ? <p className="text-xs text-text-secondary">Legacy notice: {row.contextSource}. Missing historical information is not estimated.</p> : null}
    <details className={styles.technical}><summary tabIndex={0}>Technical IDs</summary><Facts entries={[["Lifecycle entry ID", row.id], ["Opening / performed-by user ID", row.actor?.id], ["Closing user ID", row.endActor?.id]]} /></details>
  </div>;
}

export function AssetLifecycle({ history }: { history: LifecycleHistoryRecord }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  function toggleRow(id: string) { setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  async function exportLifecycle(format: "xlsx" | "pdf" | "print") {
    const printWindow = format === "print" ? window.open("", "_blank") : null;
    if (format === "print" && !printWindow) { setExportError("Allow popups to open the print view."); return; }
    if (printWindow) printWindow.opener = null;
    setExportBusy(true); setExportError("");
    try {
      const result = await apiDownload(`/api/v1/assets/${history.asset.id}/history/export`, getBrowserApiUrl(), { method: "POST", body: JSON.stringify({ format }) });
      if (printWindow) { printWindow.document.write(await result.blob.text()); printWindow.document.close(); }
      else { const url = URL.createObjectURL(result.blob); const link = document.createElement("a"); link.href = url; link.download = result.filename ?? `asset-lifecycle.${format}`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (error) { printWindow?.close(); setExportError(error instanceof Error ? error.message : "Lifecycle export failed"); }
    finally { setExportBusy(false); }
  }
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, [history]);
  const lifecycle = history.lifecycle;
  const extra = lifecycle ? Math.max(0, (now - Date.parse(lifecycle.asOf)) / 1000) : 0;
  const elapsedDays = lifecycle ? Math.max(0, Math.floor(now / 86400000) - Math.floor(Date.parse(lifecycle.asOf) / 86400000)) : 0;
  const operationalTotal = (kind: "stock" | "repair" | "assigned") => lifecycle ? lifecycle[kind].seconds + lifecycle.timeline.filter(row => row.kind === (kind === "assigned" ? "employee" : kind) && row.active && row.durationSeconds != null).length * extra : 0;
  const totalLabel = (kind: "stock" | "repair" | "assigned") => {
    if (!lifecycle) return missing;
    if (!lifecycle[kind].complete && !lifecycle.timeline.some(row => row.kind === (kind === "assigned" ? "employee" : kind) && row.durationSeconds != null)) return missing;
    return `${duration(operationalTotal(kind))}${lifecycle[kind].complete ? "" : " · recorded subtotal"}`;
  };
  return <div className={styles.lifecycleRoot}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold text-text-primary">Asset Lifecycle History</h3><div className="flex flex-wrap gap-2">{(["xlsx", "pdf", "print"] as const).map(format => <Button key={format} variant="secondary" disabled={exportBusy || !lifecycle} onClick={() => void exportLifecycle(format)}>{format === "xlsx" ? "Excel" : format === "pdf" ? "PDF" : "Print"}</Button>)}</div></div>
    <ErrorText>{exportError}</ErrorText>
    {lifecycle ? <>
      <div className={styles.summary}>
        {[["Registered", timestamp(lifecycle.registeredAt)], ["Assignments", String(lifecycle.assignments)], ["Assigned time", `${totalLabel("assigned")}${lifecycle.assignedDays ? ` + ${lifecycle.assignedDays} recorded calendar days` : ""}`], ["Stock time", totalLabel("stock")], ["Repair time", totalLabel("repair")]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      {lifecycle.hasLegacyGaps ? <p className={styles.notice}>Some legacy information is not recorded. Expand a row for available details and record notices.</p> : null}
      <div className={styles.desktopList}><table className={styles.lifecycleTable}><colgroup>{[19, 16, 13, 13, 9, 11, 10, 9].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup><thead><tr>{["Stage/Event", "Custodian/Location", "From", "To", "Duration", "Office", "Status", "Details"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{lifecycle.timeline.map(row => {
        const date = (value: string | null) => row.precision === "date" ? calendarDate(value) : timestamp(value);
        const days = row.durationSeconds != null ? (row.durationSeconds + (row.active ? extra : 0)) / 86400 : row.durationDays != null ? row.durationDays + (row.active ? elapsedDays : 0) : null;
        const length = row.kind === "event" ? "Instant" : days == null ? missing : row.durationSeconds != null ? duration(days * 86400) : `${days} ${days === 1 ? "day" : "days"}`;
        return <Fragment key={row.id}><tr className={row.active ? styles.currentRow : undefined}><td><strong>{row.title}</strong>{row.active ? <span className={styles.currentLabel}>Current</span> : null}{row.precision === "date" ? <span className={styles.precision}>Date-only record</span> : null}</td><td>{row.employee ? <>{row.employee}{row.employeeCode ? <span className={styles.precision}>{row.employeeCode}</span> : null}</> : row.location || missing}</td><td>{date(row.from)}</td><td>{row.active ? "Current" : date(row.to ?? (row.kind === "event" ? row.from : null))}</td><td>{length}</td><td>{row.office || missing}</td><td>{row.status ? <Badge>{row.status}</Badge> : missing}</td><td><button type="button" className={styles.expandButton} aria-label={`${expanded.has(row.id) ? "Hide" : "Show"} details for ${row.title}`} aria-expanded={expanded.has(row.id)} aria-controls={`lifecycle-desktop-${row.id}`} onClick={() => toggleRow(row.id)}><span className={styles.chevron} data-expanded={expanded.has(row.id)} />{expanded.has(row.id) ? "Hide" : "View"}</button></td></tr>{expanded.has(row.id) ? <tr id={`lifecycle-desktop-${row.id}`}><td colSpan={8} className={styles.expandedCell}><LifecycleDetails row={row} /></td></tr> : null}</Fragment>;
      })}</tbody></table></div>
      <div className={styles.mobileList}>{lifecycle.timeline.map(row => {
        const date = (value: string | null) => row.precision === "date" ? calendarDate(value) : timestamp(value);
        const days = row.durationSeconds != null ? (row.durationSeconds + (row.active ? extra : 0)) / 86400 : row.durationDays != null ? row.durationDays + (row.active ? elapsedDays : 0) : null;
        const length = row.kind === "event" ? "Instant" : days == null ? missing : row.durationSeconds != null ? duration(days * 86400) : `${days} ${days === 1 ? "day" : "days"}`;
        return <article key={row.id} className={styles.mobileCard}><div className={styles.sectionHeading}><h4 className="text-sm font-semibold text-text-primary">{row.title}</h4>{row.active ? <Badge>Current</Badge> : null}</div><Facts entries={[["Custodian/Location", row.employee ? `${row.employee}${row.employeeCode ? ` · ${row.employeeCode}` : ""}` : row.location], ["From", date(row.from)], ["To", row.active ? "Current" : date(row.to ?? (row.kind === "event" ? row.from : null))], ["Duration", length], ["Office", row.office], ["Status", row.status]]} />{row.precision === "date" ? <p className={styles.precision}>Date-only record</p> : null}<button type="button" className={styles.expandButton} aria-expanded={expanded.has(row.id)} aria-controls={`lifecycle-mobile-${row.id}`} onClick={() => toggleRow(row.id)}><span className={styles.chevron} data-expanded={expanded.has(row.id)} />{expanded.has(row.id) ? "Hide details" : "View details"}</button>{expanded.has(row.id) ? <div id={`lifecycle-mobile-${row.id}`}><LifecycleDetails row={row} /></div> : null}</article>;
      })}</div>
    </> : <Card><EmptyState>Lifecycle history is unavailable from this API build. Existing immutable audit entries remain available below.</EmptyState></Card>}
    <details className={styles.audit}><summary tabIndex={0}>Technical immutable audit trail · {history.events.length} events</summary><p className="mt-2 text-sm text-text-secondary">Recorded events cannot be edited or deleted.</p>{history.events.map(event => <article key={event.id} className="min-w-0 border-t border-brand-border py-3"><SectionHeader title={humanizeTechnicalLabel(event.action)} /><p className="text-sm text-text-secondary">{formatLocalDateTime(event.createdAt)}</p><Facts entries={[["Event ID", event.id], ["Performed-by user ID", event.actorId], ["Target employee ID", event.targetUserId], ["Reason / note", event.reason]]} /><details className="mt-2"><summary tabIndex={0} className="cursor-pointer text-sm text-text-secondary">Recorded values</summary><pre className={styles.values}>{JSON.stringify({ oldValues: event.oldValues, newValues: event.newValues }, null, 2)}</pre></details></article>)}</details>
  </div>;
}
