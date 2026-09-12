"use client";

import { ListWorkspace } from "@/components/page-patterns";
import styles from "./transfers.module.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Card, DialogPanel, EmptyState, ErrorText, Field, LoadingState, PageHeader, Select, StatusBadge, TableHead, TableShell, Td, Textarea, TextInput, Th } from "@/components/ui";
import { apiGet, apiRequest, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";

type Assignment = { office_id: string | null; department_id: string | null; business_unit_id: string | null; team_id: string | null; designation_id: string | null; reporting_manager_id: string | null };
type Option = { id: string; name: string; officeId?: string; departmentId?: string; businessUnitId?: string | null };
type Options = { employees: (Option & { employeeCode: string; assignment: Assignment })[]; offices: Option[]; departments: Option[]; businessUnits: Option[]; teams: Option[]; designations: Option[]; managers: Option[] };
type Transfer = { id: string; employeeId: string; employee: string; employeeCode: string; requester: string; requestedById: string; status: string; lockVersion: number; current: Assignment; proposed: Assignment; currentLabels: Assignment; proposedLabels: Assignment; applicationError: string | null; reason: string; notes: string | null; effectiveDate: string; requestedDate: string; history: { id: string; actor: string; action: string; comment: string; createdAt: string }[] };
type Action = "submit" | "review" | "approve" | "apply" | "return" | "reject" | "cancel";
const fields: [keyof Assignment, string, keyof Omit<Options, "employees">][] = [["office_id", "Office", "offices"], ["department_id", "Department", "departments"], ["business_unit_id", "Business Unit", "businessUnits"], ["team_id", "Team", "teams"], ["designation_id", "Designation", "designations"], ["reporting_manager_id", "Reporting manager", "managers"]];
const emptyAssignment: Assignment = { office_id: null, department_id: null, business_unit_id: null, team_id: null, designation_id: null, reporting_manager_id: null };
const emptyDraft = { employee_id: "", proposed: emptyAssignment, reason: "", effective_date: "", notes: "", backdate_reason: "" };
const statuses = ["Draft", "Submitted", "Reviewed", "Approved", "Applied", "Returned", "Rejected", "Cancelled", "Superseded"];
const labels: Record<Action, string> = { submit: "Submit for HR review", review: "Record HR review", approve: "Approve transfer", apply: "Apply due transfer", return: "Return for correction", reject: "Reject transfer", cancel: "Cancel transfer" };

export default function TransfersPage() {
  const { user, can } = useAuth();
  const api = getBrowserApiUrl();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = params.get("status") ?? "";
  const [items, setItems] = useState<Transfer[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Transfer | null>(null);
  const [mode, setMode] = useState<"create" | "edit" | "supersede" | "detail" | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [decision, setDecision] = useState<Action | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const workspace = useRef<HTMLDivElement | null>(null);
  const allowed = can("Transfers.View") || can("Transfers.ViewOwn") || can("Transfers.Recommend");
  const canPrepare = can("Transfers.Create") || can("Transfers.Recommend");
  const load = useCallback(async () => {
    if (!user || !allowed) { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const rows = await apiGet<{ items: Transfer[] }>(`/api/v1/transfers${status ? `?status=${encodeURIComponent(status)}` : ""}`, api);
      setItems(rows.items);
      if (canPrepare || can("Transfers.Edit")) setOptions(await apiGet<Options>("/api/v1/transfers/options", api));
    } catch (caught) { setError(caught instanceof ApiClientError ? caught.message : "Unable to load transfers"); }
    finally { setLoading(false); }
  }, [api, user, allowed, status, canPrepare, can]);
  useEffect(() => { void load(); }, [load]);
  const close = useCallback(() => {
    if (busy) return;
    setMode(null); setSelected(null); setDecision(null); setComment("");
    requestAnimationFrame(() => {
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
      else workspace.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    });
  }, [busy]);
  useEffect(() => {
    if (!mode) return;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    dialog?.querySelector<HTMLElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[role="listbox"]')) { event.preventDefault(); close(); }
      if (event.key !== "Tab" || !dialog) return;
      const elements = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [role="combobox"]:not([aria-disabled="true"])')).filter(e => e.tabIndex >= 0 && e.getClientRects().length > 0);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [mode, decision, close]);

  function open(trigger: HTMLElement, row?: Transfer) {
    returnFocus.current = trigger; setError(""); setSelected(row ?? null);
    setDraft(emptyDraft); setMode(row ? "detail" : "create");
  }
  function edit(kind: "edit" | "supersede") {
    if (!selected) return;
    setDraft({ employee_id: selected.employeeId, proposed: selected.proposed, reason: selected.reason, effective_date: selected.effectiveDate, notes: selected.notes ?? "", backdate_reason: "" });
    setMode(kind);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const { employee_id, ...rest } = draft;
      const common = { ...rest, notes: rest.notes || null, backdate_reason: rest.backdate_reason || null };
      const saved = await apiRequest<Transfer>(mode === "edit" && selected ? `/api/v1/transfers/${selected.id}` : `/api/v1/transfers${can("Transfers.Create") ? "" : "/recommend"}`, api, {
        method: mode === "edit" ? "PATCH" : "POST",
        body: JSON.stringify(mode === "edit" && selected ? { ...common, lock_version: selected.lockVersion } : { ...common, employee_id, supersedes_id: mode === "supersede" ? selected?.id : null }),
      });
      setSelected(saved); setMode("detail"); setNotice("Transfer saved. Assignments change only after approval and when due."); await load();
    } catch (caught) { setError(caught instanceof ApiClientError ? caught.message : "Unable to save transfer"); }
    finally { setBusy(false); }
  }
  async function decide(event: React.FormEvent) {
    event.preventDefault(); if (!selected || !decision || busy) return;
    setBusy(true); setError("");
    try {
      const saved = await apiRequest<Transfer>(`/api/v1/transfers/${selected.id}/action`, api, { method: "POST", body: JSON.stringify({ action: decision, lock_version: selected.lockVersion, comment }) });
      setSelected(saved); setDecision(null); setComment(""); setNotice(`Transfer ${saved.status.toLowerCase()}.`); await load();
    } catch (caught) { setError(caught instanceof ApiClientError ? caught.message : "Unable to update transfer"); }
    finally { setBusy(false); }
  }
  function actions(row: Transfer): Action[] {
    const self = user?.id === row.employeeId || user?.id === row.requestedById;
    const owner = user?.userType?.code === "OWNER";
    return (["submit", "review", "approve", "apply", "return", "reject", "cancel"] as Action[]).filter(action => {
      if (action === "submit") return can("Transfers.Create") && ["Draft", "Returned"].includes(row.status);
      if (action === "review") return can("Transfers.Review") && !self && row.status === "Submitted";
      if (action === "approve") return can("Transfers.Approve") && owner && !self && row.status === "Reviewed";
      if (action === "apply") return can("Transfers.Approve") && owner && row.status === "Approved";
      if (action === "return" || action === "reject") return can("Transfers.ReturnReject") && !self && ["Submitted", "Reviewed"].includes(row.status);
      return can("Transfers.Cancel") && ["Draft", "Returned", "Submitted", "Reviewed", ...(owner ? ["Approved"] : [])].includes(row.status);
    });
  }
  function assignmentName(key: keyof Assignment, id: string | null, label: string | null) {
    if (!id) return "Not assigned";
    if (label) return label;
    const collection = fields.find(field => field[0] === key)![2];
    return options?.[collection].find(option => option.id === id)?.name ?? id;
  }
  if (!allowed) return <EmptyState>You do not have permission to view transfers.</EmptyState>;
  return <div ref={workspace} className="space-y-4">
    <PageHeader title="Employee transfers" description="Reviewed organization changes and their effective dates." actions={<>{canPrepare && <Button onClick={event => open(event.currentTarget)}>{can("Transfers.Create") ? "Prepare transfer" : "Recommend transfer"}</Button>}<Button variant="secondary" disabled={loading} onClick={() => void load()}>Refresh</Button></>} />
    {!mode && error && <ErrorText>{error}</ErrorText>}{notice && <p role="status" className="text-sm text-text-secondary">{notice}</p>}
    <ListWorkspace title="Transfer register" filters={
    <div className="max-w-xs"><Field label="Status"><Select aria-label="Status" value={status} onChange={event => { const next = new URLSearchParams(params.toString()); if (event.target.value) next.set("status", event.target.value); else next.delete("status"); router.push(`${pathname}?${next}`, { scroll: false }); }}><option value="">All statuses</option>{statuses.map(s => <option key={s}>{s}</option>)}</Select></Field></div>
    }>
    {loading ? <LoadingState>Loading transfers…</LoadingState> : <Card>{items.length === 0 ? <EmptyState>No transfers in this scope.</EmptyState> : <TableShell className={`${styles.register} [&_table]:min-w-[600px]`}><TableHead><tr><Th>Employee</Th><Th>Requested</Th><Th>Effective</Th><Th>Status</Th><Th>Action</Th></tr></TableHead><tbody>{items.map(row => <tr key={row.id}><Td><span className="font-medium">{row.employee}</span><div className="text-xs text-text-secondary">{row.employeeCode}</div></Td><Td>{row.requestedDate}</Td><Td>{row.effectiveDate}</Td><Td><StatusBadge value={row.status} /></Td><Td><Button variant="secondary" onClick={event => open(event.currentTarget, row)}>View transfer</Button></Td></tr>)}</tbody></TableShell>}</Card>}
    </ListWorkspace>
    {mode && <DialogPanel title={decision ? labels[decision] : mode === "detail" ? "Transfer details" : mode === "edit" ? "Edit transfer draft" : mode === "supersede" ? "Supersede scheduled transfer" : can("Transfers.Create") ? "Prepare transfer" : "Recommend transfer"} onClose={close} className={!decision ? styles.dialog : undefined}>
      {error && <ErrorText>{error}</ErrorText>}
      {decision ? <form onSubmit={decide} className="mt-4 space-y-3"><p className="text-sm">{decision === "approve" || decision === "apply" ? "Due transfers update organization assignments atomically. Previous assignments remain in history." : "This decision is recorded in immutable transfer history."}</p><Field label="Reason / comment *"><Textarea required maxLength={2000} value={comment} onChange={event => setComment(event.target.value)} /></Field><div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={() => setDecision(null)}>Back</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Confirm decision"}</Button></div></form> : mode !== "detail" ? <form onSubmit={save} className="mt-4 space-y-3">
        <Field label="Employee *"><Select aria-label="Employee *" required disabled={mode !== "create"} value={draft.employee_id} onChange={event => setDraft({ ...draft, employee_id: event.target.value, proposed: options?.employees.find(e => e.id === event.target.value)?.assignment ?? emptyAssignment })}><option value="">Select employee</option>{options?.employees.map(e => <option key={e.id} value={e.id}>{e.name} · {e.employeeCode}</option>)}</Select></Field>
<fieldset className="grid gap-3 sm:grid-cols-2 rounded-2xl bg-surface-subtle p-4"><legend className="px-1 text-sm font-medium">Proposed assignment</legend>{fields.map(([key, label, collection]) => <Field key={key} label={`${label}${key === "designation_id" ? " *" : ""}`}><Select aria-label={`${label}${key === "designation_id" ? " *" : ""}`} required={key === "designation_id"} value={draft.proposed[key] ?? ""} disabled={(key === "department_id" && !draft.proposed.office_id) || (key === "business_unit_id" && !draft.proposed.department_id) || (key === "team_id" && !draft.proposed.business_unit_id)} onChange={event => { const proposed = { ...draft.proposed, [key]: event.target.value || null }; if (key === "office_id") { proposed.department_id = null; proposed.business_unit_id = null; proposed.team_id = null; } if (key === "department_id") { proposed.business_unit_id = null; proposed.team_id = null; } if (key === "business_unit_id") proposed.team_id = null; setDraft({ ...draft, proposed }); }}><option value="">{key === "designation_id" ? "Select designation" : "Not assigned"}</option>{options?.[collection].filter(o => key === "department_id" ? o.officeId === draft.proposed.office_id : key === "business_unit_id" ? o.departmentId === draft.proposed.department_id && o.officeId === draft.proposed.office_id : key === "team_id" ? o.businessUnitId === draft.proposed.business_unit_id : key === "reporting_manager_id" ? o.id !== draft.employee_id : true).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>)}</fieldset>
        <fieldset className="grid gap-3 rounded-2xl bg-surface-subtle p-4 sm:grid-cols-2"><legend className="px-1 text-sm font-medium">Timing and justification</legend>
        <Field label="Effective date *"><TextInput type="date" required value={draft.effective_date} onChange={event => setDraft({ ...draft, effective_date: event.target.value })} /></Field>
        <Field label="Reason *"><Textarea required maxLength={2000} value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })} /></Field>
        {user?.userType?.code === "OWNER" && <Field label="Past-date justification"><Textarea maxLength={2000} value={draft.backdate_reason} onChange={event => setDraft({ ...draft, backdate_reason: event.target.value })} /></Field>}
        <Field label="Notes"><Textarea maxLength={4000} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></Field>
        </fieldset>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy || !options}>{busy ? "Saving…" : "Save transfer"}</Button></div>
      </form> : selected && <div className={`mt-4 space-y-4 ${styles.detail}`}><div><p className="font-semibold">{selected.employee} · {selected.employeeCode}</p><p className="text-sm text-text-secondary">Requested by {selected.requester} · Effective {selected.effectiveDate}</p><StatusBadge value={selected.status} /></div>
        {selected.applicationError && <ErrorText>Scheduled application needs operator review ({selected.applicationError}). No assignment was changed.</ErrorText>}
        <dl className="space-y-3">{fields.map(([key, label]) => <div key={key}><dt className="text-sm font-semibold">{label}</dt><dd className="grid grid-cols-2 gap-3 break-words text-sm"><span><span className="block text-xs text-text-secondary">Current snapshot</span><span>{assignmentName(key, selected.current[key], selected.currentLabels[key])}</span></span><span><span className="block text-xs text-text-secondary">Proposed</span><span>{assignmentName(key, selected.proposed[key], selected.proposedLabels[key])}</span></span></dd></div>)}</dl><p className="break-words text-sm">{selected.reason}</p>{selected.notes && <p className="break-words text-sm text-text-secondary">{selected.notes}</p>}
        <div className="flex flex-wrap gap-2">{can("Transfers.Edit") && ["Draft", "Returned"].includes(selected.status) && <Button variant="secondary" onClick={() => edit("edit")}>Edit draft</Button>}{can("Transfers.Create") && selected.status === "Approved" && <Button variant="secondary" onClick={() => edit("supersede")}>Prepare replacement</Button>}{actions(selected).map(action => <Button key={action} variant="secondary" onClick={() => { setDecision(action); setComment(""); }}>{labels[action]}</Button>)}</div>
        {can("Transfers.History") && <section><h3 className="text-lg font-semibold">History</h3><ol className="mt-2 space-y-2">{selected.history.map(item => <li key={item.id} className="border-b border-border pb-2 text-sm"><p>{item.action} · {item.actor}</p><time className="text-xs text-text-secondary">{new Date(item.createdAt).toLocaleString("en-AE")}</time><p className="break-words">{item.comment}</p></li>)}</ol></section>}
      </div>}
    </DialogPanel>}
  </div>;
}
