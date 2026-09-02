"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  IconAlertTriangle,
  IconArrowBack,
  IconChevronDown,
  IconInfoCircle,
  IconShieldLock,
} from "@/components/icons";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  DialogPanel,
  ErrorText,
  SectionHeader,
  Select,
  StatusBadge,
  TextInput,
  cx,
  focusRing,
} from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { UserTypeSummary } from "@/lib/types";

const SCOPES = ["company", "office", "team", "own"] as const;

type Permission = { code: string; description: string };
type PermissionFilter = "all" | "selected" | "unselected";
type Feedback = { tone: "success" | "error" | "neutral"; text: string };
type UserTypeDraft = {
  canBeReportingManager: boolean;
  canBeCaseOwner: boolean;
  visibilityScope: string;
  customerVisibilityScope: string;
  applicationVisibilityScope: string;
  reportingVisibilityScope: string;
};
type PermissionGroup = {
  key: string;
  label: string;
  description: string;
  items: Permission[];
  visibleItems: Permission[];
};
type BulkConfirmation = { label: string; permissions: Permission[] };

const PERMISSION_MODULES = [
  {
    key: "users",
    label: "Users",
    description: "User administration, User Types, security settings, and organization masters.",
    prefixes: ["Users.", "UserTypes.", "Security.", "Offices.", "Departments.", "Designations.", "Teams."],
  },
  {
    key: "customers",
    label: "Customers",
    description: "Customer records and identity-safe customer administration.",
    prefixes: ["Customers."],
  },
  {
    key: "banks-products",
    label: "Banks & Products",
    description: "Bank, product, and bank-product catalogue configuration.",
    prefixes: ["Banks.", "Products.", "BankProducts.", "ProductVariants."],
  },
  {
    key: "applications-workflow",
    label: "Applications & Workflow",
    description: "Application processing, outcomes, corrections, delays, and workflow configuration.",
    prefixes: ["Applications.", "WorkflowStages.", "Workflows."],
  },
  {
    key: "reports",
    label: "Reports",
    description: "Dashboard visibility, reporting, print, and approved export actions.",
    prefixes: ["Dashboard.", "Reports."],
  },
  {
    key: "attendance",
    label: "Attendance",
    description: "Attendance records, configuration, corrections, and reports.",
    prefixes: ["Attendance."],
  },
  {
    key: "notifications",
    label: "Notifications",
    description: "In-app notifications, rule management, urgent sends, and audit visibility.",
    prefixes: ["Notifications."],
  },
  {
    key: "targets",
    label: "Targets",
    description: "Targets, KPI scorecards, lifecycle controls, and locked periods.",
    prefixes: ["Targets."],
  },
  {
    key: "finance",
    label: "Finance",
    description: "Payout periods, audited adjustments, review, finalization, and commission rules.",
    prefixes: ["Finance."],
  },
  {
    key: "assets",
    label: "Assets",
    description: "Asset master data, stock, custody, allocations, transfers, returns, and audit.",
    prefixes: ["Assets."],
  },
] as const;

const SENSITIVE_PERMISSION_CODES = new Set([
  "Users.Deactivate",
  "Users.Unlock",
  "Users.AssignUserType",
  "Users.GenerateSetupLink",
  "Users.GenerateResetLink",
  "Users.ViewAudit",
  "UserTypes.Create",
  "UserTypes.Edit",
  "UserTypes.Activate",
  "UserTypes.Deactivate",
  "UserTypes.AssignPermissions",
  "UserTypes.AssignScope",
  "Security.ManageSettings",
  "Offices.Manage",
  "Departments.Manage",
  "Designations.Manage",
  "Teams.Manage",
  "Customers.Merge",
  "Applications.CorrectSubmittedData",
  "Applications.CorrectStage",
  "Applications.ReassignCaseOwner",
  "Applications.SetOutcome",
  "Applications.CorrectDelay",
  "WorkflowStages.ConfigureTransitions",
  "Workflows.MigrateApplication",
  "Reports.ExportExcel",
  "Reports.ExportPDF",
  "Reports.Print",
  "Attendance.Manage",
  "Attendance.Correct",
  "Notifications.ManageRules",
  "Notifications.SendUrgent",
  "Notifications.ViewAudit",
  "Targets.ReopenPeriod",
  "Finance.GeneratePayout",
  "Finance.EditAdjustment",
  "Finance.Review",
  "Finance.Finalize",
  "Finance.ReopenPeriod",
  "Finance.ManageCommissionRules",
  "Assets.ManageMaster",
  "Assets.ManageStock",
  "Assets.Allocate",
  "Assets.Transfer",
  "Assets.Return",
  "Assets.ManageStatus",
  "Assets.ViewAudit",
]);

