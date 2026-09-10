"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { DatePicker } from "@/components/date-picker";
import { Button, ErrorText, Select, TextInput, cx } from "@/components/ui";
import { ApiClientError, apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { ManagerOption, OrgRef, UserTypeSummary } from "@/lib/types";

const STATUSES = ["Active", "Probation", "Notice Period", "Resigned", "Terminated", "Inactive"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INITIAL_FORM = {
  first_name: "",
  middle_name: "",
  last_name: "",
  personal_email: "",
  personal_mobile: "",
  employee_code: "",
  email: "",
  mobile: "",
  designation_id: "",
  employment_status: "Active",
  joining_date: "",
  last_working_date: "",
  office_id: "",
  department_id: "",
  team_id: "",
  user_type_id: "",
  reporting_manager_id: "",
};

type UserForm = typeof INITIAL_FORM;
type UserFormField = keyof UserForm;
type FormErrors = Partial<Record<UserFormField, string>>;

function FormSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="text-base font-semibold text-text-primary">{title}</legend>
      <div className="mt-2 grid min-w-0 gap-x-4 gap-y-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function FormField({
  id,
  label,
  required = false,
  error,
  help,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  help?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("min-w-0", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-text-primary">
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className="ml-1 text-danger">*</span>
            <span className="sr-only"> (required)</span>
          </>
        ) : null}
      </label>
      {children}
      {help ? <p id={`${id}-help`} className="mt-1 text-xs leading-4 text-text-secondary">{help}</p> : null}
      {error ? <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-medium text-danger">{error}</p> : null}
    </div>
  );
}

function validate(form: UserForm): FormErrors {
  const errors: FormErrors = {};
  if (!form.first_name.trim()) errors.first_name = "Enter the employee’s first name.";
  if (!form.last_name.trim()) errors.last_name = "Enter the employee’s last name.";
  if (!form.employee_code.trim()) errors.employee_code = "Enter an employee code.";
  if (!form.email.trim()) errors.email = "Enter a work email address.";
  else if (!EMAIL_PATTERN.test(form.email.trim())) errors.email = "Enter a valid work email address.";
  if (!form.mobile.trim()) errors.mobile = "Enter a work mobile number.";
  else if (form.mobile.trim().length < 5) errors.mobile = "Work mobile must contain at least 5 characters.";
  if (form.personal_email.trim() && !EMAIL_PATTERN.test(form.personal_email.trim())) {
    errors.personal_email = "Enter a valid personal email address.";
  }
  if (form.personal_mobile.trim() && form.personal_mobile.trim().length < 5) {
    errors.personal_mobile = "Personal mobile must contain at least 5 characters.";
  }
  if (!form.designation_id) errors.designation_id = "Select a designation.";
  if (!form.joining_date) errors.joining_date = "Enter the joining date.";
  if (["Resigned", "Terminated"].includes(form.employment_status) && !form.last_working_date) {
    errors.last_working_date = "Enter the last working date for this employment status.";
  }
  return errors;
}

