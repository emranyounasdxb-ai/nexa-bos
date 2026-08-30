"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DatePicker } from "@/components/date-picker";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  PageHeader,
  Select,
  TableHead,
  TableShell,
  Td,
  Textarea,
  TextInput,
  Th,
} from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { AssetHistoryRecord, AssetOptions, AssetRecord } from "@/lib/types";

const today = () => new Date().toISOString().slice(0, 10);

export default function AssetDetailPage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [asset, setAsset] = useState<AssetRecord | null>(null);
  const [options, setOptions] = useState<AssetOptions | null>(null);
  const [history, setHistory] = useState<AssetHistoryRecord | null>(null);
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
  const [master, setMaster] = useState({ brand: "", model: "", mobile_number: "", operator: "", description: "" });
  const [identifiers, setIdentifiers] = useState({ serial_number: "", imei: "", iccid: "", reason: "" });

  const refresh = useCallback(async () => {
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
    }
  }, [api, can, params.id]);

  useEffect(() => {
    if (can("Assets.View")) {
      void refresh().catch((value: unknown) =>
        setError(value instanceof Error ? value.message : "Unable to load Asset"),
      );
    }
  }, [can, refresh]);

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

  async function run(path: string, body: object, success: string) {
    setError("");
    setMessage("");
    try {
      await apiRequest(path, api, { method: "POST", body: JSON.stringify(body) });
      setMessage(success);
      setReason("");
      setRemarks("");
      await refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Asset operation failed");
    }
  }

  async function updateMaster(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiRequest(`/api/v1/assets/${params.id}`, api, {
        method: "PATCH",
        body: JSON.stringify(master),
      });
      setMessage("Asset master updated");
      await refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Asset update failed");
    }
  }

  async function correctIdentifiers(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiRequest(`/api/v1/assets/${params.id}/identifiers`, api, {
        method: "POST",
        body: JSON.stringify(identifiers),
      });
      setMessage("Identifiers corrected with audit history");
      await refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Identifier correction failed");
    }
  }

  if (!can("Assets.View")) {
    return <EmptyState>You do not have permission to view Assets.</EmptyState>;
  }
  if (!asset) {
    return <ErrorText>{error || "Loading Asset…"}</ErrorText>;
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title={asset.assetCode}
        description={`${asset.category.name} · ${asset.office?.name ?? "No Office"}`}
        actions={<><Badge>{asset.status}</Badge><Badge>{asset.condition}</Badge></>}
      />
      {asset.outstanding ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">
          Outstanding Asset: the leaving employee still has active custody. Use explicit Return to close it.
        </p>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}

      <Card>
        <h3 className="font-semibold">Asset identity and custody</h3>
        <dl className="mt-3 grid gap-3 text-sm md:grid-cols-3">
          <div><dt className="text-slate-500">Category</dt><dd>{asset.category.name}</dd></div>
          <div><dt className="text-slate-500">Office</dt><dd>{asset.office?.name ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Employee</dt><dd>{asset.currentAllocation?.employeeName ?? "Available stock"}</dd></div>
          <div><dt className="text-slate-500">Brand</dt><dd>{asset.brand ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Model</dt><dd>{asset.model ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Serial / Service Tag</dt><dd>{asset.serialNumber ?? "—"}</dd></div>
          <div><dt className="text-slate-500">IMEI</dt><dd>{asset.imei ?? "—"}</dd></div>
          <div><dt className="text-slate-500">ICCID</dt><dd>{asset.iccid ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Mobile Number</dt><dd>{asset.mobileNumber ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Operator</dt><dd>{asset.operator ?? "—"}</dd></div>
          {Object.entries(asset.attributes).map(([key, value]) => <div key={key}><dt className="text-slate-500">{asset.category.fields.find((field) => field.key === key)?.label ?? key}</dt><dd>{value}</dd></div>)}
        </dl>
      </Card>

      {can("Assets.ManageMaster") ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="font-semibold">Edit Asset master</h3>
            <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={updateMaster}>
              <Field label="Brand"><TextInput aria-label="Edit Asset brand" value={master.brand} onChange={(event) => setMaster((current) => ({ ...current, brand: event.target.value }))} /></Field>
              <Field label="Model"><TextInput aria-label="Edit Asset model" value={master.model} onChange={(event) => setMaster((current) => ({ ...current, model: event.target.value }))} /></Field>
              <Field label="Mobile Number"><TextInput aria-label="Edit Asset mobile number" value={master.mobile_number} onChange={(event) => setMaster((current) => ({ ...current, mobile_number: event.target.value }))} /></Field>
              <Field label="Operator"><TextInput aria-label="Edit Asset operator" value={master.operator} onChange={(event) => setMaster((current) => ({ ...current, operator: event.target.value }))} /></Field>
              <Field label="Description" className="md:col-span-2"><Textarea aria-label="Edit Asset description" value={master.description} onChange={(event) => setMaster((current) => ({ ...current, description: event.target.value }))} /></Field>
              <Button type="submit">Save master details</Button>
            </form>
          </Card>
          <Card>
            <h3 className="font-semibold">Correct identifiers</h3>
            <p className="mt-1 text-xs text-slate-500">A mandatory reason and immutable audit entry are recorded.</p>
            <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={correctIdentifiers}>
              <Field label="Serial / Service Tag"><TextInput aria-label="Correct Serial Number" value={identifiers.serial_number} onChange={(event) => setIdentifiers((current) => ({ ...current, serial_number: event.target.value }))} /></Field>
              <Field label="IMEI"><TextInput aria-label="Correct IMEI" value={identifiers.imei} onChange={(event) => setIdentifiers((current) => ({ ...current, imei: event.target.value }))} /></Field>
              <Field label="ICCID"><TextInput aria-label="Correct ICCID" value={identifiers.iccid} onChange={(event) => setIdentifiers((current) => ({ ...current, iccid: event.target.value }))} /></Field>
              <Field label="Reason"><TextInput aria-label="Identifier correction reason" required value={identifiers.reason} onChange={(event) => setIdentifiers((current) => ({ ...current, reason: event.target.value }))} /></Field>
              <Button type="submit">Save identifier correction</Button>
            </form>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {!asset.currentAllocation && asset.status === "In Stock" && can("Assets.Allocate") ? (
          <Card>
            <h3 className="font-semibold">Allocate to employee</h3>
            <div className="mt-3 space-y-3">
              <Field label="Eligible employee"><Select aria-label="Allocation employee" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Select employee</option>{allocationEmployees.map((item) => <option key={item.id} value={item.id}>{item.userCode} — {item.fullName} ({item.employmentStatus})</option>)}</Select></Field>
              <Field label="Issue Date"><DatePicker aria-label="Asset Issue Date" value={issueDate} onChange={setIssueDate} required /></Field>
              <Field label="Condition at Issue"><Select aria-label="Condition at Issue" value={condition} onChange={(event) => setCondition(event.target.value)}>{options?.conditions.map((item) => <option key={item}>{item}</option>)}</Select></Field>
              <Field label="Remarks"><Textarea aria-label="Allocation remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} /></Field>
              <Button type="button" disabled={!employeeId} onClick={() => void run(`/api/v1/assets/${asset.id}/allocate`, { employee_id: employeeId, issue_date: issueDate, condition_at_issue: condition, remarks: remarks || null }, "Asset allocated")}>Allocate Asset</Button>
            </div>
          </Card>
        ) : null}
        {asset.currentAllocation && can("Assets.Return") ? (
          <Card>
            <h3 className="font-semibold">Return Asset</h3>
            <p className="mt-1 text-sm text-slate-600">Current custody: {asset.currentAllocation.employeeName}</p>
            {returnCondition === "Damaged" ? (
              <p className="mt-1 text-xs text-slate-500">
                A damaged return requires Assets.ManageStatus and a reason because it atomically changes Asset status.
              </p>
            ) : null}
            <div className="mt-3 space-y-3">
              <Field label="Return Date"><DatePicker aria-label="Asset Return Date" value={returnDate} onChange={setReturnDate} required /></Field>
              <Field label="Return Condition"><Select aria-label="Return Condition" value={returnCondition} onChange={(event) => setReturnCondition(event.target.value)}>{options?.conditions.map((item) => <option key={item}>{item}</option>)}</Select></Field>
              <Field label={returnCondition === "Damaged" ? "Mandatory reason" : "Remarks"}><Textarea aria-label="Return remarks" required={returnCondition === "Damaged"} value={remarks} onChange={(event) => setRemarks(event.target.value)} /></Field>
              <Button type="button" disabled={returnCondition === "Damaged" && (!can("Assets.ManageStatus") || !remarks.trim())} onClick={() => void run(`/api/v1/assets/${asset.id}/return`, { return_date: returnDate, return_condition: returnCondition, remarks: remarks || null }, "Asset returned; allocation history preserved")}>Process Return</Button>
            </div>
          </Card>
        ) : null}
        {asset.currentAllocation && can("Assets.Transfer") ? (
          <Card>
            <h3 className="font-semibold">Employee transfer</h3>
            <div className="mt-3 space-y-3">
              <Field label="New employee"><Select aria-label="Transfer employee" value={transferEmployee} onChange={(event) => setTransferEmployee(event.target.value)}><option value="">Select employee</option>{transferEmployees.map((item) => <option key={item.id} value={item.id}>{item.userCode} — {item.fullName} ({item.employmentStatus})</option>)}</Select></Field>
              <Field label="Transfer Date"><DatePicker aria-label="Employee Transfer Date" value={transferDate} onChange={setTransferDate} required /></Field>
              <Field label="Condition"><Select aria-label="Employee Transfer Condition" value={condition} onChange={(event) => setCondition(event.target.value)}>{options?.conditions.map((item) => <option key={item}>{item}</option>)}</Select></Field>
              <Field label="Remarks"><Textarea aria-label="Employee transfer remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} /></Field>
              <Button type="button" disabled={!transferEmployee} onClick={() => void run(`/api/v1/assets/${asset.id}/transfer/employee`, { employee_id: transferEmployee, transfer_date: transferDate, condition, remarks: remarks || null }, "Employee custody transferred atomically")}>Transfer Employee</Button>
            </div>
          </Card>
        ) : null}
        {can("Assets.Transfer") && asset.status !== "Retired" ? (
          <Card>
            <h3 className="font-semibold">Office transfer</h3>
            <div className="mt-3 space-y-3">
              <Field label="Destination Office"><Select aria-label="Transfer Office" value={transferOffice} onChange={(event) => setTransferOffice(event.target.value)}><option value="">Select Office</option>{options?.offices.filter((item) => item.id !== asset.office?.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
              <Field label="Transfer Date"><DatePicker aria-label="Office Transfer Date" value={transferDate} onChange={setTransferDate} required /></Field>
              <Field label="Remarks"><Textarea aria-label="Office transfer remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} /></Field>
              <Button type="button" disabled={!transferOffice} onClick={() => void run(`/api/v1/assets/${asset.id}/transfer/office`, { office_id: transferOffice, transfer_date: transferDate, remarks: remarks || null }, "Office custody transferred")}>Transfer Office</Button>
            </div>
          </Card>
        ) : null}
        {can("Assets.ManageStatus") ? (
          <Card>
            <h3 className="font-semibold">Status management</h3>
            <div className="mt-3 space-y-3">
              <Field label="Status"><Select aria-label="New Asset Status" value={status} onChange={(event) => setStatus(event.target.value)}>{options?.statuses.map((item) => <option key={item}>{item}</option>)}</Select></Field>
              <Field label="Mandatory reason"><Textarea aria-label="Asset status reason" required value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
              <Button type="button" disabled={!reason.trim()} onClick={() => void run(`/api/v1/assets/${asset.id}/status`, { status, reason }, "Asset status updated")}>Update Status</Button>
            </div>
          </Card>
        ) : null}
      </div>

      {history ? (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Asset History</h3>
          <TableShell>
            <TableHead><tr><Th>Employee</Th><Th>Issue</Th><Th>Issue condition</Th><Th>Return</Th><Th>Return condition</Th><Th>Closure</Th></tr></TableHead>
            <tbody>{history.allocations.map((row) => <tr key={row.id} className="border-t border-slate-100"><Td>{row.employeeName}</Td><Td>{row.issueDate}</Td><Td>{row.conditionAtIssue}</Td><Td>{row.returnDate ?? "Active"}</Td><Td>{row.returnCondition ?? "—"}</Td><Td>{row.endType ?? "Current custody"}</Td></tr>)}</tbody>
          </TableShell>
          <TableShell>
            <TableHead><tr><Th>Office</Th><Th>From</Th><Th>To</Th><Th>Reason</Th></tr></TableHead>
            <tbody>{history.officeCustody.map((row) => <tr key={row.id} className="border-t border-slate-100"><Td>{row.officeName}</Td><Td>{row.startedOn}</Td><Td>{row.endedOn ?? "Current"}</Td><Td>{row.reason ?? "—"}</Td></tr>)}</tbody>
          </TableShell>
          <Card>
            <h4 className="font-semibold">Immutable audit trail</h4>
            <ul className="mt-3 space-y-2 text-sm">{history.events.map((event) => <li key={event.id}><span className="font-medium">{event.action}</span> · {event.createdAt}{event.reason ? ` · ${event.reason}` : ""}</li>)}</ul>
          </Card>
        </div>
      ) : null}
    </section>
  );
}
