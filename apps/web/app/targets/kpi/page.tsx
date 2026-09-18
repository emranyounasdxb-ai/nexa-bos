"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { IconEdit, IconGauge, IconTargetArrow, IconX } from "@/components/icons";
import { Pagination, useClientPagination } from "@/components/pagination";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  DialogPanel,
  EmptyState,
  ErrorText,
  Field,
  LoadingState,
  PageHeader,
  Select,
  StatusBadge,
  TextInput,
  cx,
} from "@/components/ui";
import { apiGet, apiRequest, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import styles from "./kpi.module.css";

type MetricDef = { code: string; label: string; defaultDirection: string };
type MetricRow = {
  id?: string;
  metricCode: string;
  weightPercent: string;
  direction: string;
  baseline?: string | null;
  sortOrder: number;
};
type Scorecard = {
  id: string;
  name: string;
  status: string;
  weightTotal: string;
  weightValid: boolean;
  metrics: MetricRow[];
};
type EditorMode = "create" | "edit";
type StatusAction = { id: string; name: string; activate: boolean };

const milestoneMetricCodes = new Set([
  "submitted_count",
  "submitted_value",
  "approved_count",
  "approved_value",
  "booked_count",
  "booked_value",
  "funded_count",
  "funded_value",
]);

function defaultMetricRows(): MetricRow[] {
  return [
    {
      metricCode: "target_achievement",
      weightPercent: "100",
      direction: "higher_is_better",
      baseline: "100",
      sortOrder: 0,
    },
  ];
}

function editorSnapshot(name: string, rows: MetricRow[]): string {
  return JSON.stringify({
    name,
    rows: rows.map((row, index) => ({
      metricCode: row.metricCode,
      weightPercent: row.weightPercent,
      direction: row.direction,
      baseline: row.baseline ?? "",
      sortOrder: index,
    })),
  });
}

function numericValue(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function KpiScorecardsPage() {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [items, setItems] = useState<Scorecard[]>([]);
  const [catalog, setCatalog] = useState<MetricDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<MetricRow[]>(defaultMetricRows);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [initialEditorState, setInitialEditorState] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const pagination = useClientPagination(items);

  const catalogByCode = useMemo(
    () => new Map(catalog.map((metric) => [metric.code, metric])),
    [catalog],
  );
  const total = useMemo(
    () => rows.reduce((sum, row) => sum + (numericValue(row.weightPercent) ?? 0), 0),
    [rows],
  );
  const currentEditorState = useMemo(() => editorSnapshot(name, rows), [name, rows]);
  const editorDirty = editorOpen && currentEditorState !== initialEditorState;
  const validationReasons = useMemo(() => {
    const reasons: string[] = [];
    if (!name.trim()) reasons.push("Enter a scorecard name.");
    if (name.trim().length > 160) reasons.push("Keep the scorecard name within 160 characters.");
    if (rows.length === 0) reasons.push("Add at least one metric.");

    const seen = new Set<string>();
    rows.forEach((row, index) => {
      const position = index + 1;
      if (!row.metricCode) reasons.push(`Choose a metric for row ${position}.`);
      if (seen.has(row.metricCode)) reasons.push(`Metric ${position} duplicates another metric.`);
      seen.add(row.metricCode);

      const weight = numericValue(row.weightPercent);
      if (weight === null || weight <= 0 || weight > 100) {
        reasons.push(`Metric ${position} weight must be greater than 0 and no more than 100.`);
      }
      if (!milestoneMetricCodes.has(row.metricCode)) {
        const baseline = numericValue(row.baseline);
        if (baseline === null || baseline < 0) {
          reasons.push(`Metric ${position} requires a non-negative baseline / target.`);
        }
      }
    });
    if (Math.abs(total - 100) >= 0.001) reasons.push("Total metric weight must equal exactly 100%.");
    return [...new Set(reasons)];
  }, [name, rows, total]);
  const canSave = validationReasons.length === 0;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError("");
      const data = await apiGet<{ items: Scorecard[]; metrics: MetricDef[] }>("/api/v1/targets/kpi", api);
      setItems(data.items);
      setCatalog(data.metrics);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to load KPI scorecards");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (can("Targets.View")) void load();
  }, [can, load]);

  useEffect(() => {
    if (!editorOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!editorDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving && !discardOpen) {
        if (editorDirty) setDiscardOpen(true);
        else setEditorOpen(false);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [discardOpen, editorDirty, editorOpen, saving]);

  function openCreate() {
    const nextRows = defaultMetricRows();
    setEditorMode("create");
    setEditingId(null);
    setName("");
    setRows(nextRows);
    setInitialEditorState(editorSnapshot("", nextRows));
    setError("");
    setMessage("");
    setDiscardOpen(false);
    setEditorOpen(true);
  }

  function openEdit(item: Scorecard) {
    const nextRows = item.metrics.map((row, index) => ({ ...row, sortOrder: index }));
    setEditorMode("edit");
    setEditingId(item.id);
    setName(item.name);
    setRows(nextRows);
    setInitialEditorState(editorSnapshot(item.name, nextRows));
    setError("");
    setMessage("");
    setDiscardOpen(false);
    setEditorOpen(true);
  }

  function requestCloseEditor() {
    if (saving) return;
    if (editorDirty) setDiscardOpen(true);
    else setEditorOpen(false);
  }

  function discardEditorChanges() {
    setDiscardOpen(false);
    setEditorOpen(false);
    setError("");
  }

  function updateRow(index: number, patch: Partial<MetricRow>) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    const next = catalog.find((item) => !rows.some((row) => row.metricCode === item.code));
    if (!next) return;
    setRows((current) => [
      ...current,
      {
        metricCode: next.code,
        weightPercent: "0",
        direction: next.defaultDirection,
        baseline: "",
        sortOrder: current.length,
      },
    ]);
  }

  function removeRow(index: number) {
    setRows((current) =>
      current
        .filter((_, rowIndex) => rowIndex !== index)
        .map((row, rowIndex) => ({ ...row, sortOrder: rowIndex })),
    );
  }

  async function saveCard() {
    if (!canSave) return;
    setError("");
    setMessage("");
    setSaving(true);
    const payload = {
      name: name.trim(),
      metrics: rows.map((row, index) => ({
        metric_code: row.metricCode,
        weight_percent: row.weightPercent,
        direction: row.direction,
        baseline: row.baseline?.trim() ? row.baseline : null,
        sort_order: index,
      })),
    };
    try {
      if (editorMode === "edit" && editingId) {
        await apiRequest(`/api/v1/targets/kpi/${editingId}`, api, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setMessage("KPI scorecard updated.");
      } else {
        await apiRequest("/api/v1/targets/kpi", api, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setMessage("KPI scorecard saved.");
      }
      setEditorOpen(false);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function confirmStatusAction() {
    if (!statusAction) return;
    setError("");
    setMessage("");
    setStatusSaving(true);
    try {
      await apiRequest(
        `/api/v1/targets/kpi/${statusAction.id}/${statusAction.activate ? "activate" : "deactivate"}`,
        api,
        { method: "POST" },
      );
      setMessage(`KPI scorecard ${statusAction.activate ? "activated" : "deactivated"}.`);
      setStatusAction(null);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : statusAction.activate
            ? "Activation failed"
            : "Deactivation failed",
      );
    } finally {
      setStatusSaving(false);
    }
  }

  if (!can("Targets.View")) {
    return (
      <section>
        <PageHeader title="KPI scorecards" />
        <EmptyState>You do not have permission to view KPI scorecards.</EmptyState>
      </section>
    );
  }

  return (
    <section className={styles.scorecardsPage}>
      <PageHeader
        title="KPI scorecards"
        description="Configure how existing employee results combine into an overall KPI score."
        actions={
          <>
            <ButtonLink href="/targets" variant="secondary">
              <IconTargetArrow className="size-4" />
              Targets
            </ButtonLink>
            {can("Targets.Create") ? (
              <Button type="button" onClick={openCreate}>
                <IconGauge className="size-4" />
                Create scorecard
              </Button>
            ) : null}
          </>
        }
      />

      <Card className={cx("overflow-hidden p-0", styles.scorecardsCard)}>
        <div className={styles.listHeader}>
          <div>
            <h2 className="text-[length:var(--amafh-text-section)] font-semibold text-slate-900">Scorecards</h2>
            <p className="mt-1 text-sm text-slate-600">Configuration only: the weights below are not employee performance scores.</p>
          </div>
          <Badge tone="neutral">{items.length} configured</Badge>
        </div>

        <div className={styles.listBody}>
          <div className={styles.explanation}>
            <p><strong>How scoring works:</strong> A scorecard combines metric achievements into one KPI score. Each achievement is multiplied by its weight, with its contribution capped at that weight. For example, 80% achievement at a 25% weight contributes 20 points. Missing actuals or comparison values contribute zero.</p>
            <p><strong>Where it applies:</strong> Only one scorecard can be Active. The service uses it for employee KPI calculations in the selected reporting period and permitted reporting scope; there are no separate employee assignments here. Active does not guarantee that all metric data or matching targets are available.</p>
            <p><strong>Where results appear:</strong> My Performance on the role dashboard and Targets / KPI in employee reports, where available to the user. This page configures the calculation; it does not show those results.</p>
          </div>
          <ErrorText>{error}</ErrorText>
          {message ? (
            <p role="status" className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {message}
            </p>
          ) : null}

          {loading ? (
            <LoadingState>Loading KPI scorecards…</LoadingState>
          ) : items.length === 0 ? (
            <EmptyState>
              <div className="flex flex-col items-start gap-3">
                <span>No KPI scorecards are configured.</span>
                {can("Targets.Create") ? (
                  <Button type="button" onClick={openCreate}>
                    Create scorecard
                  </Button>
                ) : null}
              </div>
            </EmptyState>
          ) : (
            <>
              <div className={styles.scorecardList} aria-label="Configured scorecards">
                  {pagination.pagedItems.map((item) => (
                    <article data-amafh-list-record="" key={item.id} className={styles.scorecard}>
                      <header className={styles.scorecardHeader}><h3 data-amafh-record-primary="" className="font-medium text-text-primary">{item.name}</h3>
                      <StatusBadge value={item.status} /></header>
                      <p className={styles.usage}>{item.status === "active" ? "Used for KPI calculations" : "Not used for KPI calculations"}</p>
                      <div className={styles.weightSummary}>
                        <span className="text-text-secondary">Total assigned weight</span>
                        <strong className="font-medium text-text-primary">{item.weightTotal}%</strong>
                        <Badge tone={item.weightValid ? "green" : "amber"}>{item.weightValid && Number(item.weightTotal) === 100 ? "Weights total 100%" : "Weights must total 100%"}</Badge>
                      </div>
                      <div className={styles.configuredMetrics}>
                        <p className="text-text-secondary">Configured metrics</p>
                        <dl className={styles.metricRows}>
                          {item.metrics.map((metric) => (
                            <div key={metric.id ?? metric.metricCode}>
                              <dt>{catalogByCode.get(metric.metricCode)?.label ?? "Unavailable metric"}</dt>
                              <dd>{metric.weightPercent}%</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                      <footer className={styles.scorecardActions}>
                        <div className="flex flex-wrap gap-1.5">
                          {can("Targets.Edit") ? (
                            <Button type="button" variant="secondary" size="compact" aria-label={`Edit ${item.name}`} onClick={() => openEdit(item)}>
                              <IconEdit className="size-3.5" />
                              Edit
                            </Button>
                          ) : null}
                          {can("Targets.Activate") && item.status !== "active" ? (
                            <Button type="button" size="compact" aria-label={`Activate ${item.name}`} onClick={() => setStatusAction({ id: item.id, name: item.name, activate: true })}>
                              Activate
                            </Button>
                          ) : null}
                          {can("Targets.Deactivate") && item.status === "active" ? (
                            <Button type="button" variant="secondary" size="compact" aria-label={`Deactivate ${item.name}`} onClick={() => setStatusAction({ id: item.id, name: item.name, activate: false })}>
                              Deactivate
                            </Button>
                          ) : null}
                        </div>
                      </footer>
                    </article>
                  ))}
              </div>
              <Pagination
                className="rounded-t-none border-t-0"
                page={pagination.page}
                pageSize={pagination.pageSize}
                total={pagination.total}
                totalPages={pagination.totalPages}
                onPageChange={pagination.setPage}
                onPageSizeChange={pagination.setPageSize}
              />
            </>
          )}
        </div>
      </Card>

      {editorOpen ? (
        <div className="fixed inset-0 z-50" role="presentation">
          <button type="button" className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-label="Close scorecard drawer" onClick={requestCloseEditor} />
          <aside role="dialog" aria-modal="true" aria-labelledby="scorecard-editor-title" className={cx("absolute inset-y-3 right-3 flex w-[calc(100%-24px)] flex-col overflow-hidden rounded-[24px] border border-brand-border bg-surface shadow-2xl sm:max-w-4xl", styles.editor)}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{editorMode === "edit" ? "Edit configuration" : "New configuration"}</p>
                <h2 id="scorecard-editor-title" className="mt-1 text-[length:var(--amafh-text-section)] font-semibold text-slate-900">
                  {editorMode === "edit" ? "Edit KPI scorecard" : "Create KPI scorecard"}
                </h2>
                <p className="mt-1 text-sm text-slate-600">{editorMode === "create" ? "New scorecards are saved as Draft. Activate from the list to use one for KPI calculations." : "Saving updates this configuration without changing its status."}</p>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="Close drawer" disabled={saving} onClick={requestCloseEditor}>
                <IconX className="size-4" />
              </Button>
            </div>

            <div className={cx("flex-1 overflow-y-auto", styles.editorBody)}>
              <fieldset className={styles.editorGroup}>
                <legend className="px-1 text-sm font-semibold text-slate-900">Scorecard details</legend>
                <div className="max-w-xl">
                  <Field label="Scorecard name">
                    <TextInput autoFocus maxLength={160} aria-label="Scorecard name" value={name} onChange={(event) => setName(event.target.value)} />
                    <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">A name to identify this configuration in the list and KPI results.</span>
                  </Field>
                </div>
              </fieldset>

              <fieldset className={styles.editorGroup}>
                <legend className="px-1 text-sm font-semibold text-slate-900">Metrics</legend>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="max-w-3xl text-sm leading-6 text-slate-600">
                    Choose each metric once and assign its share of the overall score. Submitted, approved, booked and funded metrics use matching active employee Targets without a bank-specific scope. Other metrics use the saved Baseline / target value.
                  </p>
                  <Button type="button" variant="secondary" disabled={rows.length >= catalog.length} onClick={addRow}>
                    Add metric
                  </Button>
                </div>

                <div className={styles.editorWeight} aria-label="Total assigned weight">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-slate-700">Total assigned weight</span>
                    <span className={cx("font-semibold", Math.abs(total - 100) < 0.001 ? "text-emerald-700" : "text-amber-800")}>
                      {total.toFixed(2)}% / 100%
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="Assigned weight total, not performance" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, total))}>
                    <div className={cx("h-full rounded-full transition-[width]", Math.abs(total - 100) < 0.001 ? "bg-emerald-600" : "bg-amber-500")} style={{ width: `${Math.min(100, Math.max(0, total))}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-slate-600">Weights must total exactly 100% before saving. This checks the configuration, not employee achievement.</p>
                </div>

                <div className="mt-3 space-y-2">
                  {rows.length === 0 ? (
                    <EmptyState>Add at least one metric to configure this scorecard.</EmptyState>
                  ) : rows.map((row, index) => {
                    const selectedDefinition = catalogByCode.get(row.metricCode);
                    const milestoneMetric = milestoneMetricCodes.has(row.metricCode);
                    return (
                      <section key={`${row.id ?? row.metricCode}-${index}`} className="rounded-lg border border-slate-200 bg-surface p-3" aria-labelledby={`metric-${index + 1}-title`}>
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-action text-xs font-semibold text-action-text">{index + 1}</span>
                            <div className="min-w-0">
                              <h3 id={`metric-${index + 1}-title`} className="truncate text-sm font-semibold text-slate-900">{selectedDefinition?.label ?? "Metric"}</h3>
                            </div>
                          </div>
                          <Button type="button" variant="ghost" size="compact" aria-label={`Remove metric ${index + 1}`} onClick={() => removeRow(index)}>
                            Remove
                          </Button>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <Field label="Metric" help="The existing operational measure to include. Each metric can appear only once.">
                            <Select
                              aria-label={`Metric ${index + 1}`}
                              value={row.metricCode}
                              onChange={(event) => {
                                const next = catalogByCode.get(event.target.value);
                                updateRow(index, {
                                  metricCode: event.target.value,
                                  direction: next?.defaultDirection ?? row.direction,
                                  baseline: milestoneMetricCodes.has(event.target.value) ? "" : row.baseline,
                                });
                              }}
                            >
                              {catalog.map((item) => (
                                <option key={item.code} value={item.code} disabled={rows.some((other, otherIndex) => otherIndex !== index && other.metricCode === item.code)}>
                                  {item.label}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Weight (%)" help="This metric's share of the overall score. All weights must total 100%. For example, a 25% weight contributes up to 25 points.">
                            <TextInput type="number" min="0.01" max="100" step="0.01" inputMode="decimal" aria-label={`Weight ${index + 1}`} value={row.weightPercent} onChange={(event) => updateRow(index, { weightPercent: event.target.value })} />
                          </Field>
                          <Field label="Baseline / target">
                            <TextInput type="number" min="0" step="0.01" inputMode="decimal" aria-label={`Baseline ${index + 1}`} value={row.baseline ?? ""} onChange={(event) => updateRow(index, { baseline: event.target.value })} />
                            <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">{milestoneMetric ? "The saved value is not used for this metric; scoring uses matching configured Targets." : "Required comparison value: achievement compares the actual result with this value."}</span>
                          </Field>
                          <Field label="Direction" help="Higher is better compares actual to baseline; lower is better compares baseline to actual. Each metric's weighted contribution is capped at its assigned weight.">
                            <Select aria-label={`Direction ${index + 1}`} value={row.direction} onChange={(event) => updateRow(index, { direction: event.target.value })}>
                              <option value="higher_is_better">Higher is better</option>
                              <option value="lower_is_better">Lower is better</option>
                            </Select>
                          </Field>
                        </div>
                      </section>
                    );
                  })}
                </div>
              </fieldset>

              {validationReasons.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900" aria-label="Scorecard validation">
                  <p className="font-semibold">Complete the following before saving:</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {validationReasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                </div>
              ) : (
                <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Scorecard configuration is ready to save.</p>
              )}
              <ErrorText>{error}</ErrorText>
            </div>

            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-surface px-4 py-3 sm:px-6">
              <p className="text-xs text-slate-500">{editorDirty ? "You have unsaved changes." : "No unsaved changes."}</p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" disabled={saving} onClick={requestCloseEditor}>Cancel</Button>
                <Button type="button" disabled={saving || !canSave} aria-describedby={!canSave ? "scorecard-save-reason" : undefined} onClick={() => void saveCard()}>
                  {saving ? "Saving…" : editorMode === "edit" ? "Save changes" : "Save scorecard"}
                </Button>
              </div>
              {!canSave ? <span id="scorecard-save-reason" className="sr-only">Complete all validation requirements before saving.</span> : null}
            </div>
          </aside>
        </div>
      ) : null}

      {discardOpen ? (
        <DialogPanel title="Discard unsaved changes?" description="Your scorecard changes have not been saved." onClose={() => setDiscardOpen(false)}>
          <p className="text-sm leading-6 text-slate-600">Closing now will discard the staged scorecard details and metric changes.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDiscardOpen(false)}>Keep editing</Button>
            <Button type="button" variant="danger" onClick={discardEditorChanges}>Discard changes</Button>
          </div>
        </DialogPanel>
      ) : null}

      {statusAction ? (
        <DialogPanel title={`Confirm ${statusAction.activate ? "activation" : "deactivation"}`} description={statusAction.name} onClose={() => !statusSaving && setStatusAction(null)}>
          <p className="text-sm leading-6 text-slate-600">
            {statusAction.activate
              ? "This scorecard will become active. If another scorecard is active, the existing service will mark it inactive."
              : "This scorecard will become inactive and will no longer be used for KPI results."}
          </p>
          <div className="mt-4"><ErrorText>{error}</ErrorText></div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={statusSaving} onClick={() => setStatusAction(null)}>Cancel</Button>
            <Button type="button" variant={statusAction.activate ? "primary" : "danger"} disabled={statusSaving} onClick={() => void confirmStatusAction()}>
              {statusSaving ? "Updating…" : statusAction.activate ? "Activate" : "Deactivate"}
            </Button>
          </div>
        </DialogPanel>
      ) : null}
    </section>
  );
}