export function CreateUserDialog() {
  const router = useRouter();
  const { can } = useAuth();
  const dialogRef = useRef<HTMLElement>(null);
  const submittingRef = useRef(false);
  const [types, setTypes] = useState<UserTypeSummary[]>([]);
  const [designations, setDesignations] = useState<OrgRef[]>([]);
  const [offices, setOffices] = useState<OrgRef[]>([]);
  const [departments, setDepartments] = useState<(OrgRef & { officeId?: string })[]>([]);
  const [teams, setTeams] = useState<(OrgRef & { officeId?: string; departmentId?: string })[]>([]);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<UserForm>(INITIAL_FORM);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const open = () => setVisible(true);
    const syncWithHistory = () => setVisible(window.location.pathname === "/users/new");
    window.addEventListener("nexa:create-user-modal", open);
    window.addEventListener("popstate", syncWithHistory);
    return () => {
      window.removeEventListener("nexa:create-user-modal", open);
      window.removeEventListener("popstate", syncWithHistory);
    };
  }, []);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  const close = useCallback(() => {
    if (submittingRef.current) return;
    setVisible(false);
    router.replace("/users");
  }, [router]);

  useEffect(() => {
    if (!visible) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const activeDialog = dialog;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => activeDialog.querySelector<HTMLElement>("#first-name")?.focus());

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (activeDialog.querySelector('[role="dialog"]') || document.querySelector('[role="listbox"]')) return;
        event.preventDefault();
        activeDialog.querySelector<HTMLButtonElement>("[data-dialog-close]")?.click();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        activeDialog.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((item) => item.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    activeDialog.addEventListener("keydown", onKeyDown);
    return () => {
      activeDialog.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [close, visible]);

  useEffect(() => {
    const api = getBrowserApiUrl();
    if (can("Users.AssignUserType")) {
      void apiGet<{ items: UserTypeSummary[] }>("/api/v1/user-types", api)
        .then((data) =>
          setTypes(data.items.filter((item) => !["OWNER", "PENDING"].includes(item.code))),
        )
        .catch(() => undefined);
    }
    void apiGet<{ items: OrgRef[] }>("/api/v1/designations", api).then((data) =>
      setDesignations(data.items),
    );
    void apiGet<{ items: OrgRef[] }>("/api/v1/offices", api).then((data) => setOffices(data.items));
    void apiGet<{ items: (OrgRef & { officeId: string })[] }>("/api/v1/departments", api).then(
      (data) => setDepartments(data.items),
    );
    void apiGet<{ items: (OrgRef & { officeId: string; departmentId: string })[] }>(
      "/api/v1/teams",
      api,
    ).then((data) => setTeams(data.items));
    void apiGet<{ items: ManagerOption[] }>("/api/v1/users/managers", api).then((data) =>
      setManagers(data.items),
    );
  }, [can]);

  const fullName = useMemo(
    () => [form.first_name, form.middle_name, form.last_name].map((part) => part.trim()).filter(Boolean).join(" "),
    [form.first_name, form.middle_name, form.last_name],
  );
  const filteredDepartments = useMemo(
    () => departments.filter((item) => !form.office_id || item.officeId === form.office_id),
    [departments, form.office_id],
  );
  const filteredTeams = useMemo(
    () =>
      teams.filter(
        (item) =>
          (!form.office_id || item.officeId === form.office_id) &&
          (!form.department_id || item.departmentId === form.department_id),
      ),
    [teams, form.office_id, form.department_id],
  );

  function updateField<Name extends UserFormField>(name: Name, value: UserForm[Name]) {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError("");
    const nextErrors = validate(form);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      window.requestAnimationFrame(() => {
        formElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }
    setSubmitting(true);
    try {
      const created = await apiRequest<{ id: string }>("/api/v1/users", getBrowserApiUrl(), {
        method: "POST",
        body: JSON.stringify({
          ...form,
          full_name: fullName,
          middle_name: form.middle_name || null,
          personal_email: form.personal_email || null,
          personal_mobile: form.personal_mobile || null,
          last_working_date: form.last_working_date || null,
          office_id: form.office_id || null,
          department_id: form.department_id || null,
          team_id: form.team_id || null,
          user_type_id: can("Users.AssignUserType") ? form.user_type_id || null : null,
          reporting_manager_id: form.reporting_manager_id || null,
        }),
      });
      router.push(`/users/${created.id}`);
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        const code = caught.body?.error?.code;
        if (code === "EMAIL_DUPLICATE") setErrors((current) => ({ ...current, email: caught.message }));
        if (code === "EMPLOYEE_CODE_DUPLICATE") {
          setErrors((current) => ({ ...current, employee_code: caught.message }));
        }
      }
      setError(caught instanceof Error ? caught.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!visible) return null;

  return (
    <div
      data-testid="create-user-modal-backdrop"
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) close();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-user-dialog-title"
        aria-describedby="create-user-dialog-description"
        className="flex h-[100dvh] max-h-[100dvh] w-full min-w-0 flex-col bg-surface shadow-[var(--amafh-shadow-elevated)] sm:h-auto sm:max-h-[90vh] sm:max-w-[960px] sm:rounded-lg sm:border sm:border-brand-border"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-brand-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id="create-user-dialog-title" className="text-lg font-semibold text-text-primary">Create User</h2>
            <p id="create-user-dialog-description" className="mt-0.5 text-sm text-text-secondary">
              Add Basic user details. HR and PRO records remain available from the employee profile after creation.
            </p>
          </div>
          <Button data-dialog-close="" type="button" variant="ghost" size="compact" disabled={submitting} aria-label="Close Create User" onClick={close}>
            Close
          </Button>
        </header>
      <form
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div data-testid="create-user-form-body" className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 sm:p-5">
          <FormSection title="Personal & Contact Information">
            <FormField id="first-name" label="First Name" required error={errors.first_name}>
              <TextInput id="first-name" autoComplete="given-name" value={form.first_name} error={Boolean(errors.first_name)} aria-describedby={errors.first_name ? "first-name-error" : undefined} onChange={(event) => updateField("first_name", event.target.value)} />
            </FormField>
            <FormField id="middle-name" label="Middle Name">
              <TextInput id="middle-name" autoComplete="additional-name" value={form.middle_name} onChange={(event) => updateField("middle_name", event.target.value)} />
            </FormField>
            <FormField id="last-name" label="Last Name" required error={errors.last_name}>
              <TextInput id="last-name" autoComplete="family-name" value={form.last_name} error={Boolean(errors.last_name)} aria-describedby={errors.last_name ? "last-name-error" : undefined} onChange={(event) => updateField("last_name", event.target.value)} />
            </FormField>
            <FormField id="full-name" label="Full Name" help="Derived automatically from the name fields.">
              <TextInput id="full-name" value={fullName} readOnly aria-describedby="full-name-help" className="bg-surface-subtle" />
            </FormField>
            <FormField id="work-email" label="Work Email" required error={errors.email}>
              <TextInput id="work-email" type="email" inputMode="email" autoComplete="email" spellCheck={false} value={form.email} error={Boolean(errors.email)} aria-describedby={errors.email ? "work-email-error" : undefined} onChange={(event) => updateField("email", event.target.value)} />
            </FormField>
            <FormField id="work-mobile" label="Work Mobile" required error={errors.mobile}>
              <TextInput id="work-mobile" type="tel" inputMode="tel" autoComplete="tel" value={form.mobile} error={Boolean(errors.mobile)} aria-describedby={errors.mobile ? "work-mobile-error" : undefined} onChange={(event) => updateField("mobile", event.target.value)} />
            </FormField>
            <FormField id="personal-email" label="Personal Email" error={errors.personal_email}>
              <TextInput id="personal-email" type="email" inputMode="email" autoComplete="email" spellCheck={false} value={form.personal_email} error={Boolean(errors.personal_email)} aria-describedby={errors.personal_email ? "personal-email-error" : undefined} onChange={(event) => updateField("personal_email", event.target.value)} />
            </FormField>
            <FormField id="personal-mobile" label="Personal Mobile" error={errors.personal_mobile}>
              <TextInput id="personal-mobile" type="tel" inputMode="tel" autoComplete="tel" value={form.personal_mobile} error={Boolean(errors.personal_mobile)} aria-describedby={errors.personal_mobile ? "personal-mobile-error" : undefined} onChange={(event) => updateField("personal_mobile", event.target.value)} />
            </FormField>
          </FormSection>

          <div className="border-t border-brand-border" />

          <FormSection title="Employment & Organization">
            <FormField id="employee-code" label="Employee Code" required error={errors.employee_code}>
              <TextInput id="employee-code" spellCheck={false} value={form.employee_code} error={Boolean(errors.employee_code)} aria-describedby={errors.employee_code ? "employee-code-error" : undefined} onChange={(event) => updateField("employee_code", event.target.value)} />
            </FormField>
            <FormField id="designation" label="Designation" required error={errors.designation_id}>
              <Select id="designation" value={form.designation_id} error={Boolean(errors.designation_id)} aria-describedby={errors.designation_id ? "designation-error" : undefined} onChange={(event) => updateField("designation_id", event.target.value)}>
                <option value="">Select designation</option>
                {designations.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
              </Select>
            </FormField>
            <FormField id="joining-date" label="Joining Date" required error={errors.joining_date}>
              <DatePicker id="joining-date" value={form.joining_date} onChange={(joining_date) => updateField("joining_date", joining_date)} required error={Boolean(errors.joining_date)} aria-label="Joining Date" aria-describedby={errors.joining_date ? "joining-date-error" : undefined} />
            </FormField>
            <FormField id="employment-status" label="Employment Status">
              <Select id="employment-status" value={form.employment_status} onChange={(event) => {
                updateField("employment_status", event.target.value);
                if (!["Resigned", "Terminated"].includes(event.target.value)) updateField("last_working_date", "");
              }}>
                {STATUSES.map((status) => <option key={status}>{status}</option>)}
              </Select>
            </FormField>
            {["Resigned", "Terminated"].includes(form.employment_status) ? (
              <FormField id="last-working-date" label="Last Working Date" required error={errors.last_working_date}>
                <DatePicker id="last-working-date" value={form.last_working_date} onChange={(last_working_date) => updateField("last_working_date", last_working_date)} required error={Boolean(errors.last_working_date)} aria-label="Last Working Date" aria-describedby={errors.last_working_date ? "last-working-date-error" : undefined} />
              </FormField>
            ) : null}
            <FormField id="office" label="Office">
              <Select id="office" value={form.office_id} onChange={(event) => setForm((current) => ({ ...current, office_id: event.target.value, department_id: "", team_id: "" }))}>
                <option value="">Select office</option>
                {offices.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
              </Select>
            </FormField>
            <FormField id="department" label="Department">
              <Select id="department" value={form.department_id} disabled={!form.office_id} onChange={(event) => setForm((current) => ({ ...current, department_id: event.target.value, team_id: "" }))}>
                <option value="">Select department</option>
                {filteredDepartments.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
              </Select>
            </FormField>
            <FormField id="team" label="Team">
              <Select id="team" value={form.team_id} disabled={!form.office_id || !form.department_id} onChange={(event) => updateField("team_id", event.target.value)}>
                <option value="">Select team</option>
                {filteredTeams.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
              </Select>
            </FormField>
            <FormField id="reporting-manager" label="Reporting Manager">
              <Select id="reporting-manager" value={form.reporting_manager_id} onChange={(event) => updateField("reporting_manager_id", event.target.value)}>
                <option value="">Select reporting manager</option>
                {managers.map((item) => <option key={item.id} value={item.id}>{item.userCode} — {item.fullName}</option>)}
              </Select>
            </FormField>
          </FormSection>

          <div className="border-t border-brand-border" />

          <FormSection title="Account Access">
            {can("Users.AssignUserType") ? (
              <FormField id="user-type" label="User Type" help="Optional. Leave unassigned to create the account as PENDING.">
                <Select id="user-type" value={form.user_type_id} aria-describedby="user-type-help" onChange={(event) => updateField("user_type_id", event.target.value)}>
                  <option value="">Pending assignment</option>
                  {types.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
                </Select>
              </FormField>
            ) : (
              <p className="rounded-md border border-brand-border bg-surface-subtle px-3 py-2 text-sm text-text-secondary sm:col-span-2">
                This user will be created as PENDING. OWNER or GM must assign the final User Type.
              </p>
            )}
          </FormSection>
        </div>

        {error ? <div className="shrink-0 px-4 pb-3 sm:px-5"><ErrorText>{error}</ErrorText></div> : null}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-brand-border bg-surface-subtle px-4 py-3 sm:px-5">
          <Button type="button" variant="secondary" disabled={submitting} onClick={close}>Cancel</Button>
          <Button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create User"}</Button>
        </div>
      </form>
      </section>
    </div>
  );
}
