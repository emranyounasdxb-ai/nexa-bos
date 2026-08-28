"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { apiGet, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type {
  ApplicationRecord,
  CatalogItem,
  ManagerOption,
  OrgRef,
  WorkflowRecord,
} from "@/lib/types";

const OUTCOMES = ["Completed", "Final Rejected", "Cancelled", "Withdrawn"];

const emptyFilters = {
  bank_id: "",
  product_id: "",
  case_owner_id: "",
  office_id: "",
  department_id: "",
  team_id: "",
  current_stage_id: "",
  terminal_outcome: "",
  submission_from: "",
  submission_to: "",
  bank_stage_from: "",
  bank_stage_to: "",
  created_from: "",
  created_to: "",
  requested_min: "",
  requested_max: "",
  approved_min: "",
  approved_max: "",
  booked_min: "",
  booked_max: "",
  funded_min: "",
  funded_max: "",
};

export default function ApplicationsPage() {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [items, setItems] = useState<ApplicationRecord[]>([]);
  const [error, setError] = useState("");
  const [banks, setBanks] = useState<CatalogItem[]>([]);
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [owners, setOwners] = useState<ManagerOption[]>([]);
  const [offices, setOffices] = useState<OrgRef[]>([]);
  const [departments, setDepartments] = useState<OrgRef[]>([]);
  const [teams, setTeams] = useState<OrgRef[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);

  useEffect(() => {
    void Promise.all([
      apiGet<{ items: CatalogItem[] }>("/api/v1/banks", api),
      apiGet<{ items: CatalogItem[] }>("/api/v1/products", api),
      apiGet<{ items: OrgRef[] }>("/api/v1/offices", api),
      apiGet<{ items: OrgRef[] }>("/api/v1/departments", api),
      apiGet<{ items: OrgRef[] }>("/api/v1/teams", api),
      apiGet<{ items: WorkflowRecord[] }>("/api/v1/workflows", api),
      apiGet<{ items: ManagerOption[] }>("/api/v1/applications/case-owners", api),
    ])
      .then(([bankData, productData, officeData, deptData, teamData, workflowData, ownerData]) => {
        setBanks(bankData.items);
        setProducts(productData.items);
        setOffices(officeData.items);
        setDepartments(deptData.items);
        setTeams(teamData.items);
        setWorkflows(workflowData.items);
        setOwners(ownerData.items);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Load failed"));
  }, [api]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query) {
      params.set("q", query);
    }
    for (const [key, value] of Object.entries(applied)) {
      if (value) {
        params.set(key, value);
      }
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    void apiGet<{ items: ApplicationRecord[] }>(`/api/v1/applications${suffix}`, api)
      .then((data) => {
        setItems(data.items);
        setError("");
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err.message : "Unable to load applications");
      });
  }, [api, applied, query]);

  const stages = useMemo(
    () =>
      workflows.flatMap((workflow) =>
        workflow.stages.map((stage) => ({
          id: stage.id,
          label: `${workflow.bank?.code ?? ""}/${workflow.product?.code ?? ""} v${workflow.version}: ${stage.name}`,
        })),
      ),
    [workflows],
  );

  const officeDepartments = departments.filter(
    (item) => !filters.office_id || item.officeId === filters.office_id,
  );
  const officeTeams = teams.filter(
    (item) =>
      (!filters.office_id || item.officeId === filters.office_id) &&
      (!filters.department_id || item.departmentId === filters.department_id),
  );

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Applications</h2>
        {can("Applications.Create") ? (
          <Link
            className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white"
            href="/applications/new"
          >
            Create application
          </Link>
        ) : null}
      </div>
      <input
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        placeholder="Search application ID, bank file, customer code, name, or mobile"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search applications"
      />
      <form
        className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ ...filters });
        }}
      >
        <select
          className="rounded-md border px-3 py-2 text-sm"
          aria-label="Filter by bank"
          value={filters.bank_id}
          onChange={(event) => setFilters({ ...filters, bank_id: event.target.value })}
        >
          <option value="">All banks</option>
          {banks.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border px-3 py-2 text-sm"
          aria-label="Filter product"
          value={filters.product_id}
          onChange={(event) => setFilters({ ...filters, product_id: event.target.value })}
        >
          <option value="">All products</option>
          {products.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border px-3 py-2 text-sm"
          aria-label="Filter case owner"
          value={filters.case_owner_id}
          onChange={(event) => setFilters({ ...filters, case_owner_id: event.target.value })}
        >
          <option value="">All case owners</option>
          {owners.map((item) => (
            <option key={item.id} value={item.id}>
              {item.fullName}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border px-3 py-2 text-sm"
          aria-label="Filter office"
          value={filters.office_id}
          onChange={(event) =>
            setFilters({ ...filters, office_id: event.target.value, department_id: "", team_id: "" })
          }
        >
          <option value="">All offices</option>
          {offices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.name}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border px-3 py-2 text-sm"
          aria-label="Filter department"
          value={filters.department_id}
          onChange={(event) =>
            setFilters({ ...filters, department_id: event.target.value, team_id: "" })
          }
        >
          <option value="">All departments</option>
          {officeDepartments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.name}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border px-3 py-2 text-sm"
          aria-label="Filter team"
          value={filters.team_id}
          onChange={(event) => setFilters({ ...filters, team_id: event.target.value })}
        >
          <option value="">All teams</option>
          {officeTeams.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.name}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border px-3 py-2 text-sm"
          aria-label="Filter current stage"
          value={filters.current_stage_id}
          onChange={(event) => setFilters({ ...filters, current_stage_id: event.target.value })}
        >
          <option value="">All stages</option>
          {stages.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border px-3 py-2 text-sm"
          aria-label="Filter terminal outcome"
          value={filters.terminal_outcome}
          onChange={(event) => setFilters({ ...filters, terminal_outcome: event.target.value })}
        >
          <option value="">All outcomes</option>
          {OUTCOMES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <label className="text-sm">
          Submission from
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            type="date"
            aria-label="Filter submission from"
            value={filters.submission_from}
            onChange={(event) => setFilters({ ...filters, submission_from: event.target.value })}
          />
        </label>
        <label className="text-sm">
          Submission to
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            type="date"
            aria-label="Filter submission to"
            value={filters.submission_to}
            onChange={(event) => setFilters({ ...filters, submission_to: event.target.value })}
          />
        </label>
        <label className="text-sm">
          Bank stage from
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            type="date"
            aria-label="Bank stage date from"
            value={filters.bank_stage_from}
            onChange={(event) => setFilters({ ...filters, bank_stage_from: event.target.value })}
          />
        </label>
        <label className="text-sm">
          Bank stage to
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            type="date"
            aria-label="Bank stage date to"
            value={filters.bank_stage_to}
            onChange={(event) => setFilters({ ...filters, bank_stage_to: event.target.value })}
          />
        </label>
        <label className="text-sm">
          Created from
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            type="date"
            aria-label="Filter created from"
            value={filters.created_from}
            onChange={(event) => setFilters({ ...filters, created_from: event.target.value })}
          />
        </label>
        <label className="text-sm">
          Created to
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            type="date"
            aria-label="Filter created to"
            value={filters.created_to}
            onChange={(event) => setFilters({ ...filters, created_to: event.target.value })}
          />
        </label>
        {(
          [
            ["requested_min", "Requested min"],
            ["requested_max", "Requested max"],
            ["approved_min", "Approved min"],
            ["approved_max", "Approved max"],
            ["booked_min", "Booked min"],
            ["booked_max", "Booked max"],
            ["funded_min", "Funded min"],
            ["funded_max", "Funded max"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="text-sm">
            {label}
            <input
              className="mt-1 w-full rounded-md border px-3 py-2"
              type="number"
              min="0"
              step="0.01"
              aria-label={`Filter ${label.toLowerCase()}`}
              value={filters[key]}
              onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}
            />
          </label>
        ))}
        <div className="flex items-end gap-2 md:col-span-3">
          <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" type="submit">
            Apply filters
          </button>
          <button
            className="rounded-md border px-3 py-2 text-sm"
            type="button"
            onClick={() => {
              setFilters(emptyFilters);
              setApplied(emptyFilters);
            }}
          >
            Clear filters
          </button>
        </div>
      </form>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">Application ID</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Bank / Product</th>
              <th className="px-3 py-2">Case Owner</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <Link className="font-medium text-slate-900" href={`/applications/${item.id}`}>
                    {item.applicationCode}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  {item.customerCode} · {item.customerName}
                </td>
                <td className="px-3 py-2">
                  {item.bankCode} / {item.productCode}
                </td>
                <td className="px-3 py-2">{item.caseOwnerName}</td>
                <td className="px-3 py-2">{item.currentStage}</td>
                <td className="px-3 py-2">{item.terminalOutcome ?? "Open"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
