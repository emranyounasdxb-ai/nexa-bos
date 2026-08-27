"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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
      <h2 className="text-xl font-semibold">User types</h2>
      {can("UserTypes.Create") ? (
        <form onSubmit={(event) => void createType(event)} className="grid gap-2 rounded-xl border bg-white p-4 md:grid-cols-4">
          <input
            className="rounded-md border px-3 py-2 text-sm"
            placeholder="Name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
          <input
            className="rounded-md border px-3 py-2 text-sm"
            placeholder="Unique code"
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value })}
            required
          />
          <input
            className="rounded-md border px-3 py-2 text-sm"
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
          <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" type="submit">
            Create custom type
          </button>
        </form>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <table className="min-w-full rounded-xl border bg-white text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-3 py-2 text-left">Code</th>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Scope</th>
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
              <td className="px-3 py-2">{item.canBeReportingManager ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
