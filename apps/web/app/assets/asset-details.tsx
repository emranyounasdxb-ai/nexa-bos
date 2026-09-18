"use client";


import { AssetActionPopup as PanelPopup } from "./asset-action-popup";
import { AssetLifecycle, type LifecycleHistoryRecord } from "./asset-lifecycle";
import styles from "./lifecycle.module.css";
import { createPortal } from "react-dom";
import { IssueAssetAction } from "./asset-issue";
import { AssetCustodian, AssetStatusBadge } from "./asset-position";



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
  SectionHeader,
  Select,
  Textarea,
  TextInput,
  cx,
} from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import { formatLocalDateTime } from "@/lib/presentation";
import type { AssetOptions, AssetRecord } from "@/lib/types";

const today = () => new Date().toISOString().slice(0, 10);

type AssetTab = "master" | "custody" | "status" | "audit";

const TABS: Array<{ id: AssetTab; label: string }> = [
  { id: "master", label: "Overview" },
  { id: "audit", label: "Lifecycle History" },
  { id: "custody", label: "Manage Asset" },
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
  if (value === "status") return "custody";
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

export function AssetDetails({ assetId, onMutation, initialTab }: { assetId: string; onMutation?: () => void; initialTab?: AssetTab }) {
  const { can } = useAuth();
  const tabs = TABS.filter(tab => tab.id !== "audit" || can("Assets.ViewAudit"));
  const api = getBrowserApiUrl();
  const [asset, setAsset] = useState<AssetRecord | null>(null);
  const [options, setOptions] = useState<AssetOptions | null>(null);
  const [history, setHistory] = useState<LifecycleHistoryRecord | null>(null);
  const [activeTab, setActiveTab] = useState<AssetTab>(validTab(initialTab ?? "master"));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
        apiGet<AssetRecord>(`/api/v1/assets/${assetId}`, api),
        apiGet<AssetOptions>("/api/v1/assets/options", api),
      ]);
      setAsset(loaded);
      setOptions(loadedOptions);
      setCondition(loaded.condition);
      setStatus(loadedOptions.statuses.find(item => item !== loaded.status && !(item === "In Stock" && loaded.currentAllocation) && !(item === "Allocated" && !loaded.currentAllocation) && !(item === "Retired" && loaded.currentAllocation)) ?? "");
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
        setHistory(await apiGet<LifecycleHistoryRecord>(`/api/v1/assets/${assetId}/history`, api));
      } else {
        setHistory(null);
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to load Asset");
    } finally {
      setLoading(false);
    }
  }, [api, can, assetId]);

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
      const tab = validTab(initialTab ?? new URLSearchParams(window.location.search).get("tab"));
      setActiveTab(tab === "audit" && !can("Assets.ViewAudit") ? "master" : tab);
    }
    restoreTab();
    window.addEventListener("popstate", restoreTab);
    if (can("Assets.View")) void refresh();
    return () => window.removeEventListener("popstate", restoreTab);
  }, [can, refresh, initialTab]);

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

  function selectTab(nextTab: AssetTab) {
    if (nextTab === activeTab) return;
    setActiveTab(nextTab);
    const query = new URLSearchParams(window.location.search);
    query.set("tab", nextTab);
    window.history.replaceState(null, "", `${window.location.pathname}?${query.toString()}`);
  }

  function handleTabKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
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
      setTransferEmployee("");
      setTransferOffice("");
      await refresh();
      onMutation?.();
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
      await apiRequest(`/api/v1/assets/${assetId}`, api, {
        method: "PATCH",
        body: JSON.stringify(master),
      });
      await refresh();
      onMutation?.();
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
    <section className={styles.detailsRoot}>
      <div className={styles.stickyHeader}><div className={styles.headerIdentity}><div className="min-w-0"><h3 className="text-lg font-semibold text-text-primary">{asset.assetCode}</h3><p className="mt-0.5 break-words text-sm text-text-secondary">{asset.category.name} · {asset.brand ?? asset.model ?? asset.serialNumber ?? "Asset details"}</p></div><div className="flex flex-wrap gap-2"><AssetStatusBadge asset={asset} /><Badge>{asset.condition}</Badge></div></div>      <div className={styles.tabs} style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} role="tablist" aria-label="Asset workspace">
        {tabs.map((tab, index) => (
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
              activeTab === tab.id ? "bg-brand-fill text-white" : "text-text-secondary hover:bg-brand-soft hover:text-brand-primary",
            )}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => handleTabKey(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div></div>
      {asset.outstanding ? (
        <p className="rounded-[10px] border border-danger bg-danger-soft p-3 text-sm font-semibold text-danger">
          Outstanding Asset: the leaving employee still has active custody. Use an explicit Return to close it.
        </p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {message ? <p role="status" className="text-sm font-medium text-success">{message}</p> : null}




      <div id={`asset-panel-${activeTab}`} role="tabpanel" aria-labelledby={`asset-tab-${activeTab}`}>
        {activeTab === "master" ? (
          <div className={styles.overview}>
            <Card className={styles.section}>
              <div className={styles.sectionHeading}><SectionHeader title="Current custody" />            <div className={styles.actionRow}>      <IssueAssetAction asset={asset} onIssued={updated => { setAsset(updated); setMessage(`${updated.assetCode} assigned to ${updated.currentAllocation?.employeeName ?? "the selected employee"}`); onMutation?.(); void refresh(); }} />
{asset.currentAllocation && can("Assets.Return") && (asset.status === "Allocated" || (asset.status === "Under Repair" && can("Assets.ManageStatus"))) ? <Button onClick={() => selectTab("custody")}>{asset.status === "Under Repair" ? "Receive from repair" : "Receive return"}</Button> : asset.status === "Under Repair" && !asset.currentAllocation && can("Assets.ManageStatus") ? <Button onClick={() => selectTab("custody")}>Receive from repair</Button> : can("Assets.ManageMaster") || can("Assets.ManageStock") || can("Assets.ManageStatus") || can("Assets.Transfer") ? <Button variant="secondary" onClick={() => selectTab("custody")}>Manage Asset</Button> : null}</div></div>
              <dl className={styles.overviewGrid}><Detail label="Custodian / location"><AssetCustodian asset={asset} /></Detail><Detail label="Current office">{asset.office?.name ?? "Not recorded"}</Detail>                {asset.currentAllocation ? <><Detail label="Employee code">{asset.currentAllocation.employeeCode ?? "Not recorded"}</Detail><Detail label="Issued on">{asset.currentAllocation.issueDate}</Detail><Detail label="Issued by">{asset.currentAllocation.issuedBy ?? "Not recorded"}</Detail><Detail label="Condition at issue">{asset.currentAllocation.conditionAtIssue}</Detail><Detail label="Issue note">{asset.currentAllocation.issueRemarks ?? "Not recorded"}</Detail></> : null}
</dl>
            </Card>
            <Card className={styles.section}><SectionHeader title="Asset identity" /><dl className={styles.overviewGrid}>                <Detail label="Brand">{asset.brand ?? "—"}</Detail>
                <Detail label="Model">{asset.model ?? "—"}</Detail>
                <Detail label="Serial / Service Tag">{asset.serialNumber ?? "—"}</Detail>
                <Detail label="IMEI">{asset.imei ?? "—"}</Detail>
                <Detail label="ICCID">{asset.iccid ?? "—"}</Detail>
                <Detail label="Mobile Number">{asset.mobileNumber ?? "—"}</Detail>
                <Detail label="Operator">{asset.operator ?? "—"}</Detail>
                <Detail label="Description">{asset.description ?? "—"}</Detail>
                 {Object.entries(asset.attributes).map(([key, value]) => (
                  <Detail key={key} label={asset.category.fields.find((field) => field.key === key)?.label ?? key}>{value}</Detail>
                ))}</dl></Card>
            <Card className={styles.section}><SectionHeader title="Registration details" /><dl className={styles.overviewGrid}><Detail label="Registered">{formatLocalDateTime(asset.createdAt)}</Detail><Detail label="Last updated">{formatLocalDateTime(asset.updatedAt)}</Detail></dl></Card>
          </div>
        ) : null}

        {activeTab === "custody" ? (
          <div className={styles.manage}>
            {(can("Assets.Allocate") && asset.status === "In Stock" && !asset.currentAllocation) || (asset.currentAllocation && can("Assets.Return") && (asset.status === "Allocated" || (asset.status === "Under Repair" && can("Assets.ManageStatus")))) || (can("Assets.Transfer") && asset.status !== "Retired") ? <Card className={styles.section}><SectionHeader title="Custody actions" /><div className={styles.actionRow}>      <IssueAssetAction asset={asset} onIssued={updated => { setAsset(updated); setMessage(`${updated.assetCode} assigned to ${updated.currentAllocation?.employeeName ?? "the selected employee"}`); onMutation?.(); void refresh(); }} />
               {asset.currentAllocation && can("Assets.Return") && (asset.status === "Allocated" || (asset.status === "Under Repair" && can("Assets.ManageStatus"))) ? (
                <PanelPopup feedback={<><ErrorText>{error}</ErrorText>{message ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}</>} label={asset.status === "Under Repair" ? "Receive from repair" : "Receive return"}><Card>
                  <SectionHeader title="Return Asset" description={`Closes ${asset.currentAllocation.employeeName}'s active custody and returns the Asset to Office stock.`} />
                  {returnCondition === "Damaged" ? <p className="mt-2 text-xs text-text-secondary">A damaged return also changes Asset status and requires Assets.ManageStatus plus a reason.</p> : null}
                  <div className="mt-3 space-y-3">
                    <Field label="Return Date"><DatePicker aria-label="Asset Return Date" value={returnDate} onChange={setReturnDate} required /></Field>
                    <Field label="Return Condition"><Select aria-label="Return Condition" value={returnCondition} onChange={(event) => setReturnCondition(event.target.value)}>{options?.conditions.map((item) => <option key={item}>{item}</option>)}</Select></Field>
                    <Field label={returnCondition === "Damaged" ? "Mandatory reason" : "Remarks"}><Textarea aria-label="Return remarks" required={returnCondition === "Damaged" || asset.status === "Under Repair"} value={remarks} onChange={(event) => setRemarks(event.target.value)} /></Field>
                    <Button type="button" disabled={busy || (asset.status === "Under Repair" && !remarks.trim()) || (returnCondition === "Damaged" && (!can("Assets.ManageStatus") || !remarks.trim()))} onClick={(event) => requestConfirmation(event.currentTarget, {
                      title: "Process Asset return?",
                      description: `${asset.currentAllocation?.employeeName}'s custody will close on ${returnDate}. The allocation history remains permanent.${returnCondition === "Damaged" ? " The Asset will also be marked Damaged." : ""}`,
                      confirmLabel: "Confirm return",
                      path: `/api/v1/assets/${asset.id}/return`,
                      body: { return_date: returnDate, return_condition: returnCondition, remarks: remarks || null },
                      success: "Asset returned; allocation history preserved",
                    })}>Process Return</Button>
                  </div>
                </Card></PanelPopup>
              ) : null}
              {asset.currentAllocation && asset.status === "Allocated" && can("Assets.Transfer") ? (
                <PanelPopup feedback={<><ErrorText>{error}</ErrorText>{message ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}</>} label="Employee transfer"><Card>
                  <SectionHeader title="Employee transfer" description="Atomically closes current employee custody and opens custody for the selected employee." />
                  <div className="mt-3 space-y-3">
                    <Field label="New employee"><Select aria-label="Transfer employee" value={transferEmployee} onChange={(event) => setTransferEmployee(event.target.value)}><option value="">Select employee</option>{transferEmployees.map((item) => <option key={item.id} value={item.id}>{item.fullName} ({item.employmentStatus})</option>)}</Select></Field>
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
                </Card></PanelPopup>
              ) : null}
              {can("Assets.Transfer") && asset.status !== "Retired" ? (
                <PanelPopup feedback={<><ErrorText>{error}</ErrorText>{message ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}</>} label="Office transfer"><Card>
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
                </Card></PanelPopup>
              ) : null}
</div></Card> : null}
            {can("Assets.ManageStock") || (can("Assets.ManageStatus") && (["In Stock", "Allocated"].includes(asset.status) || (asset.status === "Under Repair" && !asset.currentAllocation))) ? <Card className={styles.section}><SectionHeader title="Asset maintenance" /><div className={styles.actionRow}>              {["In Stock", "Allocated"].includes(asset.status) && can("Assets.ManageStatus") ? <PanelPopup label="Send for repair"><Card><SectionHeader title="Send for repair" description="Mark the asset Under Repair. Existing custody and its complete history remain recorded." /><Field label="Repair reason"><Textarea aria-label="Asset repair reason" required value={reason} onChange={event => setReason(event.target.value)} /></Field><Button disabled={busy || !reason.trim()} onClick={event => requestConfirmation(event.currentTarget, { title: "Send asset for repair?", description: "The asset will be unavailable for allocation while Under Repair. Active custody is retained until an explicit receipt closes it.", confirmLabel: "Send for repair", path: `/api/v1/assets/${asset.id}/status`, body: { status: "Under Repair", reason }, success: "Asset sent for repair; custody history preserved" })}>Send for repair</Button></Card></PanelPopup> : null}
              {asset.status === "Under Repair" && !asset.currentAllocation && can("Assets.ManageStatus") ? <PanelPopup label="Receive from repair"><Card><SectionHeader title="Receive from repair" description="Return repaired office stock to available inventory. A reason remains in audit history." /><Field label="Repair completion reason"><Textarea value={reason} onChange={event => setReason(event.target.value)} required /></Field><Button disabled={busy || !reason.trim()} onClick={event => requestConfirmation(event.currentTarget, { title: "Receive repaired asset?", description: "The asset will return to In Stock and become available for allocation. Repair history is retained.", confirmLabel: "Receive from repair", path: `/api/v1/assets/${asset.id}/status`, body: { status: "In Stock", reason }, success: "Repaired asset returned to available inventory" })}>Receive from repair</Button></Card></PanelPopup> : null}
             {can("Assets.ManageStock") ? <PanelPopup label="Correct condition"><Card><SectionHeader title="Condition management" description="The previous condition and your reason remain in immutable audit history." /><div className="mt-3 space-y-3"><Field label="Condition"><Select value={condition} onChange={event => setCondition(event.target.value)}>{options?.conditions.map(item => <option key={item}>{item}</option>)}</Select></Field><Field label="Mandatory reason"><Textarea required value={reason} onChange={event => setReason(event.target.value)} /></Field><Button disabled={busy || !reason.trim() || condition === asset.condition} onClick={event => requestConfirmation(event.currentTarget, { title: "Correct asset condition?", description: "This updates condition without changing custody or operational status. The previous value and reason remain recorded.", confirmLabel: "Confirm correction", path: `/api/v1/assets/${asset.id}/condition`, body: { condition, reason }, success: "Asset condition corrected with audit history" })}>Correct condition</Button></div></Card></PanelPopup> : null}
</div></Card> : null}
                        {can("Assets.ManageMaster") ? (
              <Card className={styles.section}><SectionHeader title="Record management" /><div className={styles.actionRow}>
                <PanelPopup feedback={<><ErrorText>{error}</ErrorText>{message ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}</>} label="Edit Asset master"><Card>
                  <SectionHeader title="Edit Asset master" description="Update descriptive fields without changing the immutable Asset Code." />
                  <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={updateMaster}>
                    <Field label="Brand"><TextInput aria-label="Edit Asset brand" value={master.brand} onChange={(event) => setMaster((current) => ({ ...current, brand: event.target.value }))} /></Field>
                    <Field label="Model"><TextInput aria-label="Edit Asset model" value={master.model} onChange={(event) => setMaster((current) => ({ ...current, model: event.target.value }))} /></Field>
                    <Field label="Mobile Number"><TextInput aria-label="Edit Asset mobile number" value={master.mobile_number} onChange={(event) => setMaster((current) => ({ ...current, mobile_number: event.target.value }))} /></Field>
                    <Field label="Operator"><TextInput aria-label="Edit Asset operator" value={master.operator} onChange={(event) => setMaster((current) => ({ ...current, operator: event.target.value }))} /></Field>
                    <Field label="Description" className="sm:col-span-2"><Textarea aria-label="Edit Asset description" value={master.description} onChange={(event) => setMaster((current) => ({ ...current, description: event.target.value }))} /></Field>
                    <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save master details"}</Button>
                  </form>
                </Card></PanelPopup>
                <PanelPopup feedback={<><ErrorText>{error}</ErrorText>{message ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}</>} label="Correct identifiers"><Card>
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
                </Card></PanelPopup>
              </div></Card>
            ) : null}
                        {can("Assets.ManageStatus") ? (
              <Card className={styles.section}>
                <SectionHeader title="Status management" description="Every status change requires a reason and creates an immutable audit event." />
                <div className={styles.statusForm}>
                  <Field label="New status"><Select aria-label="New Asset Status" value={status} onChange={(event) => setStatus(event.target.value)}>{options?.statuses.filter(item => item !== asset.status && !(item === "In Stock" && asset.currentAllocation) && !(item === "Allocated" && !asset.currentAllocation) && !(item === "Retired" && asset.currentAllocation)).map((item) => <option key={item}>{item}</option>)}</Select></Field>
                  <Field label="Mandatory reason"><Textarea aria-label="Asset status reason" required value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
                  <Button variant={status === "Retired" ? "danger" : "primary"} type="button" disabled={busy || !status || !reason.trim()} onClick={(event) => requestConfirmation(event.currentTarget, {
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
            ) : null}


          </div>
        ) : null}

        {activeTab === "audit" ? (
          can("Assets.ViewAudit") ? (
            history ? (
              <AssetLifecycle history={history} />
            ) : <LoadingState>Loading Asset audit…</LoadingState>
          ) : <Card><EmptyState>You do not have permission to view Asset audit history.</EmptyState></Card>
        ) : null}
      </div>

      {confirmation ? createPortal(
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/40 p-4" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeConfirmation(); }}>
          <section ref={confirmationRef} role="alertdialog" aria-modal="true" aria-labelledby="asset-confirm-title" aria-describedby="asset-confirm-description" className="w-full max-w-md rounded-[10px] border border-brand-border bg-surface p-4 shadow-2xl" onKeyDown={trapConfirmationFocus}>
            <h2 id="asset-confirm-title" className="text-[length:var(--amafh-text-section)] font-semibold text-text-primary">{confirmation.title}</h2>
            <p id="asset-confirm-description" className="mt-2 text-sm leading-6 text-text-secondary">{confirmation.description}</p>
            {confirmationError ? <div className="mt-3"><ErrorText>{confirmationError}</ErrorText></div> : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" autoFocus disabled={busy} onClick={closeConfirmation}>Cancel</Button>
              <Button type="button" variant={confirmation.danger ? "danger" : "primary"} disabled={busy} onClick={() => void runConfirmed()}>{busy ? "Working…" : confirmation.confirmLabel}</Button>
            </div>
          </section>
        </div>
      , document.body) : null}

    </section>
  );
}

