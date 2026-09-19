const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T/;

const ACTION_LABELS: Record<string, string> = {
  "auth.lock": "Account locked",
  "auth.login": "Signed in",
  "auth.login_failed": "Sign-in attempt failed",
  "auth.logout": "Signed out",
  "auth.mfa_challenge": "Multi-factor verification requested",
  "auth.mfa_disable": "Multi-factor authentication disabled",
  "auth.mfa_enable": "Multi-factor authentication enabled",
  "auth.mfa_setup": "Multi-factor authentication set up",
  "user.activate": "Account activated",
  "user.assign_type": "User type assigned",
  "user.bootstrap_owner": "Owner account created",
  "user.bulk_import": "Staff import completed",
  "user.create": "Employee created",
  "user.deactivate": "Account deactivated",
  "user.document.create": "Employee document added",
  "user.document.delete": "Employee document removed",
  "user.document.download": "Employee document downloaded",
  "user.document.metadata.replace": "Employee document details updated",
  "user.document.purge": "Employee document permanently removed",
  "user.document.replace": "Employee document replaced",
  "user.document.upload": "Employee document uploaded",
  "user.document.view": "Employee document viewed",
  "user.photo": "Profile photo updated",
  "user.profile.basic.update": "Personal details updated",
  "user.profile.hr.update": "HR profile updated",
  "user.rehire": "Employee rehired",
  "user.self_update": "Profile details updated",
  "user.sessions.terminate": "Active sessions ended",
  "user.unlock": "Account unlocked",
  "user.update": "Employee details updated",
};

const FIELD_LABELS: Record<string, string> = {
  accountStatus: "Account status",
  activeEmployeeId: "Assigned employee",
  businessUnitId: "Business unit",
  caseOwnerId: "Case owner",
  conditionAtIssue: "Condition when issued",
  contentType: "File type",
  departmentId: "Department",
  designationId: "Designation",
  employeeCode: "Employee code",
  employeeId: "Employee",
  employmentStatus: "Employment status",
  failedLoginCount: "Failed sign-in attempts",
  firstName: "First name",
  fullName: "Full name",
  issueDate: "Issue date",
  joiningDate: "Joining date",
  lastName: "Last name",
  lockedUntil: "Locked until",
  middleName: "Middle name",
  mobile: "Mobile",
  officeId: "Office",
  personalEmail: "Personal email",
  personalMobile: "Personal mobile",
  reportingManagerId: "Reporting manager",
  returnDate: "Return date",
  status: "Status",
  teamId: "Team",
  userTypeId: "User type",
  workEmail: "Work email",
  workMobile: "Work mobile",
};

const HIDDEN_AUDIT_FIELDS = new Set([
  "contentType",
  "key",
  "mimeType",
  "objectKey",
  "path",
  "profilePhotoKey",
  "storageKey",
]);

const ENUM_AUDIT_FIELDS = new Set([
  "accountStatus",
  "conditionAtIssue",
  "employmentStatus",
  "kind",
  "status",
]);

export function humanizeTechnicalLabel(value: string): string {
  const mapped = ACTION_LABELS[value];
  if (mapped) return mapped;
  const text = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[._-]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Recorded update";
}

export function formatStatusLabel(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bId\b/g, "ID")
    .replace(/\bHr\b/g, "HR")
    .replace(/\bPro\b/g, "PRO")
    .replace(/\bMfa\b/g, "MFA");
}

export function auditFieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? humanizeTechnicalLabel(key);
}

export function formatLocalDateTime(value: string, fallback = "—"): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const options: Intl.DateTimeFormatOptions = ISO_DATE_PATTERN.test(value)
    ? { day: "numeric", month: "short", year: "numeric" }
    : { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" };
  return new Intl.DateTimeFormat("en-AE", options).format(date);
}

export function formatDateRange(from: string, to: string | null): string {
  return `${formatLocalDateTime(from)} – ${to ? formatLocalDateTime(to) : "Current"}`;
}

export type AuditDisplayEntry = { label: string; value: string };

export function auditDisplayEntries(values: Record<string, unknown> | null | undefined): AuditDisplayEntry[] {
  return Object.entries(values ?? {}).flatMap(([key, value]) => {
    if (HIDDEN_AUDIT_FIELDS.has(key) || ((/^(?:id|.*(?:Id|_id))$/.test(key) || /uuid|record.?source|context.?source|legacy|lock.?version/i.test(key)) && !["emiratesId", "emirates_id"].includes(key))) return [];
    if (value === null || value === undefined || value === "") {
      return [{ label: auditFieldLabel(key), value: "Not assigned" }];
    }
    if (typeof value === "string") {
      if (UUID_PATTERN.test(value)) {
        return [];
      }
      if (ISO_DATE_PATTERN.test(value) || ISO_DATE_TIME_PATTERN.test(value)) {
        return [{ label: auditFieldLabel(key), value: formatLocalDateTime(value) }];
      }
      return [{ label: auditFieldLabel(key), value: ENUM_AUDIT_FIELDS.has(key) ? humanizeTechnicalLabel(value) : value }];
    }
    if (typeof value === "boolean") {
      return [{ label: auditFieldLabel(key), value: value ? "Yes" : "No" }];
    }
    if (typeof value === "number") {
      return [{ label: auditFieldLabel(key), value: value.toLocaleString("en-AE") }];
    }
    return [{ label: auditFieldLabel(key), value: "Updated" }];
  });
}

export function auditEventSummary(action: string): string {
  if (action === "user.photo") return "Profile photo was updated.";
  return `${humanizeTechnicalLabel(action)}.`;
}
