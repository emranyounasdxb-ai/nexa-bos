"use client";

import { ListWorkspace } from "@/components/page-patterns";
import styles from "./approvals.module.css";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Card, DialogPanel, EmptyState, ErrorText, Field, LoadingState, PageHeader, Select, StatusBadge, TableHead, TableShell, Td, Textarea, TextInput, Th } from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";

type Row = { id: string; module: string; status: string; employeeId: string; employee: string; requesterId: string; requester: string; departmentId: string | null; department: string | null; approvers: { id: string; name: string }[]; dueDate: string; overdue: boolean; createdAt: string; lockVersion: number; actions: string[]; href: string };
const titles: Record<string, string> = { approve: "Approve current step", reject: "Reject", return: "Return for correction", override: "OWNER override" };
const keys = ["module", "status", "employee", "requester", "approver", "department", "date_from", "date_to"];

export default function ApprovalCentre() {
  const { can } = useAuth(); const api = getBrowserApiUrl(); const router = useRouter(); const pathname = usePathname(); const params = useSearchParams();
  const search = useMemo(() => { const next = new URLSearchParams(); keys.forEach(key => { const value = params.get(key); if (value !== null) next.set(key, value); }); if (!params.has("status")) next.set("status", "Pending"); return next.toString(); }, [params]);
  const query = new URLSearchParams(search);
  const [rows, setRows] = useState<Row[]>([]); const [all, setAll] = useState<Row[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<{ row: Row; action: string } | null>(null); const [comment, setComment] = useState(""); const trigger = useRef<HTMLElement | null>(null); const refresh = useRef<HTMLButtonElement | null>(null);
  const allowed = can("Approvals.View");
  const restoreAfterSave = useRef(false);
  useEffect(() => {
    if (restoreAfterSave.current && !busy && !loading && !selected) {
      restoreAfterSave.current = false;
      refresh.current?.focus();
    }
  }, [busy, loading, selected]);
  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return; } setLoading(true); setError("");
    try { const [filtered, choices] = await Promise.all([apiGet<{ items: Row[] }>(`/api/v1/approvals?${search}`, api), apiGet<{ items: Row[] }>("/api/v1/approvals", api)]); setRows(filtered.items); setAll(choices.items); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load approvals"); } finally { setLoading(false); }
  }, [allowed, api, search, setError, setLoading, setRows, setAll]);
  useEffect(() => { void load(); }, [load]);
  const close = useCallback(() => { if (busy) return; setSelected(null); requestAnimationFrame(() => { if (trigger.current?.isConnected) trigger.current.focus(); else refresh.current?.focus(); }); }, [busy, setSelected]);
  useEffect(() => {
    if (!selected) return; const dialog = document.querySelector<HTMLElement>('[role="dialog"]'); dialog?.querySelector<HTMLElement>("textarea")?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } if (e.key !== "Tab" || !dialog) return; const nodes = Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled),textarea:not(:disabled)")).filter(node => node.getClientRects().length); if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes.at(-1)?.focus(); } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0]?.focus(); } }; document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, [selected, close]);
  function filter(key: string, value: string) { const next = new URLSearchParams(search); next.set(key, value); router.push(`${pathname}?${next}`, { scroll: false }); }
  const choices = (key: "employee" | "requester" | "department" | "approver") => Array.from(new Map(all.flatMap(row => key === "approver" ? row.approvers.map(person => [person.id, person.name] as const) : key === "department" ? row.departmentId ? [[row.departmentId, row.department ?? "Department"] as const] : [] : [[row[`${key}Id`], row[key]] as const])).entries());
  if (!allowed) return <EmptyState>You do not have permission to view the Approval Centre.</EmptyState>;
  return <section ref={node => { refresh.current = node?.querySelector<HTMLButtonElement>("button") ?? null; }} className="min-w-0 space-y-4"><PageHeader title="Approval Centre" description="Individual decisions in your authorized HR workflows." actions={<Button variant="secondary" disabled={loading || busy} onClick={async () => { setBusy(true); setError(""); try { await apiRequest("/api/v1/approvals/reminders", api, { method: "POST" }); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to refresh reminders"); } finally { setBusy(false); } }}>Refresh queue</Button>} />
    <ListWorkspace title="Review queue" filters={
    <Card><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Module"><Select aria-label="Module" value={query.get("module") ?? ""} onChange={e => filter("module", e.target.value)}><option value="">All modules</option>{["Leave", "Contracts", "Transfers", "Exit"].map(name => <option key={name}>{name}</option>)}</Select></Field><Field label="Status"><Select aria-label="Status" value={query.get("status") ?? ""} onChange={e => filter("status", e.target.value)}><option value="">All statuses</option><option value="Pending">Pending steps</option>{Array.from(new Set(all.map(row => row.status))).sort().map(status => <option key={status}>{status}</option>)}</Select></Field>{(["employee", "requester", "approver", "department"] as const).map(key => <Field key={key} label={key[0].toUpperCase() + key.slice(1)}><Select aria-label={key[0].toUpperCase() + key.slice(1)} value={query.get(key) ?? ""} onChange={e => filter(key, e.target.value)}><option value="">All permitted {key}s</option>{choices(key).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></Field>)}<Field label="Requested from"><TextInput type="date" value={query.get("date_from") ?? ""} onChange={e => filter("date_from", e.target.value)} /></Field><Field label="Requested to"><TextInput type="date" value={query.get("date_to") ?? ""} onChange={e => filter("date_to", e.target.value)} /></Field></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-text-secondary">{rows.length} requests in scope</p><Button variant="secondary" onClick={() => router.push(pathname)}>Reset filters</Button></div></Card>
    }>
    {error && !selected && <ErrorText>{error}</ErrorText>}{message && <p role="status" className="text-sm">{message}</p>}
    {loading ? <LoadingState>Loading approvals…</LoadingState> : error ? null : !rows.length ? <EmptyState>No requests match these filters.</EmptyState> : <Card><TableShell className={`${styles.queue} [&_table]:min-w-[900px]`}><TableHead><tr><Th>Employee / Module</Th><Th>Requester</Th><Th>Status / Approver</Th><Th>Due date</Th><Th>Decision</Th></tr></TableHead><tbody>{rows.map(row => <tr key={`${row.module}-${row.id}`}><Td><strong>{row.employee}</strong><p>{row.module} · {row.department ?? "No department"}</p></Td><Td>{row.requester}<time className="block text-xs">{new Date(row.createdAt).toLocaleDateString("en-AE")}</time></Td><Td><StatusBadge value={row.status} /><p className="text-xs">{row.approvers.map(person => person.name).join(", ") || "Open workflow for next required step"}</p></Td><Td>{row.dueDate}{row.overdue && <p className="text-xs text-amber-700">Overdue</p>}</Td><Td><div className="flex flex-wrap gap-2">{row.actions.map(action => <Button key={action} variant="secondary" onClick={e => { trigger.current = e.currentTarget; setComment(""); setError(""); setSelected({ row, action }); }}>{titles[action]}</Button>)}<Link className="text-sm text-brand-primary underline focus-visible:outline focus-visible:outline-2" href={row.href}>Open {row.module}</Link></div></Td></tr>)}</tbody></TableShell></Card>}
    </ListWorkspace>
    {selected && <DialogPanel title={titles[selected.action]} onClose={close}><form className="mt-4 space-y-3" onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(""); try { await apiRequest(`/api/v1/approvals/${selected.row.module}/${selected.row.id}/decision`, api, { method: "POST", body: JSON.stringify({ action: selected.action, lock_version: selected.row.lockVersion, comment }) }); restoreAfterSave.current = true; setSelected(null); setMessage("Decision recorded in the workflow history."); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Decision could not be saved"); } finally { setBusy(false); } }}><p className="text-sm">{selected.row.employee} · {selected.row.module} · {selected.row.status}</p><p className="text-sm text-text-secondary">Confirm this individual workflow step. Existing validation, clearance and independent approval rules still apply.</p>{error && <ErrorText>{error}</ErrorText>}<Field label="Reason / comment *"><Textarea required maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} /></Field><div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Confirm decision"}</Button></div></form></DialogPanel>}
  </section>;
}
