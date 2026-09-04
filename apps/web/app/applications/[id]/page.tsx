"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  Select,
  StatusBadge,
  Textarea,
  TextInput,
  cx,
} from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDuration } from "@/lib/duration";
import { getBrowserApiUrl } from "@/lib/env";
import type {
  ApplicationEventRecord,
  ApplicationRecord,
  ManagerOption,
  ProductVariantRecord,
  WorkflowRecord,
  WorkflowStageRecord,
} from "@/lib/types";

type DetailTab = "overview" | "workflow" | "actions" | "timeline";

type ApplicationStageMetadata = {
  workflowId: string;
  version: number;
  status: string;
  stages: WorkflowStageRecord[];
  transitions: WorkflowRecord["transitions"];
};

type Confirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  path: string;
  body: Record<string, unknown>;
  success: string;
  danger?: boolean;
  clearCorrectionVariant?: boolean;
};

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "workflow", label: "Workflow & TAT" },
  { id: "actions", label: "Corrections & Actions" },
  { id: "timeline", label: "Timeline" },
];
const TIMELINE_PAGE_SIZE = 8;
const today = () => new Date().toISOString().slice(0, 10);

function validTab(value: string | null): DetailTab {
  return value === "workflow" || value === "actions" || value === "timeline"
    ? value
    : "overview";
}

function eventLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayDate(value: string | null): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function correctionVariant(
  payload: Record<string, unknown> | null,
  side: "old" | "new",
): { id: string | null; label: string } | null {
  const value = payload?.[side];
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.productVariantId === "string" ? record.productVariantId : null;
  const name =
    typeof record.productVariantName === "string" ? record.productVariantName : null;
  const code =
    typeof record.productVariantCode === "string" ? record.productVariantCode : null;
  return {
    id,
    label: name ? `${name}${code ? ` (${code})` : ""}` : "No Product Variant (legacy)",
  };
}

