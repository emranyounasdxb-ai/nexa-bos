"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button, ErrorText, PageHeader, TextInput } from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { UserTypeSummary } from "@/lib/types";

export default function UserTypesPage() {
  const { can } = useAuth();
  const [items, setItems] = useState<UserTypeSummary[]>([]);
  const [form, setForm] = useState({ name: "", code: "", description: "" });
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState("");
  const api = getBrowserApiUrl();

  const refresh = useCallback(async () => {
    const data = await apiGet<{ items: UserTypeSummary[] }>("/api/v1/user-types", api);
    setItems(data.items);
  }, [api]);

  useEffect(() => {
    void refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : "Load failed"));
  }, [refresh]);

  async function createType(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiRequest("/api/v1/user-types", api, {
        method: "POST",
        body: JSON.stringify({ ...form, can_be_reporting_manager: canManage }),
      });
      setForm({ name: "", code: "", description: "" });
      setCanManage(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="User types"
        description="Review and manage the existing role templates and their configured visibility scopes."
      />
      <ErrorText>{error}</ErrorText>
      {can("UserTypes.Create") ? (
        <form onSubmit={(event) => void createType(event)} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-4">
          <TextInput
            placeholder="Name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
          <TextInput
            placeholder="Unique code"
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value })}
            required
          />
          <TextInput
            placeholder="Description"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={canManage}
              onChange={(event) => setCanManage(event.target.checked)}
            />
            Can be reporting manager
          </label>
          <Button type="submit">Create custom type</Button>
        </form>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-3 py-2 text-left">Code</th>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">User directory scope</th>
            <th className="px-3 py-2 text-left">Customer scope</th>
            <th className="px-3 py-2 text-left">Can be reporting manager</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t">
              <td className="px-3 py-2">
                <Link className="font-medium" href={`/user-types/${item.id}`}>
                  {item.code}
                </Link>
              </td>
              <td className="px-3 py-2">{item.name}</td>
              <td className="px-3 py-2">{item.status}</td>
              <td className="px-3 py-2">{item.visibilityScope ?? "none"}</td>
              <td className="px-3 py-2">{item.customerVisibilityScope ?? "none"}</td>
              <td className="px-3 py-2">{item.canBeReportingManager ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}
