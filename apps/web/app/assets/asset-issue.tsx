"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { DatePicker } from "@/components/date-picker";
import { Button, EmptyState, ErrorText, Field, LoadingState, Select, Textarea, TextInput } from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { AssetOptions, AssetRecord } from "@/lib/types";
import { AssetActionPopup } from "./asset-action-popup";

/** One explicit issue workflow for list rows and the asset detail drawer. */
export function IssueAssetAction({ asset, onIssued }: { asset: AssetRecord; onIssued: (asset: AssetRecord) => void }) {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<AssetOptions | null>(null);
  const [search, setSearch] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [condition, setCondition] = useState(asset.condition);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const available = asset.status === "In Stock" && !asset.currentAllocation;
  const [reload, setReload] = useState(0);
  const changeOpen = useCallback((next: boolean) => { if (!submitting.current) setOpen(next); }, []);
  useEffect(() => {
    if (!open || !can("Assets.Allocate") || !available) return;
    let active = true;
    setLoading(true); setError(""); setOptions(null);
    void apiGet<AssetOptions>("/api/v1/assets/options", api).then(data => { if (active) setOptions(data); }).catch(value => { if (active) setError(value instanceof Error ? value.message : "Unable to load permitted employees"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, can, open, available, reload]);
  const eligible = useMemo(() => options?.employees.filter(employee => ["Active", "Probation", "Notice Period"].includes(employee.employmentStatus) && employee.officeId === asset.office?.id) ?? [], [options, asset.office?.id]);
  const selected = eligible.find(employee => employee.id === employeeId);
  const matches = eligible.filter(employee => [employee.fullName, employee.employeeCode, employee.userCode, employee.designationName, employee.officeName].filter(Boolean).join(" ").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  // A selected employee stays visible while the user changes their search.
  const choices = selected && !matches.includes(selected) ? [selected, ...matches] : matches;
  async function issue(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !available || !can("Assets.Allocate") || !selected) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const updated = await apiRequest<AssetRecord>(`/api/v1/assets/${asset.id}/allocate`, api, { method: "POST", body: JSON.stringify({ employee_id: selected.id, issue_date: issueDate, condition_at_issue: condition, remarks: note.trim() || null }) });
      setOpen(false); setEmployeeId(""); setSearch(""); setNote("");
      onIssued(updated);
    } catch (value) { setError(value instanceof Error ? value.message : "Unable to issue asset"); }
    finally { submitting.current = false; setBusy(false); }
  }
  if (!can("Assets.Allocate") || !available) return null;
  return <AssetActionPopup label="Issue Asset" open={open} onOpenChange={changeOpen}>
    <form onSubmit={issue} className="space-y-4" aria-busy={busy || loading}>
      <div><h3 className="text-lg font-semibold text-text-primary">Issue {asset.assetCode}</h3><p className="mt-1 text-sm text-text-secondary">Select an eligible employee in {asset.office?.name ?? "the asset's office"}. Confirmation creates an employee custody record and marks this asset Assigned.</p></div>
      {loading ? <LoadingState>Loading permitted employees…</LoadingState> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {!loading && !options ? <Button type="button" variant="secondary" disabled={busy} onClick={() => setReload(value => value + 1)}>Reload employees</Button> : null}
      <Field label="Search employees"><TextInput aria-label="Search employees for asset issue" placeholder="Employee name, code or designation" value={search} onChange={event => setSearch(event.target.value)} disabled={busy || loading} /></Field>
      <Field label="Employee" help="Only permitted, eligible employees in this asset's office are listed. Transfer office custody first when issuing to another office."><Select aria-label="Employee for asset issue" value={employeeId} required disabled={busy || loading} onChange={event => setEmployeeId(event.target.value)}><option value="">Select employee</option>{choices.map(employee => <option key={employee.id} value={employee.id}>{employee.fullName} · {employee.employeeCode ?? employee.userCode}</option>)}</Select></Field>
      {options && !matches.length ? <EmptyState>No eligible employees match this search.</EmptyState> : null}
      {selected ? <dl className="grid gap-3 rounded-[10px] border border-brand-border bg-surface-subtle p-3 sm:grid-cols-2">{[["Employee", selected.fullName], ["Employee code", selected.employeeCode ?? selected.userCode], ["Designation", selected.designationName ?? "Not recorded"], ["Office", selected.officeName ?? options?.offices.find(office => office.id === selected.officeId)?.name ?? "Not recorded"]].map(([label, value]) => <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="mt-1 break-words text-sm font-medium text-text-primary">{value}</dd></div>)}</dl> : null}
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Issue date"><DatePicker aria-label="Asset issue date" value={issueDate} onChange={setIssueDate} required disabled={busy} /></Field><Field label="Condition at issue"><Select aria-label="Asset condition at issue" value={condition} onChange={event => setCondition(event.target.value)} required disabled={busy || loading}>{options?.conditions.map(value => <option key={value}>{value}</option>)}</Select></Field></div>
      <Field label="Note (optional)"><Textarea aria-label="Asset issue note" value={note} maxLength={4000} disabled={busy} onChange={event => setNote(event.target.value)} /></Field>
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={() => changeOpen(false)}>Cancel</Button><Button type="submit" disabled={busy || loading || !selected || !issueDate}>{busy ? "Issuing…" : "Confirm assignment"}</Button></div>
    </form>
  </AssetActionPopup>;
}
