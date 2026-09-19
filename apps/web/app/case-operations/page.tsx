"use client";

import { DatePicker, DateRangePicker } from "@/components/date-picker";


import { PanelPopup } from "@/components/panel-popup";
import { useCallback, useEffect, useMemo, useState } from "react";

import { IconFileSpreadsheet, IconHierarchy3, IconReportAnalytics } from "@/components/icons";
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  LoadingState,
  PageHeader,
  Select,
  StatusBadge,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
} from "@/components/ui";
import { apiDownload, apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";

type Named = { id: string; name: string; code?: string; officeId?: string; bankId?: string; productId?: string };
type Options = { offices: Named[]; products: Named[]; cardVariants: Named[]; salesManagers: Named[]; coordinators: Named[] };
type CardRule = { id: string; bankId: string; bankName: string; productVariantId: string; productVariantName: string; version: number; points: string; effectiveFrom: string; effectiveTo: string | null; status: string };
type Routing = { id: string; officeId: string; officeName: string; productId: string; productName: string; salesManagerId: string; salesManagerName: string; coordinatorId: string; coordinatorName: string; status: string };
type Earning = { id: string; applicationCode: string | null; earningType: string; amount: string; reversedAmount: string; availableAmount: string; earnedAt: string };
type Clawback = { id: string; earningId: string; applicationCode: string | null; earningType: string | null; amount: string; reason: string; status: string; submittedAt: string; decisionReason: string | null };
type Metrics = { employeeId: string; employeeName?: string; cardsBooked: number; pointsEarned: string; pointsReversed: string; pointsNet: string; loansBooked: number; loanAmount: string; commissionEarned: string; commissionReversed: string; commissionNet: string; pendingCases: number; closedCases: number };
type ReportRow = { caseId: string; customerReference: string | null; caseOwner: string | null; office: string | null; homeDepartment: string | null; homeTeam: string | null; productLane: string | null; bank: string | null; product: string | null; variant: string | null; bookingDate: string | null; submissionDate: string | null; bankFileNumber: string | null; currentStage: string | null; stageEntryDate: string | null; overdue: { overdueHours: number } | null; closure: string | null; points: string; loanAmount: string | null; commission: string; clawbacks: string };
type Tab = "rules" | "routing" | "clawbacks" | "csv" | "reports";
const IconDownload = IconFileSpreadsheet;
const IconUpload = IconFileSpreadsheet;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function CaseOperationsPage() {
  const api = getBrowserApiUrl();
  const { can, user } = useAuth();
  const tabs = useMemo(() => [
    ...(can("CaseOperations.ViewRules") ? ["rules" as const] : []),
    ...(can("CaseOperations.ViewRouting") ? ["routing" as const] : []),
    ...(can("CaseOperations.SubmitClawback") || can("CaseOperations.ApproveClawback") ? ["clawbacks" as const] : []),
    ...(can("CaseOperations.StageCsv") ? ["csv" as const] : []),
    ...(can("CaseOperations.ViewReports") ? ["reports" as const] : []),
  ], [can]);
  const [tab, setTab] = useState<Tab>(tabs[0] ?? "rules");
  const [options, setOptions] = useState<Options | null>(null);
  const [rules, setRules] = useState<CardRule[]>([]);
  const [routing, setRouting] = useState<Routing[]>([]);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [clawbacks, setClawbacks] = useState<Clawback[]>([]);
  const [report, setReport] = useState<ReportRow[]>([]);
  const [metrics, setMetrics] = useState<Metrics[]>([]);
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [bankId, setBankId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [points, setPoints] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [officeId, setOfficeId] = useState("");
  const [productId, setProductId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [coordinatorId, setCoordinatorId] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [earningId, setEarningId] = useState("");
  const [clawbackAmount, setClawbackAmount] = useState("");
  const [clawbackReason, setClawbackReason] = useState("");
  const [csvResult, setCsvResult] = useState<{ valid: boolean; recordCount: number; errors: Array<{ row: number; field: string; message: string }> } | null>(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [nextOptions, nextRules, nextRouting] = await Promise.all([
        can("CaseOperations.ViewRules") ? apiGet<Options>("/api/v1/case-operations/options", api) : Promise.resolve(null),
        can("CaseOperations.ViewRules") ? apiGet<{ items: CardRule[] }>("/api/v1/case-operations/card-point-rules", api) : Promise.resolve({ items: [] }),
        can("CaseOperations.ViewRouting") ? apiGet<{ items: Routing[] }>("/api/v1/case-operations/routing", api) : Promise.resolve({ items: [] }),
      ]);
      setOptions(nextOptions);
      setRules(nextRules.items);
      setRouting(nextRouting.items);
      if (can("CaseOperations.SubmitClawback") || can("CaseOperations.ApproveClawback")) {
        const [nextEarnings, nextClawbacks] = await Promise.all([
          can("CaseOperations.SubmitClawback") ? apiGet<{ items: Earning[] }>("/api/v1/case-operations/earnings", api) : Promise.resolve({ items: [] }),
          apiGet<{ items: Clawback[] }>("/api/v1/case-operations/clawbacks", api),
        ]);
        setEarnings(nextEarnings.items);
        setClawbacks(nextClawbacks.items);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Case Operations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [api, can]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function run(action: () => Promise<void>, success: string) {
    setSaving(true); setError(""); setMessage("");
    try { await action(); setMessage(success); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Action failed."); }
    finally { setSaving(false); }
  }

  async function download(path: string, filename: string) {
    const result = await apiDownload(path, api);
    downloadBlob(result.blob, result.filename ?? filename);
  }

  function reportPath(suffix = "") {
    const query = new URLSearchParams();
    if (reportFrom) query.set("booking_from", reportFrom);
    if (reportTo) query.set("booking_to", reportTo);
    const encoded = query.toString();
    return `/api/v1/case-operations/reports/cases${suffix}${encoded ? `?${encoded}` : ""}`;
  }

  if (!tabs.length || user?.userType?.code === "TL") return <EmptyState>You do not have permission to access Case Operations.</EmptyState>;
  return <section className="space-y-4">
    <PageHeader title="Case Operations" description="Configure effective rules, processing lanes, controlled stage imports and operational reporting." />
    {error ? <ErrorText>{error}</ErrorText> : null}
    {message ? <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm">{message}</p> : null}
    <div role="tablist" aria-label="Case Operations sections" className="flex flex-wrap gap-2 border-b border-brand-border pb-2">
      {tabs.map((item) => <Button key={item} type="button" size="compact" variant={tab === item ? "primary" : "ghost"} role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{item === "csv" ? "Stage CSV" : item[0].toUpperCase() + item.slice(1)}</Button>)}
    </div>
    {loading ? <LoadingState>Loading Case Operations…</LoadingState> : null}
    {!loading && tab === "rules" ? <div className="grid gap-4">
      {can("CaseOperations.ManageRules") && options ? <PanelPopup feedback={<><ErrorText>{error}</ErrorText>{message ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}</>} label="New Card Point Rule"><Card><h2 className="font-semibold">New Card Point Rule</h2><div className="mt-3 grid gap-3">
        <Field label="Card variant"><Select value={variantId} onChange={(event) => { const id = event.target.value; setVariantId(id); setBankId(options.cardVariants.find((row) => row.id === id)?.bankId ?? ""); }}><option value="">Select Card</option>{options.cardVariants.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select></Field>
        <Field label="Points"><TextInput type="number" min="0" step="0.01" value={points} onChange={(event) => setPoints(event.target.value)} /></Field>
        <Field label="Effective from"><DatePicker aria-label="Effective from" value={effectiveFrom} onChange={setEffectiveFrom} /></Field>
        <Button disabled={saving || !bankId || !variantId || !points} onClick={() => void run(async () => { await apiRequest("/api/v1/case-operations/card-point-rules", api, { method: "POST", body: JSON.stringify({ bank_id: bankId, product_variant_id: variantId, points, effective_from: effectiveFrom }) }); }, "Draft Card Point rule created.")}>Create Draft</Button>
      </div></Card></PanelPopup> : null}
      <Card className="min-w-0"><TableShell><TableHead><tr><Th>Bank / Card</Th><Th>Points</Th><Th>Effective</Th><Th>Version</Th><Th>Status</Th><Th>Action</Th></tr></TableHead><tbody>{rules.map((row) => <tr key={row.id}><Td>{row.bankName}<span className="block text-xs text-text-secondary">{row.productVariantName}</span></Td><Td>{row.points}</Td><Td>{row.effectiveFrom}{row.effectiveTo ? ` – ${row.effectiveTo}` : " onward"}</Td><Td>{row.version}</Td><Td><StatusBadge value={row.status} /></Td><Td>{can("CaseOperations.ManageRules") ? <Button size="compact" variant="secondary" onClick={() => void run(async () => { await apiRequest(`/api/v1/case-operations/card-point-rules/${row.id}/${row.status === "active" ? "deactivate" : "activate"}`, api, { method: "POST" }); }, `Rule ${row.status === "active" ? "deactivated" : "activated"}.`)}>{row.status === "active" ? "Deactivate" : "Activate"}</Button> : "—"}</Td></tr>)}</tbody></TableShell>{!rules.length ? <EmptyState>No Card Point rules yet.</EmptyState> : null}</Card>
    </div> : null}
    {!loading && tab === "routing" ? <div className="grid gap-4">
      {can("CaseOperations.ManageRouting") && options ? <PanelPopup feedback={<><ErrorText>{error}</ErrorText>{message ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}</>} label="Office and Product Lane"><Card><h2 className="font-semibold">Office and Product Lane</h2><div className="mt-3 grid gap-3">
        <Field label="Office"><Select value={officeId} onChange={(event) => { setOfficeId(event.target.value); setManagerId(""); setCoordinatorId(""); }}><option value="">Select Office</option>{options.offices.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select></Field>
        <Field label="Product lane"><Select value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">Select Product</option>{options.products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select></Field>
        <Field label="Sales Manager"><Select value={managerId} onChange={(event) => setManagerId(event.target.value)}><option value="">Select Manager</option>{options.salesManagers.filter((row) => row.officeId === officeId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select></Field>
        <Field label="Coordinator"><Select value={coordinatorId} onChange={(event) => setCoordinatorId(event.target.value)}><option value="">Select Coordinator</option>{options.coordinators.filter((row) => row.officeId === officeId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select></Field>
        <Button disabled={saving || !officeId || !productId || !managerId || !coordinatorId} onClick={() => void run(async () => { await apiRequest("/api/v1/case-operations/routing", api, { method: "PUT", body: JSON.stringify({ office_id: officeId, product_id: productId, sales_manager_id: managerId, coordinator_id: coordinatorId }) }); }, "Routing assignment saved.")}>Save Assignment</Button>
      </div></Card></PanelPopup> : null}
      <Card><TableShell><TableHead><tr><Th>Office</Th><Th>Product Lane</Th><Th>Sales Manager</Th><Th>Coordinator</Th><Th>Status</Th><Th>Action</Th></tr></TableHead><tbody>{routing.map((row) => <tr key={row.id}><Td>{row.officeName}</Td><Td>{row.productName}</Td><Td>{row.salesManagerName}</Td><Td>{row.coordinatorName}</Td><Td><StatusBadge value={row.status} /></Td><Td>{can("CaseOperations.ManageRouting") ? <Button size="compact" variant="secondary" onClick={() => void run(async () => { await apiRequest(`/api/v1/case-operations/routing/${row.id}/${row.status === "active" ? "deactivate" : "activate"}`, api, { method: "POST" }); }, `Routing ${row.status === "active" ? "deactivated" : "activated"}.`)}>{row.status === "active" ? "Deactivate" : "Activate"}</Button> : "—"}</Td></tr>)}</tbody></TableShell>{!routing.length ? <EmptyState>No routing assignments configured.</EmptyState> : null}</Card>
    </div> : null}
    {!loading && tab === "clawbacks" ? <div className="grid gap-4">
      {can("CaseOperations.SubmitClawback") && user?.userType?.code === "COD" ? <PanelPopup feedback={<><ErrorText>{error}</ErrorText>{message ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}</>} label="Submit Clawback"><Card><h2 className="font-semibold">Submit Clawback</h2><p className="mt-1 text-sm text-text-secondary">Credit Card points require a full reversal. Personal Finance commission supports a partial or full reversal.</p><div className="mt-3 grid gap-3">
        <Field label="Case earning"><Select value={earningId} onChange={(event) => { const id = event.target.value; setEarningId(id); setClawbackAmount(earnings.find((row) => row.id === id)?.availableAmount ?? ""); }}><option value="">Select earning</option>{earnings.filter((row) => Number(row.availableAmount) > 0).map((row) => <option key={row.id} value={row.id}>{row.applicationCode ?? "Case"} · {row.earningType === "card_points" ? "Card Points" : "PF Commission"} · {row.availableAmount}</option>)}</Select></Field>
        <Field label="Amount"><TextInput type="number" min="0.01" step="0.01" value={clawbackAmount} onChange={(event) => setClawbackAmount(event.target.value)} /></Field>
        <Field label="Reason"><TextInput value={clawbackReason} onChange={(event) => setClawbackReason(event.target.value)} /></Field>
        <Button disabled={saving || !earningId || !clawbackAmount || !clawbackReason.trim()} onClick={() => void run(async () => { await apiRequest("/api/v1/case-operations/clawbacks", api, { method: "POST", body: JSON.stringify({ earning_id: earningId, amount: clawbackAmount, reason: clawbackReason }) }); setEarningId(""); setClawbackAmount(""); setClawbackReason(""); }, "Clawback submitted for approval.")}>Submit for Approval</Button>
      </div></Card></PanelPopup> : null}
      <Card className="min-w-0"><TableShell><TableHead><tr><Th>Case</Th><Th>Type</Th><Th>Amount</Th><Th>Reason</Th><Th>Status</Th><Th>Decision</Th></tr></TableHead><tbody>{clawbacks.map((row) => <tr key={row.id}><Td>{row.applicationCode ?? "—"}</Td><Td>{row.earningType === "card_points" ? "Card Points" : "PF Commission"}</Td><Td>{row.amount}</Td><Td>{row.reason}</Td><Td><StatusBadge value={row.status} /></Td><Td>{row.status === "pending" && can("CaseOperations.ApproveClawback") ? <div className="flex gap-2"><Button size="compact" onClick={() => void run(async () => { await apiRequest(`/api/v1/case-operations/clawbacks/${row.id}/decision`, api, { method: "POST", body: JSON.stringify({ decision: "approve" }) }); }, "Clawback approved.")}>Approve</Button><Button size="compact" variant="secondary" onClick={() => { const reason = window.prompt("Reason for rejecting this clawback"); if (reason?.trim()) void run(async () => { await apiRequest(`/api/v1/case-operations/clawbacks/${row.id}/decision`, api, { method: "POST", body: JSON.stringify({ decision: "reject", reason }) }); }, "Clawback rejected."); }}>Reject</Button></div> : "—"}</Td></tr>)}</tbody></TableShell>{!clawbacks.length ? <EmptyState>No clawback requests yet.</EmptyState> : null}</Card>
    </div> : null}
    {!loading && tab === "csv" ? <Card className="max-w-3xl"><div className="flex items-center gap-2"><IconHierarchy3 className="size-5 text-brand-primary" /><h2 className="font-semibold">Controlled Stage Import</h2></div><p className="mt-1 text-sm text-text-secondary">Use the official UTF-8 template. Every row is revalidated against your assigned cases and current configured transition before one atomic import.</p><div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void download("/api/v1/case-operations/stage-csv/template", "case-stage-template.csv")}><IconDownload className="size-4" />Blank Template</Button><Button variant="secondary" onClick={() => void download("/api/v1/case-operations/stage-csv/current-cases", "current-cases.csv")}><IconDownload className="size-4" />Scoped Current Cases</Button></div><Field label="Completed CSV" className="mt-4"><input type="file" accept=".csv,text/csv" onChange={(event) => { setCsvFile(event.target.files?.[0] ?? null); setCsvResult(null); }} /></Field><div className="mt-3 flex gap-2"><Button disabled={!csvFile || saving} onClick={() => void run(async () => { const body = new FormData(); body.append("file", csvFile!); const result = await apiRequest<typeof csvResult>("/api/v1/case-operations/stage-csv/validate", api, { method: "POST", body }); setCsvResult(result); }, "CSV validation complete.")}>Validate</Button><Button disabled={!csvFile || !csvResult?.valid || saving} onClick={() => void run(async () => { const body = new FormData(); body.append("file", csvFile!); await apiRequest("/api/v1/case-operations/stage-csv/import", api, { method: "POST", body }); setCsvResult(null); setCsvFile(null); }, "Stage changes imported.")}><IconUpload className="size-4" />Import {csvResult?.recordCount ?? 0}</Button></div>{csvResult?.errors.length ? <ul className="mt-3 list-disc pl-5 text-sm text-danger">{csvResult.errors.map((item) => <li key={`${item.row}-${item.field}`}>Row {item.row}, {item.field}: {item.message}</li>)}</ul> : null}</Card> : null}
    {!loading && tab === "reports" ? <div className="space-y-4"><Card><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold">Current Case Operations Report</h2><p className="text-sm text-text-secondary">Booking-date scoped and generated from current authorized case state.</p></div><div className="flex flex-wrap items-end gap-2"><Field label="Booking date range"><DateRangePicker aria-label="Booking date range" allowPartial from={reportFrom} to={reportTo} onChange={({ from, to }) => { setReportFrom(from); setReportTo(to); }} /></Field><Button variant="secondary" onClick={() => void run(async () => { const data = await apiGet<{ items: ReportRow[] }>(reportPath(), api); setReport(data.items); }, "Report refreshed.")}><IconReportAnalytics className="size-4" />Generate</Button>{user ? <Button variant="secondary" onClick={() => void run(async () => { if (user.team?.id && user.userType?.code === "TL") { const data = await apiGet<{ items: Metrics[] }>(`/api/v1/case-operations/metrics/teams/${user.team.id}`, api); setMetrics(data.items); } else { setMetrics([await apiGet<Metrics>(`/api/v1/case-operations/metrics/employees/${user.id}`, api)]); } }, "Performance metrics refreshed.")}>{user.userType?.code === "TL" ? "My Team Metrics" : "My Metrics"}</Button> : null}{can("CaseOperations.ExportReports") ? <Button onClick={() => void download(reportPath(".xlsx"), "case-operations.xlsx")}><IconDownload className="size-4" />Download XLSX</Button> : null}</div></div>{metrics.length ? <TableShell><TableHead><tr><Th>Employee</Th><Th>Cards / Points</Th><Th>Loans / Amount</Th><Th>Commission</Th><Th>Cases</Th></tr></TableHead><tbody>{metrics.map((row) => <tr key={row.employeeId}><Td>{row.employeeName ?? user?.fullName ?? "—"}</Td><Td>{row.cardsBooked} · {row.pointsEarned} earned · {row.pointsReversed} reversed · {row.pointsNet} net</Td><Td>{row.loansBooked} · {row.loanAmount}</Td><Td>{row.commissionEarned} earned · {row.commissionReversed} reversed · {row.commissionNet} net</Td><Td>{row.pendingCases} pending · {row.closedCases} closed</Td></tr>)}</tbody></TableShell> : null}<TableShell><TableHead><tr><Th>Case / Customer</Th><Th>Case Owner</Th><Th>Home Organization</Th><Th>Product Lane</Th><Th>Booking / Submission</Th><Th>Bank File</Th><Th>Stage / Entry</Th><Th>Overdue / Closure</Th><Th>Points</Th><Th>Loan Amount</Th><Th>Commission</Th><Th>Clawbacks</Th></tr></TableHead><tbody>{report.map((row) => <tr key={row.caseId}><Td>{row.caseId}<span className="block text-xs text-text-secondary">{row.customerReference ?? "Not recorded"}</span></Td><Td>{row.caseOwner ?? "—"}</Td><Td>{row.office ?? "—"}<span className="block text-xs text-text-secondary">{row.homeDepartment ?? "—"} · {row.homeTeam ?? "—"}</span></Td><Td>{row.productLane ?? "—"}<span className="block text-xs text-text-secondary">{row.bank ?? "—"} · {row.product ?? "—"} · {row.variant ?? "—"}</span></Td><Td>{row.bookingDate ? new Date(row.bookingDate).toLocaleDateString() : "—"}<span className="block text-xs text-text-secondary">{row.submissionDate ? new Date(row.submissionDate).toLocaleDateString() : "—"}</span></Td><Td>{row.bankFileNumber ?? "—"}</Td><Td>{row.currentStage ?? "—"}<span className="block text-xs text-text-secondary">{row.stageEntryDate ? new Date(row.stageEntryDate).toLocaleString() : "—"}</span></Td><Td>{row.overdue ? `${row.overdue.overdueHours}h overdue` : "—"}<span className="block text-xs text-text-secondary">{row.closure ?? "Open"}</span></Td><Td>{row.points}</Td><Td>{row.loanAmount ?? "—"}</Td><Td>{row.commission}</Td><Td>{row.clawbacks}</Td></tr>)}</tbody></TableShell>{!report.length ? <EmptyState>Generate the report to view current authorized cases.</EmptyState> : null}</Card></div> : null}
  </section>;
}
