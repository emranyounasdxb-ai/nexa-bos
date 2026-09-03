"use client";

import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { DatePicker } from "@/components/date-picker";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  LoadingState,
  PageHeader,
  SectionHeader,
  Select,
  TableHead,
  TableShell,
  Td,
  Textarea,
  TextInput,
  Th,
  cx,
} from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { AssetHistoryRecord, AssetOptions, AssetRecord } from "@/lib/types";

const today = () => new Date().toISOString().slice(0, 10);

type AssetTab = "master" | "custody" | "status" | "audit";

const TABS: Array<{ id: AssetTab; label: string }> = [
  { id: "master", label: "Master" },
  { id: "custody", label: "Custody" },
  { id: "status", label: "Status" },
  { id: "audit", label: "Audit" },
];

type Confirmation = {
  body: object;
  confirmLabel: string;
  danger?: boolean;
  description: string;
  path: string;
  success: string;
  title: string;
};

function validTab(value: string | null): AssetTab {
  return TABS.some((tab) => tab.id === value) ? (value as AssetTab) : "master";
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-text-secondary">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-text-primary">{children}</dd>
    </div>
  );
}

export default function AssetDetailPage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [asset, setAsset] = useState<AssetRecord | null>(null);
  const [options, setOptions] = useState<AssetOptions | null>(null);
  const [history, setHistory] = useState<AssetHistoryRecord | null>(null);
  const [activeTab, setActiveTab] = useState<AssetTab>("master");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [issueDate, setIssueDate] = useState(today());
  const [condition, setCondition] = useState("Good");
  const [remarks, setRemarks] = useState("");
  const [returnDate, setReturnDate] = useState(today());
  const [returnCondition, setReturnCondition] = useState("Good");
  const [transferEmployee, setTransferEmployee] = useState("");
  const [transferOffice, setTransferOffice] = useState("");
  const [transferDate, setTransferDate] = useState(today());
  const [status, setStatus] = useState("Under Repair");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmationError, setConfirmationError] = useState("");
  const [master, setMaster] = useState({ brand: "", model: "", mobile_number: "", operator: "", description: "" });
  const [identifiers, setIdentifiers] = useState({ serial_number: "", imei: "", iccid: "", reason: "" });
  const confirmationRef = useRef<HTMLElement>(null);
  const confirmationTriggerRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [loaded, loadedOptions] = await Promise.all([
        apiGet<AssetRecord>(`/api/v1/assets/${params.id}`, api),
        apiGet<AssetOptions>("/api/v1/assets/options", api),
      ]);
      setAsset(loaded);
      setOptions(loadedOptions);
      setMaster({
        brand: loaded.brand ?? "",
        model: loaded.model ?? "",
        mobile_number: loaded.mobileNumber ?? "",
        operator: loaded.operator ?? "",
        description: loaded.description ?? "",
      });
      setIdentifiers({
        serial_number: loaded.serialNumber ?? "",
        imei: loaded.imei ?? "",
        iccid: loaded.iccid ?? "",
        reason: "",
      });
      if (can("Assets.ViewAudit")) {
        setHistory(await apiGet<AssetHistoryRecord>(`/api/v1/assets/${params.id}/history`, api));
      } else {
        setHistory(null);
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to load Asset");
    } finally {
      setLoading(false);
    }
  }, [api, can, params.id]);

  const restoreActionFocus = useCallback(() => {
    window.setTimeout(() => {
      if (confirmationTriggerRef.current?.isConnected) confirmationTriggerRef.current.focus();
      else document.getElementById(`asset-tab-${activeTab}`)?.focus();
    }, 0);
  }, [activeTab]);

  const closeConfirmation = useCallback(() => {
    if (busy) return;
    setConfirmation(null);
    setConfirmationError("");
    restoreActionFocus();
  }, [busy, restoreActionFocus]);

  useEffect(() => {
    function restoreTab() {
      setActiveTab(validTab(new URLSearchParams(window.location.search).get("tab")));
    }
    restoreTab();
    window.addEventListener("popstate", restoreTab);
    if (can("Assets.View")) void refresh();
    return () => window.removeEventListener("popstate", restoreTab);
  }, [can, refresh]);

  useEffect(() => {
    if (!confirmation) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      closeConfirmation();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [busy, closeConfirmation, confirmation]);

  const allocationEmployees = useMemo(
    () =>
      options?.employees.filter(
        (item) =>
          ["Active", "Probation", "Notice Period"].includes(item.employmentStatus) &&
          item.officeId === asset?.office?.id,
      ) ?? [],
    [asset?.office?.id, options],
  );
  const transferEmployees = useMemo(
    () =>
      options?.employees.filter(
        (item) =>
          ["Active", "Probation", "Notice Period"].includes(item.employmentStatus) &&
          item.id !== asset?.currentAllocation?.employeeId,
      ) ?? [],
    [asset?.currentAllocation?.employeeId, options],
  );
  const transferEmployeeName = transferEmployees.find((item) => item.id === transferEmployee)?.fullName;
  const transferOfficeName = options?.offices.find((item) => item.id === transferOffice)?.name;
  const allocationEmployeeName = allocationEmployees.find((item) => item.id === employeeId)?.fullName;

  function selectTab(nextTab: AssetTab) {
    if (nextTab === activeTab) return;
    setActiveTab(nextTab);
    const query = new URLSearchParams(window.location.search);
    query.set("tab", nextTab);
    window.history.pushState(null, "", `${window.location.pathname}?${query.toString()}`);
  }

  function handleTabKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? TABS.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    const next = TABS[nextIndex];
    selectTab(next.id);
    document.getElementById(`asset-tab-${next.id}`)?.focus();
  }

  function requestConfirmation(trigger: HTMLElement, next: Confirmation) {
    confirmationTriggerRef.current = trigger;
    setConfirmationError("");
    setConfirmation(next);
  }

  function trapConfirmationFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      confirmationRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function runConfirmed() {
    if (!confirmation) return;
    setBusy(true);
    setConfirmationError("");
    setError("");
    setMessage("");
    try {
      await apiRequest(confirmation.path, api, {
        method: "POST",
        body: JSON.stringify(confirmation.body),
      });
      const success = confirmation.success;
      setReason("");
      setRemarks("");
      setEmployeeId("");
      setTransferEmployee("");
      setTransferOffice("");
      await refresh();
      setMessage(success);
      setConfirmation(null);
      restoreActionFocus();
    } catch (value) {
      setConfirmationError(value instanceof Error ? value.message : "Asset operation failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateMaster(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(`/api/v1/assets/${params.id}`, api, {
        method: "PATCH",
        body: JSON.stringify(master),
      });
      await refresh();
      setMessage("Asset master updated");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Asset update failed");
    } finally {
      setBusy(false);
    }
  }

  if (!can("Assets.View")) {
    return <EmptyState>You do not have permission to view Assets.</EmptyState>;
  }
  if (loading && !asset) {
    return <LoadingState>Loading Asset…</LoadingState>;
  }
  if (!asset) {
    return <ErrorText>{error || "Asset could not be loaded."}</ErrorText>;
  }

  return (
    <section className="min-w-0 space-y-4">
      <PageHeader
        title={asset.assetCode}
        description={`${asset.category.name} · ${asset.office?.name ?? "No Office"}`}
        actions={<><Badge>{asset.status}</Badge><Badge>{asset.condition}</Badge></>}
      />
      {asset.outstanding ? (
        <p className="rounded-[10px] border border-danger bg-danger-soft p-3 text-sm font-semibold text-danger">
          Outstanding Asset: the leaving employee still has active custody. Use an explicit Return to close it.
        </p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {message ? <p role="status" className="text-sm font-medium text-success">{message}</p> : null}

      <Card>
        <SectionHeader title="Asset identity and custody" description="Current operational state at a glance." />
        <dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Category">{asset.category.name}</Detail>
          <Detail label="Current Office">{asset.office?.name ?? "—"}</Detail>
          <Detail label="Current employee">{asset.currentAllocation?.employeeName ?? "Available stock"}</Detail>
          <Detail label="Primary identity">{asset.serialNumber ?? asset.imei ?? asset.iccid ?? asset.mobileNumber ?? asset.model ?? "—"}</Detail>
        </dl>
      </Card>

      <div className="grid min-w-0 grid-cols-2 gap-1 rounded-[10px] border border-brand-border bg-surface p-1 sm:grid-cols-4" role="tablist" aria-label="Asset workspace">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            id={`asset-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`asset-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={cx(
              "h-8 min-w-0 rounded-md px-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary",
              activeTab === tab.id ? "bg-brand-primary text-white" : "text-text-secondary hover:bg-brand-soft hover:text-brand-primary",
            )}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => handleTabKey(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div id={`asset-panel-${activeTab}`} role="tabpanel" aria-labelledby={`asset-tab-${activeTab}`}>
        {activeTab === "master" ? (
          <div className="space-y-4">
            <Card>
              <SectionHeader title="Master data" description="Identifiers and descriptive details recorded for this Asset." />
              <dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Detail label="Brand">{asset.brand ?? "—"}</Detail>
                <Detail label="Model">{asset.model ?? "—"}</Detail>
                <Detail label="Serial / Service Tag">{asset.serialNumber ?? "—"}</Detail>
                <Detail label="IMEI">{asset.imei ?? "—"}</Detail>
                <Detail label="ICCID">{asset.iccid ?? "—"}</Detail>
                <Detail label="Mobile Number">{asset.mobileNumber ?? "—"}</Detail>
                <Detail label="Operator">{asset.operator ?? "—"}</Detail>
                <Detail label="Description">{asset.description ?? "—"}</Detail>
                {Object.entries(asset.attributes).map(([key, value]) => (
                  <Detail key={key} label={asset.category.fields.find((field) => field.key === key)?.label ?? key}>{value}</Detail>
                ))}
              </dl>
            </Card>

            {can("Assets.ManageMaster") ? (
              <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                <Card>
                  <SectionHeader title="Edit Asset master" description="Update descriptive fields without changing the immutable Asset Code." />
                  <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={updateMaster}>
                    <Field label="Brand"><TextInput aria-label="Edit Asset brand" value={master.brand} onChange={(event) => setMaster((current) => ({ ...current, brand: event.target.value }))} /></Field>
                    <Field label="Model"><TextInput aria-label="Edit Asset model" value={master.model} onChange={(event) => setMaster((current) => ({ ...current, model: event.target.value }))} /></Field>
                    <Field label="Mobile Number"><TextInput aria-label="Edit Asset mobile number" value={master.mobile_number} onChange={(event) => setMaster((current) => ({ ...current, mobile_number: event.target.value }))} /></Field>
                    <Field label="Operator"><TextInput aria-label="Edit Asset operator" value={master.operator} onChange={(event) => setMaster((current) => ({ ...current, operator: event.target.value }))} /></Field>
                    <Field label="Description" className="sm:col-span-2"><Textarea aria-label="Edit Asset description" value={master.description} onChange={(event) => setMaster((current) => ({ ...current, description: event.target.value }))} /></Field>
                    <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save master details"}</Button>
                  </form>
                </Card>
                <Card>
                  <SectionHeader title="Correct identifiers" description="A mandatory reason and immutable audit entry are recorded." />
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Serial / Service Tag"><TextInput aria-label="Correct Serial Number" value={identifiers.serial_number} onChange={(event) => setIdentifiers((current) => ({ ...current, serial_number: event.target.value }))} /></Field>
                    <Field label="IMEI"><TextInput aria-label="Correct IMEI" value={identifiers.imei} onChange={(event) => setIdentifiers((current) => ({ ...current, imei: event.target.value }))} /></Field>
                    <Field label="ICCID"><TextInput aria-label="Correct ICCID" value={identifiers.iccid} onChange={(event) => setIdentifiers((current) => ({ ...current, iccid: event.target.value }))} /></Field>
                    <Field label="Reason"><TextInput aria-label="Identifier correction reason" required value={identifiers.reason} onChange={(event) => setIdentifiers((current) => ({ ...current, reason: event.target.value }))} /></Field>
                    <Button
                      type="button"
                      disabled={busy || !identifiers.reason.trim()}
                      onClick={(event) => requestConfirmation(event.currentTarget, {
                        title: "Correct Asset identifiers?",
                        description: "The new identifiers must remain unique. The previous values and your reason will remain in immutable audit history.",
                        confirmLabel: "Confirm correction",
                        path: `/api/v1/assets/${asset.id}/identifiers`,
                        body: identifiers,
                        success: "Identifiers corrected with audit history",
                      })}
                    >
                      Review correction
                    </Button>
                  </div>
                </Card>
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === "custody" ? (
          <div className="space-y-4">
            <Card>
              <SectionHeader title="Current custody" description={asset.currentAllocation ? "This Asset is assigned to an employee." : "This Asset is held as Office stock."} />
              <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                <Detail label="Office">{asset.office?.name ?? "—"}</Detail>
                <Detail label="Employee">{asset.currentAllocation?.employeeName ?? "Available stock"}</Detail>
                <Detail label="Custody status">{asset.currentAllocation ? "Allocated" : asset.status}</Detail>
              </dl>
            </Card>
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              {!asset.currentAllocation && asset.status === "In Stock" && can("Assets.Allocate") ? (
                <Card>
                  <SectionHeader title="Allocate to employee" description="Creates an active custody record for an eligible employee in this Office." />
                  <div className="mt-3 space-y-3">
                    <Field label="Eligible employee"><Select aria-label="Allocation employee" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Select employee</option>{allocationEmployees.map((item) => <option key={item.id} value={item.id}>{item.userCode} — {item.fullName} ({item.employmentStatus})</option>)}</Select></Field>
                    <Field label="Issue Date"><DatePicker aria-label="Asset Issue Date" value={issueDate} onChange={setIssueDate} required /></Field>
                    <Field label="Condition at Issue"><Select aria-label="Condition at Issue" value={condition} onChange={(event) => setCondition(event.target.value)}>{options?.conditions.map((item) => <option key={item}>{item}</option>)}</Select></Field>
                    <Field label="Remarks"><Textarea aria-label="Allocation remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} /></Field>
                    <Button type="button" disabled={busy || !employeeId} onClick={(event) => requestConfirmation(event.currentTarget, {
                      title: "Allocate Asset?",
                      description: `${asset.assetCode} will leave Office stock and be assigned to ${allocationEmployeeName ?? "the selected employee"}. A custody record will be created.`,
                      confirmLabel: "Confirm allocation",
                      path: `/api/v1/assets/${asset.id}/allocate`,
                      body: { employee_id: employeeId, issue_date: issueDate, condition_at_issue: condition, remarks: remarks || null },
                      success: "Asset allocated",
                    })}>Allocate Asset</Button>
                  </div>
                </Card>
              ) : null}
              {asset.currentAllocation && can("Assets.Return") ? (
                <Card>
                  <SectionHeader title="Return Asset" description={`Closes ${asset.currentAllocation.employeeName}'s active custody and returns the Asset to Office stock.`} />
                  {returnCondition === "Damaged" ? <p className="mt-2 text-xs text-text-secondary">A damaged return also changes Asset status and requires Assets.ManageStatus plus a reason.</p> : null}
                  <div className="mt-3 space-y-3">
                    <Field label="Return Date"><DatePicker aria-label="Asset Return Date" value={returnDate} onChange={setReturnDate} required /></Field>
                    <Field label="Return Condition"><Select aria-label="Return Condition" value={returnCondition} onChange={(event) => setReturnCondition(event.target.value)}>{options?.conditions.map((item) => <option key={item}>{item}</option>)}</Select></Field>
                    <Field label={returnCondition === "Damaged" ? "Mandatory reason" : "Remarks"}><Textarea aria-label="Return remarks" required={returnCondition === "Damaged"} value={remarks} onChange={(event) => setRemarks(event.target.value)} /></Field>
                    <Button type="button" disabled={busy || (returnCondition === "Damaged" && (!can("Assets.ManageStatus") || !remarks.trim()))} onClick={(event) => requestConfirmation(event.currentTarget, {
                      title: "Process Asset return?",
                      description: `${asset.currentAllocation?.employeeName}'s custody will close on ${returnDate}. The allocation history remains permanent.${returnCondition === "Damaged" ? " The Asset will also be marked Damaged." : ""}`,
                      confirmLabel: "Confirm return",
                      path: `/api/v1/assets/${asset.id}/return`,
                      body: { return_date: returnDate, return_condition: returnCondition, remarks: remarks || null },
                      success: "Asset returned; allocation history preserved",
                    })}>Process Return</Button>
                  </div>
                </Card>
              ) : null}
              {asset.currentAllocation && can("Assets.Transfer") ? (
                <Card>
                  <SectionHeader title="Employee transfer" description="Atomically closes current employee custody and opens custody for the selected employee." />
                  <div className="mt-3 space-y-3">
                    <Field label="New employee"><Select aria-label="Transfer employee" value={transferEmployee} onChange={(event) => setTransferEmployee(event.target.value)}><option value="">Select employee</option>{transferEmployees.map((item) => <option key={item.id} value={item.id}>{item.userCode} — {item.fullName} ({item.employmentStatus})</option>)}</Select></Field>
                    <Field label="Transfer Date"><DatePicker aria-label="Employee Transfer Date" value={transferDate} onChange={setTransferDate} required /></Field>
                    <Field label="Condition"><Select aria-label="Employee Transfer Condition" value={condition} onChange={(event) => setCondition(event.target.value)}>{options?.conditions.map((item) => <option key={item}>{item}</option>)}</Select></Field>
                    <Field label="Remarks"><Textarea aria-label="Employee transfer remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} /></Field>
                    <Button type="button" disabled={busy || !transferEmployee} onClick={(event) => requestConfirmation(event.currentTarget, {
                      title: "Transfer employee custody?",
                      description: `${asset.currentAllocation?.employeeName}'s custody will close and ${transferEmployeeName ?? "the selected employee"} will receive this Asset. Both records remain in history.`,
                      confirmLabel: "Confirm transfer",
                      path: `/api/v1/assets/${asset.id}/transfer/employee`,
                      body: { employee_id: transferEmployee, transfer_date: transferDate, condition, remarks: remarks || null },
                      success: "Employee custody transferred atomically",
                    })}>Transfer Employee</Button>
                  </div>
                </Card>
              ) : null}
              {can("Assets.Transfer") && asset.status !== "Retired" ? (
                <Card>
                  <SectionHeader title="Office transfer" description="Moves Office responsibility while preserving the complete custody chain." />
                  <div className="mt-3 space-y-3">
                    <Field label="Destination Office"><Select aria-label="Transfer Office" value={transferOffice} onChange={(event) => setTransferOffice(event.target.value)}><option value="">Select Office</option>{options?.offices.filter((item) => item.id !== asset.office?.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
                    <Field label="Transfer Date"><DatePicker aria-label="Office Transfer Date" value={transferDate} onChange={setTransferDate} required /></Field>
                    <Field label="Remarks"><Textarea aria-label="Office transfer remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} /></Field>
                    <Button type="button" disabled={busy || !transferOffice} onClick={(event) => requestConfirmation(event.currentTarget, {
                      title: "Transfer Office custody?",
                      description: `${asset.assetCode} will move from ${asset.office?.name ?? "its current Office"} to ${transferOfficeName ?? "the selected Office"}. Existing custody history remains unchanged.`,
                      confirmLabel: "Confirm Office transfer",
                      path: `/api/v1/assets/${asset.id}/transfer/office`,
                      body: { office_id: transferOffice, transfer_date: transferDate, remarks: remarks || null },
                      success: "Office custody transferred",
                    })}>Transfer Office</Button>
                  </div>
                </Card>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeTab === "status" ? (
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <Card>
              <SectionHeader title="Operational status" description="Condition and status are tracked independently from employee custody." />
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                <Detail label="Current status"><Badge>{asset.status}</Badge></Detail>
                <Detail label="Current condition"><Badge>{asset.condition}</Badge></Detail>
                <Detail label="Custody">{asset.currentAllocation?.employeeName ?? "Office stock"}</Detail>
                <Detail label="Outstanding">{asset.outstanding ? "Yes" : "No"}</Detail>
              </dl>
            </Card>
            {can("Assets.ManageStatus") ? (
              <Card>
                <SectionHeader title="Status management" description="Every status change requires a reason and creates an immutable audit event." />
                <div className="mt-3 space-y-3">
                  <Field label="New status"><Select aria-label="New Asset Status" value={status} onChange={(event) => setStatus(event.target.value)}>{options?.statuses.map((item) => <option key={item}>{item}</option>)}</Select></Field>
                  <Field label="Mandatory reason"><Textarea aria-label="Asset status reason" required value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
                  <Button variant={status === "Retired" ? "danger" : "primary"} type="button" disabled={busy || !reason.trim()} onClick={(event) => requestConfirmation(event.currentTarget, {
                    title: status === "Retired" ? "Retire this Asset?" : `Change status to ${status}?`,
                    description: status === "Retired"
                      ? "Retirement removes the Asset from active custody operations. An allocated Asset cannot be retired, and the reason remains in audit history."
                      : `The Asset will be marked ${status}. The reason remains in immutable audit history.`,
                    confirmLabel: status === "Retired" ? "Confirm retirement" : "Confirm status change",
                    danger: status === "Retired",
                    path: `/api/v1/assets/${asset.id}/status`,
                    body: { status, reason },
                    success: "Asset status updated",
                  })}>{status === "Retired" ? "Retire Asset" : "Update Status"}</Button>
                </div>
              </Card>
            ) : (
              <Card><EmptyState>You do not have permission to change Asset status.</EmptyState></Card>
            )}
          </div>
        ) : null}

        {activeTab === "audit" ? (
          can("Assets.ViewAudit") ? (
            history ? (
              <div className="space-y-4">
                <Card>
                  <SectionHeader title="Employee custody history" description="Every issue, transfer, and return remains available for review." />
                  {history.allocations.length ? (
                    <>
                      <div className="mt-3 hidden md:block">
                        <TableShell>
                          <TableHead><tr><Th>Employee</Th><Th>Issue</Th><Th>Issue condition</Th><Th>Return</Th><Th>Return condition</Th><Th>Closure</Th></tr></TableHead>
                          <tbody>{history.allocations.map((row) => <tr key={row.id} className="border-t border-slate-100"><Td>{row.employeeName}</Td><Td>{row.issueDate}</Td><Td>{row.conditionAtIssue}</Td><Td>{row.returnDate ?? "Active"}</Td><Td>{row.returnCondition ?? "—"}</Td><Td>{row.endType ?? "Current custody"}</Td></tr>)}</tbody>
                        </TableShell>
                      </div>
                      <div className="mt-3 grid gap-2 md:hidden">{history.allocations.map((row) => <Card key={row.id} className="!p-3"><p className="font-medium text-text-primary">{row.employeeName}</p><dl className="mt-2 grid grid-cols-2 gap-2"><Detail label="Issued">{row.issueDate}</Detail><Detail label="Returned">{row.returnDate ?? "Active"}</Detail><Detail label="Issue condition">{row.conditionAtIssue}</Detail><Detail label="Return condition">{row.returnCondition ?? "—"}</Detail></dl></Card>)}</div>
                    </>
                  ) : <EmptyState>No employee custody events are recorded.</EmptyState>}
                </Card>
                <Card>
                  <SectionHeader title="Office custody history" description="Office responsibility is preserved across transfers and retirement." />
                  {history.officeCustody.length ? (
                    <>
                      <div className="mt-3 hidden md:block"><TableShell><TableHead><tr><Th>Office</Th><Th>From</Th><Th>To</Th><Th>Reason</Th></tr></TableHead><tbody>{history.officeCustody.map((row) => <tr key={row.id} className="border-t border-slate-100"><Td>{row.officeName}</Td><Td>{row.startedOn}</Td><Td>{row.endedOn ?? "Current"}</Td><Td>{row.reason ?? "—"}</Td></tr>)}</tbody></TableShell></div>
                      <div className="mt-3 grid gap-2 md:hidden">{history.officeCustody.map((row) => <Card key={row.id} className="!p-3"><p className="font-medium text-text-primary">{row.officeName}</p><dl className="mt-2 grid grid-cols-2 gap-2"><Detail label="From">{row.startedOn}</Detail><Detail label="To">{row.endedOn ?? "Current"}</Detail></dl>{row.reason ? <p className="mt-2 text-xs text-text-secondary">{row.reason}</p> : null}</Card>)}</div>
                    </>
                  ) : <EmptyState>No Office custody events are recorded.</EmptyState>}
                </Card>
                <Card>
                  <SectionHeader title="Immutable audit trail" description="Recorded lifecycle actions and reasons cannot be edited or deleted." />
                  {history.events.length ? <ul className="mt-3 divide-y divide-brand-border text-sm">{history.events.map((event) => <li key={event.id} className="min-w-0 py-2 first:pt-0 last:pb-0"><div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><span className="font-medium text-text-primary">{event.action}</span><time className="text-xs text-text-secondary">{new Date(event.createdAt).toLocaleString()}</time></div>{event.reason ? <p className="mt-1 break-words text-text-secondary">{event.reason}</p> : null}</li>)}</ul> : <EmptyState>No audit events are recorded.</EmptyState>}
                </Card>
              </div>
            ) : <LoadingState>Loading Asset audit…</LoadingState>
          ) : <Card><EmptyState>You do not have permission to view Asset audit history.</EmptyState></Card>
        ) : null}
      </div>

      {confirmation ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/40 p-4" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeConfirmation(); }}>
          <section ref={confirmationRef} role="alertdialog" aria-modal="true" aria-labelledby="asset-confirm-title" aria-describedby="asset-confirm-description" className="w-full max-w-md rounded-[10px] border border-brand-border bg-surface p-4 shadow-2xl" onKeyDown={trapConfirmationFocus}>
            <h2 id="asset-confirm-title" className="text-base font-semibold text-text-primary">{confirmation.title}</h2>
            <p id="asset-confirm-description" className="mt-2 text-sm leading-6 text-text-secondary">{confirmation.description}</p>
            {confirmationError ? <div className="mt-3"><ErrorText>{confirmationError}</ErrorText></div> : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" autoFocus disabled={busy} onClick={closeConfirmation}>Cancel</Button>
              <Button type="button" variant={confirmation.danger ? "danger" : "primary"} disabled={busy} onClick={() => void runConfirmed()}>{busy ? "Working…" : confirmation.confirmLabel}</Button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
