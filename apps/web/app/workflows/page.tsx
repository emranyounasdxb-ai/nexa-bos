"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  IconChevronRight,
  IconCircleCheck,
  IconEdit,
  IconGitBranch,
  IconInfoCircle,
  IconPower,
  IconX,
} from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
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
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
} from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import { canReadWorkflows } from "@/lib/role-access";
import type { BankProductRecord, CatalogItem, WorkflowRecord, WorkflowStageRecord } from "@/lib/types";

type WorkspaceView = "stages" | "transitions" | "preview";
type Drawer = "create-version" | "add-stage" | "edit-stage" | "add-transition" | null;
type Confirmation = { actionLabel: string; description: string; title: string; run: () => Promise<void> };

const WORKSPACE_VIEWS: WorkspaceView[] = ["stages", "transitions", "preview"];

function catalogLabel(item: CatalogItem | null | undefined, fallback: string) {
  return item ? `${item.name} (${item.code})` : fallback;
}

function orderedStages(workflow: WorkflowRecord | undefined) {
  return [...(workflow?.stages ?? [])].sort((left, right) => left.sortOrder - right.sortOrder);
}

function workflowLayers(workflow: WorkflowRecord): WorkflowStageRecord[][] {
  const stages = orderedStages(workflow);
  if (!stages.length) return [];
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const entry = stages.find((stage) => stage.systemKey === "application_created") ?? stages[0];
  const nextByStage = new Map<string, string[]>();
  workflow.transitions.forEach((transition) => {
    nextByStage.set(transition.fromStageId, [...(nextByStage.get(transition.fromStageId) ?? []), transition.toStageId]);
  });
  const visited = new Set<string>([entry.id]);
  const layers: WorkflowStageRecord[][] = [[entry]];
  let frontier = [entry.id];
  while (frontier.length) {
    const nextIds = Array.from(new Set(frontier.flatMap((stageId) => nextByStage.get(stageId) ?? [])))
      .filter((stageId) => byId.has(stageId) && !visited.has(stageId))
      .sort((left, right) => (byId.get(left)?.sortOrder ?? 0) - (byId.get(right)?.sortOrder ?? 0));
    if (!nextIds.length) break;
    nextIds.forEach((stageId) => visited.add(stageId));
    layers.push(nextIds.map((stageId) => byId.get(stageId)!));
    frontier = nextIds;
  }
  const unlinked = stages.filter((stage) => !visited.has(stage.id));
  if (unlinked.length) layers.push(unlinked);
  return layers;
}

