"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Badge,
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
import { apiGet, apiRequest, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";

type LeaveType = {
  id: string;
  code: string;
  name: string;
  isPaid: boolean;
  eligibility: string | null;
  yearlyEntitlement: number;
  accrualMethod: "none" | "monthly";
  monthlyAccrual: number;
  carryForwardLimit: number;
  carryForwardExpiryMonths: number | null;
  halfDayAllowed: boolean;
  attachmentRequired: boolean;
};

type LeaveRequest = {
  id: string;
  employeeId: string;
  employee: string;
  requestedBy: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  portion: string;
  workingDays: number;
  status: string;
  reason: string | null;
  cancellationManagerApproved: boolean;
  lockVersion: number;
  updatedAt: string;
};

type Balance = {
  leaveType: LeaveType;
  entitled: number;
  adjustments: number;
  used: number;
  pending: number;
  available: number;
};

type CalendarItem = {
  employee: string;
  startDate: string;
  endDate: string;
  status: string;
};

type EmployeeOption = { id: string; fullName: string; employeeCode: string };
type Tab = "requests" | "approvals" | "calendar" | "settings";
type DecisionMode = "return" | "reject" | "cancellation-approve" | "cancellation-reject" | "owner-override";
type PendingDecision = { item: LeaveRequest; mode: DecisionMode };

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "requests", label: "My leave" },
  { id: "approvals", label: "Approvals" },
  { id: "calendar", label: "Team calendar" },
  { id: "settings", label: "Leave settings" },
];

const today = new Date().toISOString().slice(0, 10);
const year = Number(today.slice(0, 4));

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? error.message : fallback;
}

