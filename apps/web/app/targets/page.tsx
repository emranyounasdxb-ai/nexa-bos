"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DatePicker } from "@/components/date-picker";
import {
  IconCalendarCheck,
  IconGauge,
  IconRefresh,
  IconTargetArrow,
  IconX,
} from "@/components/icons";
import {
  Pagination,
  type PaginatedResponse,
  SERVER_PAGE_SIZE_OPTIONS,
  type ServerPageSize,
} from "@/components/pagination";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  DialogPanel,
  EmptyState,
  ErrorText,
  Field,
  PageHeader,
  Select,
  StatusBadge,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
  cx,
} from "@/components/ui";
import { apiGet, apiRequest, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import { formatAed, formatPct } from "@/lib/reports";

type Named = {
  id: string;
  name?: string;
  fullName?: string;
  code?: string;
  employeeCode?: string;
  employmentStatus?: string;
};
type ProductOpt = {
  id: string;
  code: string;
  name: string;
  requestedAmountRequired: boolean;
  defaultMeasurement: string;
};
type TargetResult = {
  target: string;
  effectiveTarget: string;
  actual: string;
  achievementPct: number | null;
  gap: string;
  exceeded: boolean;
  dailyRequiredRunRate: string | null;
  remainingWorkingDays: number;
  period: string;
  from: string;
  to: string;
};
type Target = {
  id: string;
  level: string;
  entityId: string;
  entityName: string | null;
  periodMonth: string;
  productCode: string | null;
  bankCode: string | null;
  milestone: string;
  measurement: string;
  targetValue: string;
  prorate: boolean;
  status: string;
  locked: boolean;
  result: TargetResult | null;
  history?: { id: string; reason: string; oldValues: object; newValues: object; createdAt: string }[];
};
type Options = {
  employees: Named[];
  teams: Named[];
  offices: Named[];
  products: ProductOpt[];
  banks: { id: string; code: string; name: string }[];
  lockedMonths: string[];
};
type PageView = "targets" | "periods";
type PeriodAction = "lock" | "reopen";
type StatusAction = { id: string; name: string; active: boolean };

function monthFirst(value: string): string {
  return value ? `${value.slice(0, 7)}-01` : "";
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function namedLabel(item: Named | undefined): string {
  if (!item) return "Not selected";
  const base = item.fullName ?? item.name ?? "Unnamed";
  const code = item.employeeCode ?? item.code;
  return code ? `${base} (${code})` : base;
}

export default function TargetsPage() {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [options, setOptions] = useState<Options | null>(null);
  const [items, setItems] = useState<Target[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<ServerPageSize>(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeView, setActiveView] = useState<PageView>("targets");
  const [createOpen, setCreateOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [level, setLevel] = useState("employee");
  const [entityId, setEntityId] = useState("");
  const [periodMonth, setPeriodMonth] = useState(monthFirst(new Date().toISOString().slice(0, 10)));
  const [productId, setProductId] = useState("");
  const [bankId, setBankId] = useState("");
  const [milestone, setMilestone] = useState("submitted");
  const [measurement, setMeasurement] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [prorate, setProrate] = useState(false);
  const [filterLevel, setFilterLevel] = useState("");
  const [filterPeriod, setFilterPeriod] = useState("month");
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [periodAction, setPeriodAction] = useState<PeriodAction | null>(null);
  const [periodSaving, setPeriodSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<Target["history"]>([]);

  const entities = useMemo(() => {
    if (!options) return [];
    if (level === "team") return options.teams;
    if (level === "office") return options.offices;
    return options.employees;
  }, [level, options]);

  const selectedEntity = entities.find((item) => item.id === entityId);
  const selectedProduct = options?.products.find((item) => item.id === productId);
  const selectedBank = options?.banks.find((item) => item.id === bankId);
  const normalizedMonth = monthFirst(periodMonth);
  const isPeriodLocked = options?.lockedMonths.includes(normalizedMonth) ?? false;
  const canSubmitTarget = Boolean(entityId && normalizedMonth && productId && targetValue.trim());

  const load = useCallback(async () => {
    try {
      setError("");
      const query = new URLSearchParams({ period: filterPeriod });
      if (filterLevel) query.set("level", filterLevel);
      if (periodMonth) query.set("period_month", monthFirst(periodMonth));
      query.set("page", String(page));
      query.set("page_size", String(pageSize));
      setLoading(true);
      const [opts, listed] = await Promise.all([
        apiGet<Options>("/api/v1/targets/options", api),
        apiGet<PaginatedResponse<Target>>(`/api/v1/targets?${query}`, api),
      ]);
      setOptions(opts);
      setItems(listed.items);
      setTotal(listed.pagination.total);
      setTotalPages(listed.pagination.totalPages);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to load targets");
    } finally {
      setLoading(false);
    }
  }, [api, filterLevel, filterPeriod, page, pageSize, periodMonth]);

  useEffect(() => {
    if (can("Targets.View")) void load();
  }, [can, load]);

  useEffect(() => {
    if (selectedProduct && !measurement) setMeasurement(selectedProduct.defaultMeasurement);
  }, [measurement, selectedProduct]);

  useEffect(() => {
    if (!createOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !createSaving) setCreateOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [createOpen, createSaving]);

  async function createTarget() {
    if (!canSubmitTarget) return;
    setError("");
    setMessage("");
    setCreateSaving(true);
    try {
      await apiRequest("/api/v1/targets", api, {
        method: "POST",
        body: JSON.stringify({
          level,
          entity_id: entityId,
          period_month: normalizedMonth,
          product_id: productId,
          bank_id: bankId || null,
          milestone,
          measurement: measurement || null,
          target_value: targetValue,
          prorate,
        }),
      });
      setTargetValue("");
      setCreateOpen(false);
      setMessage("Target saved.");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Save failed");
    } finally {
      setCreateSaving(false);
    }
  }

  async function saveEdit() {
    if (!editId) return;
    setError("");
    setEditSaving(true);
    try {
      await apiRequest(`/api/v1/targets/${editId}`, api, {
        method: "PATCH",
        body: JSON.stringify({ target_value: editValue, reason: editReason }),
      });
      setEditId(null);
      setEditReason("");
      setMessage("Target updated.");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Update failed");
    } finally {
      setEditSaving(false);
    }
  }

  async function confirmStatus() {
    if (!statusAction) return;
    setError("");
    setStatusSaving(true);
    try {
      await apiRequest(`/api/v1/targets/${statusAction.id}/${statusAction.active ? "activate" : "deactivate"}`, api, { method: "POST" });
      setMessage(`Target ${statusAction.active ? "activated" : "deactivated"}.`);
      setStatusAction(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Status change failed");
    } finally {
      setStatusSaving(false);
    }
  }

  async function confirmPeriodAction() {
    if (!periodAction) return;
    setError("");
    setPeriodSaving(true);
    try {
      if (periodAction === "lock") {
        await apiRequest(`/api/v1/targets/periods/${normalizedMonth}/lock`, api, { method: "POST" });
        setMessage("Target period locked.");
      } else {
        await apiRequest(`/api/v1/targets/periods/${normalizedMonth}/reopen`, api, {
          method: "POST",
          body: JSON.stringify({ reason: reopenReason }),
        });
        setReopenReason("");
        setMessage("Target period reopened.");
      }
      setPeriodAction(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : periodAction === "lock" ? "Lock failed" : "Reopen failed");
    } finally {
      setPeriodSaving(false);
    }
  }

  async function showHistory(id: string) {
    try {
      const detail = await apiGet<Target>(`/api/v1/targets/${id}`, api);
      setHistoryId(id);
      setHistory(detail.history ?? []);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to load history");
    }
  }

  if (!can("Targets.View")) {
    return (
      <section>
        <PageHeader title="Targets" />
        <EmptyState>You do not have permission to view targets.</EmptyState>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="Targets"
        description="Plan measurable employee, team, and office outcomes and review authoritative results."
        actions={
          <>
            <ButtonLink href="/targets/kpi" variant="secondary">
              <IconGauge className="size-4" />
              KPI scorecards
            </ButtonLink>
            {can("Targets.Create") ? (
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <IconTargetArrow className="size-4" />
                Create target
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="overflow-hidden p-0">
        <div className="border-b border-slate-200 px-3 pt-3 sm:px-4">
          <p className="mb-3 text-sm text-slate-600">
            Review targets and their results, or manage the monthly lock lifecycle in a separate workspace.
          </p>
          <div role="tablist" aria-label="Target workspaces" className="flex gap-1 overflow-x-auto">
            {([
              ["targets", "Targets", IconTargetArrow],
              ["periods", "Period Management", IconCalendarCheck],
            ] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                id={`${value}-tab`}
                type="button"
                role="tab"
                aria-selected={activeView === value}
                aria-controls={`${value}-panel`}
                className={cx(
                  "inline-flex h-9 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c81]",
                  activeView === value
                    ? "border-[#0f4c81] text-[#0f4c81]"
                    : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900",
                )}
                onClick={() => setActiveView(value)}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeView === "targets" ? (
          <div id="targets-panel" role="tabpanel" aria-labelledby="targets-tab" className="space-y-4 p-3 sm:p-4">
            <div className="flex flex-col gap-3 rounded-lg bg-slate-50 p-3 md:flex-row md:items-end">
              <Field label="Level" className="w-full md:max-w-56">
                <Select aria-label="Filter level" value={filterLevel} onChange={(event) => { setFilterLevel(event.target.value); setPage(1); }}>
                  <option value="">All levels</option>
                  <option value="employee">Employee</option>
                  <option value="team">Team</option>
                  <option value="office">Office</option>
                </Select>
              </Field>
              <Field label="Result period" className="w-full md:max-w-56">
                <Select aria-label="Result period" value={filterPeriod} onChange={(event) => { setFilterPeriod(event.target.value); setPage(1); }}>
                  <option value="month">Monthly</option>
                  <option value="qtd">QTD</option>
                  <option value="half_year">Half-Year</option>
                  <option value="ytd">YTD</option>
                </Select>
              </Field>
              <Field label="Month" className="w-full md:max-w-56">
                <DatePicker
                  aria-label="Target month filter"
                  value={periodMonth}
                  onChange={(value) => {
                    setPeriodMonth(monthFirst(value));
                    setPage(1);
                  }}
                />
              </Field>
              <Button type="button" variant="secondary" disabled={loading} onClick={() => void load()}>
                <IconRefresh className={cx("size-4", loading && "animate-spin")} />
                Refresh
              </Button>
              <p className="text-xs text-slate-500 md:ml-auto md:self-center">{total.toLocaleString()} target{total === 1 ? "" : "s"} in scope</p>
            </div>

            <ErrorText>{error}</ErrorText>
            {message ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p> : null}
            {loading && items.length === 0 ? (
              <EmptyState>Loading targets…</EmptyState>
            ) : items.length === 0 ? (
              <EmptyState>
                <span>No targets are in scope for the selected filters.</span>
                {can("Targets.Create") ? <Button className="mt-3" type="button" onClick={() => setCreateOpen(true)}>Create target</Button> : null}
              </EmptyState>
            ) : (
              <TableShell className={loading ? "opacity-70" : undefined}>
                <TableHead>
                  <tr>
                    <Th>Level</Th><Th>Entity</Th><Th>Month</Th><Th>Product</Th><Th>Bank</Th><Th>Milestone</Th><Th>Target</Th><Th>Actual</Th><Th>Achievement</Th><Th>Gap</Th><Th>Run-rate</Th><Th>Status</Th><Th>Actions</Th>
                  </tr>
                </TableHead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <Td className="capitalize">{item.level}</Td>
                      <Td>{item.level === "employee" ? <Link className="font-medium text-[#0f4c81] underline-offset-2 hover:underline" href={`/reports/employees/${item.entityId}`}>{item.entityName}</Link> : item.entityName}</Td>
                      <Td>{item.periodMonth}</Td><Td>{item.productCode}</Td><Td>{item.bankCode ?? "Overall"}</Td><Td className="capitalize">{item.milestone}</Td>
                      <Td className="font-medium text-slate-900">{item.measurement === "amount" ? formatAed(item.result?.effectiveTarget ?? item.targetValue) : item.result?.effectiveTarget ?? item.targetValue}</Td>
                      <Td>{item.measurement === "amount" ? formatAed(item.result?.actual) : item.result?.actual}</Td><Td>{formatPct(item.result?.achievementPct)}</Td><Td>{item.result?.gap}</Td><Td>{item.result?.dailyRequiredRunRate ?? "—"}</Td>
                      <Td><div className="flex flex-wrap gap-1"><StatusBadge value={humanize(item.status)} />{item.locked ? <Badge tone="red">Locked</Badge> : null}{item.prorate ? <Badge tone="blue">Prorated</Badge> : null}</div></Td>
                      <Td>
                        <div className="flex flex-wrap gap-1.5">
                          <Button type="button" variant="secondary" size="compact" onClick={() => void showHistory(item.id)}>History</Button>
                          {can("Targets.Edit") && !item.locked ? <Button type="button" variant="secondary" size="compact" onClick={() => { setEditId(item.id); setEditValue(item.targetValue); setEditReason(""); }}>Edit</Button> : null}
                          {can("Targets.Deactivate") && item.status === "active" ? <Button type="button" variant="secondary" size="compact" onClick={() => setStatusAction({ id: item.id, name: item.entityName ?? "Target", active: false })}>Deactivate</Button> : null}
                          {can("Targets.Activate") && item.status === "inactive" ? <Button type="button" variant="secondary" size="compact" onClick={() => setStatusAction({ id: item.id, name: item.entityName ?? "Target", active: true })}>Activate</Button> : null}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
            <Pagination page={page} pageSize={pageSize} total={total} totalPages={totalPages} pageSizeOptions={SERVER_PAGE_SIZE_OPTIONS} onPageChange={setPage} onPageSizeChange={(value) => { if (value !== "all") setPageSize(value); }} />
          </div>
        ) : (
          <div id="periods-panel" role="tabpanel" aria-labelledby="periods-tab" className="p-3 sm:p-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.65fr)]">
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h2 className="text-base font-semibold text-slate-900">Monthly period controls</h2><p className="mt-1 max-w-2xl text-sm text-slate-600">Lock a month to prevent target edits. Reopening requires a recorded reason and is audited.</p></div>
                  <Badge tone={isPeriodLocked ? "red" : "green"}>{isPeriodLocked ? "Locked" : "Open"}</Badge>
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <Field label="Target month" className="w-full sm:max-w-64"><DatePicker aria-label="Target month" value={periodMonth} onChange={(value) => { setPeriodMonth(monthFirst(value)); setPage(1); }} /></Field>
                  {can("Targets.Edit") && !isPeriodLocked ? <Button type="button" variant="secondary" onClick={() => setPeriodAction("lock")}>Lock month</Button> : null}
                  {can("Targets.ReopenPeriod") && isPeriodLocked ? <Button type="button" variant="secondary" onClick={() => setPeriodAction("reopen")}>Reopen month</Button> : null}
                </div>
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <h2 className="text-sm font-semibold text-slate-900">Locked months</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">Only months returned by the existing target-period service are shown.</p>
                {options?.lockedMonths.length ? <ul className="mt-3 flex flex-wrap gap-2" aria-label="Locked target months">{options.lockedMonths.map((month) => <li key={month}><Badge tone="red">{month}</Badge></li>)}</ul> : <p className="mt-4 text-sm text-slate-600">No target months are currently locked.</p>}
              </div>
            </div>
            <div className="mt-4"><ErrorText>{error}</ErrorText>{message ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p> : null}</div>
          </div>
        )}
      </Card>

      {createOpen ? (
        <div className="fixed inset-0 z-50" role="presentation">
          <button type="button" className="absolute inset-0 bg-slate-950/40" aria-label="Close create target drawer" onClick={() => !createSaving && setCreateOpen(false)} />
          <aside role="dialog" aria-modal="true" aria-labelledby="create-target-title" className="absolute inset-y-0 right-0 flex w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl sm:max-w-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-6">
              <div><h2 id="create-target-title" className="text-lg font-semibold text-slate-900">Create target</h2><p className="mt-1 text-sm text-slate-600">Define who owns the target, its monthly period, and how results are measured.</p></div>
              <Button type="button" variant="ghost" size="icon" aria-label="Close drawer" disabled={createSaving} onClick={() => setCreateOpen(false)}><IconX className="size-4" /></Button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
              <fieldset className="rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-900">Assignment</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Level"><Select autoFocus aria-label="Target level" value={level} onChange={(event) => { setLevel(event.target.value); setEntityId(""); }}><option value="employee">Employee</option><option value="team">Team</option><option value="office">Office</option></Select><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Sets whether the target belongs to one employee, team, or office.</span></Field>
                  <Field label="Entity"><Select aria-label="Target entity" value={entityId} onChange={(event) => setEntityId(event.target.value)}><option value="">Select</option>{entities.map((item) => <option key={item.id} value={item.id}>{namedLabel(item)}</option>)}</Select><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Options are limited by the existing reporting scope.</span></Field>
                </div>
              </fieldset>

              <fieldset className="rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-900">Target period</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Month / period"><DatePicker aria-label="Target month" value={periodMonth} onChange={(value) => { setPeriodMonth(monthFirst(value)); setPage(1); }} /><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">The saved target applies to the calendar month containing this date.</span></Field>
                  <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600"><span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Selected period</span><span className="mt-1 block font-medium text-slate-900">{normalizedMonth || "Not selected"}</span>{isPeriodLocked ? <span className="mt-2 block text-xs text-red-700">This month is currently locked.</span> : null}</div>
                </div>
              </fieldset>

              <fieldset className="rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-900">Measurement</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Product"><Select aria-label="Product" value={productId} onChange={(event) => { const nextId = event.target.value; setProductId(nextId); setMeasurement(options?.products.find((item) => item.id === nextId)?.defaultMeasurement ?? ""); }}><option value="">Select</option>{options?.products.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</Select><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">The product supplies the existing default measurement.</span></Field>
                  <Field label="Bank (optional)"><Select aria-label="Bank" value={bankId} onChange={(event) => setBankId(event.target.value)}><option value="">Overall product</option>{options?.banks.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}</Select><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Leave blank to measure the product across all banks.</span></Field>
                  <Field label="Milestone"><Select aria-label="Milestone" value={milestone} onChange={(event) => setMilestone(event.target.value)}><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="booked">Booked</option><option value="funded">Funded</option></Select><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Actual results use applications that reached this workflow milestone.</span></Field>
                  <Field label="Measurement"><Select aria-label="Measurement" value={measurement} onChange={(event) => setMeasurement(event.target.value)}><option value="amount">Amount (AED)</option><option value="count">Count</option></Select><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Measure the milestone by eligible amount or application count.</span></Field>
                  <Field label="Target value"><TextInput aria-label="Target value" inputMode="decimal" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} /><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Enter a non-negative count or AED value matching the selected measurement.</span></Field>
                  <Field label="Prorate"><Select aria-label="Prorate" value={prorate ? "yes" : "no"} onChange={(event) => setProrate(event.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></Select><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">For the current month, prorating adjusts the effective target by elapsed working days.</span></Field>
                </div>
              </fieldset>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4" aria-label="Target summary">
                <h3 className="text-sm font-semibold text-blue-950">Target summary</h3>
                <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-blue-700">Assignment</dt><dd className="font-medium text-blue-950">{humanize(level)} · {namedLabel(selectedEntity)}</dd></div>
                  <div><dt className="text-blue-700">Period</dt><dd className="font-medium text-blue-950">{normalizedMonth || "Not selected"}</dd></div>
                  <div><dt className="text-blue-700">Product / bank</dt><dd className="font-medium text-blue-950">{selectedProduct ? `${selectedProduct.name} (${selectedProduct.code})` : "Not selected"} · {selectedBank ? `${selectedBank.name} (${selectedBank.code})` : "Overall"}</dd></div>
                  <div><dt className="text-blue-700">Result</dt><dd className="font-medium text-blue-950">{humanize(milestone)} · {humanize(measurement || "Not selected")} · {targetValue || "No value"}{prorate ? " · Prorated" : ""}</dd></div>
                </dl>
              </div>
              <ErrorText>{error}</ErrorText>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-6"><Button type="button" variant="secondary" disabled={createSaving} onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="button" disabled={createSaving || !canSubmitTarget || isPeriodLocked} onClick={() => void createTarget()}>{createSaving ? "Saving…" : "Save target"}</Button></div>
          </aside>
        </div>
      ) : null}

      {editId ? (
        <DialogPanel title="Edit target" description="Update the target value and record the required reason." onClose={() => !editSaving && setEditId(null)}>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Target value"><TextInput aria-label="Edit target value" value={editValue} onChange={(event) => setEditValue(event.target.value)} /></Field><Field label="Reason"><TextInput aria-label="Edit reason" value={editReason} onChange={(event) => setEditReason(event.target.value)} /></Field></div>
          <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="secondary" disabled={editSaving} onClick={() => setEditId(null)}>Cancel</Button><Button type="button" disabled={editSaving || !editValue.trim() || !editReason.trim()} onClick={() => void saveEdit()}>{editSaving ? "Saving…" : "Save edit"}</Button></div>
        </DialogPanel>
      ) : null}

      {historyId ? (
        <DialogPanel title="Edit history" description="Recorded changes for this target." onClose={() => setHistoryId(null)}>
          {history && history.length > 0 ? <ul className="space-y-2 text-sm">{history.map((row) => <li key={row.id} className="rounded-md border border-slate-200 p-3"><span className="block font-medium text-slate-900">{row.reason}</span><span className="mt-1 block text-xs text-slate-500">{row.createdAt}</span></li>)}</ul> : <EmptyState>No edits recorded.</EmptyState>}
        </DialogPanel>
      ) : null}

      {periodAction ? (
        <DialogPanel title={periodAction === "lock" ? "Confirm period lock" : "Reopen target period"} description={`${normalizedMonth} · ${periodAction === "lock" ? "Open" : "Locked"}`} onClose={() => !periodSaving && setPeriodAction(null)}>
          <p className="text-sm leading-6 text-slate-600">{periodAction === "lock" ? "Locking this month prevents edits to its targets. The action is recorded in the audit history." : "Reopening removes the period lock and records both your reason and the action in audit history."}</p>
          {periodAction === "reopen" ? <Field label="Reopen reason" className="mt-4"><TextInput autoFocus aria-label="Reopen reason" value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} /></Field> : null}
          <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="secondary" disabled={periodSaving} onClick={() => setPeriodAction(null)}>Cancel</Button><Button type="button" disabled={periodSaving || (periodAction === "reopen" && !reopenReason.trim())} onClick={() => void confirmPeriodAction()}>{periodSaving ? "Saving…" : periodAction === "lock" ? "Lock month" : "Reopen month"}</Button></div>
        </DialogPanel>
      ) : null}

      {statusAction ? (
        <DialogPanel title={`Confirm ${statusAction.active ? "activation" : "deactivation"}`} description={statusAction.name} onClose={() => !statusSaving && setStatusAction(null)}>
          <p className="text-sm leading-6 text-slate-600">This will mark the target {statusAction.active ? "active" : "inactive"}. The existing API does not provide a dependency count for this action.</p>
          <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="secondary" disabled={statusSaving} onClick={() => setStatusAction(null)}>Cancel</Button><Button type="button" variant={statusAction.active ? "primary" : "danger"} disabled={statusSaving} onClick={() => void confirmStatus()}>{statusSaving ? "Updating…" : statusAction.active ? "Activate" : "Deactivate"}</Button></div>
        </DialogPanel>
      ) : null}
    </section>
  );
}
