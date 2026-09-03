"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { IconRefresh, IconX } from "@/components/icons";
import { Pagination, useClientPagination } from "@/components/pagination";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorText,
  Field,
  LoadingState,
  PageHeader,
  SearchActionBar,
  SectionHeader,
  Select,
  StatusBadge,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
  cx,
} from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { AssetAllocationRecord, AssetRecord, UserRecord, UserTypeSummary } from "@/lib/types";

type ProfileTab = "overview" | "organization" | "assets" | "history";
type HistoryAssignment = {
  field: string;
  valueId: string | null;
  valueLabel: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};
type EmploymentPeriod = {
  joiningDate: string;
  lastWorkingDate: string | null;
  employeeCode: string;
  isCurrent: boolean;
};
type AuditEvent = {
  id: string;
  action: string;
  actorId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  createdAt: string;
};
type History = {
  emails: { email: string; changedAt: string }[];
  employeeCodes: { employeeCode: string; effectiveFrom: string; effectiveTo: string | null }[];
  assignments: HistoryAssignment[];
  employmentPeriods: EmploymentPeriod[];
  events: AuditEvent[];
};
type EmployeeAssets = {
  current: { asset: AssetRecord; allocation: AssetAllocationRecord }[];
  history: { asset: AssetRecord; allocation: AssetAllocationRecord }[];
};
type Confirmation = {
  body?: unknown;
  captureLink?: boolean;
  confirmLabel: string;
  danger?: boolean;
  description: string;
  path: string;
  success: string;
  title: string;
};

const PROFILE_TABS: { id: ProfileTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "organization", label: "Organization & Access" },
  { id: "assets", label: "Assets" },
  { id: "history", label: "History & Audit" },
];

