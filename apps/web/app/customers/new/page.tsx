"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, EmptyState, ErrorText, PageHeader, TextInput, secondaryButtonClass } from "@/components/ui";
import { apiRequest, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import { canManageCustomers } from "@/lib/role-access";
import type { CustomerRecord } from "@/lib/types";

type DuplicateMatch = {
  id: string;
  customerCode: string;
  customerType: string;
  status: string;
  fullName: string | null;
  companyName: string | null;
  mobile: string;
  email: string | null;
};

export default function CreateCustomerPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [form, setForm] = useState({
    customer_type: "individual",
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

  async function submit(createAnyway: boolean) {
    setError("");
    try {
      const created = await apiRequest<CustomerRecord>("/api/v1/customers", getBrowserApiUrl(), {
        method: "POST",
        body: JSON.stringify({
          customer_type: form.customer_type,
          full_name: form.customer_type === "individual" ? form.full_name : null,
          company_name: form.customer_type === "company" ? form.company_name : null,
          contact_person: form.customer_type === "company" ? form.contact_person : null,
          mobile: form.mobile,
          email: form.email || null,
          emirates_id: form.customer_type === "individual" ? form.emirates_id || null : null,
          passport: form.customer_type === "individual" ? form.passport || null : null,
          employer: form.customer_type === "individual" ? form.employer || null : null,
          trade_license: form.customer_type === "company" ? form.trade_license || null : null,
          create_anyway: createAnyway,
        }),
      });
      router.push(`/customers/${created.id}`);
    } catch (err) {
      if (err instanceof ApiClientError && err.body?.error?.code === "CUSTOMER_DUPLICATE_WARNING") {
        setDuplicates((err.body.error.details as DuplicateMatch[]) ?? []);
        setError(err.message);
        return;
      }
      setDuplicates([]);
      setError(err instanceof Error ? err.message : "Create failed");
    }
  }

  const individual = form.customer_type === "individual";

  if (!canManageCustomers(user)) {
    return <EmptyState>You do not have permission to create Customers.</EmptyState>;
  }

  return (
    <section className="max-w-2xl space-y-4">
      <PageHeader title="Create customer" />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(false);
        }}
        className="grid gap-3"
      >
        <fieldset className="space-y-2 text-sm">
          <legend className="font-medium">Customer type</legend>
          <label className="mr-4">
            <input
              className="mr-2"
              type="radio"
              name="customer_type"
              value="individual"
              checked={individual}
              onChange={() => setForm({ ...form, customer_type: "individual" })}
            />
            Individual
          </label>
          <label>
            <input
              className="mr-2"
              type="radio"
              name="customer_type"
              value="company"
              checked={!individual}
              onChange={() => setForm({ ...form, customer_type: "company" })}
            />
            Company / Business
          </label>
          <p className="text-xs text-slate-500">Type cannot be changed after creation.</p>
        </fieldset>
        {individual ? (
          <>
            <Field
              label="Full name"
              value={form.full_name}
              onChange={(value) => setForm({ ...form, full_name: value })}
              required
            />
            <Field
              label="Mobile"
              value={form.mobile}
              onChange={(value) => setForm({ ...form, mobile: value })}
              required
            />
            <Field
              label="Email"
              type="email"
              value={form.email}
              onChange={(value) => setForm({ ...form, email: value })}
            />
            <Field
              label="Emirates ID"
              value={form.emirates_id}
              onChange={(value) => setForm({ ...form, emirates_id: value })}
            />
            <Field
              label="Passport"
              value={form.passport}
              onChange={(value) => setForm({ ...form, passport: value })}
            />
            <Field
              label="Employer"
              value={form.employer}
              onChange={(value) => setForm({ ...form, employer: value })}
            />
          </>
        ) : (
          <>
            <Field
              label="Company name"
              value={form.company_name}
              onChange={(value) => setForm({ ...form, company_name: value })}
              required
            />
            <Field
              label="Contact person"
              value={form.contact_person}
              onChange={(value) => setForm({ ...form, contact_person: value })}
              required
            />
            <Field
              label="Mobile"
              value={form.mobile}
              onChange={(value) => setForm({ ...form, mobile: value })}
              required
            />
            <Field
              label="Email"
              type="email"
              value={form.email}
              onChange={(value) => setForm({ ...form, email: value })}
            />
            <Field
              label="Trade license"
              value={form.trade_license}
              onChange={(value) => setForm({ ...form, trade_license: value })}
            />
          </>
        )}
        <ErrorText>{error}</ErrorText>
        {duplicates.length > 0 ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="font-medium">Possible duplicates</p>
            <ul className="mt-2 list-disc pl-5">
              {duplicates.map((row) => (
                <li key={row.id}>
                  {row.customerCode} — {row.companyName || row.fullName} ({row.mobile})
                </li>
              ))}
            </ul>
            <button className={`mt-3 ${secondaryButtonClass}`} type="button" onClick={() => void submit(true)}>
              Create anyway
            </button>
          </div>
        ) : null}
        <Button type="submit">Create customer</Button>
      </form>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      {label}
      <TextInput
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
    </label>
  );
}
