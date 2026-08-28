"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiGet, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { CustomerRecord } from "@/lib/types";

export default function CustomersPage() {
  const { can } = useAuth();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CustomerRecord[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (query) {
      params.set("q", query);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    void apiGet<{ items: CustomerRecord[] }>(`/api/v1/customers${suffix}`, getBrowserApiUrl())
      .then((data) => {
        setItems(data.items);
        setError("");
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err.message : "Unable to load customers");
      });
  }, [query]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Customers</h2>
        {can("Customers.Create") ? (
          <Link className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" href="/customers/new">
            Create customer
          </Link>
        ) : null}
      </div>
      <input
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        placeholder="Search code, name, company, mobile, email, Emirates ID, passport, trade license"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">Customer code</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Name / company</th>
              <th className="px-3 py-2">Mobile</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((customer) => (
              <tr key={customer.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <Link className="font-medium text-slate-900" href={`/customers/${customer.id}`}>
                    {customer.customerCode}
                  </Link>
                </td>
                <td className="px-3 py-2">{customer.customerTypeLabel}</td>
                <td className="px-3 py-2">{customer.companyName || customer.fullName}</td>
                <td className="px-3 py-2">{customer.mobile}</td>
                <td className="px-3 py-2">{customer.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
