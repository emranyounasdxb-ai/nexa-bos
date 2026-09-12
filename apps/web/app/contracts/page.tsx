"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Button,
  Card,
  DialogPanel,
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
  Textarea,
  TextInput,
  Th,
  cx,
  focusRing,
} from "@/components/ui";
import { apiDownload, apiGet, apiRequest, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";

type ContractType = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

type Attachment = {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  version: number;
  isActive: boolean;
  uploadedAt: string;
};

type HistoryItem = {
  id: string;
  actor: string;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  comment: string | null;
  createdAt: string;
};

type Contract = {
  id: string;
  employeeId: string;
  employee: string;
  employeeCode: string;
  contractType: ContractType;
  parentContractId: string | null;
  contractNumber: string;
  startDate: string;
  endDate: string | null;
  jobTitleSnapshot: string;
  currency: string;
  basicSalary: string;
  allowancesTotal: string;
  totalCompensation: string;
  notes: string | null;
  status: string;
  storedStatus: string;
  lockVersion: number;
  attachments: Attachment[];
  history: HistoryItem[];
  updatedAt: string;
};

type EmployeeOption = { id: string; fullName: string; employeeCode: string };
type Reminder = Contract & { daysRemaining: number; reminderMilestone: number };
type Tab = "mine" | "register" | "reminders" | "settings";
type Decision = { contract: Contract; kind: "activate" | "return" | "reject" | "cancel" };

const tabOptions: Array<{ id: Tab; label: string }> = [
  { id: "mine", label: "My contract" },
  { id: "register", label: "Contract register" },
  { id: "reminders", label: "Expiry reminders" },
  { id: "settings", label: "Contract types" },
];

const emptyDraft = {
  employeeId: "",
  contractTypeId: "",
  contractNumber: "",
  startDate: "",
  endDate: "",
  jobTitleSnapshot: "",
  currency: "AED",
  basicSalary: "0",
  allowancesTotal: "0",
  notes: "",
  parentContractId: "",
};

function messageFor(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? error.message : fallback;
}

function money(value: string, currency: string) {
  return new Intl.NumberFormat("en-AE", { style: "currency", currency }).format(Number(value));
}

export default function ContractsPage() {
  const { user, can } = useAuth();
  const api = getBrowserApiUrl();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab") as Tab | null;
  const allowedTabs = useMemo(
    () => tabOptions.filter((tab) => {
      if (tab.id === "mine") return can("Contracts.ViewOwn");
      if (tab.id === "settings") return can("Contracts.Settings");
      return can("Contracts.View");
    }),
    [can],
  );
  const fallbackTab = allowedTabs[0]?.id ?? "mine";
  const activeTab = allowedTabs.some((tab) => tab.id === requestedTab)
    ? requestedTab as Tab
    : fallbackTab;
  const [types, setTypes] = useState<ContractType[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [ownContract, setOwnContract] = useState<Contract | null>(null);
  const [reminderItems, setReminderItems] = useState<Reminder[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [selected, setSelected] = useState<Contract | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [comment, setComment] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [replacementReason, setReplacementReason] = useState("");
  const [typeDraft, setTypeDraft] = useState({ code: "", name: "", description: "" });
  const returnFocus = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const typeData = await apiGet<{ items: ContractType[] }>(
        `/api/v1/contracts/types${can("Contracts.Settings") ? "?include_inactive=true" : ""}`,
        api,
      );
      setTypes(typeData.items);
      const operations: Promise<void>[] = [];
      if (can("Contracts.ViewOwn")) {
        operations.push(apiGet<{ item: Contract | null }>("/api/v1/contracts/me/active", api)
          .then((data) => setOwnContract(data.item)));
      }
      if (can("Contracts.View")) {
        operations.push(apiGet<{ items: Contract[] }>("/api/v1/contracts", api)
          .then((data) => setContracts(data.items)));
        operations.push(apiGet<{ items: Reminder[] }>("/api/v1/contracts/reminders", api)
          .then((data) => setReminderItems(data.items)));
      }
      if (can("Contracts.Create")) {
        operations.push(apiGet<{ items: EmployeeOption[] }>("/api/v1/contracts/employees", api)
          .then((data) => setEmployees(data.items)));
      }
      await Promise.all(operations);
    } catch (caught) {
      setError(messageFor(caught, "Unable to load employment contracts"));
    } finally {
      setLoading(false);
    }
  }, [api, can, user]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!creating && !editing && !selected && !decision) return;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const initial = creating || editing
      ? dialog?.querySelector<HTMLElement>('[role="combobox"]')
      : dialog?.querySelector<HTMLElement>("textarea, button");
    initial?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (decision) closeDecision();
        else if (editing) closeEdit();
        else closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [role="combobox"]:not([aria-disabled="true"]), a[href]',
      )).filter((element) => element.getClientRects().length > 0 && element.tabIndex >= 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [creating, decision, editing, selected]);

  function setTab(tab: Tab) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", tab);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function openDialog(kind: "create" | "detail" | "edit", trigger: HTMLElement, item?: Contract) {
    returnFocus.current = trigger;
    if (kind === "create") {
      setDraft(emptyDraft);
      setCreating(true);
    } else if (kind === "edit" && item) {
      setEditing(item);
      setDraft({
        employeeId: item.employeeId,
        contractTypeId: item.contractType.id,
        contractNumber: item.contractNumber,
        startDate: item.startDate,
        endDate: item.endDate ?? "",
        jobTitleSnapshot: item.jobTitleSnapshot,
        currency: item.currency,
        basicSalary: item.basicSalary,
        allowancesTotal: item.allowancesTotal,
        notes: item.notes ?? "",
        parentContractId: item.parentContractId ?? "",
      });
    } else {
      setSelected(item ?? null);
    }
  }

  function closeDialog() {
    setCreating(false);
    setEditing(null);
    setSelected(null);
    setDecision(null);
    setComment("");
    setAttachment(null);
    setReplacementReason("");
    requestAnimationFrame(() => returnFocus.current?.focus());
  }

  function closeEdit() {
    setEditing(null);
    requestAnimationFrame(() => returnFocus.current?.focus());
  }

  function closeDecision() {
    setDecision(null);
    setComment("");
    requestAnimationFrame(() => returnFocus.current?.focus());
  }

  async function saveContract(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const common = {
        contract_type_id: draft.contractTypeId,
        start_date: draft.startDate,
        end_date: draft.endDate || null,
        job_title_snapshot: draft.jobTitleSnapshot,
        currency: draft.currency,
        basic_salary: draft.basicSalary,
        allowances_total: draft.allowancesTotal,
        notes: draft.notes || null,
      };
      const saved = editing
        ? await apiRequest<Contract>(`/api/v1/contracts/${editing.id}`, api, {
          method: "PATCH",
          body: JSON.stringify({ ...common, lock_version: editing.lockVersion }),
        })
        : await apiRequest<Contract>("/api/v1/contracts", api, {
          method: "POST",
          body: JSON.stringify({
          employee_id: draft.employeeId,
          contract_number: draft.contractNumber,
          parent_contract_id: draft.parentContractId || null,
          ...common,
        }),
      });
      setNotice(`Contract ${saved.contractNumber} ${editing ? "updated" : "created as a draft"}.`);
      setCreating(false);
      setEditing(null);
      await load();
      setSelected(saved);
    } catch (caught) {
      setError(messageFor(caught, "Unable to create contract"));
    }
  }

  async function toggleType(item: ContractType) {
    setError("");
    try {
      await apiRequest(`/api/v1/contracts/types/${item.id}`, api, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !item.isActive }),
      });
      setNotice(`${item.name} ${item.isActive ? "deactivated" : "activated"}.`);
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Unable to update contract type"));
    }
  }

  async function action(item: Contract, suffix: string, body: object) {
    setError("");
    try {
      const updated = await apiRequest<Contract>(`/api/v1/contracts/${item.id}/${suffix}`, api, {
        method: "POST",
        body: JSON.stringify({ lock_version: item.lockVersion, ...body }),
      });
      setNotice(`Contract ${updated.contractNumber} updated.`);
      setDecision(null);
      setSelected(updated);
      await load();
      return true;
    } catch (caught) {
      setError(messageFor(caught, "Unable to update contract"));
      return false;
    }
  }

  async function confirmDecision(event: React.FormEvent) {
    event.preventDefault();
    if (!decision) return;
    const body = decision.kind === "cancel"
      ? { reason: comment }
      : decision.kind === "return" || decision.kind === "reject"
        ? { decision: decision.kind, comment }
        : { comment: comment || null };
    if (await action(decision.contract, decision.kind === "activate" ? "activate" : decision.kind === "cancel" ? "cancel" : "decision", body)) {
      setComment("");
    }
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !attachment) return;
    const body = new FormData();
    body.append("upload", attachment);
    if (replacementReason) body.append("reason", replacementReason);
    setError("");
    try {
      await apiRequest(`/api/v1/contracts/${selected.id}/attachment`, api, { method: "POST", body });
      setNotice("Signed attachment saved.");
      setAttachment(null);
      setReplacementReason("");
      const refreshed = await apiGet<Contract>(`/api/v1/contracts/${selected.id}`, api);
      setSelected(refreshed);
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Unable to save signed attachment"));
    }
  }

  async function download(item: Contract, file: Attachment) {
    setError("");
    try {
      const result = await apiDownload(
        `/api/v1/contracts/${item.id}/attachments/${file.id}/file`,
        api,
      );
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename ?? file.name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(messageFor(caught, "Unable to download attachment"));
    }
  }

  async function createType(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiRequest("/api/v1/contracts/types", api, {
        method: "POST",
        body: JSON.stringify(typeDraft),
      });
      setTypeDraft({ code: "", name: "", description: "" });
      setNotice("Contract type created.");
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Unable to create contract type"));
    }
  }

  const renderSummary = (item: Contract) => (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div><p className="text-xs text-text-secondary">Employee</p><p className="font-medium">{item.employee}</p></div>
      <div><p className="text-xs text-text-secondary">Contract</p><p className="font-medium">{item.contractNumber}</p></div>
      <div><p className="text-xs text-text-secondary">Type</p><p className="font-medium">{item.contractType.name}</p></div>
      <div><p className="text-xs text-text-secondary">Status</p><StatusBadge value={item.status} /></div>
      <div><p className="text-xs text-text-secondary">Dates</p><p>{item.startDate} – {item.endDate ?? "Open ended"}</p></div>
      <div><p className="text-xs text-text-secondary">Job title</p><p>{item.jobTitleSnapshot}</p></div>
      <div><p className="text-xs text-text-secondary">Basic salary</p><p>{money(item.basicSalary, item.currency)}</p></div>
      <div><p className="text-xs text-text-secondary">Total compensation</p><p>{money(item.totalCompensation, item.currency)}</p></div>
    </div>
  );

  return (
    <div className="space-y-3">
      <PageHeader
        title="Employment contracts"
        description="Private, versioned employment-contract records and expiry reminders."
        actions={can("Contracts.Create") ? (
          <Button id="create-contract-trigger" onClick={(event) => openDialog("create", event.currentTarget)}>
            Prepare contract
          </Button>
        ) : undefined}
      />
      <div role="tablist" aria-label="Contract workspaces" className="flex min-w-0 overflow-x-auto border-b border-brand-border">
        {allowedTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setTab(tab.id)}
            className={cx(
              "h-8 shrink-0 border-b-2 px-3 text-sm font-medium",
              activeTab === tab.id
                ? "border-brand-primary text-brand-primary"
                : "border-transparent text-text-secondary hover:bg-surface-subtle hover:text-text-primary",
              focusRing,
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {notice ? <p role="status" className="rounded-md border border-success-soft bg-success-soft px-3 py-2 text-sm">{notice}</p> : null}
      {loading ? <LoadingState>Loading contracts…</LoadingState> : null}

      {!loading && activeTab === "mine" ? (
        ownContract ? (
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[length:var(--amafh-text-section)] font-semibold">My active contract</h2>
              <StatusBadge value={ownContract.status} />
            </div>
            {renderSummary(ownContract)}
            {ownContract.attachments.filter((item) => item.isActive).map((file) => (
              <Button key={file.id} variant="secondary" onClick={() => void download(ownContract, file)}>
                Download signed contract
              </Button>
            ))}
          </Card>
        ) : <EmptyState>No active employment contract is available.</EmptyState>
      ) : null}

      {!loading && activeTab === "register" ? (
        contracts.length ? (
          <TableShell aria-label="Employment contract register">
            <TableHead><tr><Th>Contract</Th><Th>Employee</Th><Th>Type</Th><Th>Dates</Th><Th>Status</Th><Th>Action</Th></tr></TableHead>
            <tbody>
              {contracts.map((item) => (
                <tr key={item.id}>
                  <Td className="font-medium">{item.contractNumber}</Td>
                  <Td>{item.employee}<span className="block text-xs text-text-secondary">{item.employeeCode}</span></Td>
                  <Td>{item.contractType.name}</Td>
                  <Td>{item.startDate}<span className="block text-xs text-text-secondary">to {item.endDate ?? "open ended"}</span></Td>
                  <Td><StatusBadge value={item.status} /></Td>
                  <Td><Button variant="ghost" size="compact" onClick={(event) => openDialog("detail", event.currentTarget, item)}>View</Button></Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        ) : <EmptyState>No contracts have been prepared.</EmptyState>
      ) : null}

      {!loading && activeTab === "reminders" ? (
        reminderItems.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {reminderItems.map((item) => (
              <Card key={item.id} className="flex items-start justify-between gap-3">
                <div><p className="font-semibold">{item.employee}</p><p className="text-sm text-text-secondary">{item.contractNumber} · ends {item.endDate}</p></div>
                <div className="text-right"><p className="text-xl font-semibold text-brand-primary">{item.daysRemaining}</p><p className="text-xs text-text-secondary">days · {item.reminderMilestone}-day reminder</p></div>
              </Card>
            ))}
          </div>
        ) : <EmptyState>No contracts are within a 90-day reminder window.</EmptyState>
      ) : null}

      {!loading && activeTab === "settings" ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
          <Card className="space-y-3">
            <h2 className="text-[length:var(--amafh-text-section)] font-semibold">Configured contract types</h2>
            {types.length ? types.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 border-t border-brand-border pt-3 first:border-0 first:pt-0">
                <div><p className="font-medium">{item.name}</p><p className="text-xs text-text-secondary">{item.code}{item.description ? ` · ${item.description}` : ""}</p></div>
                <div className="flex items-center gap-2"><StatusBadge value={item.isActive ? "Active" : "Inactive"} /><Button type="button" size="compact" variant="ghost" onClick={() => void toggleType(item)}>{item.isActive ? "Deactivate" : "Activate"}</Button></div>
              </div>
            )) : <EmptyState>No contract types are configured.</EmptyState>}
          </Card>
          <Card>
            <form className="space-y-3" onSubmit={createType}>
              <h2 className="text-[length:var(--amafh-text-section)] font-semibold">Add contract type</h2>
              <Field label="Code"><TextInput required pattern="[A-Z0-9_-]+" value={typeDraft.code} onChange={(event) => setTypeDraft((value) => ({ ...value, code: event.target.value.toUpperCase() }))} /></Field>
              <Field label="Name"><TextInput required value={typeDraft.name} onChange={(event) => setTypeDraft((value) => ({ ...value, name: event.target.value }))} /></Field>
              <Field label="Description"><Textarea value={typeDraft.description} onChange={(event) => setTypeDraft((value) => ({ ...value, description: event.target.value }))} /></Field>
              <Button type="submit">Create type</Button>
            </form>
          </Card>
        </div>
      ) : null}

      {creating || editing ? (
        <DialogPanel title={editing ? "Edit draft contract" : "Prepare employment contract"} description="A renewal creates a new version; existing evidence is never overwritten." onClose={editing ? closeEdit : closeDialog}>
          <form className="space-y-4" onSubmit={saveContract}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Employee"><Select required disabled={Boolean(editing)} value={draft.employeeId} onChange={(event) => setDraft((value) => ({ ...value, employeeId: event.target.value }))}><option value="">Select employee</option>{employees.map((item) => <option key={item.id} value={item.id}>{item.fullName} · {item.employeeCode}</option>)}</Select></Field>
              <Field label="Contract type"><Select required value={draft.contractTypeId} onChange={(event) => setDraft((value) => ({ ...value, contractTypeId: event.target.value }))}><option value="">Select type</option>{types.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
              <Field label="Contract number"><TextInput required readOnly={Boolean(editing)} value={draft.contractNumber} onChange={(event) => setDraft((value) => ({ ...value, contractNumber: event.target.value }))} /></Field>
              <Field label="Job title snapshot"><TextInput required value={draft.jobTitleSnapshot} onChange={(event) => setDraft((value) => ({ ...value, jobTitleSnapshot: event.target.value }))} /></Field>
              <Field label="Start date"><TextInput type="date" required value={draft.startDate} onChange={(event) => setDraft((value) => ({ ...value, startDate: event.target.value }))} /></Field>
              <Field label="End date"><TextInput type="date" value={draft.endDate} onChange={(event) => setDraft((value) => ({ ...value, endDate: event.target.value }))} /></Field>
              <Field label="Currency"><TextInput required maxLength={3} value={draft.currency} onChange={(event) => setDraft((value) => ({ ...value, currency: event.target.value.toUpperCase() }))} /></Field>
              <Field label="Basic salary"><TextInput type="number" min="0" step="0.01" required value={draft.basicSalary} onChange={(event) => setDraft((value) => ({ ...value, basicSalary: event.target.value }))} /></Field>
              <Field label="Allowances total"><TextInput type="number" min="0" step="0.01" required value={draft.allowancesTotal} onChange={(event) => setDraft((value) => ({ ...value, allowancesTotal: event.target.value }))} /></Field>
              <Field label="Renewal of"><Select disabled={Boolean(editing)} value={draft.parentContractId} onChange={(event) => setDraft((value) => ({ ...value, parentContractId: event.target.value }))}><option value="">New contract</option>{contracts.map((item) => <option key={item.id} value={item.id}>{item.contractNumber} · {item.employee}</option>)}</Select></Field>
              <Field label="Notes" className="sm:col-span-2"><Textarea value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} /></Field>
            </div>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={editing ? closeEdit : closeDialog}>Cancel</Button><Button type="submit">{editing ? "Save changes" : "Save draft"}</Button></div>
          </form>
        </DialogPanel>
      ) : null}

      {selected && !decision && !editing ? (
        <DialogPanel title={selected.contractNumber} description="Private employment contract details and immutable history." onClose={closeDialog}>
          <div className="space-y-4">
            {renderSummary(selected)}
            {selected.notes ? <p className="rounded-md bg-surface-subtle p-3 text-sm">{selected.notes}</p> : null}
            <div className="flex flex-wrap gap-2">
              {selected.storedStatus === "Draft" && can("Contracts.Edit") ? <Button variant="secondary" onClick={(event) => openDialog("edit", event.currentTarget, selected)}>Edit draft</Button> : null}
              {selected.storedStatus === "Draft" && can("Contracts.Create") ? <Button onClick={() => void action(selected, "submit", {})}>Submit for approval</Button> : null}
              {selected.storedStatus === "Pending Approval" && can("Contracts.Approve") ? <Button onClick={(event) => { returnFocus.current = event.currentTarget; setDecision({ contract: selected, kind: "activate" }); }}>Activate</Button> : null}
              {selected.storedStatus === "Pending Approval" && can("Contracts.ReturnReject") ? <><Button variant="secondary" onClick={(event) => { returnFocus.current = event.currentTarget; setDecision({ contract: selected, kind: "return" }); }}>Return</Button><Button variant="danger" onClick={(event) => { returnFocus.current = event.currentTarget; setDecision({ contract: selected, kind: "reject" }); }}>Reject</Button></> : null}
              {["Draft", "Pending Approval"].includes(selected.storedStatus) && can("Contracts.Cancel") ? <Button variant="danger" onClick={(event) => { returnFocus.current = event.currentTarget; setDecision({ contract: selected, kind: "cancel" }); }}>Cancel contract</Button> : null}
            </div>
            {["Draft", "Pending Approval"].includes(selected.storedStatus) && (can("Contracts.Create") || can("Contracts.Edit")) ? (
              <form className="space-y-2 rounded-md border border-brand-border p-3" onSubmit={upload}>
                <Field label={selected.attachments.some((item) => item.isActive) ? "Replace signed attachment" : "Signed attachment"}>
                  <TextInput type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} />
                </Field>
                {selected.attachments.some((item) => item.isActive) ? <Field label="Replacement reason"><Textarea required value={replacementReason} onChange={(event) => setReplacementReason(event.target.value)} /></Field> : null}
                <Button type="submit" variant="secondary">Upload attachment</Button>
              </form>
            ) : null}
            <div>
              <h3 className="text-lg font-semibold">Attachments</h3>
              {selected.attachments.length ? selected.attachments.map((file) => (
                <button key={file.id} type="button" onClick={() => void download(selected, file)} className={cx("mt-2 block text-sm text-brand-primary underline", focusRing)}>{file.name} · version {file.version}{file.isActive ? " · current" : ""}</button>
              )) : <p className="mt-1 text-sm text-text-secondary">No signed attachment uploaded.</p>}
            </div>
            {can("Contracts.History") ? <div><h3 className="text-lg font-semibold">History</h3>{selected.history.map((item) => <div key={item.id} className="mt-2 border-l-2 border-brand-border pl-3 text-sm"><p className="font-medium">{item.action} · {item.toStatus}</p><p className="text-xs text-text-secondary">{item.actor} · {new Date(item.createdAt).toLocaleString("en-AE")}</p>{item.comment ? <p>{item.comment}</p> : null}</div>)}</div> : null}
          </div>
        </DialogPanel>
      ) : null}

      {decision ? (
        <DialogPanel title={`${decision.kind[0].toUpperCase()}${decision.kind.slice(1)} contract`} description="This sensitive action is recorded in immutable history." onClose={closeDecision}>
          <form className="space-y-3" onSubmit={confirmDecision}>
            <Field label={decision.kind === "cancel" ? "Reason" : "Comment"}><Textarea required={decision.kind !== "activate"} value={comment} onChange={(event) => setComment(event.target.value)} /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={closeDecision}>Back</Button><Button type="submit" variant={decision.kind === "activate" ? "primary" : "danger"}>Confirm</Button></div>
          </form>
        </DialogPanel>
      ) : null}
    </div>
  );
}
