"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { ApplicationRecord, CustomerRecord } from "@/lib/types";

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [others, setOthers] = useState<CustomerRecord[]>([]);
  const [primaryId, setPrimaryId] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    full_name: "",
    company_name: "",
    contact_person: "",
    mobile: "",
    email: "",
    emirates_id: "",
    passport: "",
    employer: "",
    trade_license: "",
  });
  const api = getBrowserApiUrl();

  const refresh = useCallback(async () => {
    const data = await apiGet<CustomerRecord>(`/api/v1/customers/${params.id}`, api);
    setCustomer(data);
    setForm({
      full_name: data.fullName ?? "",
      company_name: data.companyName ?? "",
      contact_person: data.contactPerson ?? "",
      mobile: data.mobile,
      email: data.email ?? "",
      emirates_id: data.emiratesId ?? "",
      passport: data.passport ?? "",
      employer: data.employer ?? "",
      trade_license: data.tradeLicense ?? "",
    });
    const directory = await apiGet<{ items: CustomerRecord[] }>("/api/v1/customers", api);
    setOthers(directory.items.filter((item) => item.id !== data.id && item.status !== "Merged"));
    try {
      const apps = await apiGet<{ items: ApplicationRecord[] }>(
        `/api/v1/customers/${params.id}/applications`,
        api,
      );
      setApplications(apps.items);
    } catch {
      setApplications([]);
    }
  }, [api, params.id]);

  useEffect(() => {
    void refresh().catch((err: unknown) => setMessage(err instanceof Error ? err.message : "Load failed"));
  }, [refresh]);

  if (!customer) {
    return <p className="text-sm">{message || "Loading…"}</p>;
  }

  const merged = customer.status === "Merged";
  const individual = customer.customerType === "individual";
  const customerId = customer.id;

  async function save() {
    setMessage("");
    try {
      await apiRequest(`/api/v1/customers/${customerId}`, api, {
        method: "PATCH",
        body: JSON.stringify(
          individual
            ? {
                full_name: form.full_name,
                mobile: form.mobile,
                email: form.email || null,
                emirates_id: form.emirates_id || null,
                passport: form.passport || null,
                employer: form.employer || null,
              }
            : {
                company_name: form.company_name,
                contact_person: form.contact_person,
                mobile: form.mobile,
                email: form.email || null,
                trade_license: form.trade_license || null,
              },
        ),
      });
      await refresh();
      setMessage("Saved");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function merge() {
    if (!primaryId) {
      return;
    }
    setMessage("");
    try {
      await apiRequest(`/api/v1/customers/${customerId}/merge`, api, {
        method: "POST",
        body: JSON.stringify({ primary_customer_id: primaryId }),
      });
      await refresh();
      setMessage("Customer merged. This is irreversible.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Merge failed");
    }
  }

  return (
    <section className="max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold">{customer.customerCode}</h2>
      <p className="text-sm text-slate-600">
        {customer.customerTypeLabel} · {customer.status}
        {customer.mergedIntoId ? ` · merged into ${customer.mergedIntoId}` : ""}
      </p>
      {message ? <p className="text-sm text-red-700">{message}</p> : null}
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {individual ? (
          <>
            <Field label="Full name" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} disabled={merged} />
            <Field label="Mobile" value={form.mobile} onChange={(value) => setForm({ ...form, mobile: value })} disabled={merged} />
            <Field label="Email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} disabled={merged} />
            <Field label="Emirates ID" value={form.emirates_id} onChange={(value) => setForm({ ...form, emirates_id: value })} disabled={merged} />
            <Field label="Passport" value={form.passport} onChange={(value) => setForm({ ...form, passport: value })} disabled={merged} />
            <Field label="Employer" value={form.employer} onChange={(value) => setForm({ ...form, employer: value })} disabled={merged} />
          </>
        ) : (
          <>
            <Field label="Company name" value={form.company_name} onChange={(value) => setForm({ ...form, company_name: value })} disabled={merged} />
            <Field label="Contact person" value={form.contact_person} onChange={(value) => setForm({ ...form, contact_person: value })} disabled={merged} />
            <Field label="Mobile" value={form.mobile} onChange={(value) => setForm({ ...form, mobile: value })} disabled={merged} />
            <Field label="Email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} disabled={merged} />
            <Field label="Trade license" value={form.trade_license} onChange={(value) => setForm({ ...form, trade_license: value })} disabled={merged} />
          </>
        )}
        {can("Customers.Edit") && !merged ? (
          <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" type="submit">
            Save
          </button>
        ) : null}
      </form>
      <div className="flex gap-2 text-sm">
        {can("Customers.Deactivate") && customer.status === "Active" ? (
          <button
            className="rounded-md border px-3 py-1.5"
            type="button"
            onClick={() =>
              void apiRequest(`/api/v1/customers/${customer.id}/deactivate`, api, { method: "POST" })
                .then(refresh)
                .catch((err: unknown) => setMessage(err instanceof Error ? err.message : "Failed"))
            }
          >
            Deactivate
          </button>
        ) : null}
        {can("Customers.Activate") && customer.status === "Inactive" ? (
          <button
            className="rounded-md border px-3 py-1.5"
            type="button"
            onClick={() =>
              void apiRequest(`/api/v1/customers/${customer.id}/activate`, api, { method: "POST" })
                .then(refresh)
                .catch((err: unknown) => setMessage(err instanceof Error ? err.message : "Failed"))
            }
          >
            Activate
          </button>
        ) : null}
      </div>
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="font-semibold">Applications</h3>
        <p className="text-xs text-slate-500">Only applications visible to you are listed.</p>
        {applications.length === 0 ? (
          <p className="text-sm text-slate-500">No visible applications.</p>
        ) : (
          <ul className="text-sm">
            {applications.map((app) => (
              <li key={app.id}>
                <Link className="underline" href={`/applications/${app.id}`}>
                  {app.applicationCode}
                </Link>{" "}
                · {app.bankCode}/{app.productCode} · {app.currentStage}
                {app.terminalOutcome ? ` · ${app.terminalOutcome}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
      {can("Customers.Merge") && !merged ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="font-semibold">Merge into primary customer</h3>
          <p className="text-xs text-slate-500">
            Irreversible. This customer code is retired and never reused. History is preserved.
          </p>
          <select
            className="w-full rounded-md border px-3 py-2 text-sm"
            value={primaryId}
            onChange={(event) => setPrimaryId(event.target.value)}
            aria-label="Primary customer"
          >
            <option value="">Select primary customer</option>
            {others.map((item) => (
              <option key={item.id} value={item.id}>
                {item.customerCode} — {item.companyName || item.fullName}
              </option>
            ))}
          </select>
          <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" type="button" onClick={() => void merge()}>
            Merge
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block text-sm">
      {label}
      <input
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-50"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </label>
  );
}