const scopeHelp = {
  visibilityScope: "Controls which employee and user-directory records this type can view.",
  customerVisibilityScope: "Controls which customer records are visible to this type.",
  applicationVisibilityScope: "Controls which applications and workflows this type can access.",
  reportingVisibilityScope: "Controls the reporting population used by dashboards, reports, targets, and Finance.",
} as const;

const scopeTooltips = {
  visibilityScope:
    "Company shows all users. Office shows users in the same office. Team shows the user and reporting-line descendants. Own shows only the signed-in user; No scope also falls back to Own for the directory.",
  customerVisibilityScope:
    "Company shows all customers. Office, Team, and Own derive customers from applications by the current Case Owner's office, reporting hierarchy, or identity. No scope returns no customer records.",
  applicationVisibilityScope:
    "Company shows all applications. Office uses the current Case Owner's office. Team uses the reporting hierarchy. Own uses applications owned by the signed-in user. No scope returns no applications.",
  reportingVisibilityScope:
    "Company is company-wide. Office uses office assignment at the reporting event time. Team uses the reporting-manager hierarchy. Own uses personal performance. No scope returns no reporting data.",
} as const;

const scopeLabels: Record<keyof Pick<UserTypeDraft, "visibilityScope" | "customerVisibilityScope" | "applicationVisibilityScope" | "reportingVisibilityScope">, string> = {
  visibilityScope: "User Directory",
  customerVisibilityScope: "Customer",
  applicationVisibilityScope: "Application",
  reportingVisibilityScope: "Reporting",
};

function draftFrom(item: UserTypeSummary): UserTypeDraft {
  return {
    canBeReportingManager: Boolean(item.canBeReportingManager),
    canBeCaseOwner: Boolean(item.canBeCaseOwner),
    visibilityScope: item.visibilityScope ?? "",
    customerVisibilityScope: item.customerVisibilityScope ?? "",
    applicationVisibilityScope: item.applicationVisibilityScope ?? "",
    reportingVisibilityScope: item.reportingVisibilityScope ?? "",
  };
}

function samePermissions(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((code) => rightSet.has(code));
}

function displayStatus(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function displayScope(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "No scope";
}

function moduleFor(permission: Permission) {
  return PERMISSION_MODULES.find((definition) =>
    definition.prefixes.some((prefix) => permission.code.startsWith(prefix)),
  );
}

function countTone(selectedCount: number, totalCount: number): "neutral" | "blue" | "green" {
  if (selectedCount === 0) return "neutral";
  if (selectedCount === totalCount) return "green";
  return "blue";
}

function InfoTooltip({
  id,
  label,
  text,
  align = "left",
}: {
  id: string;
  label: string;
  text: string;
  align?: "left" | "right";
}) {
  return (
    <span className="group relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className={cx("rounded text-slate-400 hover:text-slate-700", focusRing)}
      >
        <IconInfoCircle className="size-4" />
      </button>
      <span
        id={id}
        role="tooltip"
        className={cx(
          "pointer-events-none invisible absolute top-full z-40 mt-2 w-72 rounded-lg bg-slate-950 px-3 py-2 text-left text-xs font-normal leading-5 text-white opacity-0 shadow-xl transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100",
          align === "right" ? "right-0" : "left-0",
        )}
      >
        {text}
      </span>
    </span>
  );
}

function SystemTypeBadge() {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label="About System Type restrictions"
        aria-describedby="system-type-restrictions"
        className={cx("rounded-md", focusRing)}
      >
        <Badge tone="blue">System Type</Badge>
      </button>
      <span
        id="system-type-restrictions"
        role="tooltip"
        className="pointer-events-none invisible absolute right-0 top-full z-40 mt-2 w-72 rounded-lg bg-slate-950 px-3 py-2 text-left text-xs font-normal leading-5 text-white opacity-0 shadow-xl transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        System User Types keep their seeded identity details and reporting-manager eligibility locked.
        Existing separately authorized case-owner, scope, and permission controls remain available.
        OWNER has additional full-access protection.
      </span>
    </span>
  );
}