export default function LeavePage() {
  const { user, can } = useAuth();
  const api = getBrowserApiUrl();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab") as Tab | null;
  const allowedTabs = useMemo(
    () => tabs.filter((tab) => {
      if (tab.id === "settings") return can("Leave.Settings");
      if (tab.id === "approvals") return can("Leave.ApproveManager") || can("Leave.ApproveHR");
      return true;
    }),
    [can],
  );
  const activeTab = allowedTabs.some((tab) => tab.id === requestedTab)
    ? requestedTab as Tab
    : "requests";
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [calendar, setCalendar] = useState<CalendarItem[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [decision, setDecision] = useState<PendingDecision | null>(null);
  const [decisionComment, setDecisionComment] = useState("");
  const cancelReturnFocus = useRef<HTMLElement | null>(null);
  const decisionReturnFocus = useRef<HTMLElement | null>(null);
  const [draft, setDraft] = useState({
    employeeId: "",
    leaveTypeId: "",
    startDate: "",
    endDate: "",
    portion: "full_day",
    reason: "",
    exceptionReason: "",
  });

  const load = useCallback(async () => {
    if (!user || !can("Leave.View")) return;
    setLoading(true);
    setError("");
    try {
      const calendarEnd = `${year}-12-31`;
      const [typeData, requestData, balanceData, calendarData] = await Promise.all([
        apiGet<{ items: LeaveType[] }>("/api/v1/leave/types", api),
        apiGet<{ items: LeaveRequest[] }>("/api/v1/leave/requests", api),
        apiGet<{ items: Balance[] }>(`/api/v1/leave/employees/${user.id}/balances?year=${year}`, api),
        apiGet<{ items: CalendarItem[] }>(
          `/api/v1/leave/team-calendar?date_from=${year}-01-01&date_to=${calendarEnd}`,
          api,
        ),
      ]);
      setTypes(typeData.items);
      setRequests(requestData.items);
      setBalances(balanceData.items);
      setCalendar(calendarData.items);
      if (!draft.leaveTypeId && typeData.items[0]) {
        setDraft((current) => ({ ...current, leaveTypeId: typeData.items[0].id }));
      }
      if (can("Leave.CreateForEmployee")) {
        const data = await apiGet<{ items: EmployeeOption[] }>("/api/v1/leave/employees", api);
        setEmployees(data.items);
      }
    } catch (caught) {
      setError(errorMessage(caught, "Unable to load leave management"));
    } finally {
      setLoading(false);
    }
  }, [api, can, draft.leaveTypeId, user]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!creating && !cancelling && !decision) return;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const initial = creating
      ? dialog?.querySelector<HTMLElement>('[role="combobox"]')
      : dialog?.querySelector<HTMLElement>('textarea');
    initial?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (creating) closeCreate();
        else if (cancelling) closeCancellation();
        else closeDecision();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [role="combobox"]:not([aria-disabled="true"]), [href]',
      )).filter((element) => !element.hidden && element.tabIndex !== -1);
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
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [cancelling, creating, decision]);

  function setTab(tab: Tab) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", tab);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function closeCreate() {
    setCreating(false);
    requestAnimationFrame(() => document.getElementById("request-leave-trigger")?.focus());
  }

  function openCancellation(item: LeaveRequest, trigger: HTMLElement) {
    cancelReturnFocus.current = trigger;
    setCancellationReason("");
    setCancelling(item);
  }

  function closeCancellation() {
    setCancelling(null);
    setCancellationReason("");
    requestAnimationFrame(() => cancelReturnFocus.current?.focus());
  }

  async function confirmCancellation(event: React.FormEvent) {
    event.preventDefault();
    if (!cancelling) return;
    if (await action(cancelling, "cancel", { reason: cancellationReason })) {
      closeCancellation();
    }
  }

  function openDecision(item: LeaveRequest, mode: DecisionMode, trigger: HTMLElement) {
    decisionReturnFocus.current = trigger;
    setDecisionComment("");
    setDecision({ item, mode });
  }

  function closeDecision() {
    setDecision(null);
    setDecisionComment("");
    requestAnimationFrame(() => decisionReturnFocus.current?.focus());
  }

  async function confirmDecision(event: React.FormEvent) {
    event.preventDefault();
    if (!decision) return;
    const { item, mode } = decision;
    let succeeded = false;
    if (mode === "return" || mode === "reject") {
      succeeded = await action(item, "decision", { decision: mode, comment: decisionComment });
    } else if (mode === "owner-override") {
      succeeded = await action(item, "owner-override", { exception_reason: decisionComment });
    } else {
      succeeded = await action(item, "cancellation-decision", {
        approve: mode === "cancellation-approve",
        comment: decisionComment,
      });
    }
    if (succeeded) closeDecision();
  }

  async function createRequest(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const selectedType = types.find((item) => item.id === draft.leaveTypeId);
      await apiRequest("/api/v1/leave/requests", api, {
        method: "POST",
        body: JSON.stringify({
          employee_id: draft.employeeId || null,
          leave_type_id: draft.leaveTypeId,
          start_date: draft.startDate,
          end_date: draft.endDate,
          portion: draft.portion,
          reason: draft.reason,
          submit: !selectedType?.attachmentRequired,
          exception_reason: draft.exceptionReason || null,
        }),
      });
      closeCreate();
      setDraft((current) => ({ ...current, employeeId: "", startDate: "", endDate: "", reason: "", exceptionReason: "" }));
      setMessage(selectedType?.attachmentRequired
        ? "Draft saved. Add the required attachment, then submit it for approval."
        : "Leave request submitted for approval.");
      await load();
    } catch (caught) {
      setError(errorMessage(caught, "Unable to submit leave request"));
    }
  }

  async function upload(item: LeaveRequest, file: File) {
    const form = new FormData();
    form.set("upload", file);
    setError("");
    try {
      await apiRequest(`/api/v1/leave/requests/${item.id}/attachment`, api, {
        method: "POST",
        body: form,
      });
      setMessage("Leave attachment uploaded.");
      await load();
    } catch (caught) {
      setError(errorMessage(caught, "Unable to upload leave attachment"));
    }
  }

  async function action(item: LeaveRequest, path: string, payload: object = {}) {
    setError("");
    setMessage("");
    try {
      await apiRequest(`/api/v1/leave/requests/${item.id}/${path}`, api, {
        method: "POST",
        body: JSON.stringify({ lock_version: item.lockVersion, ...payload }),
      });
      setMessage("Leave request updated.");
      await load();
      return true;
    } catch (caught) {
      setError(errorMessage(caught, "Unable to update leave request"));
      return false;
    }
  }

  async function saveType(item: LeaveType, form: HTMLFormElement) {
    const values = new FormData(form);
    setError("");
    try {
      await apiRequest(`/api/v1/leave/types/${item.id}`, api, {
        method: "PATCH",
        body: JSON.stringify({
          is_paid: values.get("isPaid") === "on",
          eligibility: values.get("eligibility") || null,
          yearly_entitlement: Number(values.get("yearlyEntitlement")),
          accrual_method: values.get("accrualMethod"),
          monthly_accrual: Number(values.get("monthlyAccrual")),
          carry_forward_limit: Number(values.get("carryForwardLimit")),
          carry_forward_expiry_months: values.get("carryForwardExpiryMonths")
            ? Number(values.get("carryForwardExpiryMonths")) : null,
          half_day_allowed: values.get("halfDayAllowed") === "on",
          attachment_required: values.get("attachmentRequired") === "on",
        }),
      });
      setMessage(`${item.name} settings saved.`);
      await load();
    } catch (caught) {
      setError(errorMessage(caught, "Unable to save leave settings"));
    }
  }

  if (!can("Leave.View")) return <ErrorText>Leave permission is required.</ErrorText>;

  const myRequests = requests.filter((item) => item.employeeId === user?.id);
  const approvalRequests = requests.filter((item) =>
    ["Submitted", "Manager Approved", "Cancellation Pending"].includes(item.status),
  );

  return (
    <div className="space-y-3">
      <PageHeader
        title="Leave management"
        description="Request leave, follow approvals and view balances using the configured UAE working calendar."
        actions={can("Leave.Request") || can("Leave.CreateForEmployee") ? (
          <Button id="request-leave-trigger" type="button" onClick={() => setCreating(true)}>Request leave</Button>
        ) : undefined}
      />
      <div role="tablist" aria-label="Leave workspaces" className="flex min-w-0 overflow-x-auto border-b border-brand-border">
        {allowedTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={cx(
              "h-8 shrink-0 border-b-2 px-3 text-sm font-medium",
              focusRing,
              activeTab === tab.id
                ? "border-brand-primary text-brand-primary"
                : "border-transparent text-text-secondary hover:bg-surface-subtle hover:text-text-primary",
            )}
            onClick={() => setTab(tab.id)}
          >{tab.label}</button>
        ))}
      </div>
      {message ? <p role="status" className="rounded-md border border-success-soft bg-success-soft px-3 py-2 text-sm">{message}</p> : null}
      <ErrorText>{error}</ErrorText>
      {loading ? <LoadingState>Loading leave records…</LoadingState> : null}

      {!loading && activeTab === "requests" ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {balances.map((item) => (
              <Card key={item.leaveType.id}>
                <p className="text-sm font-medium text-text-secondary">{item.leaveType.name}</p>
                <p className="mt-1 text-3xl font-semibold text-text-primary">{item.available}</p>
                <p className="mt-1 text-xs text-text-secondary">{item.used} used · {item.pending} pending · {item.entitled + item.adjustments} entitled</p>
              </Card>
            ))}
          </div>
          {myRequests.length ? <RequestTable items={myRequests} own onAction={action} onUpload={upload} onCancel={openCancellation} /> : <Card><EmptyState>No leave requests yet.</EmptyState></Card>}
        </div>
      ) : null}

      {!loading && activeTab === "approvals" ? (
        approvalRequests.length ? <RequestTable items={approvalRequests} onAction={action} canManager={can("Leave.ApproveManager")} canHr={can("Leave.ApproveHR")} canReturnReject={can("Leave.ReturnReject")} canCancelDecision={can("Leave.Cancel")} canOverride={can("Leave.Override")} onDecision={openDecision} /> : <Card><EmptyState>No leave approvals need attention.</EmptyState></Card>
      ) : null}

      {!loading && activeTab === "calendar" ? (
        calendar.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {calendar.map((item, index) => <Card key={`${item.employee}-${item.startDate}-${index}`}><div className="flex items-center justify-between gap-2"><p className="font-semibold">{item.employee}</p><StatusBadge value={item.status} /></div><p className="mt-2 text-sm text-text-secondary">{item.startDate} to {item.endDate}</p></Card>)}
          </div>
        ) : <Card><EmptyState>No approved team leave in {year}.</EmptyState></Card>
      ) : null}

      {!loading && activeTab === "settings" ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {types.map((item) => <LeaveTypeForm key={item.id} item={item} onSave={saveType} />)}
        </div>
      ) : null}

      {creating ? (
        <DialogPanel title="Request leave" description="Working days exclude configured weekends and official holidays." onClose={closeCreate}>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={createRequest}>
            {can("Leave.CreateForEmployee") ? <Field label="Employee"><Select value={draft.employeeId} onChange={(event) => setDraft({ ...draft, employeeId: event.target.value })}><option value="">Myself</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeCode} · {employee.fullName}</option>)}</Select></Field> : null}
            <Field label="Leave type"><Select required value={draft.leaveTypeId} onChange={(event) => setDraft({ ...draft, leaveTypeId: event.target.value })}>{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</Select></Field>
            <Field label="Start date"><TextInput required type="date" min={today} value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></Field>
            <Field label="End date"><TextInput required type="date" min={draft.startDate || today} value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></Field>
            <Field label="Portion"><Select value={draft.portion} onChange={(event) => setDraft({ ...draft, portion: event.target.value })}><option value="full_day">Full day</option><option value="first_half">First half</option><option value="second_half">Second half</option></Select></Field>
            <Field label="Reason" className="sm:col-span-2"><Textarea required value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></Field>
            {can("Leave.Override") ? <Field label="OWNER exception reason (only when overriding a control)" className="sm:col-span-2"><Textarea value={draft.exceptionReason} onChange={(event) => setDraft({ ...draft, exceptionReason: event.target.value })} /></Field> : null}
            <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={closeCreate}>Cancel</Button><Button type="submit">Submit request</Button></div>
          </form>
        </DialogPanel>
      ) : null}
      {cancelling ? (
        <DialogPanel title="Cancel leave request" description="Provide a reason. Approved leave follows the configured cancellation approval workflow." onClose={closeCancellation}>
          <form className="space-y-3" onSubmit={confirmCancellation}>
            <Field label="Cancellation reason">
              <Textarea required value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeCancellation}>Keep request</Button>
              <Button type="submit" variant="danger">Request cancellation</Button>
            </div>
          </form>
        </DialogPanel>
      ) : null}
      {decision ? (
        <DialogPanel title={decisionTitle(decision.mode)} description="This decision is recorded in immutable leave history and the application audit trail." onClose={closeDecision}>
          <form className="space-y-3" onSubmit={confirmDecision}>
            <Field label={decision.mode === "owner-override" ? "Mandatory override reason" : "Mandatory comment"}>
              <Textarea required value={decisionComment} onChange={(event) => setDecisionComment(event.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeDecision}>Cancel</Button>
              <Button type="submit" variant={decision.mode.includes("reject") ? "danger" : "primary"}>Confirm</Button>
            </div>
          </form>
        </DialogPanel>
      ) : null}
    </div>
  );
}

