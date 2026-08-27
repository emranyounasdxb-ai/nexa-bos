"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { apiGet, apiRequest } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";
import type { ManagerOption, OrgRef, UserTypeSummary } from "@/lib/types";

const STATUSES = ["Active", "Probation", "Notice Period", "Resigned", "Terminated", "Inactive"];

export default function CreateUserPage() {
  const router = useRouter();
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
    void apiGet<{ items: UserTypeSummary[] }>("/api/v1/user-types", api)
      .then((data) => setTypes(data.items.filter((item) => item.code !== "OWNER")))
      .catch(() => undefined);
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
  }, []);

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
          user_type_id: form.user_type_id || null,
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
      <h2 className="text-xl font-semibold">Create user</h2>
      <form onSubmit={(event) => void onSubmit(event)} className="grid gap-3">
        {[
          ["full_name", "Full name"],
          ["employee_code", "Employee code"],
          ["email", "Email"],
          ["mobile", "Mobile number"],
        ].map(([name, label]) => (
          <label key={name} className="block text-sm">
            {label}
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              type={name === "email" ? "email" : "text"}
              value={form[name as keyof typeof form]}
              onChange={(event) => setForm({ ...form, [name]: event.target.value })}
              required
            />
          </label>
        ))}
        <label className="block text-sm">
          Designation
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
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
          </select>
        </label>
        <label className="block text-sm">
          Joining date
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            type="date"
            value={form.joining_date}
            onChange={(event) => setForm({ ...form, joining_date: event.target.value })}
            required
          />
        </label>
        <label className="block text-sm">
          Employment status
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={form.employment_status}
            onChange={(event) => setForm({ ...form, employment_status: event.target.value })}
          >
            {STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        {["Resigned", "Terminated"].includes(form.employment_status) ? (
          <label className="block text-sm">
            Last working date
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              type="date"
              value={form.last_working_date}
              onChange={(event) => setForm({ ...form, last_working_date: event.target.value })}
              required
            />
          </label>
        ) : null}
        <label className="block text-sm">
          Office
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
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
          </select>
        </label>
        <label className="block text-sm">
          Department
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={form.department_id}
            onChange={(event) => setForm({ ...form, department_id: event.target.value, team_id: "" })}
          >
            <option value="">None</option>
            {filteredDepartments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} — {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Team
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={form.team_id}
            onChange={(event) => setForm({ ...form, team_id: event.target.value })}
          >
            <option value="">None</option>
            {filteredTeams.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} — {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          User type (optional)
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={form.user_type_id}
            onChange={(event) => setForm({ ...form, user_type_id: event.target.value })}
          >
            <option value="">Unassigned</option>
            {types.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} — {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Reporting manager
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={form.reporting_manager_id}
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
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" type="submit">
          Create
        </button>
      </form>
    </section>
  );
}
