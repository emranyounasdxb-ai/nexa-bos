"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AssetDrawer } from "./asset-drawer";
import { AssetDetails } from "./asset-details";
import { IssueAssetAction } from "./asset-issue";
import { AssetCustodian, AssetStatusBadge } from "./asset-position";
import { AssetSettings } from "./asset-settings";
import workspace from "./workspace.module.css";
import { auditDisplayEntries, formatLocalDateTime, humanizeTechnicalLabel } from "@/lib/presentation";



import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { IconX, IconPlus } from "@/components/icons";
import {
  Pagination,
  type PaginatedResponse,
  SERVER_PAGE_SIZE_OPTIONS,
  type ServerPageSize,
} from "@/components/pagination";
import {
  Badge,
  Button,

  EmptyState,
  ErrorText,
  Field,
  LoadingState,
  PageHeader,
  Select,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
} from "@/components/ui";
import { apiDownload, apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { AssetCategoryRecord, AssetOptions, AssetRecord, AssetHistoryRecord } from "@/lib/types";

const BUILTINS: Record<string, keyof AssetForm> = {
  brand: "brand",
  model: "model",
  serial_number: "serial_number",
  imei: "imei",
  iccid: "iccid",
  mobile_number: "mobile_number",
  operator: "operator",
};

type AssetForm = {
  category_id: string;
  office_id: string;
  condition: string;
  brand: string;
  model: string;
  serial_number: string;
  imei: string;
  iccid: string;
  mobile_number: string;
  operator: string;
  description: string;
  attributes: Record<string, string>;
};

const EMPTY_FORM: AssetForm = {
  category_id: "",
  office_id: "",
  condition: "New",
  brand: "",
  model: "",
  serial_number: "",
  imei: "",
  iccid: "",
  mobile_number: "",
  operator: "",
  description: "",
  attributes: {},
};

function identity(asset: AssetRecord): string {
  return (
    asset.serialNumber ??
    asset.imei ??
    asset.iccid ??
    asset.mobileNumber ??
    asset.model ??
    "—"
  );
}

type WorkspaceView = "all" | "assigned" | "returns" | "history";
type ReportData = PaginatedResponse<Record<string, unknown>> & { title: string; reportingScope: string };

export function AssetManagementWorkspace({ initialAssetId, initialSettings = false, initialExport = false }: { initialAssetId?: string; initialSettings?: boolean; initialExport?: boolean }) {
  const { can, user } = useAuth();
  const search = useSearchParams();
  const router = useRouter();
  const adminOfficer = user?.userType?.code === "ADMIN_OFFICER";
  const reportsView = can("Assets.Reports") && search.get("view") === "reports";
  const api = getBrowserApiUrl();
  const [options, setOptions] = useState<(AssetOptions & { categoryManagementAllowed?: boolean }) | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<ServerPageSize>(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [office, setOffice] = useState("");
  const [category, setCategory] = useState("");
  const [view, setView] = useState<WorkspaceView>("all");
  const [outstanding, setOutstanding] = useState(false);
  const [counts, setCounts] = useState<number[] | null>(null);
  const [countError, setCountError] = useState("");
  const [events, setEvents] = useState<Array<AssetHistoryRecord["events"][number] & { assetCode?: string }>>([]);
  const [selectedAsset, setSelectedAsset] = useState(initialAssetId ?? "");
  const [settingsOpen, setSettingsOpen] = useState(initialSettings);
  const [exportOpen, setExportOpen] = useState(initialExport);
  const [report, setReport] = useState("asset_register");
  const [reportEmployee, setReportEmployee] = useState("");
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [reportPage, setReportPage] = useState(1);
  const [reportPageSize, setReportPageSize] = useState<ServerPageSize>(10);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");
  const [revision, setRevision] = useState(0);
  const requestId = useRef(0);
  const filterDetails = useRef<HTMLDetailsElement>(null);
  const canSettings = can("Assets.ManageCategories") && Boolean(options?.categoryManagementAllowed);
  const closeDetails = useCallback(() => setSelectedAsset(""), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeExport = useCallback(() => setExportOpen(false), []);
  const afterMutation = useCallback(() => setRevision(value => value + 1), []);
  const [form, setForm] = useState<AssetForm>(EMPTY_FORM);
  const [message, setMessage] = useState("");
  const [pageError, setPageError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerDirty, setDrawerDirty] = useState(false);
  const [drawerError, setDrawerError] = useState("");
  const [saving, setSaving] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);

  const selectedCategory = useMemo(
    () => options?.categories.find((item) => item.id === form.category_id) ?? null,
    [form.category_id, options],
  );

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 641px)");
    const revealFilters = () => { if (desktop.matches && filterDetails.current) filterDetails.current.open = true; };
    revealFilters();
    desktop.addEventListener("change", revealFilters);
    return () => desktop.removeEventListener("change", revealFilters);
  }, []);

  const appliedQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (office) params.set("officeId", office);
    if (category) params.set("categoryId", category);
    if (outstanding) params.set("outstanding", "true");
    if (view === "assigned") params.set("allocated", "true");
    if (view === "returns") params.set("returnsOrRepairs", "true");
    return params;
  }, [q, status, office, category, outstanding, view]);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    const params = appliedQuery();
    params.set("page", String(page)); params.set("page_size", String(pageSize));
    setLoading(true); setPageError("");
    try {
      const path = view === "history" ? "/api/v1/assets/audit" : "/api/v1/assets";
      const data = await apiGet<PaginatedResponse<AssetRecord> | PaginatedResponse<AssetHistoryRecord["events"][number]>>(`${path}?${params}`, api);
      if (id !== requestId.current) return;
      if (view === "history") { setEvents(data.items as AssetHistoryRecord["events"]); setAssets([]); }
      else { setAssets(data.items as AssetRecord[]); setEvents([]); }
      setTotal(data.pagination.total); setTotalPages(data.pagination.totalPages);
    } catch (error) { if (id === requestId.current) { setAssets([]); setEvents([]); setPageError(error instanceof Error ? error.message : "Unable to load assets"); } }
    finally { if (id === requestId.current) setLoading(false); }
  }, [api, appliedQuery, page, pageSize, view]);

  useEffect(() => {
    if (!can("Assets.View")) return;
    let active = true;
    void apiGet<AssetOptions & { categoryManagementAllowed?: boolean }>("/api/v1/assets/options", api).then(data => { if (active) setOptions(data); }).catch(error => { if (active) setPageError(error instanceof Error ? error.message : "Unable to load asset options"); });
    return () => { active = false; };
  }, [api, can, revision]);
  useEffect(() => { if (can("Assets.View") && (view !== "history" || can("Assets.ViewAudit"))) void refresh(); }, [can, refresh, revision, view]);
  useEffect(() => {
    if (!can("Assets.View")) return;
    let active = true;
    setCounts(null); setCountError("");
    const base = new URLSearchParams();
    if (q) base.set("q", q); if (office) base.set("officeId", office); if (category) base.set("categoryId", category);
    base.set("page", "1"); base.set("page_size", "10");
    void Promise.all(["", "status=In+Stock", "allocated=true", "status=Under+Repair", "outstanding=true"].map(filter => apiGet<PaginatedResponse<AssetRecord>>(`/api/v1/assets?${base}${filter ? `&${filter}` : ""}`, api))).then(results => { if (active) setCounts(results.map(data => data.pagination.total)); }).catch(error => { if (active) setCountError(error instanceof Error ? error.message : "Asset totals unavailable"); });
    return () => { active = false; };
  }, [api, can, q, office, category, revision]);

  useEffect(() => {
    if (!(exportOpen || reportsView) || !can("Assets.Reports") || (report === "asset_history" && !can("Assets.ViewAudit"))) return;
    let active = true;
    const params = appliedQuery();
    if (reportEmployee) params.set("employeeId", reportEmployee);
    params.set("page", String(reportPage)); params.set("page_size", String(reportPageSize));
    setReportBusy(true); setReportError(""); setReportData(null);
    void apiGet<ReportData>(`/api/v1/assets/reports/${report}?${params}`, api).then(data => { if (active) setReportData(data); }).catch(error => { if (active) setReportError(error instanceof Error ? error.message : "Unable to load report"); }).finally(() => { if (active) setReportBusy(false); });
    return () => { active = false; };
  }, [api, can, exportOpen, reportsView, appliedQuery, report, reportEmployee, reportPage, reportPageSize, revision]);

  async function exportReport(format: "xlsx" | "pdf" | "print") {
    // Open the print window from the user gesture; the authenticated export remains server-scoped.
    const printWindow = format === "print" ? window.open("", "_blank") : null;
    if (format === "print" && !printWindow) { setReportError("Allow popups to open the print view."); return; }
    if (printWindow) printWindow.opener = null;
    setReportBusy(true); setReportError("");
    try {
      const result = await apiDownload("/api/v1/assets/reports/export", api, { method: "POST", body: JSON.stringify({ format, report, q: q || null, status: status || null, office_id: office || null, category_id: category || null, employee_id: reportEmployee || null, allocated: view === "assigned" ? true : null, outstanding: outstanding ? true : null, returns_or_repairs: view === "returns" }) });
      if (printWindow) { printWindow.document.write(await result.blob.text()); printWindow.document.close(); }
      else { const url = URL.createObjectURL(result.blob), link = document.createElement("a"); link.href = url; link.download = result.filename ?? `amafh-assets.${format}`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (error) { printWindow?.close(); setReportError(error instanceof Error ? error.message : "Export failed"); }
    finally { setReportBusy(false); }
  }
  function clearFilters() { setQ(""); setStatus(""); setCategory(""); setOffice(""); setOutstanding(false); setPage(1); }
  function chooseView(next: WorkspaceView) { if (reportsView) router.push("/assets"); setView(next); setStatus(""); setOutstanding(false); setPage(1); }
  function chooseSummary(index: number) { if (reportsView) router.push("/assets"); setView(index === 2 ? "assigned" : "all"); setStatus(index === 1 ? "In Stock" : index === 3 ? "Under Repair" : ""); setOutstanding(index === 4); setPage(1); }

  function closeDrawer() {
    setDrawerOpen(false);
    setDiscardConfirmOpen(false);
    setDrawerDirty(false);
    setDrawerError("");
    setForm(EMPTY_FORM);
    window.setTimeout(() => {
      if (drawerTriggerRef.current?.isConnected) drawerTriggerRef.current.focus();
    }, 0);
  }

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || saving) return;
      event.preventDefault();
      if (discardConfirmOpen) setDiscardConfirmOpen(false);
      else if (drawerDirty) setDiscardConfirmOpen(true);
      else closeDrawer();
    }
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [discardConfirmOpen, drawerDirty, drawerOpen, saving]);

  useEffect(() => {
    if (!drawerDirty) return;
    function preventUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [drawerDirty]);

  function defaultForm(): AssetForm {
    return {
      ...EMPTY_FORM,
      category_id: options?.categories[0]?.id ?? "",
      office_id: options?.offices[0]?.id ?? "",
      condition: options?.conditions[0] ?? "New",
    };
  }

  function openDrawer(trigger: HTMLElement) {
    drawerTriggerRef.current = trigger;
    setForm(defaultForm());
    setDrawerDirty(false);
    setDrawerError("");
    setDiscardConfirmOpen(false);
    setDrawerOpen(true);
  }

  function requestDrawerClose() {
    if (saving) return;
    if (drawerDirty) setDiscardConfirmOpen(true);
    else closeDrawer();
  }

  function trapDrawerFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      drawerRef.current?.querySelectorAll<HTMLElement>(
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

  function setField(field: keyof AssetForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setDrawerDirty(true);
    setDrawerError("");
  }

  function categoryField(definition: AssetCategoryRecord["fields"][number]) {
    const builtin = BUILTINS[definition.key];
    const value = builtin ? String(form[builtin]) : (form.attributes[definition.key] ?? "");
    return (
      <Field key={definition.key} label={definition.label}>
        <TextInput
          aria-label={definition.label}
          value={value}
          required={definition.required}
          onChange={(event) => {
            if (builtin) {
              setField(builtin, event.target.value);
            } else {
              setForm((current) => ({
                ...current,
                attributes: { ...current.attributes, [definition.key]: event.target.value },
              }));
              setDrawerDirty(true);
              setDrawerError("");
            }
          }}
        />
      </Field>
    );
  }

  async function createAsset(event: FormEvent) {
    event.preventDefault();
    setDrawerError("");
    if (!form.category_id || !form.office_id || !form.condition) {
      setDrawerError("Choose a category, current Office, and condition.");
      return;
    }
    const customKeys = new Set(
      selectedCategory?.fields.filter((item) => !BUILTINS[item.key]).map((item) => item.key) ?? [],
    );
    const attributes = Object.fromEntries(
      Object.entries(form.attributes).filter(([key, value]) => customKeys.has(key) && value.trim()),
    );
    setSaving(true);
    try {
      const created = await apiRequest<AssetRecord>("/api/v1/assets", api, {
        method: "POST",
        body: JSON.stringify({
          category_id: form.category_id,
          office_id: form.office_id,
          condition: form.condition,
          brand: form.brand || null,
          model: form.model || null,
          serial_number: form.serial_number || null,
          imei: form.imei || null,
          iccid: form.iccid || null,
          mobile_number: form.mobile_number || null,
          operator: form.operator || null,
          attributes,
          description: form.description || null,
        }),
      });
      setMessage(`${created.assetCode} created`);
      closeDrawer();
      await refresh();
      afterMutation();
    } catch (reason) {
      setDrawerError(reason instanceof Error ? reason.message : "Asset creation failed");
    } finally {
      setSaving(false);
    }
  }

  if ((initialSettings && !can("Assets.ManageCategories")) || ((initialExport || search.get("view") === "reports") && !can("Assets.Reports"))) return <EmptyState>You do not have permission to access this asset view.</EmptyState>;
  if (!can("Assets.View")) {
    return <EmptyState>You do not have permission to view Assets.</EmptyState>;
  }

  const viewTitle = view === "assigned" ? "Assigned assets" : view === "returns" ? "Returns & repairs" : view === "history" ? "Asset history" : "All assets";
  const filtered = Boolean(q || status || category || office || outstanding);
  const columns = reportData?.items.length ? Object.keys(reportData.items[0]).filter(column => !/(?:^id$|(?:Id|_id)$|uuid|record.?source|old.?values|new.?values|legacy|lock.?version)/i.test(column)) : [];
  const reportContent = <div className={workspace.exportControls}>
      <p className="text-sm text-text-secondary">Reports and exports use your authorized scope and the workspace's applied search, status, category, office and view filters. Exports include all matching records, across every page.</p>
      <Field label="Report"><Select value={report} aria-label="Asset report" onChange={event => { setReport(event.target.value); setReportPage(1); }}>{options?.reports.filter(item => item.key !== "asset_history" || can("Assets.ViewAudit")).map(item => <option key={item.key} value={item.key}>{item.title}</option>)}</Select></Field>
      <Field label="Employee (optional)"><Select value={reportEmployee} aria-label="Asset report employee" onChange={event => { setReportEmployee(event.target.value); setReportPage(1); }}><option value="">All permitted employees</option>{options?.employees.map(item => <option key={item.id} value={item.id}>{item.fullName} ({item.userCode})</option>)}</Select></Field>
      <div>{(["xlsx", "pdf", "print"] as const).map(format => <Button key={format} variant="secondary" hidden={!can("Assets.Export")} disabled={reportBusy || !reportData || !can("Assets.Export")} onClick={() => void exportReport(format)}>{format === "xlsx" ? "Excel" : format === "pdf" ? "PDF" : "Print"}</Button>)}</div>
      {reportError ? <ErrorText>{reportError}</ErrorText> : null}{reportBusy ? <LoadingState>Preparing report…</LoadingState> : null}
      {reportData ? <><p className="text-sm text-text-secondary">{reportData.title} · {reportData.reportingScope} scope · {reportData.pagination.total} records</p>{reportData.items.length ? <TableShell mobileCards={false} headerTone="subtle"><TableHead><tr>{columns.map(column => <Th key={column}>{humanizeTechnicalLabel(column)}</Th>)}</tr></TableHead><tbody>{reportData.items.map((row, index) => <tr key={index}>{columns.map(column => <Td key={column}>{auditDisplayEntries({ [column]: row[column] })[0]?.value ?? "—"}</Td>)}</tr>)}</tbody></TableShell> : <EmptyState>No records match this report and the applied filters.</EmptyState>}<Pagination page={reportData.pagination.page} pageSize={reportPageSize} total={reportData.pagination.total} totalPages={reportData.pagination.totalPages} onPageChange={setReportPage} pageSizeOptions={SERVER_PAGE_SIZE_OPTIONS} onPageSizeChange={value => { if (value !== "all") setReportPageSize(value); setReportPage(1); }} /></> : null}
    </div>;
  return <section className={workspace.workspace}>
    <PageHeader title="Asset Management" description="Manage inventory, employee custody, returns and repairs in one workspace." actions={<div className="flex flex-wrap items-center gap-2">
      {can("Assets.ManageStock") ? <Button type="button" disabled={!options} onClick={event => openDrawer(event.currentTarget)}><IconPlus className="size-4" />Add Asset</Button> : null}
      {can("Assets.Reports") && <Button variant="secondary" onClick={() => { setReport(view === "history" ? "asset_history" : "asset_register"); setReportPage(1); setExportOpen(true); }}>Reports{can("Assets.Export") ? " & Export" : ""}</Button>}
      {canSettings ? <Button variant="secondary" onClick={() => setSettingsOpen(true)}>Asset Settings</Button> : null}
    </div>} />
    <div className={workspace.summary} aria-label="Asset summaries">
      {["Total Assets", "In Stock", "Assigned", "Under Repair", "Return Pending"].map((label, index) => <button key={label} type="button" className={workspace.summaryCard} aria-pressed={index === 0 ? view === "all" && !status && !outstanding : index === 1 ? status === "In Stock" : index === 2 ? view === "assigned" : index === 3 ? status === "Under Repair" : outstanding} onClick={() => chooseSummary(index)} title={index === 4 ? "Active custody held by employees on notice, resigned, terminated or inactive" : `Show ${label.toLowerCase()}`}><span>{label}</span><strong>{counts ? counts[index].toLocaleString() : countError ? "—" : "…"}</strong></button>)}
    </div>
    {countError ? <ErrorText>{countError}</ErrorText> : null}
    {message ? <p role="status" className="text-sm text-success">{message}</p> : null}
    <div className={workspace.surface}>
      <div className={workspace.toolbar}><nav className={workspace.tabs} aria-label="Asset views">{([ ["all", "All Assets"], ["assigned", "Assigned"], ["returns", "Returns & Repairs"], ...(can("Assets.ViewAudit") ? [["history", "History"]] : []) ] as [WorkspaceView, string][]).map(([key, label]) => <button key={key} type="button" className={workspace.tab} aria-current={!reportsView && view === key ? "page" : undefined} onClick={() => chooseView(key)}>{label}</button>)}{can("Assets.Reports") && <Link className={workspace.tab} href="/assets?view=reports" aria-current={reportsView ? "page" : undefined}>Reports</Link>}</nav><span className={workspace.scope}>{loading ? "Loading…" : pageError ? "Results unavailable" : `${total.toLocaleString()} ${view === "history" ? "events" : "assets"}`} · {filtered ? "Filtered permitted records" : "All permitted records"}</span></div>
      <details ref={filterDetails} open className={workspace.filters}><summary>Search and filters <span aria-hidden="true">⌄</span></summary><form onSubmit={event => { event.preventDefault(); void refresh(); }}>
        <Field label="Search assets"><TextInput aria-label="Search assets" placeholder="Asset code, brand or identifier" value={q} onChange={event => { setQ(event.target.value); setPage(1); }} /></Field>
        <Field label="Status"><Select aria-label="Asset status filter" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{options?.statuses.map(item => <option key={item} value={item}>{item === "Allocated" ? "Assigned" : item}</option>)}</Select></Field>
        <Field label="Category"><Select aria-label="Asset category filter" value={category} onChange={event => { setCategory(event.target.value); setPage(1); }}><option value="">All categories</option>{options?.categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
        <Field label="Office"><Select aria-label="Asset office filter" value={office} onChange={event => { setOffice(event.target.value); setPage(1); }}><option value="">All authorized offices</option>{options?.offices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
        <Button type="button" variant="secondary" onClick={clearFilters}>Clear filters</Button>
      </form></details>
      {reportsView ? reportContent : <>
      {view === "returns" || outstanding ? <p className="px-4 py-2 text-sm text-text-secondary">Return pending identifies active custody held by employees on notice, resigned, terminated or inactive. Repairs remain recorded in the asset history.</p> : null}
      {pageError ? <div className="p-4"><ErrorText>{pageError}</ErrorText><Button variant="secondary" onClick={() => void refresh()}>Retry</Button></div> : null}
      {loading && !assets.length && !events.length ? <LoadingState>Loading {viewTitle.toLowerCase()}…</LoadingState> : null}
      {!loading && !pageError && !assets.length && !events.length ? <EmptyState title="No records match this view" description="Adjust the filters or choose another asset view." /> : null}
      {view !== "history" && assets.length ? <TableShell headerTone="subtle" mobileCards={false} className={workspace.table}><TableHead><tr>{["Asset", "Category", "Office", "Current Custodian", "Status", "Condition", "Last Updated", "Actions"].map(label => <Th key={label}>{label}</Th>)}</tr></TableHead><tbody>{assets.map(asset => <tr key={asset.id} className={workspace.row} onClick={event => { if (event.currentTarget.contains(event.target as Node) && !(event.target as HTMLElement).closest("button,a")) setSelectedAsset(asset.id); }}>
        <Td><button className={workspace.assetLink} onClick={() => setSelectedAsset(asset.id)}>{asset.assetCode}</button><span className={workspace.secondary}>{[asset.brand, asset.model, identity(asset) !== "—" && ![asset.brand, asset.model].includes(identity(asset)) ? identity(asset) : null].filter(Boolean).join(" · ") || "Identity not recorded"}</span></Td><Td>{asset.category.name}</Td><Td>{asset.office?.name ?? "—"}</Td><Td><AssetCustodian asset={asset} /></Td><Td><AssetStatusBadge asset={asset} /></Td><Td>{asset.condition}</Td><Td>{formatLocalDateTime(asset.updatedAt)}</Td><Td><div className="flex flex-wrap items-center gap-2"><IssueAssetAction asset={asset} onIssued={updated => { setAssets(current => current.map(item => item.id === updated.id ? updated : item)); setMessage(`${updated.assetCode} assigned to ${updated.currentAllocation?.employeeName ?? "the selected employee"}`); afterMutation(); }} /><Button variant="secondary" size="compact" onClick={() => setSelectedAsset(asset.id)}>View asset</Button></div></Td>
      </tr>)}</tbody></TableShell> : null}
      {view === "history" && events.length ? <TableShell headerTone="subtle" mobileCards={false}><TableHead><tr><Th>Asset</Th><Th>Action</Th><Th>Reason</Th><Th>Recorded</Th><Th>Actions</Th></tr></TableHead><tbody>{events.map(event => <tr key={event.id}><Td><button className={workspace.assetLink} onClick={() => setSelectedAsset(event.entityId)}>{String(event.assetCode ?? event.newValues?.assetCode ?? event.oldValues?.assetCode ?? "Not recorded")}</button></Td><Td>{humanizeTechnicalLabel(event.action)}</Td><Td>{event.reason ?? "—"}</Td><Td>{formatLocalDateTime(event.createdAt)}</Td><Td><Button variant="secondary" size="compact" onClick={() => setSelectedAsset(event.entityId)}>View history</Button></Td></tr>)}</tbody></TableShell> : null}
      {!pageError ? <Pagination page={page} pageSize={pageSize} total={total} totalPages={totalPages} pageSizeOptions={SERVER_PAGE_SIZE_OPTIONS} onPageChange={setPage} onPageSizeChange={value => { if (value !== "all") setPageSize(value); setPage(1); }} /> : null}
      </>}
    </div>
    {selectedAsset ? <AssetDrawer title="Asset details" onClose={closeDetails}><AssetDetails key={selectedAsset} assetId={selectedAsset} onMutation={afterMutation} initialTab={view === "history" ? "audit" : undefined} /></AssetDrawer> : null}
    {settingsOpen && canSettings ? <AssetDrawer title="Asset Settings" onClose={closeSettings}><AssetSettings editable={canSettings} onMutation={afterMutation} /></AssetDrawer> : null}
    {exportOpen && can("Assets.Reports") && !reportsView ? <AssetDrawer title="Asset reports and export" onClose={closeExport}>{reportContent}</AssetDrawer> : null}
      {drawerOpen ? (
        <div
          data-amafh-editor-backdrop=""
          className="fixed inset-0 z-50 flex justify-end bg-[#17101f]/45 p-3 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) requestDrawerClose();
          }}
        >
          <aside
            data-amafh-editor-panel=""
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-drawer-title"
            aria-describedby="asset-drawer-description"
            className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[24px] border border-brand-border bg-surface shadow-2xl sm:max-w-xl"
            onKeyDown={trapDrawerFocus}
          >
            <div className="flex items-start justify-between gap-3 border-b border-brand-border px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 id="asset-drawer-title" className="text-[length:var(--amafh-text-section)] font-semibold text-text-primary">Add asset</h2>
                <p id="asset-drawer-description" className="mt-0.5 text-sm text-text-secondary">
                  Record stock identity and its initial Office custody. The Asset Code is generated and immutable.
                </p>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="Close asset drawer" disabled={saving} onClick={requestDrawerClose}>
                <IconX className="size-4" />
              </Button>
            </div>

            <form id="asset-create-form" className="min-h-0 flex-1 overflow-y-auto" onSubmit={createAsset}>
              <div className="space-y-4 p-4 sm:p-5">
                <fieldset className="grid gap-4 rounded-2xl bg-surface-subtle p-4 sm:grid-cols-2"><legend className="px-1 text-sm font-medium">Classification and custody</legend>
                <Field label="Category" help="Controls which identity fields are required for this Asset.">
                  <Select
                    aria-label="Asset category"
                    autoFocus
                    required
                    value={form.category_id}
                    onChange={(event) => {
                      setForm((current) => ({
                        ...EMPTY_FORM,
                        category_id: event.target.value,
                        office_id: current.office_id,
                        condition: current.condition,
                      }));
                      setDrawerDirty(true);
                      setDrawerError("");
                    }}
                  >
                    {options?.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                </Field>
                <Field label="Current Office custody" help="The Office responsible for this stock before employee allocation.">
                  <Select aria-label="Current Office custody" required value={form.office_id} onChange={(event) => setField("office_id", event.target.value)}>
                    {options?.offices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                </Field>
                <Field label="Condition">
                  <Select aria-label="Asset condition" required value={form.condition} onChange={(event) => setField("condition", event.target.value)}>
                    {options?.conditions.map((item) => <option key={item}>{item}</option>)}
                  </Select>
                </Field>
                </fieldset>
                <fieldset className="grid gap-4 rounded-2xl bg-surface-subtle p-4 sm:grid-cols-2"><legend className="px-1 text-sm font-medium">Asset identity</legend>
                {selectedCategory?.fields.map(categoryField)}
                <Field label="Description" className="sm:col-span-2">
                  <TextInput aria-label="Asset description" value={form.description} onChange={(event) => setField("description", event.target.value)} />
                </Field>
                {drawerError ? <div className="sm:col-span-2"><ErrorText>{drawerError}</ErrorText></div> : null}
                </fieldset>
              </div>
            </form>

            <div className="sticky bottom-0 border-t border-brand-border bg-surface px-4 py-3 sm:px-5">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-text-secondary">{drawerDirty ? "Unsaved asset details" : "No staged changes"}</p>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" disabled={saving} onClick={requestDrawerClose}>Cancel</Button>
                  <Button type="submit" form="asset-create-form" disabled={saving}>{saving ? "Creating…" : "Create asset"}</Button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {discardConfirmOpen ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-[#17101f]/45 p-4 backdrop-blur-sm" role="presentation">
          <section role="alertdialog" aria-modal="true" aria-labelledby="asset-discard-title" aria-describedby="asset-discard-description" className="w-full max-w-md rounded-[24px] border border-brand-border bg-surface p-5 shadow-2xl">
            <h2 id="asset-discard-title" className="text-[length:var(--amafh-text-section)] font-semibold text-text-primary">Discard unsaved asset?</h2>
            <p id="asset-discard-description" className="mt-2 text-sm text-text-secondary">The asset has not been created. Your staged details will be lost.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" autoFocus onClick={() => setDiscardConfirmOpen(false)}>Keep editing</Button>
              <Button type="button" variant="danger" onClick={closeDrawer}>Discard changes</Button>
            </div>
          </section>
        </div>
      ) : null}

  </section>;
}




