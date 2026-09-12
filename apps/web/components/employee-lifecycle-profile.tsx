"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DatePicker } from "@/components/date-picker";
import { IconCalendarCheck, IconFileDescription, IconX } from "@/components/icons";
import { ProfileNationalitySelect } from "@/components/profile-nationality-select";
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  LoadingState,
  SectionHeader,
  Select,
  StatusBadge,
  Textarea,
  TextInput,
} from "@/components/ui";
import { apiDownload, apiGet, apiRequest } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";
import type { ManagerOption, OrgRef } from "@/lib/types";

type Completion = { state: string; completed: number; required: number; missing: string[] };
type HrData = {
  dateOfBirth: string | null;
  gender: string | null;
  nationality: string | null;
  maritalStatus: string | null;
  emergencyContactName: string | null;
  emergencyContactRelationship: string | null;
  emergencyContactMobile: string | null;
  employeeStatus: string;
  employeeType: string | null;
  employmentType: string | null;
  joiningDate: string;
  probationEndDate: string | null;
  jobTitle: string | null;
  department: OrgRef | null;
  businessUnit: string | null;
  location: string | null;
  reportingManagerId: string | null;
  reportingManager: { id: string; name: string; userCode: string } | null;
  workEmail: string;
  workMobile: string;
  employeeGrade: string | null;
  basicSalary: string | null;
  housingAllowance: string | null;
  transportAllowance: string | null;
  otherAllowances: string | null;
  grossSalary: string | null;
  paymentMethod: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  iban: string | null;
  bankAccountNumber: string | null;
  hrNotes: string | null;
  lockVersion: number;
  updatedAt: string;
};
type DocumentRecord = {
  id: string;
  kind: string;
  label: string;
  name: string | null;
  documentNumber: string | null;
  visaType: string | null;
  medicalStatus: string | null;
  insuranceProvider: string | null;
  expiryDate: string | null;
  status: string;
  declaredStatus: string | null;
  notes: string | null;
  hasAttachment: boolean;
  originalFilename: string | null;
  version: number;
  updatedAt: string;
};
type Profile = {
  revision: string;
  canUpdateHr: boolean;
  canUpdatePro: boolean;
  canViewAttachments: boolean;
  documentPermissions: { upload: boolean; replace: boolean; view: boolean; download: boolean; delete: boolean; history: boolean; purge: boolean };
  basic: { completion: Completion } | null;
  hr: { data: HrData | null; completion: Completion; employeeCode: string | null; workEmail: string | null; workMobile: string | null } | null;
  pro: { documents: DocumentRecord[]; completion: Completion } | null;
};

const kinds = [
  ["passport", "Passport"],
  ["visa", "Visa / Residence"],
  ["emirates_id", "Emirates ID"],
  ["work_permit", "Labour Card / Work Permit"],
  ["medical", "Medical / Fitness"],
  ["insurance", "Health Insurance"],
  ["other", "Other document"],
] as const;

// These are UI suggestions, not new API enums. Any saved text remains an option.
const personalOptions: Record<string, string[]> = {
  gender: ["Female", "Male", "Other", "Prefer not to say"],
  marital_status: ["Single", "Married", "Divorced", "Widowed", "Separated", "Prefer not to say"],
};

