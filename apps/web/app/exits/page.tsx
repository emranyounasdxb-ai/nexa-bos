"use client";

import { ListWorkspace } from "@/components/page-patterns";
import styles from "./exits.module.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Card, DialogPanel, EmptyState, ErrorText, Field, LoadingState, PageHeader, Select, StatusBadge, TableHead, TableShell, Td, Textarea, TextInput, Th } from "@/components/ui";
import { apiGet, apiRequest, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";

type Item = { key: string; label: string; assigneeId: string | null; assignee: string | null; status: string; note: string | null; updatedAt: string };
type Exit = { id: string; employeeId: string; employee: string; employeeCode: string; requestedById: string; requester: string; exitType: string; status: string; requestDate: string; noticeDate: string; lastWorkingDate: string; reason: string | null; lockVersion: number; settlementStatus: string | null; settlementReference: string | null; checklist: Item[]; history: { id: string; action: string; actor: string; comment: string; createdAt: string }[] };
type Options = { employees: { id: string; name: string }[]; assignees: { id: string; name: string; finalApprover: boolean }[] };
type Action = "submit" | "notice" | "clearance" | "ready" | "complete" | "cancel" | "return" | "reject" | "reopen";
const labels: Record<Action, string> = { submit: "Submit exit", notice: "Confirm notice period", clearance: "Start clearance", ready: "Mark ready to close", complete: "Complete exit", cancel: "Cancel exit", return: "Return for correction", reject: "Reject exit", reopen: "Reopen exit" };
const statuses = ["Draft", "Submitted", "Notice Period", "Clearance in Progress", "Ready to Close", "Completed", "Cancelled"];
const empty = { employee_id: "", exit_type: "Resignation", notice_date: "", last_working_date: "", reason: "" };

export default function ExitsPage() {
  const { user, can } = useAuth();
  const api = getBrowserApiUrl(); const router = useRouter(); const pathname = usePathname(); const params = useSearchParams(); const status = params.get("status") ?? "";
  const [rows, setRows] = useState<Exit[]>([]); const [options, setOptions] = useState<Options | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"create" | "edit" | "detail" | null>(null); const [selected, setSelected] = useState<Exit | null>(null); const [draft, setDraft] = useState(empty);
  const [decision, setDecision] = useState<Action | null>(null); const [comment, setComment] = useState("");
  const [item, setItem] = useState<Item | null>(null); const [assign, setAssign] = useState(false); const [assignee, setAssignee] = useState(""); const [itemStatus, setItemStatus] = useState("Cleared");
  const [settlement, setSettlement] = useState(false); const [settlementStatus, setSettlementStatus] = useState("Pending"); const [reference, setReference] = useState("");
  const trigger = useRef<HTMLElement | null>(null); const workspace = useRef<HTMLDivElement | null>(null);
  const allowed = can("Exits.View") || can("Exits.ViewOwn") || can("Exits.Clearance"); const operational = can("Exits.View");
  const load = useCallback(async () => {
    if (!user || !allowed) { setLoading(false); return; }
    setLoading(true); setError("");
    try { setRows((await apiGet<{ items: Exit[] }>(`/api/v1/exits${status ? `?status=${encodeURIComponent(status)}` : ""}`, api)).items); if (can("Exits.Create") || can("Exits.Assign")) setOptions(await apiGet<Options>("/api/v1/exits/options", api)); }
    catch (caught) { setError(caught instanceof ApiClientError ? caught.message : "Unable to load exits"); } finally { setLoading(false); }
  }, [api, user, allowed, status, can]);
  useEffect(() => { void load(); }, [load]);
  const close = useCallback(() => { if (busy) return; setMode(null); setSelected(null); setDecision(null); setItem(null); setSettlement(false); requestAnimationFrame(() => { if (trigger.current?.isConnected) trigger.current.focus(); else workspace.current?.querySelector<HTMLElement>("button")?.focus(); }); }, [busy]);
  useEffect(() => {
    if (!mode) return;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]'); dialog?.querySelector<HTMLElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[role="listbox"]')) { event.preventDefault(); close(); }
      if (event.key !== "Tab" || !dialog) return;
      const nodes = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[role="combobox"]:not([aria-disabled="true"])')).filter(e => e.tabIndex >= 0 && e.getClientRects().length > 0);
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    }; document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, [mode, decision, item, settlement, close]);
  function open(element: HTMLElement, row?: Exit) { trigger.current = element; setSelected(row ?? null); setDraft({ ...empty, employee_id: user?.id ?? "" }); setError(""); setComment(""); setMode(row ? "detail" : "create"); }
  async function persist(path: string, method: string, body: object) {
    if (busy) return; setBusy(true); setError("");
    try { const saved = await apiRequest<Exit>(path, api, { method, body: JSON.stringify(body) }); setSelected(saved); setMode("detail"); setDecision(null); setItem(null); setSettlement(false); setComment(""); setNotice(`Exit ${saved.status.toLowerCase()}.`); await load(); }
    catch (caught) { setError(caught instanceof ApiClientError ? caught.message : "Unable to save exit"); } finally { setBusy(false); }
  }
  function actions(row: Exit): Action[] {
    const own = row.employeeId === user?.id && row.requestedById === user.id;
    const independent = row.employeeId !== user?.id && row.requestedById !== user?.id;
    const owner = user?.userType?.code === "OWNER";
    return (Object.keys(labels) as Action[]).filter(action => {
      if (action === "submit") return row.status === "Draft" && (can("Exits.Create") || (own && can("Exits.Request")));
      if (action === "notice") return row.status === "Submitted" && independent && can("Exits.Progress");
      if (action === "clearance") return row.status === "Notice Period" && can("Exits.Progress") && row.employeeId !== user?.id;
      if (action === "ready") return row.status === "Clearance in Progress" && independent && can("Exits.Progress");
      if (action === "complete") return row.status === "Ready to Close" && independent && owner && can("Exits.Approve");
      if (action === "reopen") return row.status === "Completed" && owner && can("Exits.Approve");
      if (action === "return" || action === "reject") return row.status === "Submitted" && independent && can("Exits.ReturnReject");
      return !["Completed", "Cancelled"].includes(row.status) && ((own && ["Draft", "Submitted"].includes(row.status) && can("Exits.Request")) || (can("Exits.Cancel") && row.employeeId !== user?.id));
    });
  }
  if (!allowed) return <EmptyState>You do not have permission to view exits.</EmptyState>;
  return <div ref={workspace} className="space-y-4">
    <PageHeader title="Exit and offboarding" description="Reviewed exits, assigned clearance and preserved employee history." actions={<>{(can("Exits.Create") || can("Exits.Request")) && <Button onClick={e => open(e.currentTarget)}>{can("Exits.Create") ? "Prepare exit" : "Request resignation"}</Button>}<Button variant="secondary" disabled={loading} onClick={() => void load()}>Refresh</Button></>} />
    {!mode && error && <ErrorText>{error}</ErrorText>}{notice && <p role="status" className="text-sm text-text-secondary">{notice}</p>}
    <ListWorkspace title="Offboarding register" filters={
    <div className="max-w-xs"><Field label="Status"><Select aria-label="Status" value={status} onChange={e => { const next = new URLSearchParams(params.toString()); if (e.target.value) next.set("status", e.target.value); else next.delete("status"); router.push(`${pathname}?${next}`, { scroll: false }); }}><option value="">All statuses</option>{statuses.map(s => <option key={s}>{s}</option>)}</Select></Field></div>
    }>
    {loading ? <LoadingState>Loading exits…</LoadingState> : <Card>{rows.length === 0 ? <EmptyState>No exits in this scope.</EmptyState> : <TableShell className={`${styles.register} [&_table]:min-w-[600px]`}><TableHead><tr><Th>Employee</Th><Th>Type</Th><Th>Last working date</Th><Th>Status</Th><Th>Action</Th></tr></TableHead><tbody>{rows.map(row => <tr key={row.id}><Td>{row.employee}<div className="text-xs text-text-secondary">{row.employeeCode}</div></Td><Td>{row.exitType}</Td><Td>{row.lastWorkingDate}</Td><Td><StatusBadge value={row.status} /></Td><Td><Button variant="secondary" onClick={e => open(e.currentTarget, row)}>View exit</Button></Td></tr>)}</tbody></TableShell>}</Card>}
    </ListWorkspace>
    {mode && <DialogPanel title={decision ? labels[decision] : item ? `${assign ? "Assign" : "Update"} ${item.label}` : settlement ? "Settlement reference" : mode === "detail" ? "Exit details" : mode === "edit" ? "Edit exit draft" : can("Exits.Create") ? "Prepare exit" : "Request resignation"} onClose={close} className={mode === "detail" && !decision && !item && !settlement ? styles.dialog : undefined}>
      {error && <ErrorText>{error}</ErrorText>}
      {(decision || item || settlement) && selected ? <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); const base = `/api/v1/exits/${selected.id}`; void persist(decision ? `${base}/action` : item ? `${base}/checklist/${item.key}` : `${base}/settlement`, decision ? "POST" : "PATCH", { lock_version: selected.lockVersion, ...(decision ? { action: decision, comment } : item ? { ...(assign ? { assignee_id: assignee } : { status: itemStatus }), note: comment } : { status: settlementStatus, reference: reference || null, comment }) }); }}>
        <p className="text-sm text-text-secondary">{decision === "complete" ? "Completion deactivates this employee and revokes their sessions. Clearance must be complete and the last working date reached." : decision === "reopen" ? "Reopen clearance for review. This does not reactivate the account or restore sessions." : "This action is recorded in immutable exit history."}</p>
        {item && (assign ? <Field label="Assignee *"><Select aria-label="Assignee *" required value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Select assignee</option>{options?.assignees.filter(a => a.id !== selected.employeeId && (item.key !== "approval" || a.finalApprover)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field> : <Field label="Clearance status *"><Select aria-label="Clearance status *" value={itemStatus} onChange={e => setItemStatus(e.target.value)}>{["Pending", "In progress", "Cleared", ...(item.key === "approval" ? [] : ["Not applicable"])].map(s => <option key={s}>{s}</option>)}</Select></Field>)}
        {settlement && <><Field label="Settlement status"><Select aria-label="Settlement status" value={settlementStatus} onChange={e => setSettlementStatus(e.target.value)}>{["Not recorded", "Pending", "Cleared"].map(s => <option key={s}>{s}</option>)}</Select></Field><Field label="Reference"><TextInput maxLength={200} value={reference} onChange={e => setReference(e.target.value)} /></Field></>}
        <Field label="Reason / comment *"><Textarea required maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} /></Field><div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={() => { setDecision(null); setItem(null); setSettlement(false); }}>Back</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Confirm decision"}</Button></div>
      </form> : mode !== "detail" ? <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); void persist(mode === "edit" && selected ? `/api/v1/exits/${selected.id}` : "/api/v1/exits", mode === "edit" ? "PATCH" : "POST", { ...draft, ...(mode === "edit" ? { lock_version: selected?.lockVersion } : {}) }); }}>
        {can("Exits.Create") ? <Field label="Employee *"><Select aria-label="Employee *" required disabled={mode === "edit"} value={draft.employee_id} onChange={e => setDraft({ ...draft, employee_id: e.target.value })}><option value="">Select employee</option>{options?.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</Select></Field> : <p className="text-sm">Resignation for {user?.fullName}</p>}
        {can("Exits.Create") && <Field label="Exit type *"><Select aria-label="Exit type *" value={draft.exit_type} onChange={e => setDraft({ ...draft, exit_type: e.target.value })}>{["Resignation", "Termination", "End of Contract", "Other"].map(type => <option key={type}>{type}</option>)}</Select></Field>}
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Notice date *"><TextInput type="date" required value={draft.notice_date} onChange={e => setDraft({ ...draft, notice_date: e.target.value })} /></Field><Field label="Last working date *"><TextInput type="date" required value={draft.last_working_date} onChange={e => setDraft({ ...draft, last_working_date: e.target.value })} /></Field></div>
        <Field label="Reason *"><Textarea required maxLength={2000} value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })} /></Field><div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save exit"}</Button></div>
      </form> : selected && <div className={`mt-4 space-y-4 ${styles.detail}`}><div><p className="font-semibold">{selected.employee} · {selected.employeeCode}</p><p className="text-sm text-text-secondary">{selected.exitType} · Requested {selected.requestDate} by {selected.requester}</p><StatusBadge value={selected.status} /></div><dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-text-secondary">Notice date</dt><dd>{selected.noticeDate}</dd></div><div><dt className="text-text-secondary">Last working date</dt><dd>{selected.lastWorkingDate}</dd></div></dl>{selected.reason && <p className="break-words text-sm">{selected.reason}</p>}
        <div className="flex flex-wrap gap-2">{selected.status === "Draft" && (can("Exits.Edit") || (selected.requestedById === user?.id && can("Exits.Request"))) && <Button variant="secondary" onClick={() => { setDraft({ employee_id: selected.employeeId, exit_type: selected.exitType, notice_date: selected.noticeDate, last_working_date: selected.lastWorkingDate, reason: selected.reason ?? "" }); setMode("edit"); }}>Edit draft</Button>}{actions(selected).map(action => <Button key={action} variant="secondary" onClick={() => { setDecision(action); setComment(""); }}>{labels[action]}</Button>)}</div>
        <section><h3 className="text-lg font-semibold">Clearance checklist</h3><ul className="mt-2 space-y-3">{selected.checklist.map(entry => <li key={entry.key} className="rounded-lg border border-border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{entry.label}</span><StatusBadge value={entry.status} /></div><p className="text-text-secondary">{entry.assignee ?? "Unassigned"}</p>{entry.note && <p className="break-words">{entry.note}</p>}<time className="text-xs text-text-secondary">{new Date(entry.updatedAt).toLocaleString("en-AE")}</time>{selected.status === "Clearance in Progress" && <div className="mt-2 flex flex-wrap gap-2">{can("Exits.Assign") && <Button variant="secondary" onClick={() => { setItem(entry); setAssign(true); setAssignee(entry.assigneeId ?? ""); setComment(""); }}>Assign {entry.label}</Button>}{entry.assigneeId === user?.id && can("Exits.Clearance") && <Button variant="secondary" onClick={() => { setItem(entry); setAssign(false); setItemStatus("Cleared"); setComment(""); }}>Update {entry.label}</Button>}</div>}</li>)}</ul></section>
        {operational && selected.settlementStatus && <section><h3 className="text-lg font-semibold">Settlement reference</h3><p className="text-sm">{selected.settlementStatus}{selected.settlementReference ? ` · ${selected.settlementReference}` : ""}</p>{can("Exits.Edit") && !["Completed", "Cancelled", "Ready to Close"].includes(selected.status) && <Button variant="secondary" onClick={() => { setSettlement(true); setSettlementStatus(selected.settlementStatus ?? "Not recorded"); setReference(selected.settlementReference ?? ""); setComment(""); }}>Update settlement reference</Button>}</section>}
        {can("Exits.History") && <section><h3 className="text-lg font-semibold">History</h3><ol className="mt-2 space-y-2">{selected.history.map(e => <li key={e.id} className="border-b border-border pb-2 text-sm"><p>{e.action} · {e.actor}</p><time className="text-xs text-text-secondary">{new Date(e.createdAt).toLocaleString("en-AE")}</time><p className="break-words">{e.comment}</p></li>)}</ol></section>}
      </div>}
    </DialogPanel>}
  </div>;
}