export default function WorkflowsPage() {
  const { can, user } = useAuth();
  const hasWorkflowAccess = canReadWorkflows(user);
  const api = getBrowserApiUrl();
  const createButtonRef = useRef<HTMLSpanElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);
  const [items, setItems] = useState<WorkflowRecord[]>([]);
  const [banks, setBanks] = useState<CatalogItem[]>([]);
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [mappings, setMappings] = useState<BankProductRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [bankId, setBankId] = useState("");
  const [productId, setProductId] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [view, setView] = useState<WorkspaceView>("stages");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [queryReady, setQueryReady] = useState(false);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [drawerDirty, setDrawerDirty] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [createBankId, setCreateBankId] = useState("");
  const [createProductId, setCreateProductId] = useState("");
  const [stageName, setStageName] = useState("");
  const [stageCode, setStageCode] = useState("");
  const [stageOrder, setStageOrder] = useState("80");
  const [editingStage, setEditingStage] = useState<WorkflowStageRecord | null>(null);
  const [fromStage, setFromStage] = useState("");
  const [toStage, setToStage] = useState("");

  const refresh = useCallback(async (preferredId?: string) => {
    setError("");
    try {
      const [workflowData, bankData, productData, mappingData] = await Promise.all([
        apiGet<{ items: WorkflowRecord[] }>("/api/v1/workflows", api),
        apiGet<{ items: CatalogItem[] }>("/api/v1/banks?includeInactive=true", api),
        apiGet<{ items: CatalogItem[] }>("/api/v1/products?includeInactive=true", api),
        apiGet<{ items: BankProductRecord[] }>("/api/v1/bank-products?includeInactive=true", api),
      ]);
      setItems(workflowData.items);
      setBanks(bankData.items);
      setProducts(productData.items);
      setMappings(mappingData.items);
      setSelectedId((current) => {
        if (preferredId && workflowData.items.some((item) => item.id === preferredId)) return preferredId;
        if (current && workflowData.items.some((item) => item.id === current)) return current;
        return "";
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workflow data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!hasWorkflowAccess) {
      setLoading(false);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const queryView = params.get("view");
    if (queryView && WORKSPACE_VIEWS.includes(queryView as WorkspaceView)) setView(queryView as WorkspaceView);
    setBankId(params.get("bank") ?? "");
    setProductId(params.get("product") ?? "");
    setSelectedId(params.get("workflow") ?? "");
    const queryStatus = params.get("status");
    setStatusFilter(queryStatus === "active" || queryStatus === "inactive" ? queryStatus : "all");
    setQueryReady(true);
    void refresh();
  }, [hasWorkflowAccess, refresh]);

  const selected = items.find((item) => (
    item.id === selectedId && item.bankId === bankId && item.productId === productId
  ));

  const bankOptions = useMemo(() => {
    const byId = new Map(banks.map((bank) => [bank.id, bank]));
    items.forEach((item) => { if (item.bank) byId.set(item.bank.id, item.bank); });
    return Array.from(byId.values());
  }, [banks, items]);

  const productOptions = useMemo(() => {
    if (!bankId) return [];
    const relevantIds = new Set([
      ...mappings.filter((mapping) => mapping.bankId === bankId).map((mapping) => mapping.productId),
      ...items.filter((item) => item.bankId === bankId).map((item) => item.productId),
    ]);
    const byId = new Map(products.filter((product) => relevantIds.has(product.id)).map((product) => [product.id, product]));
    items.forEach((item) => { if (item.bankId === bankId && item.product) byId.set(item.product.id, item.product); });
    return Array.from(byId.values());
  }, [bankId, items, mappings, products]);

  const versionOptions = useMemo(() => {
    if (!bankId || !productId) return [];
    return items
      .filter((item) => item.bankId === bankId && item.productId === productId)
      .filter((item) => statusFilter === "all" || item.status === statusFilter)
      .sort((left, right) => right.version - left.version);
  }, [bankId, items, productId, statusFilter]);

  useEffect(() => {
    if (loading) return;
    if (bankId && !bankOptions.some((bank) => bank.id === bankId)) {
      setBankId("");
      setProductId("");
      setSelectedId("");
      return;
    }
    if (productId && (!bankId || !productOptions.some((product) => product.id === productId))) {
      setProductId("");
      setSelectedId("");
      return;
    }
    if (selectedId && (!bankId || !productId || !versionOptions.some((workflow) => workflow.id === selectedId))) {
      setSelectedId("");
    }
  }, [bankId, bankOptions, loading, productId, productOptions, selectedId, versionOptions]);

  useEffect(() => {
    if (!hasWorkflowAccess || !queryReady) return;
    const params = new URLSearchParams(window.location.search);
    const values = { bank: bankId, product: productId, workflow: selectedId, status: statusFilter === "all" ? "" : statusFilter, view };
    Object.entries(values).forEach(([key, currentValue]) => currentValue ? params.set(key, currentValue) : params.delete(key));
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [bankId, hasWorkflowAccess, productId, queryReady, selectedId, statusFilter, view]);

  useEffect(() => {
    if (!drawer) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || saving) return;
      if (drawerDirty && !window.confirm("Discard your unsaved changes?")) return;
      setDrawer(null);
      setDrawerDirty(false);
      setEditingStage(null);
      window.setTimeout(() => {
        const trigger = drawerTriggerRef.current;
        if (trigger?.isConnected) trigger.focus();
        else createButtonRef.current?.querySelector("button")?.focus();
      }, 0);
    }
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [drawer, drawerDirty, saving]);

  useEffect(() => {
    if (!drawerDirty) return;
    function preventUnload(event: BeforeUnloadEvent) { event.preventDefault(); }
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [drawerDirty]);

  const createProductOptions = useMemo(() => {
    const productIds = new Set(mappings
      .filter((mapping) => mapping.bankId === createBankId && mapping.status === "active")
      .map((mapping) => mapping.productId));
    return products.filter((product) => productIds.has(product.id) && product.status === "active");
  }, [createBankId, mappings, products]);

  const stages = orderedStages(selected);
  const transitionError = !fromStage || !toStage
    ? "Choose both a From stage and a To stage."
    : fromStage === toStage
      ? "A transition cannot point from a stage back to itself."
      : selected?.transitions.some((item) => item.fromStageId === fromStage && item.toStageId === toStage)
        ? "This transition already exists in the selected workflow version."
        : "";

  function openDrawer(next: Exclude<Drawer, null>, stage?: WorkflowStageRecord) {
    setError("");
    setMessage("");
    setDrawerDirty(false);
    drawerTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDrawer(next);
    if (next === "create-version") {
      setCreateBankId(bankId || banks.find((item) => item.status === "active")?.id || "");
      setCreateProductId("");
    } else if (next === "add-stage") {
      setEditingStage(null);
      setStageName("");
      setStageCode("");
      setStageOrder(String((stages.at(-1)?.sortOrder ?? 70) + 10));
    } else if (next === "edit-stage" && stage) {
      setEditingStage(stage);
      setStageName(stage.name);
      setStageCode(stage.code);
      setStageOrder(String(stage.sortOrder));
    } else if (next === "add-transition") {
      setFromStage("");
      setToStage("");
    }
  }

  function closeDrawer() {
    setDrawer(null);
    setDrawerDirty(false);
    setEditingStage(null);
    window.setTimeout(() => {
      const trigger = drawerTriggerRef.current;
      if (trigger?.isConnected) trigger.focus();
      else createButtonRef.current?.querySelector("button")?.focus();
    }, 0);
  }

  function requestDrawerClose() {
    if (saving) return;
    if (drawerDirty && !window.confirm("Discard your unsaved changes?")) return;
    closeDrawer();
  }

  function trapDrawerFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function createVersion() {
    setSaving(true);
    setError("");
    try {
      const created = await apiRequest<WorkflowRecord>("/api/v1/workflows", api, {
        method: "POST",
        body: JSON.stringify({ bank_id: createBankId, product_id: createProductId }),
      });
      await refresh(created.id);
      setBankId(created.bankId);
      setProductId(created.productId);
      setStatusFilter("all");
      setSelectedId(created.id);
      setMessage(`Workflow version ${created.version} was created and activated.`);
      closeDrawer();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workflow version could not be created.");
    } finally {
      setSaving(false);
      setConfirmation(null);
    }
  }

  async function saveStage() {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      if (editingStage) {
        await apiRequest(`/api/v1/workflows/stages/${editingStage.id}`, api, {
          method: "PATCH",
          body: JSON.stringify({ name: stageName.trim(), sort_order: Number(stageOrder) }),
        });
        setMessage(`${stageName.trim()} was updated.`);
      } else {
        await apiRequest(`/api/v1/workflows/${selected.id}/stages`, api, {
          method: "POST",
          body: JSON.stringify({ name: stageName.trim(), code: stageCode.trim(), sort_order: Number(stageOrder) }),
        });
        setMessage(`${stageName.trim()} was added to version ${selected.version}.`);
      }
      await refresh(selected.id);
      closeDrawer();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Stage could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function saveTransition() {
    if (!selected || transitionError) return;
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/api/v1/workflows/${selected.id}/transitions`, api, {
        method: "PUT",
        body: JSON.stringify({
          items: [
            ...selected.transitions.map((row) => ({ from_stage_id: row.fromStageId, to_stage_id: row.toStageId })),
            { from_stage_id: fromStage, to_stage_id: toStage },
          ],
        }),
      });
      await refresh(selected.id);
      setMessage("Transition added to this workflow version.");
      closeDrawer();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Transition could not be added.");
    } finally {
      setSaving(false);
    }
  }

  function confirmStageStatus(stage: WorkflowStageRecord) {
    const activating = stage.status !== "active";
    setConfirmation({
      actionLabel: activating ? "Activate stage" : "Deactivate stage",
      title: `${activating ? "Activate" : "Deactivate"} ${stage.name}?`,
      description: activating
        ? "The stage will become available in this workflow version. Existing transitions are not changed."
        : "The stage will become inactive. Existing workflow history and transitions are not deleted.",
      run: async () => {
        setSaving(true);
        setError("");
        try {
          await apiRequest(`/api/v1/workflows/stages/${stage.id}/${activating ? "activate" : "deactivate"}`, api, { method: "POST" });
          await refresh(selected?.id);
          setMessage(`${stage.name} was ${activating ? "activated" : "deactivated"}.`);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Stage status could not be changed.");
        } finally {
          setSaving(false);
          setConfirmation(null);
        }
      },
    });
  }

  const currentStep = !bankId || !productId ? 0 : !selected ? 1 : !stages.length ? 2 : !selected.transitions.length ? 3 : 4;
  const steps = ["Select Bank/Product", "Select/Create Version", "Configure Stages", "Configure Transitions", "Review/Activate"];

  if (!hasWorkflowAccess) {
    return <ErrorText>Workflow access is restricted to OWNER and GM.</ErrorText>;
  }

  return (
    <section className="min-w-0 space-y-3">
      <PageHeader
        title="Workflow Designer"
        description="Build versioned application workflows for an authorized Bank and Product without changing historical application paths."
        actions={can("WorkflowStages.Create") ? (
          <span ref={createButtonRef}><Button type="button" onClick={() => openDrawer("create-version")}>Create workflow version</Button></span>
        ) : undefined}
      />

      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <IconInfoCircle className="size-4 shrink-0 text-information" />
        <span>Configure one version at a time.</span>
        <Tooltip label="About workflow versions" text="A new version copies the latest configuration for the selected Bank and Product, becomes active, and makes the previous active version inactive. Application Created remains the fixed entry stage." />
      </div>

      <div className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-lg border border-brand-border bg-surface px-3 py-2" aria-label="Workflow setup progress">
        {steps.map((step, index) => (
          <div key={step} className="flex shrink-0 items-center gap-1">
            <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${index < currentStep ? "bg-success-soft text-success" : index === currentStep ? "bg-brand-soft text-brand-primary" : "bg-surface-subtle text-text-secondary"}`}>
              {index < currentStep ? <IconCircleCheck className="size-3.5" /> : <span className="inline-grid size-4 place-items-center rounded-full border border-current text-[10px]">{index + 1}</span>}
              {step}
            </span>
            {index < steps.length - 1 ? <IconChevronRight className="size-3.5 text-text-disabled" /> : null}
          </div>
        ))}
      </div>

      <Card className="p-3 sm:p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Bank" htmlFor="workflow-bank">
            <Select id="workflow-bank" aria-label="Workflow bank" value={bankId} onChange={(event) => { setBankId(event.target.value); setProductId(""); setSelectedId(""); }}>
              <option value="">Select bank</option>
              {bankOptions.map((bank) => <option key={bank.id} value={bank.id}>{bank.name} ({bank.code})</option>)}
            </Select>
          </Field>
          <Field label="Product" htmlFor="workflow-product">
            <Select id="workflow-product" aria-label="Workflow product" value={productId} disabled={!bankId} onChange={(event) => { setProductId(event.target.value); setSelectedId(""); }}>
              <option value="">Select product</option>
              {productOptions.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.code})</option>)}
            </Select>
          </Field>
          <Field label="Version" htmlFor="workflow-version">
            <Select id="workflow-version" aria-label="Workflow version" value={selectedId} disabled={!bankId || !productId} onChange={(event) => setSelectedId(event.target.value)}>
              <option value="">Select version</option>
              {versionOptions.map((item) => <option key={item.id} value={item.id}>Version {item.version} · {item.status}</option>)}
            </Select>
          </Field>
          <Field label="Status" htmlFor="workflow-status">
            <Select id="workflow-status" aria-label="Workflow status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
            </Select>
          </Field>
        </div>
      </Card>

      <div aria-live="polite" className="space-y-2">
        <ErrorText>{error}</ErrorText>
        {message ? <p className="rounded-md border border-success-soft bg-success-soft px-3 py-2 text-sm text-text-primary">{message}</p> : null}
      </div>

      {loading ? <LoadingState>Loading workflow versions…</LoadingState> : selected ? (
        <>
          <Card className="p-3 sm:p-4">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold text-text-primary">Version {selected.version}</h2><StatusBadge value={selected.status} /></div>
                <p className="mt-1 text-sm text-text-secondary">{catalogLabel(selected.bank, "Unknown Bank")} · {catalogLabel(selected.product, "Unknown Product")}</p>
              </div>
              <dl className="flex flex-wrap gap-2 text-xs">
                <div className="rounded-md bg-surface-subtle px-2.5 py-1.5"><dt className="inline text-text-secondary">Stages </dt><dd className="inline font-semibold text-text-primary">{stages.length}</dd></div>
                <div className="rounded-md bg-surface-subtle px-2.5 py-1.5"><dt className="inline text-text-secondary">Transitions </dt><dd className="inline font-semibold text-text-primary">{selected.transitions.length}</dd></div>
              </dl>
            </div>
          </Card>

          <div className="flex min-w-0 gap-1 overflow-x-auto border-b border-brand-border" role="tablist" aria-label="Workflow configuration">
            {WORKSPACE_VIEWS.map((item) => (
              <button key={item} type="button" role="tab" aria-selected={view === item} className={`h-8 shrink-0 rounded-t-md px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary ${view === item ? "border-b-2 border-brand-primary bg-brand-soft text-brand-primary" : "text-text-secondary hover:bg-brand-soft hover:text-brand-primary"}`} onClick={() => setView(item)}>
                {item === "stages" ? "Stages" : item === "transitions" ? "Transitions" : "Workflow preview"}
              </button>
            ))}
          </div>

          {view === "stages" ? (
            <Card className="p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h2 className="text-base font-semibold">Ordered stages</h2><p className="mt-0.5 text-sm text-text-secondary">Stage codes are immutable after creation. Sort order controls the displayed sequence.</p></div>
                {can("WorkflowStages.Create") ? <Button type="button" variant="secondary" onClick={() => openDrawer("add-stage")}>Add stage</Button> : null}
              </div>
              {stages.length ? (
                <ol className="mt-3 grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
                  {stages.map((stage, index) => {
                    const fixed = stage.systemKey === "application_created";
                    const canActivate = stage.status !== "active" && can("WorkflowStages.Activate") && !fixed;
                    const canDeactivate = stage.status === "active" && can("WorkflowStages.Deactivate") && !fixed;
                    return (
                      <li key={stage.id} className="relative flex min-w-0 gap-3 rounded-lg border border-brand-border bg-surface-subtle p-3">
                        <span className="inline-grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand-primary">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <h3 className="truncate text-sm font-semibold text-text-primary">{stage.name}</h3><StatusBadge value={stage.status ?? "active"} />
                            {fixed ? <span className="inline-flex items-center gap-1"><Badge tone="purple">Fixed entry stage</Badge><Tooltip label="About the fixed entry stage" text="Application Created is the system-defined entry stage. Its name, order, and active status cannot be changed." /></span> : null}
                          </div>
                          <p className="mt-1 font-mono text-[11px] text-text-secondary">{stage.code}</p>
                          {!fixed && (can("WorkflowStages.Edit") || canActivate || canDeactivate) ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {can("WorkflowStages.Edit") ? <Button type="button" size="compact" variant="ghost" onClick={() => openDrawer("edit-stage", stage)}><IconEdit className="size-3.5" /> Edit</Button> : null}
                              {canActivate || canDeactivate ? <Button type="button" size="compact" variant={canDeactivate ? "danger" : "secondary"} onClick={() => confirmStageStatus(stage)}><IconPower className="size-3.5" /> {canDeactivate ? "Deactivate" : "Activate"}</Button> : null}
                            </div>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : <EmptyState>No stages are configured for this version.</EmptyState>}
            </Card>
          ) : null}

          {view === "transitions" ? (
            <Card className="p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h2 className="text-base font-semibold">Allowed transitions</h2><p className="mt-0.5 text-sm text-text-secondary">Each row is an allowed direction between two stages in this version.</p></div>
                {can("WorkflowStages.ConfigureTransitions") ? <Button type="button" variant="secondary" disabled={stages.length < 2} onClick={() => openDrawer("add-transition")}>Add transition</Button> : null}
              </div>
              {selected.transitions.length ? (
                <ul className="mt-3 grid gap-2 lg:grid-cols-2">
                  {selected.transitions.map((transition) => {
                    const from = stages.find((stage) => stage.id === transition.fromStageId);
                    const to = stages.find((stage) => stage.id === transition.toStageId);
                    return <li key={transition.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-brand-border bg-surface-subtle px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate font-medium text-text-primary">{from?.name ?? "Unavailable stage"}</span><IconChevronRight className="size-4 shrink-0 text-brand-primary" aria-hidden="true" /><span className="min-w-0 flex-1 truncate font-medium text-text-primary">{to?.name ?? "Unavailable stage"}</span></li>;
                  })}
                </ul>
              ) : <EmptyState>No transitions are configured. Add the first allowed stage movement.</EmptyState>}
            </Card>
          ) : null}

          {view === "preview" ? (
            <Card className="p-3 sm:p-4">
              <div><h2 className="text-base font-semibold">Read-only workflow preview</h2><p className="mt-0.5 text-sm text-text-secondary">Stages that share a row represent branches reachable at the same depth. Unlinked stages remain visible at the end.</p></div>
              {stages.length ? (
                <div className="mt-4 max-w-full overflow-x-auto rounded-lg border border-brand-border bg-surface-subtle p-4" data-testid="workflow-preview">
                  <div className="mx-auto flex min-w-max flex-col items-center">
                    {workflowLayers(selected).map((layer, layerIndex) => (
                      <div key={layer.map((stage) => stage.id).join("-")} className="flex flex-col items-center">
                        {layerIndex ? <div className="h-5 w-px bg-brand-border" aria-hidden="true" /> : null}
                        <div className="flex items-stretch justify-center gap-3">
                          {layer.map((stage) => <div key={stage.id} className="w-48 rounded-lg border border-brand-border bg-surface px-3 py-2 text-center shadow-sm"><p className="truncate text-sm font-semibold text-text-primary">{stage.name}</p><p className="mt-0.5 font-mono text-[10px] text-text-secondary">{stage.code}</p><div className="mt-1"><StatusBadge value={stage.status ?? "active"} /></div></div>)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <EmptyState>No stages are available to preview.</EmptyState>}
              <details className="mt-3 rounded-lg border border-brand-border bg-surface">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-brand-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary">Accessible transition table</summary>
                <div className="p-3 pt-1">{selected.transitions.length ? <TableShell><TableHead><tr><Th>From stage</Th><Th>To stage</Th></tr></TableHead><tbody>{selected.transitions.map((transition) => <tr key={transition.id}><Td>{stages.find((stage) => stage.id === transition.fromStageId)?.name ?? "Unavailable stage"}</Td><Td>{stages.find((stage) => stage.id === transition.toStageId)?.name ?? "Unavailable stage"}</Td></tr>)}</tbody></TableShell> : <EmptyState>No transition rows are available.</EmptyState>}</div>
              </details>
            </Card>
          ) : null}
        </>
      ) : <Card><EmptyState>Select a bank, product, and workflow version to configure its workflow.</EmptyState></Card>}

      {drawer ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) requestDrawerClose(); }}>
          <aside ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="workflow-drawer-title" className="flex h-full w-full flex-col bg-surface shadow-2xl sm:max-w-xl" onKeyDown={trapDrawerFocus}>
            <div className="flex items-start justify-between gap-3 border-b border-brand-border px-4 py-3 sm:px-5">
              <div className="min-w-0"><h2 id="workflow-drawer-title" className="text-lg font-semibold text-text-primary">{drawer === "create-version" ? "Create workflow version" : drawer === "add-stage" ? "Add stage" : drawer === "edit-stage" ? "Edit stage" : "Add transition"}</h2><p className="mt-0.5 text-sm text-text-secondary">{drawer === "create-version" ? "Choose an active Bank–Product mapping." : drawer === "add-transition" ? "Add one allowed movement without replacing existing transitions." : "Configure the stage label and its order in this version."}</p></div>
              <Button type="button" variant="ghost" size="icon" aria-label="Close workflow drawer" onClick={requestDrawerClose}><IconX className="size-4" /></Button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
              {drawer === "create-version" ? (
                <>
                  <Field label="Bank" htmlFor="create-workflow-bank"><Select id="create-workflow-bank" autoFocus required value={createBankId} onChange={(event) => { setCreateBankId(event.target.value); setCreateProductId(""); setDrawerDirty(true); }}><option value="">Select Bank</option>{banks.filter((bank) => bank.status === "active").map((bank) => <option key={bank.id} value={bank.id}>{bank.name} ({bank.code})</option>)}</Select></Field>
                  <Field label="Product" htmlFor="create-workflow-product" help="Only Products in an active Bank–Product mapping are available."><Select id="create-workflow-product" required disabled={!createBankId} value={createProductId} onChange={(event) => { setCreateProductId(event.target.value); setDrawerDirty(true); }}><option value="">{createBankId ? "Select Product" : "Select Bank first"}</option>{createProductOptions.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.code})</option>)}</Select></Field>
                  {createBankId && !createProductOptions.length ? <p className="rounded-md bg-information-soft px-3 py-2 text-sm text-text-primary">No active Product mapping is available for this Bank.</p> : null}
                  <div className="rounded-lg border border-information-soft bg-information-soft p-3 text-sm text-text-primary">Creating a version activates it immediately and deactivates the previous active version for the same Bank and Product. Existing versions remain available for history.</div>
                </>
              ) : drawer === "add-stage" || drawer === "edit-stage" ? (
                <>
                  <Field label="Stage name" htmlFor="workflow-stage-name"><TextInput id="workflow-stage-name" autoFocus required value={stageName} onChange={(event) => { setStageName(event.target.value); setDrawerDirty(true); }} /></Field>
                  <Field label="Stage code" htmlFor="workflow-stage-code" help="The technical stage code cannot be changed after this stage is created."><TextInput id="workflow-stage-code" required disabled={Boolean(editingStage)} value={stageCode} onChange={(event) => { setStageCode(event.target.value); setDrawerDirty(true); }} /></Field>
                  <Field label="Sort order" htmlFor="workflow-stage-order" help="Lower numbers appear earlier in the workflow stage sequence."><TextInput id="workflow-stage-order" type="number" min={1} max={10000} required value={stageOrder} onChange={(event) => { setStageOrder(event.target.value); setDrawerDirty(true); }} /></Field>
                  {editingStage ? <p className="rounded-md bg-information-soft px-3 py-2 text-sm text-text-primary">The immutable code remains <span className="font-mono font-semibold">{editingStage.code}</span>.</p> : null}
                </>
              ) : (
                <>
                  <Field label="From stage" htmlFor="transition-from"><Select id="transition-from" autoFocus required value={fromStage} onChange={(event) => { setFromStage(event.target.value); setDrawerDirty(true); }}><option value="">Select From stage</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name} ({stage.code})</option>)}</Select></Field>
                  <Field label="To stage" htmlFor="transition-to"><Select id="transition-to" required value={toStage} onChange={(event) => { setToStage(event.target.value); setDrawerDirty(true); }}><option value="">Select To stage</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name} ({stage.code})</option>)}</Select></Field>
                  {(fromStage || toStage) && transitionError ? <ErrorText>{transitionError}</ErrorText> : null}
                  {!transitionError ? <p className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-sm text-text-primary"><IconGitBranch className="size-4 text-success" /> This direction is available to add.</p> : null}
                </>
              )}
            </div>
            <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-brand-border bg-surface px-4 py-3 sm:px-5">
              <Button type="button" variant="secondary" disabled={saving} onClick={requestDrawerClose}>Cancel</Button>
              {drawer === "create-version" ? <Button type="button" disabled={saving || !createBankId || !createProductId} onClick={() => setConfirmation({ actionLabel: "Create and activate", title: "Create this workflow version?", description: "The new version will become active. If this Bank and Product already has an active version, that version will become inactive; its history is retained.", run: createVersion })}>{saving ? "Creating…" : "Review and create"}</Button> : drawer === "add-transition" ? <Button type="button" disabled={saving || Boolean(transitionError)} onClick={() => void saveTransition()}>{saving ? "Saving…" : "Add transition"}</Button> : <Button type="button" disabled={saving || !stageName.trim() || !stageCode.trim() || !Number(stageOrder)} onClick={() => void saveStage()}>{saving ? "Saving…" : editingStage ? "Save changes" : "Add stage"}</Button>}
            </div>
          </aside>
        </div>
      ) : null}

      {confirmation ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4" role="presentation">
          <div role="alertdialog" aria-modal="true" aria-labelledby="workflow-confirm-title" aria-describedby="workflow-confirm-description" className="w-full max-w-md rounded-xl border border-brand-border bg-surface p-4 shadow-2xl">
            <h2 id="workflow-confirm-title" className="text-base font-semibold text-text-primary">{confirmation.title}</h2>
            <p id="workflow-confirm-description" className="mt-2 text-sm leading-6 text-text-secondary">{confirmation.description}</p>
            <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="secondary" disabled={saving} onClick={() => setConfirmation(null)}>Cancel</Button><Button type="button" variant={confirmation.actionLabel.startsWith("Deactivate") ? "danger" : "primary"} disabled={saving} onClick={() => void confirmation.run()}>{saving ? "Working…" : confirmation.actionLabel}</Button></div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
