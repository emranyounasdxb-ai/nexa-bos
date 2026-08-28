"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { DatePicker } from "@/components/date-picker";
import { Button, ErrorText, PageHeader, Select, TextInput, controlClass } from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";
import type { ManagerOption, OrgRef, UserRecord } from "@/lib/types";

const STATUSES = ["Active", "Probation", "Notice Period", "Resigned", "Terminated", "Inactive"];

function withCurrent(eligible: OrgRef[], currentId: string, all: OrgRef[]): OrgRef[] {
  if (!currentId || eligible.some((item) => item.id === currentId)) {
    return eligible;
  }
  const current = all.find((item) => item.id === currentId);
  return current ? [current, ...eligible] : eligible;
}

function orgAssignmentIssues(
  form: Record<string, string>,
  departments: OrgRef[],
  teams: OrgRef[],
): string[] {
  const issues: string[] = [];
  const officeId = form.office_id ?? "";
  const departmentId = form.department_id ?? "";
  const teamId = form.team_id ?? "";
  const department = departments.find((item) => item.id === departmentId);
  const team = teams.find((item) => item.id === teamId);
  if (departmentId && !officeId) {
    issues.push("Department requires an office. Select an office or clear the department.");
  } else if (departmentId && department?.officeId !== officeId) {
    issues.push(
      "Department must belong to the selected office. Select a valid department or clear it.",
    );
  }
  if (teamId && (!officeId || !departmentId)) {
    issues.push(
      "Team requires matching office and department. Select valid values or clear the team.",
    );
  } else if (teamId && (team?.officeId !== officeId || team?.departmentId !== departmentId)) {
    issues.push(
      "Team must match the selected office and department. Select a valid team or clear it.",
    );
  }
  return issues;
}

