"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { IconEdit, IconPower, IconX } from "@/components/icons";
import { OrganizationDeleteDialog } from "@/components/organization-delete-dialog";
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
import { ApiClientError, apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import { canReadOrganization } from "@/lib/role-access";
import type { ManagerOption, OrgRef } from "@/lib/types";

type MasterTab = "offices" | "departments" | "business-units" | "teams" | "designations";
type MasterRecord = OrgRef & { officeId?: string; departmentId?: string; businessUnitId?: string | null };
type DrawerState = { kind: MasterTab; mode: "create" | "edit"; item?: MasterRecord } | null;
type StatusTarget = { kind: MasterTab; item: MasterRecord } | null;
type FieldErrors = Partial<Record<"name" | "code" | "office" | "department" | "businessUnit", string>>;

const MASTER_TABS: MasterTab[] = ["offices", "departments", "business-units", "teams", "designations"];
const EMPTY_FILTERS: Record<MasterTab, string> = {
  "business-units": "",
  offices: "",
  departments: "",
  teams: "",
  designations: "",
};
const ALL_STATUSES: Record<MasterTab, string> = {
  "business-units": "all",
  offices: "all",
  departments: "all",
  teams: "all",
  designations: "all",
};
const MASTER_CONFIG: Record<
  MasterTab,
  {
    label: string;
    singular: string;
    description: string;
    permission: string;
    endpoint: string;
  }
> = {
  "business-units": {
    label: "Business Units", singular: "Business Unit",
    description: "Maintain Business Units within their office and department.",
    permission: "Departments.Manage", endpoint: "/api/v1/business-units",
  },
  offices: {
    label: "Offices",
    singular: "Office",
    description: "Maintain the independent office locations available across the organization.",
    permission: "Offices.Manage",
    endpoint: "/api/v1/offices",
  },
  departments: {
    label: "Departments",
    singular: "Department",
    description: "Maintain departments within an explicitly selected office.",
    permission: "Departments.Manage",
    endpoint: "/api/v1/departments",
  },
  teams: {
    label: "Teams",
    singular: "Team",
    description: "Maintain teams within their office, department, and Business Unit.",
    permission: "Teams.Manage",
    endpoint: "/api/v1/teams",
  },
  designations: {
    label: "Designations",
    singular: "Designation",
    description: "Maintain the standalone job designations used on employee records.",
    permission: "Designations.Manage",
    endpoint: "/api/v1/designations",
  },
};

function normalizedStatus(item: MasterRecord) {
  return (item.status ?? "active").toLowerCase();
}

function readTabFromUrl(): MasterTab {
  const value = new URLSearchParams(window.location.search).get("tab");
  return MASTER_TABS.includes(value as MasterTab) ? (value as MasterTab) : "offices";
}

function InlineError({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs font-medium text-danger">
      {children}
    </p>
  );
}

export default function OrganizationPage() {
  const { can, user } = useAuth();
  const api = getBrowserApiUrl();
  const drawerRef = useRef<HTMLElement>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);
  const [offices, setOffices] = useState<MasterRecord[]>([]);
  const [departments, setDepartments] = useState<MasterRecord[]>([]);
  const [designations, setDesignations] = useState<MasterRecord[]>([]);
  const [teams, setTeams] = useState<MasterRecord[]>([]);
  const [businessUnits, setBusinessUnits] = useState<MasterRecord[]>([]);
  const [businessUnitId, setBusinessUnitId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ kind: MasterTab; item: MasterRecord; trigger: HTMLElement } | null>(null);
  const [leadersByTeam, setLeadersByTeam] = useState<Record<string, ManagerOption[]>>({});
  const [activeTab, setActiveTab] = useState<MasterTab>("offices");
  const [searches, setSearches] = useState<Record<MasterTab, string>>(EMPTY_FILTERS);
  const [statuses, setStatuses] = useState<Record<MasterTab, string>>(ALL_STATUSES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState("");
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [drawerDirty, setDrawerDirty] = useState(false);
  const [drawerError, setDrawerError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<StatusTarget>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [officeId, setOfficeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const canManageTeams = can("Teams.Manage");

  const refresh = useCallback(async () => {
    const [officeData, departmentData, designationData, teamData, unitData] = await Promise.all([
      apiGet<{ items: MasterRecord[] }>("/api/v1/offices?includeInactive=true", api),
      apiGet<{ items: MasterRecord[] }>("/api/v1/departments?includeInactive=true", api),
      apiGet<{ items: MasterRecord[] }>("/api/v1/designations?includeInactive=true", api),
      apiGet<{ items: MasterRecord[] }>("/api/v1/teams?includeInactive=true", api),
      apiGet<{ items: MasterRecord[] }>("/api/v1/business-units?includeInactive=true", api),
    ]);
    setOffices(officeData.items);
    setDepartments(departmentData.items);
    setDesignations(designationData.items);
    setTeams(teamData.items);
    setBusinessUnits(unitData.items);
    if (canManageTeams) {
      const leaders = await Promise.all(
        teamData.items.map(async (team) => {
          const data = await apiGet<{ items: ManagerOption[] }>(
            `/api/v1/teams/${team.id}/eligible-leaders`,
            api,
          );
          return [team.id, data.items] as const;
        }),
      );
      setLeadersByTeam(Object.fromEntries(leaders));
    }
  }, [api, canManageTeams]);

  useEffect(() => {
    setActiveTab(readTabFromUrl());
    const params = new URLSearchParams(window.location.search);
    if (!MASTER_TABS.includes(params.get("tab") as MasterTab)) {
      params.set("tab", "offices");
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    }
    function restoreTab() {
      setActiveTab(readTabFromUrl());
    }
    window.addEventListener("popstate", restoreTab);
    void refresh()
      .catch((caught: unknown) => {
        setPageError(caught instanceof Error ? caught.message : "Organization masters could not be loaded.");
      })
      .finally(() => setLoading(false));
    return () => window.removeEventListener("popstate", restoreTab);
  }, [refresh]);

  const itemsByTab = useMemo<Record<MasterTab, MasterRecord[]>>(
    () => ({ offices, departments, "business-units": businessUnits, teams, designations }),
    [departments, designations, offices, teams, businessUnits],
  );
  const officeById = useMemo(() => new Map(offices.map((item) => [item.id, item])), [offices]);
  const departmentById = useMemo(
    () => new Map(departments.map((item) => [item.id, item])),
    [departments],
  );
  const drawerDepartments = useMemo(
    () => departments.filter((item) => item.officeId === officeId && normalizedStatus(item) === "active"),
    [departments, officeId],
  );
  const currentConfig = MASTER_CONFIG[activeTab];
  const currentSearch = searches[activeTab];
  const currentStatus = statuses[activeTab];
  const filteredItems = useMemo(() => {
    const query = currentSearch.trim().toLowerCase();
    return itemsByTab[activeTab].filter((item) => {
      if (currentStatus !== "all" && normalizedStatus(item) !== currentStatus) return false;
      if (!query) return true;
      const office = item.officeId ? officeById.get(item.officeId) : undefined;
      const department = item.departmentId ? departmentById.get(item.departmentId) : undefined;
      return [item.code, item.name, office?.code, office?.name, department?.code, department?.name]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    });
  }, [activeTab, currentSearch, currentStatus, departmentById, itemsByTab, officeById]);
  const pagination = useClientPagination(
    filteredItems,
    `${activeTab}:${currentSearch}:${currentStatus}`,
  );

  useEffect(() => {
    if (!drawer) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || saving) return;
      event.preventDefault();
      if (discardConfirmOpen) setDiscardConfirmOpen(false);
      else if (drawerDirty) setDiscardConfirmOpen(true);
      else {
        setDrawer(null);
        setDiscardConfirmOpen(false);
        setName("");
        setCode("");
        setOfficeId("");
        setDepartmentId("");
        setDrawerDirty(false);
        setDrawerError("");
        setFieldErrors({});
        window.setTimeout(() => {
          if (drawerTriggerRef.current?.isConnected) drawerTriggerRef.current.focus();
        }, 0);
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [discardConfirmOpen, drawer, drawerDirty, saving]);

  useEffect(() => {
    if (!drawerDirty) return;
    function preventUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [drawerDirty]);

  function selectTab(nextTab: MasterTab) {
    if (nextTab === activeTab) return;
    setActiveTab(nextTab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", nextTab);
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  function updateSearch(value: string) {
    setSearches((current) => ({ ...current, [activeTab]: value }));
  }

  function updateStatus(value: string) {
    setStatuses((current) => ({ ...current, [activeTab]: value }));
  }

  function resetDrawerForm() {
    setName("");
    setCode("");
    setOfficeId("");
    setDepartmentId("");
    setDrawerDirty(false);
    setDrawerError("");
    setFieldErrors({});
  }

  function openCreate(kind: MasterTab, trigger: HTMLElement) {
    drawerTriggerRef.current = trigger;
    resetDrawerForm();
    setBusinessUnitId("");
    setDrawer({ kind, mode: "create" });
  }

  function openEdit(kind: MasterTab, item: MasterRecord, trigger: HTMLElement) {
    drawerTriggerRef.current = trigger;
    resetDrawerForm();
    setName(item.name);
    setCode(item.code);
    setOfficeId(item.officeId ?? "");
    setDepartmentId(item.departmentId ?? "");
    setBusinessUnitId(item.businessUnitId ?? "");
    setDrawer({ kind, mode: "edit", item });
  }

  function closeDrawer() {
    setDrawer(null);
    setDiscardConfirmOpen(false);
    resetDrawerForm();
    window.setTimeout(() => {
      if (drawerTriggerRef.current?.isConnected) drawerTriggerRef.current.focus();
    }, 0);
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
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
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

  function validateDrawer() {
    if (!drawer) return false;
    const errors: FieldErrors = {};
    if (drawer.kind === "business-units") {
      if (!officeId) errors.office = "Select an office.";
      if (!departmentId) errors.department = "Select a department.";
    }
    if (drawer.kind === "teams" && !businessUnitId && (drawer.mode === "create" || drawer.item?.businessUnitId)) errors.businessUnit = "Select a Business Unit.";
    if (!name.trim()) {
      const article = drawer.kind === "offices" ? "an" : "a";
      errors.name = `Enter ${article} ${MASTER_CONFIG[drawer.kind].singular.toLowerCase()} name.`;
    }
    else if (name.trim().length > 120) errors.name = "Name cannot exceed 120 characters.";
    if (drawer.mode === "create") {
      if (!code.trim()) errors.code = "Enter an immutable code.";
      else if (code.trim().length > 32) errors.code = "Code cannot exceed 32 characters.";
      if ((drawer.kind === "departments" || drawer.kind === "teams") && !officeId) {
        errors.office = "Select an office.";
      }
      if (drawer.kind === "teams" && !departmentId) errors.department = "Select a department.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function saveMaster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!drawer || !validateDrawer()) return;
    const config = MASTER_CONFIG[drawer.kind];
    setSaving(true);
    setDrawerError("");
    setFieldErrors({});
    try {
      if (drawer.mode === "edit" && drawer.item) {
        await apiRequest(`${config.endpoint}/${drawer.item.id}`, api, {
          method: "PATCH",
          body: JSON.stringify({ name: name.trim(), ...(drawer.kind === "business-units" ? { office_id: officeId, department_id: departmentId } : {}), ...(drawer.kind === "teams" && businessUnitId ? { business_unit_id: businessUnitId } : {}) }),
        });
      } else {
        const body: Record<string, string> = {
          name: name.trim(),
          code: code.trim().toUpperCase(),
        };
        if (["departments", "business-units", "teams"].includes(drawer.kind)) body.office_id = officeId;
        if (["business-units", "teams"].includes(drawer.kind)) body.department_id = departmentId;
        if (drawer.kind === "teams") body.business_unit_id = businessUnitId;
        await apiRequest(config.endpoint, api, { method: "POST", body: JSON.stringify(body) });
      }
      await refresh();
      closeDrawer();
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        const errorCode = caught.body?.error?.code ?? "";
        if (errorCode.endsWith("_CODE_DUPLICATE")) setFieldErrors({ code: caught.message });
        else if (errorCode === "TEAM_ORG_MISMATCH") setFieldErrors({ department: caught.message });
        else setDrawerError(caught.message);
      } else {
        setDrawerError(caught instanceof Error ? caught.message : "Save failed.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus() {
    if (!statusTarget) return;
    const { item, kind } = statusTarget;
    const action = normalizedStatus(item) === "active" ? "deactivate" : "activate";
    setSaving(true);
    setPageError("");
    try {
      await apiRequest(`${MASTER_CONFIG[kind].endpoint}/${item.id}/${action}`, api, { method: "POST" });
      await refresh();
      setStatusTarget(null);
    } catch (caught) {
      setPageError(caught instanceof Error ? caught.message : "Status update failed.");
    } finally {
      setSaving(false);
    }
  }

  async function assignLeader(teamId: string, userId: string) {
    setPageError("");
    try {
      await apiRequest(`/api/v1/teams/${teamId}/leader`, api, {
        method: "PUT",
        body: JSON.stringify({ user_id: userId || null }),
      });
      await refresh();
    } catch (caught) {
      setPageError(caught instanceof Error ? caught.message : "Team leader update failed.");
    }
  }

  const drawerConfig = drawer ? MASTER_CONFIG[drawer.kind] : null;
  const drawerTitle = drawerConfig
    ? `${drawer?.mode === "edit" ? "Edit" : "Add"} ${drawerConfig.singular.toLowerCase()}`
    : "Organization master";
  const drawerDescription = drawerConfig
    ? drawer?.mode === "edit"
      ? `Update the display name. The ${drawerConfig.singular.toLowerCase()} code remains immutable.`
      : `Create a ${drawerConfig.singular.toLowerCase()} for authorized organization workflows.`
    : "";

  if (!canReadOrganization(user)) {
    return <ErrorText>Organization access is not available for this user type.</ErrorText>;
  }

  return (
    <section className="min-w-0 space-y-4">
      <PageHeader
        title="Organization masters"
        description="Manage offices, departments, Business Units, teams, and designations from one focused workspace."
        actions={
          can("Users.View") ? (
            <ButtonLink href="/organization/hierarchy" variant="secondary">
              View hierarchy
            </ButtonLink>
          ) : null
        }
      />
      <ErrorText>{pageError}</ErrorText>

      {loading ? (
        <LoadingState>Loading organization masters…</LoadingState>
      ) : (
        <>
          <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-5" aria-label="Organization master summary">
            {MASTER_TABS.map((kind) => {
              const items = itemsByTab[kind];
              const activeCount = items.filter((item) => normalizedStatus(item) === "active").length;
              return (
                <Card key={kind} className="!p-3">
                  <p className="text-xs font-medium text-text-secondary">{MASTER_CONFIG[kind].label}</p>
                  <div className="mt-1 flex items-end justify-between gap-2">
                    <p className="text-xl font-semibold tabular-nums text-text-primary">{items.length}</p>
                    <p className="text-xs text-text-disabled">{activeCount} active</p>
                  </div>
                </Card>
              );
            })}
          </div>

          <div
            role="tablist"
            aria-label="Organization masters"
            className="grid min-w-0 grid-cols-2 gap-1 rounded-[10px] border border-brand-border bg-surface p-1 sm:flex"
          >
            {MASTER_TABS.map((kind) => (
              <button
                key={kind}
                id={`organization-tab-${kind}`}
                type="button"
                role="tab"
                aria-controls={`organization-panel-${kind}`}
                aria-selected={activeTab === kind}
                className={cx(
                  "h-8 min-w-0 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary sm:flex-1",
                  activeTab === kind
                    ? "bg-brand-primary text-white"
                    : "text-text-secondary hover:bg-brand-soft hover:text-brand-primary",
                )}
                onClick={() => selectTab(kind)}
              >
                {MASTER_CONFIG[kind].label}
              </button>
            ))}
          </div>

          <section
            id={`organization-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`organization-tab-${activeTab}`}
            className="min-w-0 space-y-3"
          >
            <Card className="space-y-3">
              <SectionHeader
                title={currentConfig.label}
                description={currentConfig.description}
                actions={
                  can(currentConfig.permission) ? (
                    <Button type="button" onClick={(event) => openCreate(activeTab, event.currentTarget)}>
                      Add {currentConfig.singular.toLowerCase()}
                    </Button>
                  ) : null
                }
              />
              <SearchActionBar
                search={
                  <Field label={`Search ${currentConfig.label.toLowerCase()}`} htmlFor="organization-search">
                    <TextInput
                      id="organization-search"
                      value={currentSearch}
                      placeholder="Search by code, name, or parent"
                      onChange={(event) => updateSearch(event.target.value)}
                    />
                  </Field>
                }
                actions={
                  <Field label="Status" htmlFor="organization-status" className="w-full sm:w-44">
                    <Select
                      id="organization-status"
                      aria-label={`${currentConfig.label} status filter`}
                      value={currentStatus}
                      onChange={(event) => updateStatus(event.target.value)}
                    >
                      <option value="all">All statuses</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </Select>
                  </Field>
                }
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
                <p role="status" aria-live="polite" className="font-medium tabular-nums">
                  {filteredItems.length.toLocaleString()} {filteredItems.length === 1 ? "row" : "rows"}
                </p>
                {(currentSearch || currentStatus !== "all") && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="compact"
                    onClick={() => {
                      updateSearch("");
                      updateStatus("all");
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            </Card>

            {pagination.pagedItems.length ? (
              <MasterList
                kind={activeTab}
                items={pagination.pagedItems}
                officeById={officeById}
                departmentById={departmentById}
                businessUnitById={new Map(businessUnits.map((item) => [item.id, item]))}
                canDelete={user?.userType?.code === "OWNER"}
                onDelete={(kind, item, trigger) => setDeleteTarget({ kind, item, trigger })}
                canManage={can(currentConfig.permission)}
                leadersByTeam={leadersByTeam}
                onAssignLeader={(teamId, userId) => void assignLeader(teamId, userId)}
                onEdit={openEdit}
                onStatus={setStatusTarget}
              />
            ) : (
              <Card>
                <EmptyState>
                  {currentSearch || currentStatus !== "all"
                    ? `No ${currentConfig.label.toLowerCase()} match the current filters.`
                    : `No ${currentConfig.label.toLowerCase()} are available yet.`}
                </EmptyState>
              </Card>
            )}
            <Pagination
              className="rounded-[10px] border border-brand-border"
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={pagination.total}
              totalPages={pagination.totalPages}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
            />
          </section>
        </>
      )}

      {deleteTarget ? <OrganizationDeleteDialog endpoint={MASTER_CONFIG[deleteTarget.kind].endpoint} api={api} item={deleteTarget.item} trigger={deleteTarget.trigger} onClose={() => setDeleteTarget(null)} onDeleted={async () => {
        try { await refresh(); }
        catch { setPageError("The unused record was deleted and its history retained, but the list could not refresh. Reload this page."); }
      }} /> : null}

      {drawer && drawerConfig ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/40"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) requestDrawerClose();
          }}
        >
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="organization-drawer-title"
            aria-describedby="organization-drawer-description"
            className="flex h-full w-full min-w-0 flex-col bg-surface shadow-2xl sm:max-w-xl"
            onKeyDown={trapDrawerFocus}
          >
            <div className="flex items-start justify-between gap-3 border-b border-brand-border px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 id="organization-drawer-title" className="text-[length:var(--amafh-text-section)] font-semibold text-text-primary">
                  {drawerTitle}
                </h2>
                <p id="organization-drawer-description" className="mt-0.5 text-sm text-text-secondary">
                  {drawerDescription}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close organization drawer"
                onClick={requestDrawerClose}
              >
                <IconX className="size-4" />
              </Button>
            </div>

            <form id="organization-master-form" className="min-h-0 flex-1 overflow-y-auto" noValidate onSubmit={saveMaster}>
              <div className="space-y-4 px-4 py-4 sm:px-5">
                {((drawer.mode === "create" && (drawer.kind === "departments" || drawer.kind === "teams")) || drawer.kind === "business-units") ? (
                  <Field label="Office" htmlFor="master-office" help="Choose the office that owns this organization master.">
                    <Select
                      id="master-office"
                      aria-label="Office"
                      autoFocus
                      error={Boolean(fieldErrors.office)}
                      aria-describedby={fieldErrors.office ? "master-office-error" : undefined}
                      value={officeId}
                      onChange={(event) => {
                        setOfficeId(event.target.value);
                        setDepartmentId("");
                        setBusinessUnitId("");
                        setFieldErrors((current) => ({ ...current, office: undefined, department: undefined }));
                        setDrawerDirty(true);
                      }}
                    >
                      <option value="">Select office</option>
                      {offices
                        .filter((item) => normalizedStatus(item) === "active")
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} ({item.code})
                          </option>
                        ))}
                    </Select>
                    <InlineError id="master-office-error">{fieldErrors.office}</InlineError>
                  </Field>
                ) : null}

                {((drawer.mode === "create" && drawer.kind === "teams") || drawer.kind === "business-units") ? (
                  <Field label="Department" htmlFor="master-department" help="Only departments in the selected office are available.">
                    <Select
                      id="master-department"
                      aria-label="Department"
                      disabled={!officeId}
                      error={Boolean(fieldErrors.department)}
                      aria-describedby={fieldErrors.department ? "master-department-error" : undefined}
                      value={departmentId}
                      onChange={(event) => {
                        setDepartmentId(event.target.value);
                        setBusinessUnitId("");
                        setFieldErrors((current) => ({ ...current, department: undefined }));
                        setDrawerDirty(true);
                      }}
                    >
                      <option value="">Select department</option>
                      {drawerDepartments.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.code})
                        </option>
                      ))}
                    </Select>
                    <InlineError id="master-department-error">{fieldErrors.department}</InlineError>
                    {officeId && !drawerDepartments.length ? (
                      <p className="mt-1 text-xs text-text-secondary">No active departments are available for this office.</p>
                    ) : null}
                  </Field>
                ) : null}

                {drawer.kind === "teams" ? <Field label="Business Unit" htmlFor="master-business-unit" help="Only Business Units in the selected office and department are available.">
                  <Select id="master-business-unit" aria-label="Business Unit" disabled={!officeId || !departmentId} value={businessUnitId} error={Boolean(fieldErrors.businessUnit)} aria-describedby={fieldErrors.businessUnit ? "master-business-unit-error" : undefined} onChange={(event) => { setBusinessUnitId(event.target.value); setDrawerDirty(true); }}>
                    <option value="">Select Business Unit</option>
                    {businessUnits.filter((unit) => unit.officeId === officeId && unit.departmentId === departmentId && (normalizedStatus(unit) === "active" || unit.id === businessUnitId)).map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.code})</option>)}
                  </Select>
                  <InlineError id="master-business-unit-error">{fieldErrors.businessUnit}</InlineError>
                  {drawer.mode === "edit" && !drawer.item?.businessUnitId ? <p className="mt-1 text-xs text-text-secondary">Existing Team is unmapped. Select its correct Business Unit explicitly; employee assignments are not guessed or changed.</p> : null}
                </Field> : null}

                <Field label={`${drawerConfig.singular} name`} htmlFor="master-name" help="Use the business-facing label shown throughout AMAFH CORE.">
                  <TextInput
                    id="master-name"
                    aria-label={`${drawerConfig.singular} name`}
                    autoFocus={drawer.mode === "edit" || drawer.kind === "offices" || drawer.kind === "designations"}
                    maxLength={120}
                    required
                    error={Boolean(fieldErrors.name)}
                    aria-describedby={fieldErrors.name ? "master-name-error" : "master-name-help"}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setFieldErrors((current) => ({ ...current, name: undefined }));
                      setDrawerDirty(true);
                    }}
                  />
                  <p id="master-name-help" className="mt-1 text-xs text-text-secondary">Required · maximum 120 characters.</p>
                  <InlineError id="master-name-error">{fieldErrors.name}</InlineError>
                </Field>

                <Field label="Immutable code" htmlFor="master-code" help="The code is normalized to uppercase and cannot be changed after creation.">
                  <TextInput
                    id="master-code"
                    aria-label="Immutable code"
                    maxLength={32}
                    required
                    disabled={drawer.mode === "edit"}
                    error={Boolean(fieldErrors.code)}
                    aria-describedby={fieldErrors.code ? "master-code-error" : "master-code-help"}
                    value={code}
                    onChange={(event) => {
                      setCode(event.target.value.toUpperCase());
                      setFieldErrors((current) => ({ ...current, code: undefined }));
                      setDrawerDirty(true);
                    }}
                  />
                  <p id="master-code-help" className="mt-1 text-xs text-text-secondary">
                    {drawer.mode === "edit" ? "This permanent identifier cannot be edited." : "Required · maximum 32 characters · saved in uppercase."}
                  </p>
                  <InlineError id="master-code-error">{fieldErrors.code}</InlineError>
                </Field>

                {drawerError ? <ErrorText>{drawerError}</ErrorText> : null}
              </div>
            </form>

            <div className="sticky bottom-0 border-t border-brand-border bg-surface px-4 py-3 sm:px-5">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-text-secondary">{drawerDirty ? "Unsaved changes" : "No staged changes"}</p>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" disabled={saving} onClick={requestDrawerClose}>Cancel</Button>
                  <Button type="submit" form="organization-master-form" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {discardConfirmOpen ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4" role="presentation">
          <section role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-description" className="w-full max-w-md rounded-[10px] border border-brand-border bg-surface p-4 shadow-2xl">
            <h2 id="discard-title" className="text-[length:var(--amafh-text-section)] font-semibold text-text-primary">Discard unsaved changes?</h2>
            <p id="discard-description" className="mt-2 text-sm text-text-secondary">Your organization master changes will be lost.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" autoFocus onClick={() => setDiscardConfirmOpen(false)}>Keep editing</Button>
              <Button type="button" variant="danger" onClick={closeDrawer}>Discard changes</Button>
            </div>
          </section>
        </div>
      ) : null}

      {statusTarget ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4" role="presentation">
          <section role="alertdialog" aria-modal="true" aria-labelledby="status-title" aria-describedby="status-description" className="w-full max-w-md rounded-[10px] border border-brand-border bg-surface p-4 shadow-2xl">
            <h2 id="status-title" className="text-[length:var(--amafh-text-section)] font-semibold text-text-primary">
              {normalizedStatus(statusTarget.item) === "active" ? "Deactivate" : "Activate"} {MASTER_CONFIG[statusTarget.kind].singular.toLowerCase()}?
            </h2>
            <p id="status-description" className="mt-2 text-sm text-text-secondary">
              {statusTarget.item.name} ({statusTarget.item.code}) will be marked as {normalizedStatus(statusTarget.item) === "active" ? "inactive" : "active"}.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={saving} onClick={() => setStatusTarget(null)}>Cancel</Button>
              <Button type="button" variant={normalizedStatus(statusTarget.item) === "active" ? "danger" : "primary"} disabled={saving} onClick={() => void changeStatus()}>
                {saving ? "Working…" : normalizedStatus(statusTarget.item) === "active" ? "Deactivate" : "Activate"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function MasterList({ kind, items, officeById, departmentById, businessUnitById, canManage, canDelete, leadersByTeam, onAssignLeader, onEdit, onStatus, onDelete }: {
  kind: MasterTab;
  items: MasterRecord[];
  officeById: Map<string, MasterRecord>;
  departmentById: Map<string, MasterRecord>;
  businessUnitById: Map<string, MasterRecord>;
  canDelete: boolean;
  onDelete: (kind: MasterTab, item: MasterRecord, trigger: HTMLElement) => void;
  canManage: boolean;
  leadersByTeam: Record<string, ManagerOption[]>;
  onAssignLeader: (teamId: string, userId: string) => void;
  onEdit: (kind: MasterTab, item: MasterRecord, trigger: HTMLElement) => void;
  onStatus: (target: Exclude<StatusTarget, null>) => void;
}) {
  return (
    <>
      <div className="hidden min-w-0 md:block">
        <TableShell>
          <TableHead><tr><Th>Code</Th><Th>Name</Th>{(kind === "departments" || kind === "teams") && <Th>Office</Th>}{kind === "teams" && <Th>Department</Th>}<Th>Status</Th>{kind === "teams" && <Th>Team leader</Th>}{canManage && <Th className="text-right">Actions</Th>}</tr></TableHead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <Td className="font-mono text-xs font-semibold">{item.code}</Td>
                <Td className="font-medium">{item.name}{kind === "business-units" ? <p className="text-xs text-text-secondary">{officeById.get(item.officeId ?? "")?.name} · {departmentById.get(item.departmentId ?? "")?.name}</p> : null}{kind === "teams" ? <p className="text-xs text-text-secondary">Business Unit: {businessUnitById.get(item.businessUnitId ?? "")?.name ?? "Not assigned"}</p> : null}</Td>
                {(kind === "departments" || kind === "teams") && <Td>{item.officeId ? officeById.get(item.officeId)?.name ?? "Unavailable" : "—"}</Td>}
                {kind === "teams" && <Td>{item.departmentId ? departmentById.get(item.departmentId)?.name ?? "Unavailable" : "—"}</Td>}
                <Td><StatusBadge value={normalizedStatus(item)} /></Td>
                {kind === "teams" && (
                  <Td className="min-w-48">
                    {canManage ? (
                      <Select aria-label={`Team leader for ${item.code}`} className="!mt-0" value={item.teamLeaderId ?? ""} onChange={(event) => onAssignLeader(item.id, event.target.value)}>
                        <option value="">No team leader</option>
                        {(leadersByTeam[item.id] ?? []).map((leader) => <option key={leader.id} value={leader.id}>{leader.userCode} — {leader.fullName}</option>)}
                      </Select>
                    ) : item.teamLeaderId ?? "None"}
                  </Td>
                )}
                {canManage && (
                  <Td><div className="flex justify-end gap-1">
                    <Button type="button" variant="ghost" size="compact" onClick={(event) => onEdit(kind, item, event.currentTarget)}><IconEdit className="size-4" /> Edit</Button>
                    <Button type="button" variant="secondary" size="compact" onClick={() => onStatus({ kind, item })}><IconPower className="size-4" />{normalizedStatus(item) === "active" ? "Deactivate" : "Activate"}</Button>
                    {canDelete ? <Button type="button" variant="danger" size="compact" aria-label={`Delete ${item.code}`} onClick={(event) => onDelete(kind, item, event.currentTarget)}>Delete</Button> : null}
                  </div></Td>
                )}
              </tr>
            ))}
          </tbody>
        </TableShell>
      </div>

      <div className="grid min-w-0 gap-2 md:hidden" data-testid="organization-mobile-list">
        {items.map((item) => (
          <Card key={item.id} className="!p-3">
            <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-semibold text-text-primary">{item.name}</p><p className="mt-0.5 break-all font-mono text-xs text-text-secondary">{item.code}</p></div><StatusBadge value={normalizedStatus(item)} /></div>
            {(kind === "departments" || kind === "teams") && <p className="mt-3 text-xs text-text-secondary"><span className="font-medium text-text-primary">Office:</span> {item.officeId ? officeById.get(item.officeId)?.name ?? "Unavailable" : "—"}</p>}
            {kind === "teams" && (
              <><p className="mt-1 text-xs text-text-secondary"><span className="font-medium text-text-primary">Department:</span> {item.departmentId ? departmentById.get(item.departmentId)?.name ?? "Unavailable" : "—"}</p>
                {canManage ? <Field label="Team leader" className="mt-3"><Select aria-label={`Team leader for ${item.code}`} value={item.teamLeaderId ?? ""} onChange={(event) => onAssignLeader(item.id, event.target.value)}><option value="">No team leader</option>{(leadersByTeam[item.id] ?? []).map((leader) => <option key={leader.id} value={leader.id}>{leader.userCode} — {leader.fullName}</option>)}</Select></Field> : null}
              </>
            )}
            {kind === "business-units" ? <p className="mt-2 text-xs text-text-secondary">{officeById.get(item.officeId ?? "")?.name} · {departmentById.get(item.departmentId ?? "")?.name}</p> : null}
            {kind === "teams" ? <p className="mt-2 text-xs text-text-secondary">Business Unit: {businessUnitById.get(item.businessUnitId ?? "")?.name ?? "Not assigned"}</p> : null}
            {canManage && <div className="mt-3 flex flex-wrap justify-end gap-1 border-t border-brand-border pt-3"><Button type="button" variant="ghost" size="compact" onClick={(event) => onEdit(kind, item, event.currentTarget)}><IconEdit className="size-4" /> Edit</Button><Button type="button" variant="secondary" size="compact" onClick={() => onStatus({ kind, item })}><IconPower className="size-4" />{normalizedStatus(item) === "active" ? "Deactivate" : "Activate"}</Button>{canDelete ? <Button type="button" variant="danger" size="compact" aria-label={`Delete ${item.code}`} onClick={(event) => onDelete(kind, item, event.currentTarget)}>Delete</Button> : null}</div>}
          </Card>
        ))}
      </div>
    </>
  );
}