function readProfileTab(): ProfileTab {
  const value = new URLSearchParams(window.location.search).get("tab");
  return PROFILE_TABS.some((tab) => tab.id === value) ? (value as ProfileTab) : "overview";
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}` : parts[0]?.slice(0, 2) ?? "U").toUpperCase();
}

function friendly(value: string) {
  const text = value.replace(/[._-]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function assetIdentity(asset: AssetRecord) {
  return asset.serialNumber ?? asset.imei ?? asset.iccid ?? asset.mobileNumber ?? asset.model ?? "—";
}

function Definition({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-text-secondary">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-text-primary">{children}</dd>
    </div>
  );
}

export default function UserProfilePage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const confirmationRef = useRef<HTMLElement>(null);
  const confirmationTriggerRef = useRef<HTMLElement | null>(null);
  const [user, setUser] = useState<UserRecord | null>(null);
  const [types, setTypes] = useState<UserTypeSummary[]>([]);
  const [history, setHistory] = useState<History | null>(null);
  const [assets, setAssets] = useState<EmployeeAssets | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [generatedLink, setGeneratedLink] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditAction, setAuditAction] = useState("all");
  const [profileLoadedAt, setProfileLoadedAt] = useState(0);

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setLoadError("");
    try {
      const [profile, profileHistory] = await Promise.all([
        apiGet<UserRecord>(`/api/v1/users/${params.id}`, api),
        apiGet<History>(`/api/v1/users/${params.id}/history`, api),
      ]);
      setUser(profile);
      setHistory(profileHistory);
      setProfileLoadedAt(Date.now());
      if (can("Assets.View")) {
        setAssets(await apiGet<EmployeeAssets>(`/api/v1/assets/employees/${params.id}`, api));
      } else {
        setAssets(null);
      }
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "Employee profile could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, can, params.id]);

  useEffect(() => {
    setActiveTab(readProfileTab());
    const searchParams = new URLSearchParams(window.location.search);
    if (!PROFILE_TABS.some((tab) => tab.id === searchParams.get("tab"))) {
      searchParams.set("tab", "overview");
      window.history.replaceState(null, "", `${window.location.pathname}?${searchParams.toString()}`);
    }
    function restoreTab() {
      setActiveTab(readProfileTab());
    }
    window.addEventListener("popstate", restoreTab);
    void refresh();
    void apiGet<{ items: UserTypeSummary[] }>("/api/v1/user-types", api)
      .then((data) => setTypes(data.items.filter((item) => item.code !== "OWNER")))
      .catch(() => undefined);
    return () => window.removeEventListener("popstate", restoreTab);
  }, [api, refresh]);

  function closeConfirmation() {
    setConfirmation(null);
    window.setTimeout(() => {
      if (confirmationTriggerRef.current?.isConnected) confirmationTriggerRef.current.focus();
    }, 0);
  }

  useEffect(() => {
    if (!confirmation) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || actionLoading) return;
      event.preventDefault();
      closeConfirmation();
    }
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  });

  const auditActions = useMemo(
    () => Array.from(new Set((history?.events ?? []).map((event) => event.action))).sort(),
    [history?.events],
  );
  const filteredEvents = useMemo(() => {
    const query = auditSearch.trim().toLowerCase();
    return (history?.events ?? []).filter((event) => {
      if (auditAction !== "all" && event.action !== auditAction) return false;
      if (!query) return true;
      return [event.action, event.createdAt, JSON.stringify(event.oldValues) ?? "", JSON.stringify(event.newValues) ?? ""]
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [auditAction, auditSearch, history?.events]);
  const auditPagination = useClientPagination(filteredEvents, `${auditSearch}:${auditAction}`);
  const currentAssetsPagination = useClientPagination(assets?.current ?? []);
  const returnedAssetsPagination = useClientPagination(assets?.history ?? []);

  function selectTab(tab: ProfileTab) {
    if (tab === activeTab) return;
    setActiveTab(tab);
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set("tab", tab);
    window.history.pushState(null, "", `${window.location.pathname}?${searchParams.toString()}`);
  }

  function navigateTabs(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const lastIndex = PROFILE_TABS.length - 1;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? lastIndex
        : event.key === "ArrowRight"
          ? (index + 1) % PROFILE_TABS.length
          : (index - 1 + PROFILE_TABS.length) % PROFILE_TABS.length;
    const nextTab = PROFILE_TABS[nextIndex];
    selectTab(nextTab.id);
    document.getElementById(`profile-tab-${nextTab.id}`)?.focus();
  }

  function requestConfirmation(trigger: HTMLElement, next: Confirmation) {
    confirmationTriggerRef.current = trigger;
    setActionError("");
    setActionMessage("");
    setGeneratedLink("");
    setConfirmation(next);
  }

  function trapConfirmationFocus(event: React.KeyboardEvent<HTMLElement>) {
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

  async function runConfirmedAction() {
    if (!confirmation) return;
    setActionLoading(true);
    setActionError("");
    setGeneratedLink("");
    try {
      const result = await apiRequest<{ url?: string }>(confirmation.path, api, {
        method: "POST",
        body: confirmation.body ? JSON.stringify(confirmation.body) : undefined,
      });
      const success = confirmation.success;
      const link = confirmation.captureLink ? result.url ?? "" : "";
      await refresh(true);
      setConfirmation(null);
      setActionMessage(success);
      setGeneratedLink(link);
      window.setTimeout(() => {
        if (confirmationTriggerRef.current?.isConnected) confirmationTriggerRef.current.focus();
      }, 0);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Account action failed.");
      setConfirmation(null);
      window.setTimeout(() => {
        if (confirmationTriggerRef.current?.isConnected) confirmationTriggerRef.current.focus();
      }, 0);
    } finally {
      setActionLoading(false);
    }
  }

  if (loading && !user) return <LoadingState>Loading employee profile…</LoadingState>;

  if (!user) {
    return (
      <Card className="space-y-3">
        <ErrorText>{loadError || "Employee profile could not be loaded."}</ErrorText>
        <Button type="button" variant="secondary" onClick={() => void refresh()}>
          <IconRefresh className="size-4" /> Retry
        </Button>
      </Card>
    );
  }

  const accountStatus = user.accountStatus.toLowerCase();
  const locked = Boolean(user.lockedUntil && Date.parse(user.lockedUntil) > profileLoadedAt);
  const canUseSecurityActions = [
    "Users.AssignUserType",
    "Users.Activate",
    "Users.Deactivate",
    "Users.Unlock",
    "Users.GenerateSetupLink",
    "Users.GenerateResetLink",
  ].some((permission) => can(permission)) || (accountStatus === "deactivated" && can("Users.Edit"));

  return (
    <section className="min-w-0 space-y-4">
      <PageHeader
        title={user.fullName}
        description="Employee identity, organization access, company assets, and audited account history."
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            {can("Dashboard.View") || can("Reports.View") ? (
              <ButtonLink href={`/reports/employees/${user.id}`} variant="secondary">Performance profile</ButtonLink>
            ) : null}
            {can("Users.Edit") ? <ButtonLink href={`/users/${user.id}/edit`}>Edit profile</ButtonLink> : null}
          </div>
        }
      />

      <Card className="overflow-hidden !p-0">
        <div className="flex min-w-0 flex-col gap-4 bg-gradient-to-br from-brand-soft via-surface to-surface px-4 py-4 sm:flex-row sm:items-center sm:px-5">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-brand-primary text-xl font-semibold text-white shadow-sm" aria-label={`${user.fullName} initials`}>
            {initials(user.fullName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="break-words text-xl font-semibold text-text-primary">{user.fullName}</h2>
              <StatusBadge value={user.employmentStatus} />
              <StatusBadge value={user.accountStatus} />
              {locked ? <StatusBadge value="locked" /> : null}
            </div>
            <p className="mt-1 break-words text-sm text-text-secondary">
              {user.designation?.name ?? "No designation"} · {user.office?.name ?? "No office"}{user.department ? ` / ${user.department.name}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
              <span><strong className="font-medium text-text-primary">Employee:</strong> {user.employeeCode}</span>
              <span><strong className="font-medium text-text-primary">User:</strong> {user.userCode}</span>
            </div>
          </div>
        </div>
      </Card>

      <div role="tablist" aria-label="Employee profile" className="grid min-w-0 grid-cols-2 gap-1 rounded-[10px] border border-brand-border bg-surface p-1 lg:grid-cols-4">
        {PROFILE_TABS.map((tab, index) => (
          <button
            key={tab.id}
            id={`profile-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-controls={`profile-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={cx(
              "min-h-8 min-w-0 rounded-md px-2 py-1 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary",
              activeTab === tab.id ? "bg-brand-primary text-white" : "text-text-secondary hover:bg-brand-soft hover:text-brand-primary",
            )}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => navigateTabs(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loadError ? <ErrorText>{loadError}</ErrorText> : null}
      {actionError ? <ErrorText>{actionError}</ErrorText> : null}
      {actionMessage ? <p role="status" className="rounded-md border border-success-soft bg-success-soft px-3 py-2 text-sm text-text-primary">{actionMessage}</p> : null}
      {generatedLink ? <p className="break-all rounded-md border border-brand-border bg-surface px-3 py-2 text-sm text-text-primary"><strong>One-time link:</strong> {generatedLink}</p> : null}

      <section id={`profile-panel-${activeTab}`} role="tabpanel" aria-labelledby={`profile-tab-${activeTab}`} className="min-w-0 space-y-4">
        {activeTab === "overview" ? <Overview user={user} /> : null}
        {activeTab === "organization" ? (
          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <Card>
              <SectionHeader title="Organization assignment" description="Current placement and reporting context." />
              <dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <Definition label="Designation">{user.designation ? `${user.designation.code} — ${user.designation.name}` : "Unassigned"}</Definition>
                <Definition label="Office">{user.office ? `${user.office.code} — ${user.office.name}` : "Unassigned"}</Definition>
                <Definition label="Department">{user.department ? `${user.department.code} — ${user.department.name}` : "Unassigned"}</Definition>
                <Definition label="Team">{user.team ? `${user.team.code} — ${user.team.name}` : "Unassigned"}</Definition>
                <Definition label="User type">{user.userType ? `${user.userType.code} — ${user.userType.name}` : "Unassigned"}</Definition>
                <Definition label="Effective permissions">{user.permissions.length.toLocaleString()}</Definition>
              </dl>
            </Card>
            {canUseSecurityActions ? (
              <Card>
                <SectionHeader title="Account & Security" description="Permission-gated identity and account lifecycle controls." actions={refreshing ? <span role="status" className="text-xs text-text-secondary">Refreshing…</span> : null} />
                <div className="mt-4 space-y-4">
                  <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
                    <Definition label="Account"><StatusBadge value={user.accountStatus} /></Definition>
                    <Definition label="MFA enabled">{user.mfaEnabled ? "Yes" : "No"}</Definition>
                    <Definition label="Lock state">{locked ? `Locked until ${formatDateTime(user.lockedUntil!)}` : "Not locked"}</Definition>
                  </dl>
                  <div className="grid min-w-0 gap-3 border-t border-brand-border pt-4 sm:grid-cols-2">
                    {can("Users.AssignUserType") ? (
                      <Field label="Assign user type" help="OWNER cannot be assigned from this control.">
                        <Select id="profile-user-type" aria-label="Assign user type" value="" onChange={(event) => {
                          const selected = types.find((item) => item.id === event.target.value);
                          const trigger = document.getElementById("profile-user-type");
                          if (!selected || !trigger) return;
                          requestConfirmation(trigger, {
                            title: "Assign user type?",
                            description: `Assign ${selected.code} — ${selected.name} to ${user.fullName}. This changes effective access according to the existing role policy.`,
                            confirmLabel: "Assign user type",
                            path: `/api/v1/users/${user.id}/assign-type`,
                            body: { user_type_id: selected.id },
                            success: "User type assigned.",
                          });
                        }}>
                          <option value="">Choose a user type</option>
                          {types.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
                        </Select>
                      </Field>
                    ) : null}
                    <div className="flex min-w-0 flex-wrap items-end gap-2 sm:justify-end">
                      {accountStatus === "active" && can("Users.Deactivate") ? (
                        <Button type="button" variant="danger" onClick={(event) => requestConfirmation(event.currentTarget, {
                          title: "Deactivate account?",
                          description: `Deactivate ${user.fullName}. Existing sessions will be invalidated according to the current security policy.`,
                          confirmLabel: "Deactivate",
                          danger: true,
                          path: `/api/v1/users/${user.id}/deactivate`,
                          success: "Account deactivated.",
                        })}>Deactivate</Button>
                      ) : null}
                      {accountStatus !== "active" && can("Users.Activate") ? (
                        <Button type="button" onClick={(event) => requestConfirmation(event.currentTarget, {
                          title: "Activate account?",
                          description: `Activate ${user.fullName} using the existing account policy.`,
                          confirmLabel: "Activate",
                          path: `/api/v1/users/${user.id}/activate`,
                          success: "Account activated.",
                        })}>Activate</Button>
                      ) : null}
                      {locked && can("Users.Unlock") ? (
                        <Button type="button" variant="secondary" onClick={(event) => requestConfirmation(event.currentTarget, {
                          title: "Unlock account?",
                          description: `Clear the current login lock for ${user.fullName}.`,
                          confirmLabel: "Unlock",
                          path: `/api/v1/users/${user.id}/unlock`,
                          success: "Account unlocked.",
                        })}>Unlock</Button>
                      ) : null}
                      {accountStatus === "deactivated" && can("Users.Edit") ? (
                        <Button type="button" variant="secondary" onClick={(event) => requestConfirmation(event.currentTarget, {
                          title: "Rehire employee?",
                          description: `Start a new employment period for ${user.fullName} today using the existing rehire workflow.`,
                          confirmLabel: "Rehire",
                          path: `/api/v1/users/${user.id}/rehire`,
                          body: { joining_date: new Date().toISOString().slice(0, 10), employment_status: "Active" },
                          success: "Employee rehired.",
                        })}>Rehire</Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-wrap gap-2 border-t border-brand-border pt-4">
                    {can("Users.GenerateSetupLink") ? <Button type="button" variant="secondary" onClick={(event) => requestConfirmation(event.currentTarget, {
                      title: "Generate setup link?",
                      description: `Create a one-time password setup link for ${user.fullName}. Existing expiry and token rules remain in force.`,
                      confirmLabel: "Generate setup link",
                      path: `/api/v1/auth/users/${user.id}/setup-link`,
                      success: "Setup link generated.",
                      captureLink: true,
                    })}>Generate setup link</Button> : null}
                    {can("Users.GenerateResetLink") ? <Button type="button" variant="secondary" onClick={(event) => requestConfirmation(event.currentTarget, {
                      title: "Generate reset link?",
                      description: `Create a one-time password reset link for ${user.fullName}. Existing expiry and token rules remain in force.`,
                      confirmLabel: "Generate reset link",
                      path: `/api/v1/auth/users/${user.id}/reset-link`,
                      success: "Reset link generated.",
                      captureLink: true,
                    })}>Generate reset link</Button> : null}
                  </div>
                </div>
              </Card>
            ) : <Card><EmptyState>No account or security actions are available with your current permissions.</EmptyState></Card>}
          </div>
        ) : null}

        {activeTab === "assets" ? (
          can("Assets.View") ? (
            <div className="space-y-4">
              <AssetSection title="Current Assets" description="Active company custody and outstanding offboarding items." items={currentAssetsPagination.pagedItems} empty="No current assets are allocated to this employee." current />
              <Pagination className="rounded-[10px] border border-brand-border" page={currentAssetsPagination.page} pageSize={currentAssetsPagination.pageSize} total={currentAssetsPagination.total} totalPages={currentAssetsPagination.totalPages} onPageChange={currentAssetsPagination.setPage} onPageSizeChange={currentAssetsPagination.setPageSize} />
              {can("Assets.ViewAudit") ? <>
                <AssetSection title="Returned Assets" description="Completed custody records with issue and return condition." items={returnedAssetsPagination.pagedItems} empty="No returned asset history is recorded for this employee." />
                <Pagination className="rounded-[10px] border border-brand-border" page={returnedAssetsPagination.page} pageSize={returnedAssetsPagination.pageSize} total={returnedAssetsPagination.total} totalPages={returnedAssetsPagination.totalPages} onPageChange={returnedAssetsPagination.setPage} onPageSizeChange={returnedAssetsPagination.setPageSize} />
              </> : null}
            </div>
          ) : <Card><EmptyState>You do not have permission to view employee assets.</EmptyState></Card>
        ) : null}

        {activeTab === "history" ? <HistoryPanel history={history} auditSearch={auditSearch} setAuditSearch={setAuditSearch} auditAction={auditAction} setAuditAction={setAuditAction} auditActions={auditActions} filteredEvents={filteredEvents} pagination={auditPagination} /> : null}
      </section>

      {confirmation ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/40 p-4" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeConfirmation(); }}>
          <section ref={confirmationRef} role="dialog" aria-modal="true" aria-labelledby="profile-confirm-title" aria-describedby="profile-confirm-description" className="w-full max-w-md rounded-[10px] border border-brand-border bg-surface p-4 shadow-2xl" onKeyDown={trapConfirmationFocus}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><h2 id="profile-confirm-title" className="text-base font-semibold text-text-primary">{confirmation.title}</h2><p id="profile-confirm-description" className="mt-2 text-sm text-text-secondary">{confirmation.description}</p></div>
              <Button type="button" variant="ghost" size="icon" aria-label="Close confirmation" disabled={actionLoading} onClick={closeConfirmation}><IconX className="size-4" /></Button>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" autoFocus disabled={actionLoading} onClick={closeConfirmation}>Cancel</Button>
              <Button type="button" variant={confirmation.danger ? "danger" : "primary"} disabled={actionLoading} onClick={() => void runConfirmedAction()}>{actionLoading ? "Working…" : confirmation.confirmLabel}</Button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function Overview({ user }: { user: UserRecord }) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <Card><SectionHeader title="Contact details" description="Primary contact information on the employee record." /><dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2"><Definition label="Email">{user.email}</Definition><Definition label="Mobile">{user.mobile}</Definition><Definition label="Employee code">{user.employeeCode}</Definition><Definition label="User code">{user.userCode}</Definition></dl></Card>
      <Card><SectionHeader title="Employment" description="Current employment dates and lifecycle status." /><dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2"><Definition label="Joining date">{user.joiningDate}</Definition><Definition label="Last working date">{user.lastWorkingDate ?? "—"}</Definition><Definition label="Employment status"><StatusBadge value={user.employmentStatus} /></Definition><Definition label="Account status"><StatusBadge value={user.accountStatus} /></Definition></dl></Card>
    </div>
  );
}

function HistoryPanel({ history, auditSearch, setAuditSearch, auditAction, setAuditAction, auditActions, filteredEvents, pagination }: {
  history: History | null;
  auditSearch: string;
  setAuditSearch: (value: string) => void;
  auditAction: string;
  setAuditAction: (value: string) => void;
  auditActions: string[];
  filteredEvents: AuditEvent[];
  pagination: ReturnType<typeof useClientPagination<AuditEvent>>;
}) {
  return (
    <div className="space-y-4">
      <div className="grid min-w-0 gap-4 xl:grid-cols-3">
        <HistoryCard title="Employee codes" empty="No employee-code history recorded.">{(history?.employeeCodes ?? []).map((row) => <li key={`${row.employeeCode}-${row.effectiveFrom}`} className="rounded-md bg-surface-subtle px-3 py-2"><span className="font-mono text-xs font-semibold text-text-primary">{row.employeeCode}</span><span className="mt-1 block text-xs text-text-secondary">{row.effectiveFrom} to {row.effectiveTo ?? "current"}</span></li>)}</HistoryCard>
        <HistoryCard title="Email history" empty="No email history recorded.">{(history?.emails ?? []).map((row) => <li key={`${row.email}-${row.changedAt}`} className="rounded-md bg-surface-subtle px-3 py-2"><span className="break-all text-sm font-medium text-text-primary">{row.email}</span><span className="mt-1 block text-xs text-text-secondary">Changed {formatDateTime(row.changedAt)}</span></li>)}</HistoryCard>
        <HistoryCard title="Employment periods" empty="No employment periods recorded.">{(history?.employmentPeriods ?? []).map((row, index) => <li key={`${row.employeeCode}-${row.joiningDate}-${index}`} className="rounded-md bg-surface-subtle px-3 py-2"><span className="text-sm font-medium text-text-primary">{row.joiningDate} to {row.lastWorkingDate ?? "current"}</span><span className="mt-1 block text-xs text-text-secondary">{row.employeeCode}{row.isCurrent ? " · Current period" : ""}</span></li>)}</HistoryCard>
      </div>
      <Card>
        <SectionHeader title="Assignment history" description="Recorded organization, designation, code, and employment changes." />
        {history?.assignments.length ? <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">{history.assignments.map((row, index) => <div key={`${row.field}-${row.effectiveFrom}-${index}`} className="min-w-0 rounded-md border border-brand-border bg-surface-subtle px-3 py-2"><p className="text-xs font-medium text-text-secondary">{friendly(row.field)}</p><p className="mt-1 break-words text-sm font-medium text-text-primary">{row.valueLabel}</p><p className="mt-1 text-xs text-text-disabled">{row.effectiveFrom} to {row.effectiveTo ?? "current"}</p></div>)}</div> : <EmptyState>No assignment history is recorded.</EmptyState>}
      </Card>
      <Card className="space-y-3">
        <SectionHeader title="Audit events" description="Filter the existing immutable audit history for this employee." />
        <SearchActionBar search={<Field label="Search audit events" htmlFor="audit-search"><TextInput id="audit-search" value={auditSearch} placeholder="Action, date, or recorded value" onChange={(event) => setAuditSearch(event.target.value)} /></Field>} actions={<Field label="Action" className="w-full sm:w-56"><Select aria-label="Audit action filter" value={auditAction} onChange={(event) => setAuditAction(event.target.value)}><option value="all">All actions</option>{auditActions.map((action) => <option key={action} value={action}>{friendly(action)}</option>)}</Select></Field>} />
        <p role="status" className="text-xs font-medium tabular-nums text-text-secondary">{filteredEvents.length.toLocaleString()} {filteredEvents.length === 1 ? "event" : "events"}</p>
      </Card>
      {pagination.pagedItems.length ? <AuditList events={pagination.pagedItems} /> : <Card><EmptyState>{auditSearch || auditAction !== "all" ? "No audit events match the current filters." : "No audit events are available for this employee."}</EmptyState></Card>}
      <Pagination className="rounded-[10px] border border-brand-border" page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} />
    </div>
  );
}

function HistoryCard({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return <Card><SectionHeader title={title} />{items.length ? <ul className="mt-3 space-y-2">{children}</ul> : <EmptyState>{empty}</EmptyState>}</Card>;
}

function AssetSection({ title, description, items, empty, current = false }: { title: string; description: string; items: { asset: AssetRecord; allocation: AssetAllocationRecord }[]; empty: string; current?: boolean }) {
  return (
    <div className="min-w-0 space-y-3">
      <Card><SectionHeader title={title} description={description} /><p className="mt-3 text-xs font-medium tabular-nums text-text-secondary">{items.length.toLocaleString()} {items.length === 1 ? "record" : "records"} on this page</p></Card>
      {items.length ? <>
        <div className="hidden min-w-0 md:block"><TableShell><TableHead><tr><Th>Asset</Th><Th>Category</Th><Th>Identity</Th><Th>Issue date</Th>{current ? <><Th>Condition</Th><Th>Status</Th></> : <><Th>Return date</Th><Th>Issue / return condition</Th></>}</tr></TableHead><tbody>{items.map(({ asset, allocation }) => <tr key={allocation.id}><Td><ButtonLink href={`/assets/${asset.id}`} variant="secondary" size="compact">{asset.assetCode}</ButtonLink></Td><Td>{asset.category.name}</Td><Td className="max-w-64 break-all">{assetIdentity(asset)}</Td><Td>{allocation.issueDate}</Td>{current ? <><Td>{allocation.conditionAtIssue}</Td><Td><StatusBadge value={asset.outstanding ? "Outstanding" : asset.status} /></Td></> : <><Td>{allocation.returnDate ?? "—"}</Td><Td>{allocation.conditionAtIssue} / {allocation.returnCondition ?? "—"}</Td></>}</tr>)}</tbody></TableShell></div>
        <div className="grid min-w-0 gap-2 md:hidden" data-testid={current ? "current-asset-cards" : "returned-asset-cards"}>{items.map(({ asset, allocation }) => <Card key={allocation.id} className="!p-3"><div className="flex min-w-0 items-start justify-between gap-2"><ButtonLink href={`/assets/${asset.id}`} variant="secondary" size="compact">{asset.assetCode}</ButtonLink><StatusBadge value={current ? asset.outstanding ? "Outstanding" : asset.status : "Returned"} /></div><p className="mt-3 break-words text-sm font-medium text-text-primary">{asset.category.name}</p><p className="mt-1 break-all text-xs text-text-secondary">{assetIdentity(asset)}</p><dl className="mt-3 grid grid-cols-2 gap-3 border-t border-brand-border pt-3 text-xs"><Definition label="Issued">{allocation.issueDate}</Definition><Definition label={current ? "Condition" : "Returned"}>{current ? allocation.conditionAtIssue : allocation.returnDate ?? "—"}</Definition></dl></Card>)}</div>
      </> : <Card><EmptyState>{empty}</EmptyState></Card>}
    </div>
  );
}

function AuditList({ events }: { events: AuditEvent[] }) {
  return <>
    <div className="hidden min-w-0 md:block"><TableShell><TableHead><tr><Th>Date</Th><Th>Action</Th><Th>Recorded change</Th></tr></TableHead><tbody>{events.map((event) => <tr key={event.id}><Td className="whitespace-nowrap">{formatDateTime(event.createdAt)}</Td><Td><span className="font-medium">{friendly(event.action)}</span><span className="mt-0.5 block font-mono text-[11px] text-text-disabled">{event.action}</span></Td><Td className="max-w-xl"><AuditChange event={event} /></Td></tr>)}</tbody></TableShell></div>
    <div className="grid min-w-0 gap-2 md:hidden" data-testid="audit-event-cards">{events.map((event) => <Card key={event.id} className="!p-3"><div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><p className="font-medium text-text-primary">{friendly(event.action)}</p><time className="text-xs text-text-secondary">{formatDateTime(event.createdAt)}</time></div><p className="mt-1 break-all font-mono text-[11px] text-text-disabled">{event.action}</p><div className="mt-3 border-t border-brand-border pt-3"><AuditChange event={event} /></div></Card>)}</div>
  </>;
}

function AuditChange({ event }: { event: AuditEvent }) {
  const oldEntries = Object.entries(event.oldValues ?? {});
  const newEntries = Object.entries(event.newValues ?? {});
  if (!oldEntries.length && !newEntries.length) return <span className="text-xs text-text-secondary">Event recorded without field values.</span>;
  return <div className="grid min-w-0 gap-2 text-xs sm:grid-cols-2"><div className="min-w-0"><span className="font-medium text-text-secondary">Before</span><p className="mt-1 break-words text-text-primary">{oldEntries.length ? oldEntries.map(([key, value]) => `${friendly(key)}: ${String(value ?? "—")}`).join(" · ") : "—"}</p></div><div className="min-w-0"><span className="font-medium text-text-secondary">After</span><p className="mt-1 break-words text-text-primary">{newEntries.length ? newEntries.map(([key, value]) => `${friendly(key)}: ${String(value ?? "—")}`).join(" · ") : "—"}</p></div></div>;
}
