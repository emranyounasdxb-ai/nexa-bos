"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { DatePicker } from "@/components/date-picker";
import { Button, ErrorText, PageHeader, Select, TextInput } from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { ManagerOption, OrgRef, UserTypeSummary } from "@/lib/types";

const STATUSES = ["Active", "Probation", "Notice Period", "Resigned", "Terminated", "Inactive"];

export default function CreateUserPage() {
  const router = useRouter();
  const { can } = useAuth();
  const [types, setTypes] = useState<UserTypeSummary[]>([]);
  const [designations, setDesignations] = useState<OrgRef[]>([]);
  const [offices, setOffices] = useState<OrgRef[]>([]);
  const [departments, setDepartments] = useState<(OrgRef & { officeId?: string })[]>([]);
  const [teams, setTeams] = useState<(OrgRef & { officeId?: string; departmentId?: string })[]>([]);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    full_name: "",
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
  });

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

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await apiRequest<{ id: string }>("/api/v1/users", getBrowserApiUrl(), {
        method: "POST",
        body: JSON.stringify({
          ...form,
          last_working_date: form.last_working_date || null,
          office_id: form.office_id || null,
          department_id: form.department_id || null,
          team_id: form.team_id || null,
          user_type_id: can("Users.AssignUserType") ? form.user_type_id || null : null,
          reporting_manager_id: form.reporting_manager_id || null,
        }),
      });
      router.push(`/users/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  }

  return (
    <section className="max-w-2xl space-y-4">
      <PageHeader title="Create user" />
      <form onSubmit={(event) => void onSubmit(event)} className="grid gap-3">
        {[
          ["full_name", "Full name"],
          ["employee_code", "Employee code"],
          ["email", "Email"],
          ["mobile", "Mobile number"],
        ].map(([name, label]) => (
          <label key={name} className="block text-sm">
            {label}
            <TextInput
              type={name === "email" ? "email" : "text"}
              value={form[name as keyof typeof form]}
              onChange={(event) => setForm({ ...form, [name]: event.target.value })}
              required
            />
          </label>
        ))}
        <label className="block text-sm">
          Designation
          <Select
            value={form.designation_id}
            onChange={(event) => setForm({ ...form, designation_id: event.target.value })}
            required
          >
            <option value="">Select</option>
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
        <label className="block text-sm">
          Employment status
          <Select
            value={form.employment_status}
            onChange={(event) => setForm({ ...form, employment_status: event.target.value })}
          >
            {STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </Select>
        </label>
        {["Resigned", "Terminated"].includes(form.employment_status) ? (
          <label className="block text-sm">
            Last working date
            <DatePicker
              value={form.last_working_date}
              onChange={(last_working_date) => setForm({ ...form, last_working_date })}
              required
              aria-label="Last working date"
            />
          </label>
        ) : null}
        <label className="block text-sm">
          Office
          <Select
            value={form.office_id}
            onChange={(event) =>
              setForm({ ...form, office_id: event.target.value, department_id: "", team_id: "" })
            }
          >
            <option value="">None</option>
            {offices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} — {item.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-sm">
          Department
          <Select
            value={form.department_id}
            onChange={(event) => setForm({ ...form, department_id: event.target.value, team_id: "" })}
          >
            <option value="">None</option>
            {filteredDepartments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} — {item.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-sm">
          Team
          <Select
            value={form.team_id}
            onChange={(event) => setForm({ ...form, team_id: event.target.value })}
          >
            <option value="">None</option>
            {filteredTeams.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} — {item.name}
              </option>
            ))}
          </Select>
        </label>
        {can("Users.AssignUserType") ? (
          <label className="block text-sm">
            User type (optional)
            <Select
              value={form.user_type_id}
              onChange={(event) => setForm({ ...form, user_type_id: event.target.value })}
            >
              <option value="">Pending assignment</option>
              {types.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <p className="rounded-lg border border-brand-border bg-brand-soft p-3 text-sm text-text-secondary">
            This user will be created as PENDING. OWNER or GM must assign the final User Type.
          </p>
        )}
        <label className="block text-sm">
          Reporting manager
          <Select
            value={form.reporting_manager_id}
            onChange={(event) => setForm({ ...form, reporting_manager_id: event.target.value })}
          >
            <option value="">None</option>
            {managers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.userCode} — {item.fullName}
              </option>
            ))}
          </Select>
        </label>
        <ErrorText>{error}</ErrorText>
        <Button type="submit">Create</Button>
      </form>
    </section>
  );
}