function submitter(event: FormEvent<HTMLFormElement>): HTMLElement | null {
  return (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
}

function Value({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="break-words text-sm text-text-primary">{children}</dd>
    </div>
  );
}

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [item, setItem] = useState<ApplicationRecord | null>(null);
  const [progress, setProgress] = useState<WorkflowStageRecord[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [timeline, setTimeline] = useState<ApplicationEventRecord[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowRecord | null>(null);
  const [owners, setOwners] = useState<ManagerOption[]>([]);
  const [versions, setVersions] = useState<WorkflowRecord[]>([]);
  const [variants, setVariants] = useState<ProductVariantRecord[]>([]);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmationError, setConfirmationError] = useState("");
  const [timelineQuery, setTimelineQuery] = useState("");
  const [timelineType, setTimelineType] = useState("");
  const [timelinePage, setTimelinePage] = useState(1);
  const [variantId, setVariantId] = useState("");
  const [variantSaving, setVariantSaving] = useState(false);
  const [variantFeedback, setVariantFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [caseNumber, setCaseNumber] = useState("");
  const [caseReason, setCaseReason] = useState("");
  const [stageId, setStageId] = useState("");
  const [bankDate, setBankDate] = useState(today());
  const [stageNote, setStageNote] = useState("");
  const [requirement, setRequirement] = useState("");
  const [approvedAmount, setApprovedAmount] = useState("");
  const [bookedAmount, setBookedAmount] = useState("");
  const [fundedAmount, setFundedAmount] = useState("");
  const [stageCorrectionReason, setStageCorrectionReason] = useState("");
  const [submittedCorrectionReason, setSubmittedCorrectionReason] = useState("");
  const [outcome, setOutcome] = useState("Final Rejected");
  const [outcomeReason, setOutcomeReason] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [ownerReason, setOwnerReason] = useState("");
  const [migrateWorkflowId, setMigrateWorkflowId] = useState("");
  const [migrateStageId, setMigrateStageId] = useState("");
  const [migrateReason, setMigrateReason] = useState("");
  const [correctionAmount, setCorrectionAmount] = useState("");
  const [correctionVariantId, setCorrectionVariantId] = useState("");
  const [delayType, setDelayType] = useState("Bank");
  const [delayReason, setDelayReason] = useState("");
  const [delayOther, setDelayOther] = useState("");
  const [delayAction, setDelayAction] = useState("cancel");
  const [delayCorrectionReason, setDelayCorrectionReason] = useState("");
  const confirmationRef = useRef<HTMLElement>(null);
  const confirmationTriggerRef = useRef<HTMLElement | null>(null);
  const savedCaseNumberRef = useRef("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiGet<ApplicationRecord>(
        `/api/v1/applications/${params.id}`,
        api,
      );
      setItem(data);
      const savedCaseNumber = data.bankCaseNumber ?? "";
      const previousSavedCaseNumber = savedCaseNumberRef.current;
      setCaseNumber((current) =>
        current === previousSavedCaseNumber ? savedCaseNumber : current,
      );
      savedCaseNumberRef.current = savedCaseNumber;
      const [progressData, timelineData, ownerData, versionData, variantData] =
        await Promise.all([
          apiGet<ApplicationStageMetadata>(
            `/api/v1/applications/${params.id}/progress`,
            api,
          ),
          apiGet<{ items: ApplicationEventRecord[] }>(
            `/api/v1/applications/${params.id}/timeline`,
            api,
          ),
          can("Applications.ReassignCaseOwner")
            ? apiGet<{ items: ManagerOption[] }>("/api/v1/applications/case-owners", api)
            : Promise.resolve({ items: [] as ManagerOption[] }),
          can("Workflows.MigrateApplication")
            ? apiGet<{ items: WorkflowRecord[] }>(
                `/api/v1/workflows?bank_id=${data.bankId}&product_id=${data.productId}`,
                api,
              )
            : Promise.resolve({ items: [] as WorkflowRecord[] }),
          apiGet<{ items: ProductVariantRecord[] }>(
            "/api/v1/applications/product-variants",
            api,
          ),
        ]);
      const applicationWorkflow: WorkflowRecord = {
        id: progressData.workflowId,
        bankId: data.bankId,
        productId: data.productId,
        version: progressData.version,
        status: progressData.status,
        bank: null,
        product: null,
        stages: progressData.stages,
        transitions: progressData.transitions,
      };
      setProgress(progressData.stages);
      setVersion(progressData.version);
      setTimeline(timelineData.items);
      setWorkflow(applicationWorkflow);
      setOwners(ownerData.items);
      setVersions(versionData.items);
      setVariants(
        variantData.items.filter(
          (variant) =>
            variant.bankId === data.bankId && variant.productId === data.productId,
        ),
      );
      setVariantId(data.productVariantId ?? "");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to load application");
    } finally {
      setLoading(false);
    }
  }, [api, can, params.id]);

  useEffect(() => {
    function restoreTab() {
      setActiveTab(validTab(new URLSearchParams(window.location.search).get("tab")));
    }
    restoreTab();
    window.addEventListener("popstate", restoreTab);
    if (can("Applications.View")) void refresh();
    return () => window.removeEventListener("popstate", restoreTab);
  }, [can, refresh]);

  const restoreActionFocus = useCallback(() => {
    window.setTimeout(() => {
      if (confirmationTriggerRef.current?.isConnected) confirmationTriggerRef.current.focus();
      else document.getElementById("application-tab-actions")?.focus();
    }, 0);
  }, []);

  const closeConfirmation = useCallback(() => {
    if (busy) return;
    setConfirmation(null);
    setConfirmationError("");
    restoreActionFocus();
  }, [busy, restoreActionFocus]);

  useEffect(() => {
    if (!confirmation) return;
    window.setTimeout(() => {
      confirmationRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }, 0);
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      closeConfirmation();
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [busy, closeConfirmation, confirmation]);

  useEffect(() => setTimelinePage(1), [timelineQuery, timelineType]);

  const nextStages = useMemo(
    () =>
      (workflow?.transitions ?? [])
        .filter((row) => row.fromStageId === item?.currentStageId)
        .map((row) => workflow?.stages.find((stage) => stage.id === row.toStageId))
        .filter(
          (stage): stage is WorkflowStageRecord =>
            Boolean(stage && stage.status === "active"),
        ),
    [item?.currentStageId, workflow],
  );
  const timelineTypes = useMemo(
    () => Array.from(new Set(timeline.map((event) => event.eventType))).sort(),
    [timeline],
  );
  const filteredTimeline = useMemo(() => {
    const query = timelineQuery.trim().toLowerCase();
    return timeline.filter((event) => {
      if (timelineType && event.eventType !== timelineType) return false;
      if (!query) return true;
      return [
        eventLabel(event.eventType),
        event.previousStage,
        event.newStage,
        event.reason,
        event.stageNote,
        event.updatedBy,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [timeline, timelineQuery, timelineType]);
  const timelinePages = Math.max(1, Math.ceil(filteredTimeline.length / TIMELINE_PAGE_SIZE));
  const currentTimelinePage = Math.min(timelinePage, timelinePages);
  const visibleTimeline = filteredTimeline.slice(
    (currentTimelinePage - 1) * TIMELINE_PAGE_SIZE,
    currentTimelinePage * TIMELINE_PAGE_SIZE,
  );

  function selectTab(next: DetailTab) {
    if (next === activeTab) return;
    setActiveTab(next);
    const query = new URLSearchParams(window.location.search);
    if (next === "overview") query.delete("tab");
    else query.set("tab", next);
    window.history.pushState(
      null,
      "",
      `${window.location.pathname}${query.size ? `?${query.toString()}` : ""}`,
    );
  }

  function handleTabKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? TABS.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    selectTab(TABS[nextIndex].id);
    document.getElementById(`application-tab-${TABS[nextIndex].id}`)?.focus();
  }

  function ask(trigger: HTMLElement | null, next: Confirmation) {
    confirmationTriggerRef.current = trigger;
    setConfirmationError("");
    setConfirmation(next);
  }

  function trapFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      confirmationRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
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

  async function post(
    path: string,
    body: Record<string, unknown>,
    success: string,
  ): Promise<boolean> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(path, api, { method: "POST", body: JSON.stringify(body) });
      await refresh();
      setMessage(success);
      return true;
    } catch (value) {
      setError(value instanceof Error ? value.message : "Action failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function runConfirmed() {
    if (!confirmation) return;
    setBusy(true);
    setConfirmationError("");
    try {
      await apiRequest(confirmation.path, api, {
        method: "POST",
        body: JSON.stringify(confirmation.body),
      });
      const completed = confirmation;
      if (completed.clearCorrectionVariant) setCorrectionVariantId("");
      await refresh();
      setMessage(completed.success);
      setConfirmation(null);
      restoreActionFocus();
    } catch (value) {
      setConfirmationError(value instanceof Error ? value.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveVariant() {
    if (!variantId || !item) return;
    setVariantSaving(true);
    setVariantFeedback(null);
    try {
      await apiRequest(`/api/v1/applications/${item.id}`, api, {
        method: "PATCH",
        body: JSON.stringify({ product_variant_id: variantId }),
      });
      await refresh();
      setVariantFeedback({ tone: "success", text: "Product Variant saved." });
    } catch (value) {
      setVariantFeedback({
        tone: "error",
        text: value instanceof Error ? value.message : "Product Variant could not be saved",
      });
    } finally {
      setVariantSaving(false);
    }
  }

  if (!can("Applications.View")) {
    return <EmptyState>You do not have permission to view Applications.</EmptyState>;
  }
  if (loading && !item) return <LoadingState>Loading Application…</LoadingState>;
  if (!item) {
    return (
      <Card>
        <ErrorText>{error || "Application could not be loaded"}</ErrorText>
        <Button className="mt-3" type="button" variant="secondary" onClick={() => void refresh()}>
          Retry
        </Button>
      </Card>
    );
  }

  const selectedNext = nextStages.find((stage) => stage.id === stageId);
  const status = item.terminalOutcome || item.currentStage || "In progress";
  const hasActions =
    item.terminal ||
    (Boolean(item.activeDelay) && can("Applications.CorrectDelay")) ||
    (!item.activeDelay && can("Applications.MarkDelay")) ||
    can("Applications.Submit") ||
    can("Applications.UpdateStage") ||
    can("Applications.CorrectStage") ||
    (item.submitted && can("Applications.CorrectSubmittedData")) ||
    can("Applications.ReassignCaseOwner") ||
    can("Workflows.MigrateApplication") ||
    can("Applications.SetOutcome");

  return (
    <section className="min-w-0 space-y-4">
      <PageHeader
        title={item.applicationCode}
        description="Application classification, workflow progress, controlled corrections, and immutable lifecycle history."
        actions={
          <>
            <Link className="text-sm font-medium text-brand-link underline" href="/applications">
              Back to Applications
            </Link>
            <Link className="text-sm font-medium text-brand-link underline" href={`/customers/${item.customerId}`}>
              View customer
            </Link>
          </>
        }
      />

      <Card>
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="break-words text-xl font-semibold text-text-primary">{item.applicationCode}</h2>
              <StatusBadge value={status} />
              {item.activeDelay ? <Badge tone="amber">Delay · {item.activeDelay.delayType}</Badge> : null}
            </div>
            <p className="mt-1 break-words text-sm text-text-secondary">
              {item.customerCode} · {item.customerName} · {item.bankCode} / {item.productCode}
              {item.productVariantCode ? ` / ${item.productVariantCode}` : ""}
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              Case Owner {item.caseOwnerName || "Not assigned"} · Workflow version {item.workflowVersion}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-3 lg:text-right">
            <Value label="Requested">{item.requestedAmount ?? "—"}</Value>
            <Value label="Approved">{item.approvedAmount ?? "—"}</Value>
            <Value label="Funded">{item.fundedAmount ?? "—"}</Value>
          </dl>
        </div>
      </Card>

      {error ? <ErrorText>{error}</ErrorText> : null}
      {message ? <p role="status" className="text-sm font-medium text-success">{message}</p> : null}

      <div className="grid min-w-0 grid-cols-2 gap-1 rounded-[10px] border border-brand-border bg-surface p-1 lg:grid-cols-4" role="tablist" aria-label="Application workspace">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            id={`application-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`application-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={cx(
              "min-h-8 rounded-md px-2 py-1 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary",
              activeTab === tab.id
                ? "bg-brand-primary text-white"
                : "text-text-secondary hover:bg-brand-soft hover:text-brand-primary",
            )}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => handleTabKey(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section id={`application-panel-${activeTab}`} role="tabpanel" aria-labelledby={`application-tab-${activeTab}`} className="min-w-0 space-y-4">
        {activeTab === "overview" ? (
          <>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-text-primary">Product classification</h3>
                  <p className="mt-1 text-xs text-text-secondary">Bank and Product Category are immutable. Product Variant follows the saved mapping.</p>
                </div>
                {item.productVariantStatus ? <StatusBadge value={item.productVariantStatus} /> : null}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Field label="Bank"><Select aria-label="Bank" value={item.bankId} disabled><option value={item.bankId}>{item.bankName} ({item.bankCode})</option></Select></Field>
                <Field label="Product Category"><Select aria-label="Product Category" value={item.productId} disabled><option value={item.productId}>{item.productName} ({item.productCode})</option></Select></Field>
                <Field label="Product Variant">
                  {can("Applications.Edit") && !item.submitted && !item.terminal ? (
                    <Select aria-label="Product Variant" value={variantId} disabled={variantSaving} onChange={(event) => setVariantId(event.target.value)}>
                      <option value="">Select product variant</option>
                      {item.productVariantId && !variants.some((variant) => variant.id === item.productVariantId) ? <option value={item.productVariantId} disabled>{item.productVariantName} ({item.productVariantCode}) — unavailable for new selection</option> : null}
                      {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name} ({variant.code})</option>)}
                    </Select>
                  ) : <p className="mt-1.5 flex min-h-8 items-center rounded-md border border-brand-border bg-surface-subtle px-3 text-sm">{item.productVariantName ? `${item.productVariantName} (${item.productVariantCode})` : "No Product Variant assigned (legacy application)"}</p>}
                </Field>
              </div>
              {variantFeedback?.tone === "error" ? <div className="mt-3"><ErrorText>{variantFeedback.text}</ErrorText></div> : null}
              {variantFeedback?.tone === "success" ? <p role="status" className="mt-3 text-sm font-medium text-success">{variantFeedback.text}</p> : null}
              {can("Applications.Edit") && !item.submitted && !item.terminal ? <div className="mt-3 flex justify-end"><Button type="button" disabled={variantSaving || !variantId || variantId === item.productVariantId} onClick={() => void saveVariant()}>{variantSaving ? "Saving…" : "Save Product Variant"}</Button></div> : null}
            </Card>
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <Card><h3 className="font-semibold">Application values</h3><dl className="mt-3 grid gap-3 sm:grid-cols-2"><Value label="Requested amount">{item.requestedAmount ?? "—"}</Value><Value label="Approved amount">{item.approvedAmount ?? "—"}</Value><Value label="Booked amount">{item.bookedAmount ?? "—"}</Value><Value label="Funded amount">{item.fundedAmount ?? "—"}</Value></dl></Card>
              <Card><h3 className="font-semibold">Submission</h3><dl className="mt-3 grid gap-3 sm:grid-cols-2"><Value label="Bank File / Case Number">{item.bankCaseNumber ?? "Not submitted"}</Value><Value label="Submitted">{displayDate(item.submittedAt)}</Value><Value label="Created">{displayDate(item.createdAt)}</Value><Value label="Last updated">{displayDate(item.updatedAt)}</Value></dl></Card>
            </div>
          </>
        ) : null}

        {activeTab === "workflow" ? (
          <>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">Workflow progress</h3><p className="mt-1 text-xs text-text-secondary">Version {version}</p></div><StatusBadge value={status} /></div>
              <ol className="mt-3 flex min-w-0 flex-wrap gap-2">{progress.map((stage) => <li key={stage.id} className={cx("max-w-full rounded-full px-3 py-1 text-sm", stage.current ? "bg-brand-primary text-white" : "border border-brand-border text-text-secondary")}>{stage.name}{stage.current && item.currentStageElapsedSeconds != null ? ` · ${formatDuration(item.currentStageElapsedSeconds)}` : ""}</li>)}</ol>
            </Card>
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <Card><h3 className="font-semibold">Turnaround time</h3><dl className="mt-3 grid gap-3 sm:grid-cols-2"><Value label={item.terminal ? "Total duration" : "Elapsed TAT"}>{item.terminal ? formatDuration(item.totalDurationSeconds) : formatDuration(item.currentElapsedSeconds)}</Value><Value label="Current stage elapsed">{formatDuration(item.currentStageElapsedSeconds)}</Value><Value label="Started">{displayDate(item.tatStartedAt)}</Value><Value label="Stopped">{displayDate(item.tatStoppedAt)}</Value></dl></Card>
              <Card><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Delay state</h3>{item.activeDelay ? <Badge tone="amber">{item.activeDelay.delayType}</Badge> : null}</div>{item.activeDelay ? <dl className="mt-3 grid gap-3 sm:grid-cols-2"><Value label="Stage">{item.activeDelay.stageName}</Value><Value label="Marked by">{item.activeDelay.markedBy}</Value><Value label="Started">{displayDate(item.activeDelay.startedAt)}</Value><Value label="Reason">{item.activeDelay.reason}</Value></dl> : <p className="mt-2 text-sm text-text-secondary">No active delay is recorded.</p>}</Card>
            </div>
            <Card>
              <h3 className="font-semibold">Stage durations</h3>
              {item.stageDurations.length ? <ol className="mt-3 grid min-w-0 gap-2 lg:grid-cols-2">{item.stageDurations.map((row) => <li key={row.id} className="min-w-0 rounded-md border border-brand-border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{row.stageName}</p>{!row.completed ? <Badge tone="blue">Current</Badge> : null}</div><p className="mt-1 text-text-secondary">Duration {formatDuration(row.durationSeconds)}</p><p className="mt-1 break-words text-xs text-text-secondary">Entered {displayDate(row.enteredAt)}{row.exitedAt ? ` · Exited ${displayDate(row.exitedAt)}` : ""}</p>{row.bankStageDate ? <p className="mt-1">Bank Stage Date {row.bankStageDate}</p> : null}{row.stageNote ? <p className="mt-1 break-words">Note {row.stageNote}</p> : null}</li>)}</ol> : <EmptyState>No stage duration records are available.</EmptyState>}
            </Card>
          </>
        ) : null}

        {activeTab === "actions" ? (
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            {!hasActions ? <Card className="xl:col-span-2"><EmptyState>No application actions are available for your permissions.</EmptyState></Card> : null}
            {item.activeDelay && !item.terminal && can("Applications.CorrectDelay") ? (
              <Card>
                <h3 className="font-semibold">Correct active delay</h3>
                <p className="mt-1 text-xs text-text-secondary">Original delay history remains immutable.</p>
                <form
                  className="mt-3 space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void post(
                      `/api/v1/applications/${item.id}/delays/${item.activeDelay!.id}/correct`,
                      { action: delayAction, reason: delayCorrectionReason },
                      "Delay correction recorded",
                    ).then((saved) => {
                      if (saved) setDelayCorrectionReason("");
                    });
                  }}
                >
                  <Field label="Correction action">
                    <Select aria-label="Correction action" value={delayAction} onChange={(event) => setDelayAction(event.target.value)}>
                      <option value="cancel">Cancel delay</option>
                      <option value="correct">Correct delay</option>
                    </Select>
                  </Field>
                  <Field label="Correction reason">
                    <Textarea aria-label="Correction reason" placeholder="Explain why this correction is required" value={delayCorrectionReason} onChange={(event) => setDelayCorrectionReason(event.target.value)} required />
                  </Field>
                  <Button variant="secondary" type="submit" disabled={busy}>Correct Delay</Button>
                </form>
              </Card>
            ) : null}

            {!item.terminal && !item.activeDelay && can("Applications.MarkDelay") ? (
              <Card>
                <h3 className="font-semibold">Mark delay</h3>
                <p className="mt-1 text-xs text-text-secondary">Record a reason against the current workflow stage.</p>
                <form
                  className="mt-3 space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void post(
                      `/api/v1/applications/${item.id}/delays`,
                      {
                        delay_type: delayType,
                        reason: delayReason,
                        other_explanation: delayType === "Other" ? delayOther : null,
                      },
                      "Delay recorded",
                    ).then((saved) => {
                      if (saved) {
                        setDelayReason("");
                        setDelayOther("");
                      }
                    });
                  }}
                >
                  <Field label="Delay type">
                    <Select aria-label="Delay type" value={delayType} onChange={(event) => setDelayType(event.target.value)}>
                      <option>Bank</option><option>Customer</option><option>Internal</option><option>Other</option>
                    </Select>
                  </Field>
                  <Field label="Delay reason"><Textarea aria-label="Delay reason" placeholder="Delay reason" value={delayReason} onChange={(event) => setDelayReason(event.target.value)} required /></Field>
                  {delayType === "Other" ? <Field label="Other explanation"><Textarea aria-label="Other explanation" placeholder="Explain the delay type" value={delayOther} onChange={(event) => setDelayOther(event.target.value)} required /></Field> : null}
                  <Button type="submit" disabled={busy}>Mark Delay</Button>
                </form>
              </Card>
            ) : null}

            {!item.terminal && can("Applications.Submit") ? (
              <Card>
                <h3 className="font-semibold">Bank File / Case Number</h3>
                <p className="mt-1 text-xs text-text-secondary">
                  {item.submitted ? "Changing a submitted case number appends an audited correction." : "Saving the first case number submits the application."}
                </p>
                <form
                  className="mt-3 space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const body = {
                      bank_case_number: caseNumber,
                      reason: item.submitted ? caseReason : null,
                    };
                    if (item.submitted) {
                      ask(submitter(event), {
                        title: "Correct submitted case number?",
                        description: "The current value remains in immutable history. This audited correction changes the active Bank File / Case Number.",
                        confirmLabel: "Confirm correction",
                        path: `/api/v1/applications/${item.id}/case-number`,
                        body,
                        success: "Case number correction recorded",
                      });
                    } else {
                      void post(`/api/v1/applications/${item.id}/case-number`, body, "Application submitted");
                    }
                  }}
                >
                  <Field label="Bank File / Case Number"><TextInput aria-label="Bank File / Case Number" value={caseNumber} onChange={(event) => setCaseNumber(event.target.value)} required /></Field>
                  {item.submitted ? <Field label="Correction reason"><TextInput aria-label="Case number correction reason" placeholder="Why is the submitted value changing?" value={caseReason} onChange={(event) => setCaseReason(event.target.value)} required /></Field> : null}
                  <Button type="submit" disabled={busy}>{item.submitted ? "Correct case number" : "Save and submit"}</Button>
                </form>
              </Card>
            ) : null}

            {!item.terminal && can("Applications.UpdateStage") ? (
              <Card>
                <h3 className="font-semibold">Update stage</h3>
                <p className="mt-1 text-xs text-text-secondary">Only configured next stages are available.</p>
                <form
                  className="mt-3 space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void post(
                      `/api/v1/applications/${item.id}/stage`,
                      {
                        stage_id: stageId,
                        bank_stage_date: bankDate,
                        stage_note: stageNote || null,
                        requirement_text: requirement || null,
                        approved_amount: approvedAmount || null,
                        booked_amount: bookedAmount || null,
                        funded_amount: fundedAmount || null,
                      },
                      "Stage updated",
                    );
                  }}
                >
                  <Field label="Next stage">
                    <Select aria-label="Next stage" value={stageId} onChange={(event) => setStageId(event.target.value)} required>
                      <option value="">Allowed next stage</option>
                      {nextStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Bank Stage Date"><DatePicker required aria-label="Bank Stage Date" value={bankDate} onChange={setBankDate} /></Field>
                  <Field label="Stage note"><TextInput aria-label="Stage note" placeholder="Optional note" value={stageNote} onChange={(event) => setStageNote(event.target.value)} /></Field>
                  {selectedNext?.systemKey === "returned_requirement_pending" ? <Field label="Requirement reason"><Textarea aria-label="Requirement reason" placeholder="Requirement or query" value={requirement} onChange={(event) => setRequirement(event.target.value)} required /></Field> : null}
                  {selectedNext?.systemKey === "approved" ? <Field label="Approved amount"><TextInput aria-label="Approved amount" value={approvedAmount} onChange={(event) => setApprovedAmount(event.target.value)} /></Field> : null}
                  {selectedNext?.systemKey === "booked" ? <Field label="Booked amount"><TextInput aria-label="Booked amount" value={bookedAmount} onChange={(event) => setBookedAmount(event.target.value)} /></Field> : null}
                  {selectedNext?.systemKey === "fund_released" ? <Field label="Funded amount"><TextInput aria-label="Funded amount" value={fundedAmount} onChange={(event) => setFundedAmount(event.target.value)} /></Field> : null}
                  <Button type="submit" disabled={busy}>Save stage</Button>
                </form>
              </Card>
            ) : null}

            {!item.terminal && can("Applications.CorrectStage") ? (
              <Card>
                <h3 className="font-semibold">Correct stage</h3>
                <p className="mt-1 text-xs text-text-secondary">Original events remain immutable; a correction reason is mandatory.</p>
                <form
                  className="mt-3 space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    ask(submitter(event), {
                      title: "Append stage correction?",
                      description: "This does not erase the original stage event. A new audited correction changes the current stage interpretation.",
                      confirmLabel: "Append correction",
                      path: `/api/v1/applications/${item.id}/correct-stage`,
                      body: {
                        stage_id: stageId,
                        bank_stage_date: bankDate,
                        stage_note: stageNote || null,
                        reason: stageCorrectionReason,
                      },
                      success: "Stage correction appended",
                    });
                  }}
                >
                  <Field label="Corrected stage">
                    <Select aria-label="Corrected stage" value={stageId} onChange={(event) => setStageId(event.target.value)} required>
                      <option value="">Target stage</option>
                      {(workflow?.stages ?? []).filter((stage) => stage.status === "active").map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Stage correction reason"><TextInput aria-label="Stage correction reason" placeholder="Why is this correction required?" value={stageCorrectionReason} onChange={(event) => setStageCorrectionReason(event.target.value)} required /></Field>
                  <Button variant="secondary" type="submit" disabled={busy}>Append correction</Button>
                </form>
              </Card>
            ) : null}

            {!item.terminal && can("Applications.CorrectSubmittedData") && item.submitted ? (
              <Card>
                <h3 className="font-semibold">Correct submitted data</h3>
                <p className="mt-1 text-xs text-text-secondary">Only explicitly supplied values change; previous values remain in immutable history.</p>
                <form
                  className="mt-3 space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    ask(submitter(event), {
                      title: "Correct submitted application data?",
                      description: "This audited correction updates selected submitted values while preserving the original values in the timeline.",
                      confirmLabel: "Confirm correction",
                      path: `/api/v1/applications/${item.id}/correct-submitted`,
                      body: {
                        reason: submittedCorrectionReason,
                        requested_amount: correctionAmount || null,
                        product_variant_id: correctionVariantId || undefined,
                      },
                      success: "Submitted data correction recorded",
                      clearCorrectionVariant: true,
                    });
                  }}
                >
                  <Field label="Corrected Product Variant">
                    <Select aria-label="Corrected Product Variant" value={correctionVariantId} onChange={(event) => setCorrectionVariantId(event.target.value)}>
                      <option value="">Keep current — {item.productVariantName ? `${item.productVariantName} (${item.productVariantCode})` : "No Product Variant (legacy)"}</option>
                      {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name} ({variant.code})</option>)}
                    </Select>
                  </Field>
                  <Field label="Corrected requested amount"><TextInput aria-label="Corrected requested amount" placeholder="Leave empty when unchanged" value={correctionAmount} onChange={(event) => setCorrectionAmount(event.target.value)} /></Field>
                  <Field label="Submitted data correction reason"><TextInput aria-label="Submitted data correction reason" placeholder="Why is this correction required?" value={submittedCorrectionReason} onChange={(event) => setSubmittedCorrectionReason(event.target.value)} required /></Field>
                  <Button variant="secondary" type="submit" disabled={busy}>Correct submitted data</Button>
                </form>
              </Card>
            ) : null}

            {!item.terminal && can("Applications.ReassignCaseOwner") ? (
              <Card>
                <h3 className="font-semibold">Reassign Case Owner</h3>
                <p className="mt-1 text-xs text-text-secondary">Ownership history is preserved and scope may change for the selected owner.</p>
                <form
                  className="mt-3 space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const owner = owners.find((candidate) => candidate.id === ownerId);
                    ask(submitter(event), {
                      title: "Reassign Case Owner?",
                      description: `Responsibility will move to ${owner?.fullName || "the selected owner"}. The previous assignment remains in history.`,
                      confirmLabel: "Confirm reassignment",
                      path: `/api/v1/applications/${item.id}/reassign-owner`,
                      body: { case_owner_id: ownerId, reason: ownerReason || null },
                      success: "Case Owner reassigned",
                    });
                  }}
                >
                  <Field label="New Case Owner">
                    <Select aria-label="New Case Owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)} required>
                      <option value="">Select Case Owner</option>
                      {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.fullName}</option>)}
                    </Select>
                  </Field>
                  <Field label="Reassignment reason"><TextInput aria-label="Reassignment reason" placeholder="Optional reason" value={ownerReason} onChange={(event) => setOwnerReason(event.target.value)} /></Field>
                  <Button variant="secondary" type="submit" disabled={busy}>Reassign</Button>
                </form>
              </Card>
            ) : null}

            {!item.terminal && can("Workflows.MigrateApplication") ? (
              <Card>
                <h3 className="font-semibold">Migrate workflow version</h3>
                <p className="mt-1 text-xs text-text-secondary">Migration changes the governing workflow and target stage; history is preserved.</p>
                <form
                  className="mt-3 space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const target = versions.find((row) => row.id === migrateWorkflowId);
                    const targetStage = target?.stages.find((stage) => stage.id === migrateStageId);
                    ask(submitter(event), {
                      title: "Migrate workflow version?",
                      description: `This application will move to workflow version ${target?.version ?? "selected"}${targetStage ? ` at ${targetStage.name}` : ""}. Existing history remains unchanged.`,
                      confirmLabel: "Confirm migration",
                      path: `/api/v1/applications/${item.id}/migrate`,
                      body: {
                        workflow_id: migrateWorkflowId,
                        target_stage_id: migrateStageId,
                        reason: migrateReason,
                      },
                      success: "Workflow migration recorded",
                    });
                  }}
                >
                  <Field label="Target workflow">
                    <Select aria-label="Target workflow" value={migrateWorkflowId} onChange={(event) => { setMigrateWorkflowId(event.target.value); setMigrateStageId(""); }} required>
                      <option value="">Target workflow version</option>
                      {versions.filter((row) => row.id !== item.workflowId).map((row) => <option key={row.id} value={row.id}>Version {row.version} ({row.status})</option>)}
                    </Select>
                  </Field>
                  <Field label="Migration target stage">
                    <Select aria-label="Migration target stage" value={migrateStageId} onChange={(event) => setMigrateStageId(event.target.value)} required disabled={!migrateWorkflowId}>
                      <option value="">Target stage</option>
                      {(versions.find((row) => row.id === migrateWorkflowId)?.stages ?? []).filter((stage) => stage.status === "active").map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Migration reason"><TextInput aria-label="Migration reason" placeholder="Why is migration required?" value={migrateReason} onChange={(event) => setMigrateReason(event.target.value)} required /></Field>
                  <Button variant="secondary" type="submit" disabled={busy}>Migrate this application</Button>
                </form>
              </Card>
            ) : null}

            {!item.terminal && can("Applications.SetOutcome") ? (
              <Card className="border-danger-soft">
                <h3 className="font-semibold">Terminal outcome</h3>
                <p className="mt-1 text-xs text-text-secondary">Closing is irreversible in this workspace and stops active application processing.</p>
                <form
                  className="mt-3 space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    ask(submitter(event), {
                      title: `Close application as ${outcome}?`,
                      description: "This terminal action stops the application lifecycle. The outcome and mandatory reason are retained in immutable history.",
                      confirmLabel: "Close application",
                      danger: true,
                      path: `/api/v1/applications/${item.id}/outcome`,
                      body: { outcome, reason: outcomeReason },
                      success: `Application closed as ${outcome}`,
                    });
                  }}
                >
                  <Field label="Terminal outcome"><Select aria-label="Terminal outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)}><option>Final Rejected</option><option>Cancelled</option><option>Withdrawn</option></Select></Field>
                  <Field label="Outcome reason"><Textarea aria-label="Outcome reason" placeholder="Reason for closing this application" value={outcomeReason} onChange={(event) => setOutcomeReason(event.target.value)} required /></Field>
                  <Button variant="danger" type="submit" disabled={busy}>Close application</Button>
                </form>
              </Card>
            ) : null}

            {item.terminal ? <Card className="xl:col-span-2"><EmptyState>This application is closed. Lifecycle-changing actions are no longer available.</EmptyState></Card> : null}
          </div>
        ) : null}

        {activeTab === "timeline" ? (
          <Card>
            <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div className="min-w-0"><h3 className="font-semibold">Immutable timeline</h3><p className="mt-1 text-xs text-text-secondary">Filter existing lifecycle events without changing audit history.</p></div><div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:w-[38rem]"><Field label="Search timeline"><TextInput aria-label="Search timeline" placeholder="Stage, reason, action, or person" value={timelineQuery} onChange={(event) => setTimelineQuery(event.target.value)} /></Field><Field label="Event type"><Select aria-label="Filter timeline by event type" value={timelineType} onChange={(event) => setTimelineType(event.target.value)}><option value="">All event types</option>{timelineTypes.map((type) => <option key={type} value={type}>{eventLabel(type)}</option>)}</Select></Field></div></div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-y border-brand-border py-2 text-xs text-text-secondary"><span>{filteredTimeline.length} of {timeline.length} events</span>{timelineQuery || timelineType ? <Button type="button" size="compact" variant="ghost" onClick={() => { setTimelineQuery(""); setTimelineType(""); }}>Clear timeline filters</Button> : null}</div>
            {visibleTimeline.length ? <ol className="mt-3 grid min-w-0 gap-2 lg:grid-cols-2">{visibleTimeline.map((event) => { const oldVariant = correctionVariant(event.payload, "old"); const newVariant = correctionVariant(event.payload, "new"); return <li key={event.id} className="min-w-0 rounded-md border border-brand-border p-3 text-sm"><div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><p className="break-words font-medium">{eventLabel(event.eventType)}</p><time className="text-xs text-text-secondary">{displayDate(event.bosUpdatedAt)}</time></div>{event.previousStage || event.newStage ? <p className="mt-1 break-words text-text-secondary">{event.previousStage ? `${event.previousStage} → ` : ""}{event.newStage ?? ""}</p> : null}{event.bankStageDate ? <p className="mt-1">Bank Stage Date {event.bankStageDate}</p> : null}{event.stageNote ? <p className="mt-1 break-words">Note {event.stageNote}</p> : null}{event.reason ? <p className="mt-1 break-words">Reason {event.reason}</p> : null}{event.payload && typeof event.payload.delayType === "string" ? <p className="mt-1 break-words">Delay {event.payload.delayType}</p> : null}{oldVariant && newVariant && oldVariant.id !== newVariant.id ? <p className="mt-1 break-words">Product Variant: {oldVariant.label} → {newVariant.label}</p> : null}<p className="mt-2 break-words text-xs text-text-secondary">Updated by {event.updatedBy || "System"}</p></li>; })}</ol> : <EmptyState>No timeline events match the current filters.</EmptyState>}
            {timelinePages > 1 ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-brand-border pt-3 text-sm"><span className="text-text-secondary">Page {currentTimelinePage} of {timelinePages}</span><div className="flex gap-2"><Button type="button" size="compact" variant="secondary" disabled={currentTimelinePage <= 1} onClick={() => setTimelinePage((page) => Math.max(1, page - 1))}>Previous</Button><Button type="button" size="compact" variant="secondary" disabled={currentTimelinePage >= timelinePages} onClick={() => setTimelinePage((page) => Math.min(timelinePages, page + 1))}>Next</Button></div></div> : null}
          </Card>
        ) : null}
      </section>

      {confirmation ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <section ref={confirmationRef} role="alertdialog" aria-modal="true" aria-labelledby="application-confirm-title" aria-describedby="application-confirm-description" className="w-full max-w-md rounded-[10px] border border-brand-border bg-surface p-4 shadow-2xl" onKeyDown={trapFocus}>
            <h2 id="application-confirm-title" className="text-base font-semibold">{confirmation.title}</h2>
            <p id="application-confirm-description" className="mt-2 text-sm text-text-secondary">{confirmation.description}</p>
            {confirmationError ? <div className="mt-3"><ErrorText>{confirmationError}</ErrorText></div> : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2"><Button data-autofocus type="button" variant="secondary" disabled={busy} onClick={closeConfirmation}>Cancel</Button><Button type="button" variant={confirmation.danger ? "danger" : "primary"} disabled={busy} onClick={() => void runConfirmed()}>{busy ? "Saving…" : confirmation.confirmLabel}</Button></div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