function RequestTable({ items, own = false, canManager = false, canHr = false, canReturnReject = false, canCancelDecision = false, canOverride = false, onAction, onUpload, onCancel, onDecision }: { items: LeaveRequest[]; own?: boolean; canManager?: boolean; canHr?: boolean; canReturnReject?: boolean; canCancelDecision?: boolean; canOverride?: boolean; onAction: (item: LeaveRequest, path: string, payload?: object) => Promise<boolean>; onUpload?: (item: LeaveRequest, file: File) => Promise<void>; onCancel?: (item: LeaveRequest, trigger: HTMLElement) => void; onDecision?: (item: LeaveRequest, mode: DecisionMode, trigger: HTMLElement) => void }) {
  return <TableShell><TableHead><tr><Th>Employee</Th><Th>Dates</Th><Th>Days</Th><Th>Status</Th><Th>Updated</Th><Th><span className="sr-only">Actions</span></Th></tr></TableHead><tbody>{items.map((item) => <tr key={item.id}><Td><p className="font-medium">{item.employee}</p><p className="text-xs text-text-secondary">Requested by {item.requestedBy}</p></Td><Td>{item.startDate} – {item.endDate}</Td><Td>{item.workingDays}</Td><Td><StatusBadge value={item.status} /></Td><Td>{new Date(item.updatedAt).toLocaleString()}</Td><Td><div className="flex flex-wrap justify-end gap-2">{own && onUpload && ["Draft", "Returned"].includes(item.status) ? <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-brand-primary px-2.5 text-xs font-medium text-brand-primary focus-within:outline focus-within:outline-2 focus-within:outline-brand-primary">Attach<input className="sr-only" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onUpload(item, file); event.currentTarget.value = ""; }} /></label> : null}{own && ["Draft", "Returned"].includes(item.status) ? <Button size="compact" onClick={() => onAction(item, "submit")}>Submit</Button> : null}{own && onCancel && !["Cancelled", "Rejected", "Completed"].includes(item.status) ? <Button size="compact" variant="secondary" onClick={(event) => onCancel(item, event.currentTarget)}>Cancel</Button> : null}{canManager && item.status === "Submitted" ? <Button size="compact" onClick={() => onAction(item, "manager-approve")}>Manager approve</Button> : null}{canHr && item.status === "Manager Approved" ? <Button size="compact" onClick={() => onAction(item, "hr-approve")}>HR approve</Button> : null}{onDecision && canReturnReject && ["Submitted", "Manager Approved"].includes(item.status) ? <><Button size="compact" variant="secondary" onClick={(event) => onDecision(item, "return", event.currentTarget)}>Return</Button><Button size="compact" variant="danger" onClick={(event) => onDecision(item, "reject", event.currentTarget)}>Reject</Button></> : null}{onDecision && canOverride && ["Submitted", "Manager Approved", "Returned"].includes(item.status) ? <Button size="compact" variant="secondary" onClick={(event) => onDecision(item, "owner-override", event.currentTarget)}>OWNER override</Button> : null}{onDecision && canCancelDecision && item.status === "Cancellation Pending" && ((canManager && !canHr && !item.cancellationManagerApproved) || canHr) ? <Button size="compact" onClick={(event) => onDecision(item, "cancellation-approve", event.currentTarget)}>Approve cancellation</Button> : null}{onDecision && canCancelDecision && canHr && item.status === "Cancellation Pending" ? <Button size="compact" variant="danger" onClick={(event) => onDecision(item, "cancellation-reject", event.currentTarget)}>Reject cancellation</Button> : null}</div></Td></tr>)}</tbody></TableShell>;
}

function decisionTitle(mode: DecisionMode) {
  if (mode === "owner-override") return "Approve with OWNER override";
  if (mode === "cancellation-approve") return "Approve cancellation";
  if (mode === "cancellation-reject") return "Reject cancellation";
  return `${mode === "return" ? "Return" : "Reject"} leave request`;
}

function LeaveTypeForm({ item, onSave }: { item: LeaveType; onSave: (item: LeaveType, form: HTMLFormElement) => Promise<void> }) {
  return <Card><form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void onSave(item, event.currentTarget); }}><div className="sm:col-span-2"><div className="flex items-center justify-between"><h2 className="text-[length:var(--amafh-text-section)] font-semibold">{item.name}</h2><Badge>{item.code}</Badge></div></div><Field label="Yearly entitlement"><TextInput name="yearlyEntitlement" type="number" min="0" max="366" step="0.5" defaultValue={item.yearlyEntitlement} /></Field><Field label="Accrual"><Select name="accrualMethod" defaultValue={item.accrualMethod}><option value="none">Annual allocation</option><option value="monthly">Monthly accrual</option></Select></Field><Field label="Monthly accrual"><TextInput name="monthlyAccrual" type="number" min="0" max="31" step="0.5" defaultValue={item.monthlyAccrual} /></Field><Field label="Carry-forward limit"><TextInput name="carryForwardLimit" type="number" min="0" max="366" step="0.5" defaultValue={item.carryForwardLimit} /></Field><Field label="Carry-forward expiry (months)"><TextInput name="carryForwardExpiryMonths" type="number" min="1" max="24" defaultValue={item.carryForwardExpiryMonths ?? ""} /></Field><Field label="Eligibility"><TextInput name="eligibility" defaultValue={item.eligibility ?? ""} /></Field><label className="flex items-center gap-2 text-sm"><input name="isPaid" type="checkbox" defaultChecked={item.isPaid} />Paid leave</label><label className="flex items-center gap-2 text-sm"><input name="halfDayAllowed" type="checkbox" defaultChecked={item.halfDayAllowed} />Half day allowed</label><label className="flex items-center gap-2 text-sm"><input name="attachmentRequired" type="checkbox" defaultChecked={item.attachmentRequired} />Attachment required</label><div className="flex justify-end sm:col-span-2"><Button type="submit">Save {item.name}</Button></div></form></Card>;
}