function SwitchControl({
  id,
  label,
  description,
  checked,
  disabled,
  disabledReason,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  disabledReason?: string;
  onChange: (checked: boolean) => void;
}) {
  const descriptionId = `${id}-description`;
  const reasonId = `${id}-reason`;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label htmlFor={id} className="text-sm font-medium text-slate-900">
            {label}
          </label>
          <p id={descriptionId} className="mt-0.5 text-xs leading-4 text-slate-500">
            {description}
          </p>
        </div>
        <label className={cx("relative mt-0.5 inline-flex shrink-0", disabled ? "cursor-not-allowed" : "cursor-pointer") }>
          <input
            id={id}
            type="checkbox"
            role="switch"
            className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            checked={checked}
            disabled={disabled}
            aria-describedby={disabledReason ? `${descriptionId} ${reasonId}` : descriptionId}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span
            aria-hidden="true"
            className={cx(
              "flex h-5 w-9 items-center rounded-full p-0.5 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[#0f4c81] peer-focus-visible:ring-offset-2",
              checked ? "bg-[#0f4c81]" : "bg-slate-300",
              disabled && "opacity-55",
            )}
          >
            <span
              className={cx(
                "size-4 rounded-full bg-white shadow-sm transition-transform",
                checked && "translate-x-4",
              )}
            />
          </span>
        </label>
      </div>
      {disabledReason ? (
        <p id={reasonId} className="mt-2 flex items-start gap-1.5 text-xs leading-4 text-amber-700">
          <IconShieldLock className="mt-px size-3.5 shrink-0" />
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}

export default function UserTypeDetailPage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const [item, setItem] = useState<UserTypeSummary | null>(null);
  const [draft, setDraft] = useState<UserTypeDraft | null>(null);
  const [catalog, setCatalog] = useState<Permission[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [permissionQuery, setPermissionQuery] = useState("");
  const [permissionFilter, setPermissionFilter] = useState<PermissionFilter>("all");
  const [activeModuleKey, setActiveModuleKey] = useState("users");
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [bulkConfirmation, setBulkConfirmation] = useState<BulkConfirmation | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const api = getBrowserApiUrl();

  const hydrate = useCallback((data: UserTypeSummary) => {
    setItem(data);
    setDraft(draftFrom(data));
    setSelected(data.permissions ?? []);
  }, []);

  const refresh = useCallback(async () => {
    const [data, permissions] = await Promise.all([
      apiGet<UserTypeSummary>(`/api/v1/user-types/${params.id}`, api),
      apiGet<{ items: Permission[] }>("/api/v1/permissions", api),
    ]);
    hydrate(data);
    setCatalog(permissions.items);
    setLoadError("");
  }, [api, hydrate, params.id]);

  useEffect(() => {
    void refresh().catch((err: unknown) =>
      setLoadError(err instanceof Error ? err.message : "Unable to load this User Type."),
    );
  }, [refresh]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const groupedPermissions = useMemo(() => {
    const groups = PERMISSION_MODULES.map((definition) => ({
      key: definition.key,
      label: definition.label,
      description: definition.description,
      items: [] as Permission[],
    }));
    const unmatched: Permission[] = [];
    for (const permission of catalog) {
      const matchedModule = moduleFor(permission);
      const group = matchedModule
        ? groups.find((candidate) => candidate.key === matchedModule.key)
        : undefined;
      if (group) group.items.push(permission);
      else unmatched.push(permission);
    }
    return unmatched.length
      ? [
          ...groups,
          {
            key: "other",
            label: "Other permissions",
            description: "Additional system-defined permissions not yet mapped to a primary module.",
            items: unmatched,
          },
        ]
      : groups;
  }, [catalog]);

  const visibleGroups = useMemo<PermissionGroup[]>(() => {
    const query = permissionQuery.trim().toLowerCase();
    return groupedPermissions
      .map((group) => {
        const moduleMatches = !query || group.label.toLowerCase().includes(query);
        const visibleItems = group.items.filter((permission) => {
          const matchesQuery =
            moduleMatches ||
            permission.code.toLowerCase().includes(query) ||
            permission.description.toLowerCase().includes(query);
          const isSelected = selectedSet.has(permission.code);
          const matchesFilter =
            permissionFilter === "all" ||
            (permissionFilter === "selected" && isSelected) ||
            (permissionFilter === "unselected" && !isSelected);
          return matchesQuery && matchesFilter;
        });
        return { ...group, visibleItems };
      })
      .filter((group) => group.items.length > 0 && group.visibleItems.length > 0);
  }, [groupedPermissions, permissionFilter, permissionQuery, selectedSet]);

  const activeGroup =
    visibleGroups.find((group) => group.key === activeModuleKey) ?? visibleGroups[0] ?? null;

  const canEditReportingManager = Boolean(
    item && can("UserTypes.Edit") && !item.isSystem && item.code !== "OWNER",
  );
  const canEditCaseOwner = Boolean(item && can("UserTypes.Edit") && item.code !== "OWNER");
  const canEditScopes = Boolean(item && can("UserTypes.AssignScope") && item.code !== "OWNER");
  const canEditPermissions = Boolean(
    item && can("UserTypes.AssignPermissions") && item.code !== "OWNER",
  );

  const hasUnsavedChanges = Boolean(
    item &&
      draft &&
      ((canEditReportingManager &&
        draft.canBeReportingManager !== Boolean(item.canBeReportingManager)) ||
        (canEditCaseOwner && draft.canBeCaseOwner !== Boolean(item.canBeCaseOwner)) ||
        (canEditScopes &&
          (draft.visibilityScope !== (item.visibilityScope ?? "") ||
            draft.customerVisibilityScope !== (item.customerVisibilityScope ?? "") ||
            draft.applicationVisibilityScope !== (item.applicationVisibilityScope ?? "") ||
            draft.reportingVisibilityScope !== (item.reportingVisibilityScope ?? ""))) ||
        (canEditPermissions && !samePermissions(selected, item.permissions ?? []))),
  );

  const changeSummary = useMemo(() => {
    if (!item || !draft) return [];
    const changes: string[] = [];
    if (
      canEditReportingManager &&
      draft.canBeReportingManager !== Boolean(item.canBeReportingManager)
    ) {
      changes.push(`Reporting Manager ${draft.canBeReportingManager ? "enabled" : "disabled"}`);
    }
    if (canEditCaseOwner && draft.canBeCaseOwner !== Boolean(item.canBeCaseOwner)) {
      changes.push(`Case Owner ${draft.canBeCaseOwner ? "enabled" : "disabled"}`);
    }
    if (canEditScopes) {
      for (const field of Object.keys(scopeLabels) as Array<keyof typeof scopeLabels>) {
        const original = (item[field] as string | null | undefined) ?? "";
        if (draft[field] !== original) {
          changes.push(`${scopeLabels[field]} scope: ${displayScope(original)} → ${displayScope(draft[field])}`);
        }
      }
    }
    if (canEditPermissions) {
      const original = new Set(item.permissions ?? []);
      const added = selected.filter((code) => !original.has(code)).length;
      const current = new Set(selected);
      const removed = (item.permissions ?? []).filter((code) => !current.has(code)).length;
      if (added) changes.push(`${added} permission${added === 1 ? "" : "s"} added`);
      if (removed) changes.push(`${removed} permission${removed === 1 ? "" : "s"} removed`);
    }
    return changes;
  }, [canEditCaseOwner, canEditPermissions, canEditReportingManager, canEditScopes, draft, item, selected]);

  const canSave = canEditReportingManager || canEditCaseOwner || canEditScopes || canEditPermissions;

  async function saveChanges() {
    if (!item || !draft || !hasUnsavedChanges) return;
    setSaving(true);
    setFeedback(null);
    try {
      if (
        canEditReportingManager &&
        draft.canBeReportingManager !== Boolean(item.canBeReportingManager)
      ) {
        await apiRequest(`/api/v1/user-types/${item.id}`, api, {
          method: "PATCH",
          body: JSON.stringify({ can_be_reporting_manager: draft.canBeReportingManager }),
        });
      }
      if (canEditCaseOwner && draft.canBeCaseOwner !== Boolean(item.canBeCaseOwner)) {
        await apiRequest(`/api/v1/user-types/${item.id}/case-owner`, api, {
          method: "PUT",
          body: JSON.stringify({ can_be_case_owner: draft.canBeCaseOwner }),
        });
      }
      const scopeUpdates = [
        {
          changed: draft.visibilityScope !== (item.visibilityScope ?? ""),
          path: "scope",
          body: { visibility_scope: draft.visibilityScope || null },
        },
        {
          changed: draft.customerVisibilityScope !== (item.customerVisibilityScope ?? ""),
          path: "customer-scope",
          body: { customer_visibility_scope: draft.customerVisibilityScope || null },
        },
        {
          changed: draft.applicationVisibilityScope !== (item.applicationVisibilityScope ?? ""),
          path: "application-scope",
          body: { application_visibility_scope: draft.applicationVisibilityScope || null },
        },
        {
          changed: draft.reportingVisibilityScope !== (item.reportingVisibilityScope ?? ""),
          path: "reporting-scope",
          body: { reporting_visibility_scope: draft.reportingVisibilityScope || null },
        },
      ];
      if (canEditScopes) {
        for (const update of scopeUpdates) {
          if (!update.changed) continue;
          await apiRequest(`/api/v1/user-types/${item.id}/${update.path}`, api, {
            method: "PUT",
            body: JSON.stringify(update.body),
          });
        }
      }
      if (canEditPermissions && !samePermissions(selected, item.permissions ?? [])) {
        await apiRequest(`/api/v1/user-types/${item.id}/permissions`, api, {
          method: "PUT",
          body: JSON.stringify({ permissions: selected }),
        });
      }
      await refresh();
      setFeedback({
        tone: "success",
        text: "Changes saved successfully. Active sessions are terminated when access settings require it.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save changes.";
      setFeedback({
        tone: "error",
        text: `Save failed: ${message} Refresh before retrying because an earlier setting may already have been saved.`,
      });
    } finally {
      setSaving(false);
    }
  }

  function cancelChanges() {
    if (!item) return;
    setDraft(draftFrom(item));
    setSelected(item.permissions ?? []);
    setBulkConfirmation(null);
    setFeedback({ tone: "neutral", text: "Unsaved changes discarded." });
  }

  async function changeStatus(target: "activate" | "deactivate") {
    if (!item) return;
    setStatusSaving(true);
    setFeedback(null);
    try {
      const updated = await apiRequest<UserTypeSummary>(`/api/v1/user-types/${item.id}/${target}`, api, {
        method: "POST",
      });
      setItem(updated);
      setFeedback({
        tone: "success",
        text: `User Type ${target === "activate" ? "activated" : "deactivated"} successfully.`,
      });
    } catch (err) {
      setFeedback({
        tone: "error",
        text: err instanceof Error ? err.message : `Unable to ${target} this User Type.`,
      });
    } finally {
      setConfirmDeactivate(false);
      setStatusSaving(false);
    }
  }

  function togglePermission(code: string, checked: boolean) {
    setSelected((current) => {
      if (checked) return current.includes(code) ? current : [...current, code];
      return current.filter((permission) => permission !== code);
    });
    setFeedback(null);
  }

  function setModulePermissions(permissions: Permission[], checked: boolean) {
    const codes = new Set(permissions.map((permission) => permission.code));
    setSelected((current) => {
      if (checked) return Array.from(new Set([...current, ...codes]));
      return current.filter((code) => !codes.has(code));
    });
    setFeedback(null);
  }

  function requestSelectAll(group: PermissionGroup) {
    const includesNewSensitivePermission = group.items.some(
      (permission) =>
        SENSITIVE_PERMISSION_CODES.has(permission.code) && !selectedSet.has(permission.code),
    );
    if (includesNewSensitivePermission) {
      setBulkConfirmation({ label: group.label, permissions: group.items });
      return;
    }
    setModulePermissions(group.items, true);
  }

  function toggleMobileModule(key: string) {
    setExpandedModules((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (!item || !draft) {
    return (
      <section className="space-y-3">
        <ErrorText>{loadError}</ErrorText>
        {!loadError ? <p className="text-sm text-slate-500">Loading User Type…</p> : null}
      </section>
    );
  }

  const isActive = item.status.toLowerCase() === "active";
  const isOwner = item.code === "OWNER";
  const canChangeStatus =
    !isOwner &&
    ((isActive && can("UserTypes.Deactivate")) || (!isActive && can("UserTypes.Activate")));
  const reportingManagerLockReason = isOwner
    ? "OWNER settings are protected."
    : item.isSystem
      ? "Locked because system User Types cannot be edited through the custom-type settings endpoint."
      : !can("UserTypes.Edit")
        ? "Requires the UserTypes.Edit permission."
        : undefined;
  const caseOwnerLockReason = isOwner
    ? "OWNER settings are protected."
    : !can("UserTypes.Edit")
      ? "Requires the UserTypes.Edit permission."
      : undefined;

  function permissionGrid(group: PermissionGroup, testId: string) {
    return (
      <div
        data-testid={testId}
        className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 md:grid-cols-2 2xl:grid-cols-3"
      >
        {group.visibleItems.map((permission) => (
          <label
            key={permission.code}
            className="flex min-w-0 cursor-pointer items-start gap-3 bg-white px-3 py-3 transition-colors hover:bg-slate-50"
          >
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 rounded border-slate-300 text-[#0f4c81]"
              aria-label={permission.description}
              checked={selectedSet.has(permission.code)}
              disabled={saving}
              onChange={(event) => togglePermission(permission.code, event.target.checked)}
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium leading-5 text-slate-900">
                  {permission.description}
                </span>
                {SENSITIVE_PERMISSION_CODES.has(permission.code) ? (
                  <Badge tone="amber">Sensitive</Badge>
                ) : null}
              </span>
              <code className="mt-0.5 block break-all text-xs leading-4 text-slate-500">
                {permission.code}
              </code>
            </span>
          </label>
        ))}
      </div>
    );
  }

  return (
    <section className="w-full space-y-4 pb-28">
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <ButtonLink href="/user-types" variant="ghost" size="compact" className="-ml-2 mb-2">
              <IconArrowBack className="size-4" />
              Back to User Types
            </ButtonLink>
            <h2 className="text-lg font-semibold tracking-tight text-slate-950 sm:text-xl">
              {item.name} <span className="font-medium text-slate-500">({item.code})</span>
            </h2>
            <p className="mt-1 max-w-4xl text-sm leading-5 text-slate-600">
              {item.description || "No description has been provided for this User Type."}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Permissions are assigned to this User Type and inherited by its users.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 lg:max-w-sm lg:justify-end">
            <StatusBadge value={displayStatus(item.status)} />
            {item.isSystem ? <SystemTypeBadge /> : <Badge>Custom Type</Badge>}
            <Badge tone={item.mfaRequired ? "purple" : "neutral"}>
              MFA {item.mfaRequired ? "required" : "not required"}
            </Badge>
          </div>
        </div>
      </Card>

      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,13fr)]">
        <Card className="h-full">
          <SectionHeader
            title="Basic Settings"
            description="Status and operational eligibility for this User Type."
          />
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3">
              <div>
                <p className="text-sm font-medium text-slate-900">Status</p>
                <div className="mt-1">
                  <StatusBadge value={displayStatus(item.status)} />
                </div>
              </div>
              {canChangeStatus ? (
                <Button
                  type="button"
                  variant={isActive ? "danger" : "secondary"}
                  disabled={statusSaving || saving}
                  onClick={() => {
                    if (isActive) setConfirmDeactivate(true);
                    else void changeStatus("activate");
                  }}
                >
                  {statusSaving ? "Updating…" : isActive ? "Deactivate" : "Activate"}
                </Button>
              ) : null}
            </div>
            <SwitchControl
              id="can-be-reporting-manager"
              label="Can be Reporting Manager"
              description="Allows this type to be selected in employee reporting lines."
              checked={draft.canBeReportingManager}
              disabled={!canEditReportingManager || saving || statusSaving}
              disabledReason={reportingManagerLockReason}
              onChange={(checked) => {
                setDraft({ ...draft, canBeReportingManager: checked });
                setFeedback(null);
              }}
            />
            <SwitchControl
              id="can-be-case-owner"
              label="Can be Case Owner"
              description="Allows eligible users of this type to own application cases."
              checked={draft.canBeCaseOwner}
              disabled={!canEditCaseOwner || saving || statusSaving}
              disabledReason={caseOwnerLockReason}
              onChange={(checked) => {
                setDraft({ ...draft, canBeCaseOwner: checked });
                setFeedback(null);
              }}
            />
          </div>
        </Card>

        <Card className="h-full">
          <SectionHeader
            title="Data Access Scopes"
            description="Existing server-enforced visibility boundaries for each data area."
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {(Object.keys(scopeLabels) as Array<keyof typeof scopeLabels>).map((field, index) => (
              <label key={field} className="block min-w-0 text-sm font-medium text-slate-700">
                <span className="flex items-center gap-1.5">
                  {scopeLabels[field]} scope
                  <InfoTooltip
                    id={`${field}-scope-help`}
                    label={`About ${scopeLabels[field]} scope`}
                    text={scopeTooltips[field]}
                    align={index % 2 === 1 ? "right" : "left"}
                  />
                </span>
                <Select
                  aria-label={`${scopeLabels[field]} scope`}
                  value={draft[field]}
                  disabled={!canEditScopes || saving}
                  onChange={(event) => {
                    setDraft({ ...draft, [field]: event.target.value });
                    setFeedback(null);
                  }}
                >
                  <option value="">No scope</option>
                  {SCOPES.map((scope) => (
                    <option key={scope} value={scope}>
                      {displayScope(scope)}
                    </option>
                  ))}
                </Select>
                <span className="mt-1.5 block text-xs font-normal leading-4 text-slate-500">
                  {scopeHelp[field]}
                </span>
              </label>
            ))}
          </div>
          {!canEditScopes ? (
            <p className="mt-4 flex items-start gap-2 text-xs text-amber-700">
              <IconShieldLock className="mt-px size-3.5 shrink-0" />
              {isOwner
                ? "OWNER scope settings are protected."
                : "Scope values are read-only without UserTypes.AssignScope."}
            </p>
          ) : null}
        </Card>
      </div>

      {canEditPermissions ? (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
            <SectionHeader
              title="Permissions"
              description="Select the capabilities users inherit from this User Type. Technical codes remain unchanged."
            />
          </div>

          {selected.length === 0 ? (
            <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 sm:mx-4" role="status">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
              This User Type currently grants no system access.
            </div>
          ) : null}

          <div className="grid min-w-0 lg:grid-cols-[minmax(230px,1fr)_minmax(0,3fr)]">
            <aside className="min-w-0 border-b border-slate-200 bg-slate-50/70 p-3 sm:p-4 lg:border-b-0 lg:border-r" aria-label="Permission modules">
              <label className="block text-sm font-medium text-slate-700">
                Search permissions
                <TextInput
                  aria-label="Search permissions"
                  placeholder="Name or technical code"
                  value={permissionQuery}
                  onChange={(event) => setPermissionQuery(event.target.value)}
                />
              </label>
              <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-white p-1" aria-label="Permission filter">
                {(["all", "selected", "unselected"] as const).map((filter) => (
                  <Button
                    key={filter}
                    type="button"
                    size="compact"
                    variant={permissionFilter === filter ? "primary" : "ghost"}
                    aria-pressed={permissionFilter === filter}
                    onClick={() => setPermissionFilter(filter)}
                  >
                    {filter.charAt(0).toUpperCase() + filter.slice(1)}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-4 text-slate-500" aria-live="polite">
                {visibleGroups.reduce((total, group) => total + group.visibleItems.length, 0)} of {catalog.length} shown · {selected.length} selected
              </p>

              <nav className="mt-4 hidden space-y-1 lg:block" aria-label="Permission module navigation">
                {visibleGroups.map((group) => {
                  const selectedCount = group.items.filter((permission) => selectedSet.has(permission.code)).length;
                  const active = activeGroup?.key === group.key;
                  return (
                    <button
                      key={group.key}
                      type="button"
                      aria-label={`${group.label} permissions`}
                      aria-pressed={active}
                      className={cx(
                        "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        focusRing,
                        active
                          ? "bg-slate-900 text-white shadow-sm"
                          : "text-slate-700 hover:bg-white hover:text-slate-950",
                      )}
                      onClick={() => setActiveModuleKey(group.key)}
                    >
                      <span className="min-w-0 truncate font-medium">{group.label}</span>
                      <Badge tone={countTone(selectedCount, group.items.length)}>
                        {selectedCount}/{group.items.length}
                      </Badge>
                    </button>
                  );
                })}
              </nav>
            </aside>

            <div className="hidden min-w-0 p-4 lg:block">
              {activeGroup ? (
                <section aria-labelledby="active-permission-module">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 id="active-permission-module" className="text-base font-semibold text-slate-950">
                          {activeGroup.label}
                        </h3>
                        {(() => {
                          const selectedCount = activeGroup.items.filter((permission) => selectedSet.has(permission.code)).length;
                          return (
                            <Badge tone={countTone(selectedCount, activeGroup.items.length)}>
                              {selectedCount} of {activeGroup.items.length} selected
                            </Badge>
                          );
                        })()}
                      </div>
                      <p className="mt-1 text-sm text-slate-500">{activeGroup.description}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="compact"
                        variant="secondary"
                        aria-label={`Select all ${activeGroup.label} permissions`}
                        disabled={
                          saving ||
                          activeGroup.items.every((permission) => selectedSet.has(permission.code))
                        }
                        onClick={() => requestSelectAll(activeGroup)}
                      >
                        Select all
                      </Button>
                      <Button
                        type="button"
                        size="compact"
                        variant="ghost"
                        aria-label={`Clear all ${activeGroup.label} permissions`}
                        disabled={
                          saving ||
                          activeGroup.items.every((permission) => !selectedSet.has(permission.code))
                        }
                        onClick={() => setModulePermissions(activeGroup.items, false)}
                      >
                        Clear all
                      </Button>
                    </div>
                  </div>
                  {permissionGrid(activeGroup, `permission-panel-${activeGroup.key}`)}
                </section>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 px-4 py-12 text-center text-sm text-slate-500">
                  No permissions match the current search and filter.
                </div>
              )}
            </div>

            <div className="space-y-2 p-3 sm:p-4 lg:hidden">
              {visibleGroups.map((group) => {
                const selectedCount = group.items.filter((permission) => selectedSet.has(permission.code)).length;
                const isExpanded = expandedModules.has(group.key) || Boolean(permissionQuery.trim());
                const panelId = `mobile-permission-module-${group.key}`;
                return (
                  <section key={group.key} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 bg-slate-50/80 px-2 py-2 sm:flex-nowrap">
                      <button
                        type="button"
                        className={cx("flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left", focusRing)}
                        aria-label={`${group.label} permissions`}
                        aria-expanded={isExpanded}
                        aria-controls={panelId}
                        onClick={() => toggleMobileModule(group.key)}
                      >
                        <IconChevronDown className={cx("size-4 shrink-0 text-slate-500 transition-transform", !isExpanded && "-rotate-90")} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">{group.label}</span>
                            <Badge tone={countTone(selectedCount, group.items.length)}>
                              {selectedCount} of {group.items.length} selected
                            </Badge>
                          </span>
                          <span className="mt-0.5 block text-xs leading-4 text-slate-500">{group.description}</span>
                        </span>
                      </button>
                      <div className="ml-8 flex shrink-0 items-center gap-1 sm:ml-0">
                        <Button
                          type="button"
                          size="compact"
                          variant="ghost"
                          aria-label={`Select all ${group.label} permissions`}
                          disabled={saving || selectedCount === group.items.length}
                          onClick={() => requestSelectAll(group)}
                        >
                          Select all
                        </Button>
                        <Button
                          type="button"
                          size="compact"
                          variant="ghost"
                          aria-label={`Clear all ${group.label} permissions`}
                          disabled={saving || selectedCount === 0}
                          onClick={() => setModulePermissions(group.items, false)}
                        >
                          Clear all
                        </Button>
                      </div>
                    </div>
                    {isExpanded ? (
                      <div id={panelId} className="border-t border-slate-200 p-2">
                        {permissionGrid(group, `mobile-permission-panel-${group.key}`)}
                      </div>
                    ) : null}
                  </section>
                );
              })}
              {visibleGroups.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                  No permissions match the current search and filter.
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {canSave ? (
        <div className="sticky bottom-3 z-20 w-full rounded-xl border border-slate-300 bg-white/95 px-3 py-3 shadow-[0_12px_30px_rgba(15,23,42,0.14)] backdrop-blur sm:px-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0" aria-live="polite">
              {saving ? (
                <p className="text-sm font-medium text-[#0f4c81]">Saving changes…</p>
              ) : feedback?.tone === "success" ? (
                <p role="status" className="text-sm font-medium text-emerald-700">{feedback.text}</p>
              ) : feedback?.tone === "error" ? (
                <p role="alert" className="text-sm font-medium text-red-700">{feedback.text}</p>
              ) : feedback ? (
                <p role="status" className="text-sm text-slate-600">{feedback.text}</p>
              ) : hasUnsavedChanges ? (
                <div>
                  <p className="text-sm font-semibold text-amber-800">You have unsaved changes.</p>
                  <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Staged change summary">
                    {changeSummary.map((change) => (
                      <li key={change}>• {change}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-slate-500">All changes are saved.</p>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2">
              <Button type="button" variant="secondary" disabled={!hasUnsavedChanges || saving} onClick={cancelChanges}>
                Cancel
              </Button>
              <Button type="button" disabled={!hasUnsavedChanges || saving} onClick={() => void saveChanges()}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isOwner ? (
        <p className="flex items-start gap-2 text-xs text-slate-500">
          <IconShieldLock className="mt-0.5 size-4 shrink-0" />
          OWNER remains protected with full permissions and a hidden permission matrix.
        </p>
      ) : null}

      {bulkConfirmation ? (
        <DialogPanel
          title={`Select all ${bulkConfirmation.label} permissions?`}
          description="Review the impact before changing the staged permission set."
          onClose={() => setBulkConfirmation(null)}
        >
          <div className="space-y-4">
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-900">
              This will include sensitive administrative permissions.
            </p>
            <p className="text-sm text-slate-600">
              The permissions remain staged until Save changes is selected.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setBulkConfirmation(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setModulePermissions(bulkConfirmation.permissions, true);
                  setBulkConfirmation(null);
                }}
              >
                Include permissions
              </Button>
            </div>
          </div>
        </DialogPanel>
      ) : null}

      {confirmDeactivate ? (
        <DialogPanel
          title={`Deactivate ${item.name}?`}
          description="This status change takes effect immediately."
          onClose={() => setConfirmDeactivate(false)}
        >
          <div className="space-y-4">
            <p className="text-sm leading-6 text-slate-700">
              Users assigned to an inactive User Type cannot sign in. Deactivation also terminates
              their active sessions. No assigned-user count is available from this page.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setConfirmDeactivate(false)}>
                Cancel
              </Button>
              <Button type="button" variant="danger" disabled={statusSaving} onClick={() => void changeStatus("deactivate")}>
                {statusSaving ? "Deactivating…" : "Deactivate User Type"}
              </Button>
            </div>
          </div>
        </DialogPanel>
      ) : null}
    </section>
  );
}
