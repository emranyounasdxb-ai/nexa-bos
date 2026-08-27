"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiGet, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { UserRecord } from "@/lib/types";

export default function UsersPage() {
  const { can } = useAuth();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<UserRecord[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (query) {
      params.set("q", query);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    void apiGet<{ items: UserRecord[] }>(`/api/v1/users${suffix}`, getBrowserApiUrl())
      .then((data) => {
        setItems(data.items);
        setError("");
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err.message : "Unable to load users");
      });
  }, [query]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">User directory</h2>
        {can("Users.Create") ? (
          <Link className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" href="/users/new">
            Create user
          </Link>
        ) : null}
      </div>
      <input
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        placeholder="Search name, email, codes, mobile, office, department..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">User code</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((user) => (
              <tr key={user.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <Link className="font-medium text-slate-900" href={`/users/${user.id}`}>
                    {user.userCode}
                  </Link>
                </td>
                <td className="px-3 py-2">{user.fullName}</td>
                <td className="px-3 py-2">{user.email}</td>
                <td className="px-3 py-2">{user.userType?.code ?? "—"}</td>
                <td className="px-3 py-2">{user.accountStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
