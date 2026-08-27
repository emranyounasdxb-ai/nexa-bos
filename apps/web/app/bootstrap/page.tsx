"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiRequest } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";
import type { UserRecord } from "@/lib/types";

export default function BootstrapPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    secret: "",
    full_name: "",
    employee_code: "",
    email: "",
    mobile: "",
    joining_date: "",
    employment_status: "Active",
    password: "",
    designation_name: "",
    designation_code: "",
  });

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiRequest<UserRecord>("/api/v1/auth/bootstrap", getBrowserApiUrl(), {
        method: "POST",
        body: JSON.stringify(form),
      });
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "OWNER setup failed");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-10">
      <h1 className="text-2xl font-semibold text-slate-900">First-time OWNER setup</h1>
      <p className="mt-2 text-sm text-slate-600">
        Requires the one-time bootstrap secret. After OWNER is created, this flow is permanently
        disabled.
      </p>
      <form onSubmit={(event) => void onSubmit(event)} className="mt-6 grid gap-3">
        {[
          ["secret", "Bootstrap secret", "password"],
          ["full_name", "Full name", "text"],
          ["employee_code", "Employee code", "text"],
          ["email", "Email", "email"],
          ["mobile", "Mobile", "text"],
          ["joining_date", "Joining date", "date"],
          ["password", "Password", "password"],
          ["designation_name", "Designation name", "text"],
          ["designation_code", "Designation code", "text"],
        ].map(([name, label, type]) => (
          <label key={name} className="block text-sm">
            {label}
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              type={type}
              value={form[name as keyof typeof form]}
              onChange={(event) => setForm({ ...form, [name]: event.target.value })}
              required
            />
          </label>
        ))}
        <label className="block text-sm">
          Employment status
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={form.employment_status}
            onChange={(event) => setForm({ ...form, employment_status: event.target.value })}
          >
            <option>Active</option>
            <option>Probation</option>
            <option>Notice Period</option>
          </select>
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" type="submit">
          Create OWNER
        </button>
      </form>
    </main>
  );
}