export default function EditUserPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const api = getBrowserApiUrl();
  const [form, setForm] = useState<Record<string, string>>({});
  const [designations, setDesignations] = useState<OrgRef[]>([]);
  const [offices, setOffices] = useState<OrgRef[]>([]);
  const [departments, setDepartments] = useState<OrgRef[]>([]);
  const [teams, setTeams] = useState<OrgRef[]>([]);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState("");
  const orgDirty = useRef(false);
  const userHydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void apiGet<UserRecord>(`/api/v1/users/${params.id}`, api).then((user) => {
      if (cancelled || orgDirty.current || userHydrated.current) {
        return;
      }
      userHydrated.current = true;
      setForm({
        full_name: user.fullName,
        employee_code: user.employeeCode,
        email: user.email,
        mobile: user.mobile,
        designation_id: user.designation?.id ?? "",
        employment_status: user.employmentStatus,
        joining_date: user.joiningDate,
        last_working_date: user.lastWorkingDate ?? "",
        office_id: user.office?.id ?? "",
        department_id: user.department?.id ?? "",
        team_id: user.team?.id ?? "",
        reporting_manager_id: user.reportingManagerId ?? "",
      });
      setIsOwner(user.userType?.code === "OWNER");
    });
    void apiGet<{ items: OrgRef[] }>("/api/v1/designations", api).then((data) => {
      if (!cancelled) setDesignations(data.items);
    });
    void apiGet<{ items: OrgRef[] }>("/api/v1/offices", api).then((data) => {
      if (!cancelled) setOffices(data.items);
    });
    void apiGet<{ items: OrgRef[] }>("/api/v1/departments", api).then((data) => {
      if (!cancelled) setDepartments(data.items);
    });
    void apiGet<{ items: OrgRef[] }>("/api/v1/teams", api).then((data) => {
      if (!cancelled) setTeams(data.items);
    });
    void apiGet<{ items: ManagerOption[] }>(
      `/api/v1/users/managers?excludeUserId=${params.id}`,
      api,
    ).then((data) => {
      if (!cancelled) setManagers(data.items);
    });
    return () => {
      cancelled = true;
    };
  }, [api, params.id]);

  const departmentValid = Boolean(
    form.department_id &&
      departments.some(
        (item) => item.id === form.department_id && item.officeId === form.office_id,
      ),
  );
  const departmentOptions = useMemo(
    () =>
      withCurrent(
        form.office_id ? departments.filter((item) => item.officeId === form.office_id) : [],
        form.department_id ?? "",
        departments,
      ),
    [departments, form.department_id, form.office_id],
  );
  const teamOptions = useMemo(
    () =>
      withCurrent(
        form.office_id && departmentValid
          ? teams.filter(
              (item) =>
                item.officeId === form.office_id && item.departmentId === form.department_id,
            )
          : [],
        form.team_id ?? "",
        teams,
      ),
    [departmentValid, form.department_id, form.office_id, form.team_id, teams],
  );
  const assignmentIssues = orgAssignmentIssues(form, departments, teams);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const issues = orgAssignmentIssues(form, departments, teams);
    if (issues.length) {
      setError(issues[0] ?? "Select valid office, department, and team values before saving.");
      return;
    }
    try {
      await apiRequest(`/api/v1/users/${params.id}`, api, {
        method: "PATCH",
        body: JSON.stringify({
          ...form,
          last_working_date: form.last_working_date || null,
          office_id: form.office_id || null,
          department_id: form.department_id || null,
          team_id: form.team_id || null,
          reporting_manager_id: isOwner ? null : form.reporting_manager_id || null,
        }),
      });
      router.push(`/users/${params.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  if (!form.full_name) {
    return <p className="text-sm">Loading…</p>;
  }

  return (
    <section className="max-w-2xl space-y-4">
      <PageHeader title="Edit user" />
      <form onSubmit={(event) => void onSubmit(event)} className="grid gap-3">
        {["full_name", "employee_code", "email", "mobile"].map((name) => (
          <label key={name} className="block text-sm">
            {name.replace("_", " ")}
            <TextInput
              value={form[name] ?? ""}
              onChange={(event) => setForm({ ...form, [name]: event.target.value })}
            />
          </label>
        ))}
        <label className="block text-sm">
          Designation
          <Select
            value={form.designation_id}
            onChange={(event) => setForm({ ...form, designation_id: event.target.value })}
          >
            {designations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} — {item.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-sm">
          Joining date
          <DatePicker
            value={form.joining_date}
            onChange={(joining_date) => setForm({ ...form, joining_date })}
            required
            aria-label="Joining date"
          />
        </label>
        <label className="block text-sm" htmlFor="edit-office">
          Office
        </label>
        <select
          id="edit-office"
          className={`${controlClass} mt-1`}
          value={form.office_id}
          onChange={(event) => {
            orgDirty.current = true;
            setForm((current) => ({ ...current, office_id: event.target.value }));
          }}
        >
          <option value="">None</option>
          {offices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.name}
            </option>
          ))}
        </select>
        <label className="block text-sm" htmlFor="edit-department">
          Department
        </label>
        <select
          id="edit-department"
          className={`${controlClass} mt-1`}
          value={form.department_id ?? ""}
          onChange={(event) => {
            orgDirty.current = true;
            setForm((current) => ({ ...current, department_id: event.target.value }));
          }}
        >
          <option value="">None</option>
          {departmentOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.name}
              {item.officeId !== form.office_id ? " (does not match office)" : ""}
            </option>
          ))}
        </select>
        <label className="block text-sm" htmlFor="edit-team">
          Team
        </label>
        <select
          id="edit-team"
          className={`${controlClass} mt-1`}
          value={form.team_id ?? ""}
          onChange={(event) => {
            orgDirty.current = true;
            setForm((current) => ({ ...current, team_id: event.target.value }));
          }}
        >
          <option value="">None</option>
          {teamOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.name}
              {item.officeId !== form.office_id || item.departmentId !== form.department_id
                ? " (does not match office and department)"
                : ""}
            </option>
          ))}
        </select>
        <label className="block text-sm">
          Employment status
          <select
            className={`${controlClass} mt-1`}
            value={form.employment_status}
            onChange={(event) => setForm({ ...form, employment_status: event.target.value })}
          >
            {STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Last working date
          <DatePicker
            value={form.last_working_date}
            onChange={(last_working_date) => setForm({ ...form, last_working_date })}
            optional
            aria-label="Last working date"
          />
        </label>
        {isOwner ? null : (
          <label className="block text-sm">
            Reporting manager
            <select
              className={`${controlClass} mt-1`}
              value={form.reporting_manager_id ?? ""}
              onChange={(event) => setForm({ ...form, reporting_manager_id: event.target.value })}
            >
              <option value="">None</option>
              {managers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.userCode} — {item.fullName}
                </option>
              ))}
            </select>
          </label>
        )}
        {assignmentIssues.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-red-700" data-testid="org-assignment-error">
            {assignmentIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={assignmentIssues.length > 0}>
          Save
        </Button>
      </form>
    </section>
  );
}