function ProfileDate({ id, label, value, disabled, onChange }: {
  id: string; label: string; value: string; disabled?: boolean; onChange: (value: string) => void;
}) {
  return <div className="relative [&_input]:pr-9 [&_[role=dialog]]:right-0"
    onKeyDown={(event) => {
      const target = event.target as HTMLElement;
      if (event.key === "Escape" || (event.key === "Enter" && /^\d{4}-\d{2}-\d{2}$/.test(target.getAttribute("aria-label") ?? ""))) document.getElementById(id)?.focus();
    }}
    onClick={(event) => {
      const button = (event.target as HTMLElement).closest("button");
      if (button && /^\d{4}-\d{2}-\d{2}$/.test(button.getAttribute("aria-label") ?? "")) document.getElementById(id)?.focus();
    }}>
    <DatePicker id={id} aria-label={label} value={value} disabled={disabled} onChange={onChange} optional />
    <button type="button" disabled={disabled} aria-label={`Open ${label} calendar`}
      className="absolute right-0 top-0 flex size-8 items-center justify-center rounded-md text-brand-primary focus-visible:outline-2 focus-visible:outline-brand-primary disabled:text-text-disabled"
      onClick={() => { const input = document.getElementById(id); input?.focus(); input?.click(); }}>
      <IconCalendarCheck className="size-4" />
    </button>
  </div>;
}

function completionCard(title: string, completion: Completion) {
  return (
    <Card className="!p-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[length:var(--amafh-text-section)] font-semibold text-text-primary">{title}</h2>
        <StatusBadge value={completion.state} />
      </div>
      <p className="mt-2 text-xs text-text-secondary">
        {completion.completed} of {completion.required} required fields complete
      </p>
      {completion.missing.length ? (
        <details className="mt-1 text-xs text-text-secondary">
          <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-brand-primary">Missing fields ({completion.missing.length})</summary>
          <p className="mt-1">Missing: {completion.missing.join(", ")}</p>
        </details>
      ) : null}
    </Card>
  );
}

function value(data: HrData | null, key: keyof HrData) {
  const result = data?.[key];
  return result == null ? "" : String(result);
}

