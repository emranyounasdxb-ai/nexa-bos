"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { DatePicker } from "@/components/date-picker";
import { Button, ErrorText, PublicScreen, Select, TextInput } from "@/components/ui";
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
    <PublicScreen
      wide
      title="First-time OWNER setup"
      description="Requires the one-time bootstrap secret. After OWNER is created, this flow is permanently disabled."
    >
      <form onSubmit={(event) => void onSubmit(event)} className="mt-6 grid gap-3">
        {(
          [
            ["secret", "Bootstrap secret", "password"],
            ["full_name", "Full name", "text"],
            ["employee_code", "Employee code", "text"],
            ["email", "Email", "email"],
            ["mobile", "Mobile", "text"],
            ["password", "Password", "password"],
            ["designation_name", "Designation name", "text"],
            ["designation_code", "Designation code", "text"],
          ] as const
        ).map(([name, label, type]) => (
          <label key={name} className="block text-sm">
            {label}
            <TextInput
              type={type}
              value={form[name]}
              onChange={(event) => setForm({ ...form, [name]: event.target.value })}
              required
            />
          </label>
        ))}
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
            <option>Active</option>
            <option>Probation</option>
            <option>Notice Period</option>
          </Select>
        </label>
        <ErrorText>{error}</ErrorText>
        <Button type="submit">Create OWNER</Button>
      </form>
    </PublicScreen>
  );
}