export function EmployeeLifecycleProfile({ userId, section }: { userId: string; section: "hr" | "pro" }) {
  const api = getBrowserApiUrl();
  const fileRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [documentKind, setDocumentKind] = useState("passport");
  const [documentName, setDocumentName] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [documentExpiry, setDocumentExpiry] = useState("");
  const [documentVisaType, setDocumentVisaType] = useState("");
  const [documentMedicalStatus, setDocumentMedicalStatus] = useState("");
  const [documentProvider, setDocumentProvider] = useState("");
  const [documentStatus, setDocumentStatus] = useState("");
  const [documentNotes, setDocumentNotes] = useState("");
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
  const [replacementReason, setReplacementReason] = useState("");
  const [hrDraft, setHrDraft] = useState<Record<string, string>>({});
  const [histories, setHistories] = useState<Record<string, DocumentRecord[]>>({});
  const [departments, setDepartments] = useState<OrgRef[]>([]);
  const [managers, setManagers] = useState<ManagerOption[]>([]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const next = await apiGet<Profile>(`/api/v1/employee-profiles/${userId}`, api);
      setProfile((current) => current?.revision === next.revision ? current : next);
      setError("");
    } catch (caught) {
      if (!quiet) setError(caught instanceof Error ? caught.message : "Profile could not be loaded.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [api, userId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 15000);
    const refreshOnFocus = () => void load(true);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!profile?.canUpdateHr) return;
    let cancelled = false;
    void Promise.all([
      apiGet<{ items: OrgRef[] }>("/api/v1/departments", api),
      apiGet<{ items: ManagerOption[] }>(`/api/v1/users/managers?excludeUserId=${userId}`, api),
    ]).then(([departmentData, managerData]) => {
      if (cancelled) return;
      setDepartments(departmentData.items);
      setManagers(managerData.items);
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Employment options could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [api, profile?.canUpdateHr, userId]);

  useEffect(() => {
    const data = profile?.hr?.data ?? null;
    if (!profile?.hr) return;
    setHrDraft({
      date_of_birth: value(data, "dateOfBirth"), gender: value(data, "gender"),
      nationality: value(data, "nationality"), marital_status: value(data, "maritalStatus"),
      emergency_contact_name: value(data, "emergencyContactName"),
      emergency_contact_relationship: value(data, "emergencyContactRelationship"),
      emergency_contact_mobile: value(data, "emergencyContactMobile"), employee_status: value(data, "employeeStatus"),
      employee_type: value(data, "employeeType"), employment_type: value(data, "employmentType"),
      joining_date: value(data, "joiningDate"), probation_end_date: value(data, "probationEndDate"),
      job_title: value(data, "jobTitle"), department_id: data?.department?.id ?? "",
      business_unit: value(data, "businessUnit"), location: value(data, "location"),
      reporting_manager_id: value(data, "reportingManagerId"),
      employee_code: profile.hr.employeeCode ?? "",
      work_email: profile.hr.workEmail ?? "", work_mobile: profile.hr.workMobile ?? "",
      employee_grade: value(data, "employeeGrade"), basic_salary: value(data, "basicSalary"),
      housing_allowance: value(data, "housingAllowance"), transport_allowance: value(data, "transportAllowance"),
      other_allowances: value(data, "otherAllowances"), payment_method: value(data, "paymentMethod"),
      bank_name: value(data, "bankName"), bank_account_name: value(data, "bankAccountName"),
      iban: value(data, "iban"), bank_account_number: value(data, "bankAccountNumber"),
      hr_notes: value(data, "hrNotes"),
    });
  }, [profile?.hr]);

  useEffect(() => {
    if (section !== "pro" || !profile?.pro) return;
    const selected = new URLSearchParams(window.location.search).get("document");
    if (!selected) return;
    const record = document.getElementById(`employee-document-${selected}`);
    record?.scrollIntoView({ block: "center" });
    record?.focus({ preventScroll: true });
  }, [profile?.pro, section]);

  const hrGroups = useMemo(() => [
    { title: "Personal & identification", fields: [["employee_code", "Employee Code"], ["date_of_birth", "Date of birth", "date"], ["gender", "Gender"], ["nationality", "Nationality"], ["marital_status", "Marital status"]] },
    { title: "Emergency contact", fields: [["emergency_contact_name", "Name"], ["emergency_contact_relationship", "Relationship"], ["emergency_contact_mobile", "Mobile"]] },
    { title: "Employment", fields: [["employee_status", "Employee status", "status"], ["employee_type", "Employee type"], ["employment_type", "Employment type"], ["joining_date", "Joining date", "date"], ["probation_end_date", "Probation end", "date"], ["job_title", "Job title"], ["department_id", "Department", "department"], ["business_unit", "Business unit"], ["location", "Location"], ["reporting_manager_id", "Reporting manager", "manager"], ["work_email", "Work email", "email"], ["work_mobile", "Work mobile"], ["employee_grade", "Grade"]] },
    { title: "Compensation", fields: [["basic_salary", "Basic salary", "number"], ["housing_allowance", "Housing allowance", "number"], ["transport_allowance", "Transport allowance", "number"], ["other_allowances", "Other allowances", "number"], ["payment_method", "Payment method"]] },
    { title: "Bank", fields: [["bank_name", "Bank name"], ["bank_account_name", "Account name"], ["iban", "IBAN"], ["bank_account_number", "Account number"]] },
  ], []);

  async function saveHr(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      const body: Record<string, unknown> = Object.fromEntries(Object.entries(hrDraft).map(([key, item]) => [key, item || null]));
      body.lock_version = profile?.hr?.data?.lockVersion ?? null;
      await apiRequest(`/api/v1/employee-profiles/${userId}/hr`, api, { method: "PUT", body: JSON.stringify(body) });
      await load(true); setMessage("HR profile saved.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "HR profile could not be saved."); }
    finally { setSaving(false); }
  }

  function resetDocumentDraft() {
    setDocumentKind("passport"); setDocumentName(""); setDocumentNumber("");
    setDocumentExpiry(""); setDocumentVisaType(""); setDocumentMedicalStatus("");
    setDocumentProvider(""); setDocumentStatus(""); setDocumentNotes("");
    setEditingDocumentId(null); setReplacementReason("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function editDocument(row: DocumentRecord) {
    setDocumentKind(row.kind); setDocumentName(row.name ?? "");
    setDocumentNumber(row.documentNumber ?? ""); setDocumentExpiry(row.expiryDate ?? "");
    setDocumentVisaType(row.visaType ?? ""); setDocumentMedicalStatus(row.medicalStatus ?? "");
    setDocumentProvider(row.insuranceProvider ?? ""); setDocumentStatus(row.declaredStatus ?? "");
    setDocumentNotes(row.notes ?? ""); setEditingDocumentId(row.id); setReplacementReason("");
  }

  async function saveDocumentMetadata(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      const payload = {
        kind: documentKind, name: documentKind === "other" ? documentName : null,
        document_number: documentNumber || null, expiry_date: documentExpiry || null,
        visa_type: documentKind === "visa" ? documentVisaType || null : null,
        medical_status: documentKind === "medical" ? documentMedicalStatus || null : null,
        insurance_provider: documentKind === "insurance" ? documentProvider || null : null,
        declared_status: documentStatus || null, notes: documentNotes || null,
      };
      if (editingDocumentId) {
        await apiRequest(`/api/v1/employee-profiles/${userId}/documents/${editingDocumentId}`, api, {
          method: "PATCH", body: JSON.stringify({ ...payload, replacement_reason: replacementReason }),
        });
      } else {
        const created = await apiRequest<DocumentRecord>(`/api/v1/employee-profiles/${userId}/documents`, api, {
          method: "POST", body: JSON.stringify(payload),
        });
        const file = fileRef.current?.files?.[0];
        if (file) {
          const form = new FormData(); form.append("file", file);
          await apiRequest(`/api/v1/employee-profiles/${userId}/documents/${created.id}/upload`, api, { method: "POST", body: form });
        }
      }
      resetDocumentDraft(); await load(true);
      setMessage(editingDocumentId ? "PRO document metadata replaced; prior version preserved." : "PRO document record added.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Document could not be added."); }
    finally { setSaving(false); }
  }

  async function download(row: DocumentRecord) {
    try {
      const result = await apiDownload(`/api/v1/employee-profiles/${userId}/documents/${row.id}/download`, api);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = result.filename ?? row.originalFilename ?? "document"; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Document could not be downloaded."); }
  }

  async function view(row: DocumentRecord) {
    try {
      const result = await apiDownload(`/api/v1/employee-profiles/${userId}/documents/${row.id}/view`, api);
      const url = URL.createObjectURL(result.blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Document could not be viewed."); }
  }

  async function uploadOrReplace(row: DocumentRecord, file: File) {
    const replacing = row.hasAttachment;
    const reason = replacing ? window.prompt("Reason for replacing this document attachment:") : null;
    if (replacing && !reason) return;
    const form = new FormData(); form.append("file", file);
    if (reason) form.append("reason", reason);
    try {
      await apiRequest(`/api/v1/employee-profiles/${userId}/documents/${row.id}/${replacing ? "replace" : "upload"}`, api, { method: "POST", body: form });
      await load(true); setMessage(replacing ? "Document attachment replaced; prior version preserved." : "Document attachment uploaded.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Document attachment could not be saved."); }
  }

  async function showHistory(row: DocumentRecord) {
    try {
      const result = await apiGet<{ items: DocumentRecord[] }>(`/api/v1/employee-profiles/${userId}/documents/${row.id}/history`, api);
      setHistories((current) => ({ ...current, [row.id]: current[row.id] ? [] : result.items }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Document history could not be loaded."); }
  }

  async function remove(row: DocumentRecord) {
    const reason = window.prompt("Reason for removing this document from the current profile:");
    if (!reason) return;
    try {
      await apiRequest(`/api/v1/employee-profiles/${userId}/documents/${row.id}`, api, { method: "DELETE", body: JSON.stringify({ reason }) });
      await load(true); setMessage("Document removed from the current profile. History is preserved.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Document could not be removed."); }
  }

  async function purge(row: DocumentRecord) {
    if (!window.confirm("Permanently purge every stored version of this document? This cannot be undone.")) return;
    const reason = window.prompt("Required permanent-purge reason:");
    if (!reason) return;
    try {
      await apiRequest(`/api/v1/employee-profiles/${userId}/documents/${row.id}/purge`, api, { method: "DELETE", body: JSON.stringify({ reason }) });
      await load(true); setMessage("Document versions and stored files permanently purged. Audit evidence remains.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Document could not be purged."); }
  }

  if (loading) return <LoadingState>Loading employee lifecycle profile…</LoadingState>;
  if (!profile) return <Card><ErrorText>{error || "Profile is unavailable."}</ErrorText></Card>;

  return (
    <div className="min-w-0 space-y-3" data-testid="employee-lifecycle-profile">
      <div className="grid min-w-0 gap-3 md:grid-cols-3">
        {profile.basic ? completionCard("Basic profile", profile.basic.completion) : null}
        {profile.hr ? completionCard("HR profile", profile.hr.completion) : null}
        {profile.pro ? completionCard("PRO & Documents", profile.pro.completion) : null}
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {message ? <p role="status" className="rounded-md border border-success-soft bg-success-soft px-3 py-2 text-sm">{message}</p> : null}
      {section === "hr" ? (
        profile.hr ? (
          <form onSubmit={(event) => void saveHr(event)} className="space-y-3 rounded-lg border border-brand-border bg-surface p-3">
            {hrGroups.map((group) => (
              <section key={group.title} className="min-w-0 border-b border-brand-border pb-3">
                <SectionHeader title={group.title} />
                <div className="mt-2 grid min-w-0 gap-x-3 gap-y-2 md:grid-cols-2 xl:grid-cols-5" data-testid="hr-field-grid">
                  {group.fields.map(([key, label, type]) => (
                    <Field key={key} label={label} htmlFor={`hr-${key}`} className="min-w-0">
                      {type === "date" ? (
                        <ProfileDate id={`hr-${key}`} label={label} value={hrDraft[key] ?? ""} disabled={!profile.canUpdateHr} onChange={(next) => setHrDraft((current) => ({ ...current, [key]: next }))} />
                      ) : key === "nationality" ? (
                        <ProfileNationalitySelect id={`hr-${key}`} value={hrDraft[key] ?? ""} disabled={!profile.canUpdateHr} onChange={(next) => setHrDraft((current) => ({ ...current, [key]: next }))} />
                      ) : personalOptions[key] ? (
                        <Select id={`hr-${key}`} aria-label={label} value={hrDraft[key] ?? ""} disabled={!profile.canUpdateHr} onChange={(event) => setHrDraft((current) => ({ ...current, [key]: event.target.value }))}>
                          <option value="">Not recorded</option>
                          {hrDraft[key] && !personalOptions[key].includes(hrDraft[key]) ? <option value={hrDraft[key]}>{hrDraft[key]}</option> : null}
                          {personalOptions[key].map((option) => <option key={option} value={option}>{option}</option>)}
                        </Select>
                      ) : type === "status" ? (
                        <Select id={`hr-${key}`} value={hrDraft[key] ?? ""} disabled={!profile.canUpdateHr} onChange={(event) => setHrDraft((current) => ({ ...current, [key]: event.target.value }))}>
                          {["Active", "Probation", "Notice Period", "Resigned", "Terminated", "Inactive"].map((status) => <option key={status} value={status}>{status}</option>)}
                        </Select>
                      ) : type === "department" ? (
                        <Select id={`hr-${key}`} value={hrDraft[key] ?? ""} disabled={!profile.canUpdateHr} onChange={(event) => setHrDraft((current) => ({ ...current, [key]: event.target.value }))}>
                          <option value="">Not assigned</option>
                          {!profile.canUpdateHr && profile.hr?.data?.department ? <option value={profile.hr.data.department.id}>{profile.hr.data.department.name}</option> : null}
                          {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                        </Select>
                      ) : type === "manager" ? (
                        <Select id={`hr-${key}`} value={hrDraft[key] ?? ""} disabled={!profile.canUpdateHr} onChange={(event) => setHrDraft((current) => ({ ...current, [key]: event.target.value }))}>
                          <option value="">Not assigned</option>
                          {!profile.canUpdateHr && profile.hr?.data?.reportingManager ? <option value={profile.hr.data.reportingManager.id}>{profile.hr.data.reportingManager.name}</option> : null}
                          {managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.fullName}</option>)}
                        </Select>
                      ) : (
                        <TextInput id={`hr-${key}`} type={type ?? "text"} step={type === "number" ? "0.01" : undefined} value={hrDraft[key] ?? ""} readOnly={!profile.canUpdateHr || (key === "employee_code" && Boolean(profile.hr?.employeeCode))} onChange={(event) => setHrDraft((current) => ({ ...current, [key]: event.target.value }))} />
                      )}
                    </Field>
                  ))}
                </div>
              </section>
            ))}
            <section className="min-w-0">
              <SectionHeader title="Control" description={`Gross salary: ${profile.hr.data?.grossSalary ?? "Not recorded"}. Created/updated timestamps are system generated.`} />
              <Field label="HR notes" htmlFor="hr-notes"><Textarea id="hr-notes" rows={2} value={hrDraft.hr_notes ?? ""} readOnly={!profile.canUpdateHr} onChange={(event) => setHrDraft((current) => ({ ...current, hr_notes: event.target.value }))} /></Field>
            </section>
            {profile.canUpdateHr ? <div className="flex justify-end"><Button disabled={saving}>{saving ? "Saving…" : "Save HR profile"}</Button></div> : <p className="text-sm text-text-secondary">This sensitive profile is read-only for your account.</p>}
          </form>
        ) : <Card><EmptyState>HR profile metadata is not available for this account.</EmptyState></Card>
      ) : (
        <div className="space-y-4">
          {profile.canUpdatePro ? (
            <Card className="!p-3">
              <SectionHeader title={editingDocumentId ? "Replace document metadata" : "Add document record"} description="Private attachments and metadata are validated and versioned. Issue date is intentionally not collected." />
              <form onSubmit={(event) => void saveDocumentMetadata(event)} className="mt-2 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-5 [&>label]:min-w-0" data-testid="pro-field-grid">
                <Field label="Document type"><Select value={documentKind} disabled={Boolean(editingDocumentId)} onChange={(event) => setDocumentKind(event.target.value)}>{kinds.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
                {documentKind === "other" ? <Field label="Document name"><TextInput value={documentName} onChange={(event) => setDocumentName(event.target.value)} required /></Field> : null}
                <Field label="Number"><TextInput value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} /></Field>
                {documentKind === "visa" ? <Field label="Visa / residence type"><TextInput value={documentVisaType} onChange={(event) => setDocumentVisaType(event.target.value)} required /></Field> : null}
                {documentKind === "medical" ? <Field label="Medical / fitness status"><TextInput value={documentMedicalStatus} onChange={(event) => setDocumentMedicalStatus(event.target.value)} required /></Field> : null}
                {documentKind === "insurance" ? <Field label="Insurance provider"><TextInput value={documentProvider} onChange={(event) => setDocumentProvider(event.target.value)} required /></Field> : null}
                <Field label="Expiry" htmlFor="pro-expiry"><ProfileDate id="pro-expiry" label="Expiry" value={documentExpiry} onChange={setDocumentExpiry} /></Field>
                <Field label="Recorded status"><TextInput value={documentStatus} onChange={(event) => setDocumentStatus(event.target.value)} /></Field>
                {editingDocumentId ? <Field label="Replacement reason"><TextInput value={replacementReason} onChange={(event) => setReplacementReason(event.target.value)} required minLength={3} /></Field> : <Field label="Attachment" htmlFor="pro-attachment" help="PDF, JPG/JPEG, PNG or WebP; maximum 10 MB."><input id="pro-attachment" aria-label="Attachment" ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="mt-1.5 block w-full text-sm" /></Field>}
                <Field label="Notes" className="md:col-span-2 xl:col-span-4"><Textarea rows={2} value={documentNotes} onChange={(event) => setDocumentNotes(event.target.value)} /></Field>
                <div className="flex flex-wrap items-end gap-2"><Button disabled={saving}><IconFileDescription className="size-4" />{saving ? "Saving…" : editingDocumentId ? "Replace metadata" : "Add record"}</Button>{editingDocumentId ? <Button type="button" variant="secondary" onClick={resetDocumentDraft}>Cancel</Button> : null}</div>
              </form>
            </Card>
          ) : null}
          <Card>
            <SectionHeader title="PRO compliance records" description="Passport and Emirates ID are canonical here and are not duplicated in HR." />
            {profile.pro?.documents.length ? <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">{profile.pro.documents.map((row) => (
              <article id={`employee-document-${row.id}`} tabIndex={-1} key={row.id} className="min-w-0 rounded-lg border border-brand-border bg-surface-subtle p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary">
                <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold">{row.label}</h3><p className="text-xs text-text-secondary">Version {row.version} · {row.documentNumber || "No number recorded"}</p></div><StatusBadge value={row.status} /></div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs"><div><dt className="text-text-secondary">Expiry</dt><dd className="font-medium">{row.expiryDate ?? "Not recorded"}</dd></div><div><dt className="text-text-secondary">Attachment</dt><dd className="font-medium">{row.hasAttachment ? row.originalFilename ?? "Available" : "Missing"}</dd></div></dl>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {profile.canUpdatePro ? <Button type="button" size="compact" variant="secondary" onClick={() => editDocument(row)}>Edit metadata</Button> : null}
                  {row.hasAttachment && profile.documentPermissions.view ? <Button type="button" size="compact" variant="secondary" onClick={() => void view(row)}>View</Button> : null}
                  {row.hasAttachment && profile.documentPermissions.download ? <Button type="button" size="compact" variant="secondary" onClick={() => void download(row)}><IconFileDescription className="size-4" />Download</Button> : null}
                  {(!row.hasAttachment && profile.documentPermissions.upload) || (row.hasAttachment && profile.documentPermissions.replace) ? <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-brand-primary px-2.5 text-xs font-medium text-brand-primary focus-within:outline focus-within:outline-2 focus-within:outline-brand-primary">{row.hasAttachment ? "Replace" : "Upload"}<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="sr-only" aria-label={`${row.hasAttachment ? "Replace" : "Upload"} ${row.label} attachment`} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadOrReplace(row, file); event.currentTarget.value = ""; }} /></label> : null}
                  {profile.documentPermissions.history ? <Button type="button" size="compact" variant="ghost" aria-expanded={Boolean(histories[row.id]?.length)} onClick={() => void showHistory(row)}>History</Button> : null}
                  {profile.documentPermissions.delete ? <Button type="button" size="compact" variant="ghost" onClick={() => void remove(row)}><IconX className="size-4" />Remove</Button> : null}
                  {profile.documentPermissions.purge ? <Button type="button" size="compact" variant="danger" onClick={() => void purge(row)}>Purge permanently</Button> : null}
                </div>
                {histories[row.id]?.length ? <ol className="mt-3 space-y-1 border-t border-brand-border pt-3 text-xs text-text-secondary">{histories[row.id].map((version) => <li key={version.id}>Version {version.version} · {version.originalFilename ?? "No attachment"} · {version.updatedAt}</li>)}</ol> : null}
              </article>
            ))}</div> : <EmptyState>No PRO document records have been added.</EmptyState>}
          </Card>
        </div>
      )}
    </div>
  );
}
