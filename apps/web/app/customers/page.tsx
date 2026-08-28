"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  ButtonLink,
  EmptyState,
  ErrorText,
  PageHeader,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
} from "@/components/ui";
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
    let active = true;
    const params = new URLSearchParams();
    if (query) {
      params.set("q", query);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    void apiGet<{ items: CustomerRecord[] }>(`/api/v1/customers${suffix}`, getBrowserApiUrl())
      .then((data) => {
        if (!active) {
          return;
        }
        setItems(data.items);
        setError("");
      })
      .catch((err: unknown) => {
        if (!active) {
          return;
        }
        setError(err instanceof ApiClientError ? err.message : "Unable to load customers");
      });
    return () => {
      active = false;
    };
  }, [query]);

  return (
    <section className="space-y-4">
      <PageHeader
        title="Customers"
        actions={
          can("Customers.Create") ? (
            <ButtonLink href="/customers/new">Create customer</ButtonLink>
          ) : null
        }
      />
      <TextInput
        className="mt-0"
        placeholder="Search code, name, company, mobile, email, Emirates ID, passport, trade license"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search customers"
      />
      <ErrorText>{error}</ErrorText>
      <TableShell>
        <TableHead>
          <tr>
            <Th>Customer code</Th>
            <Th>Type</Th>
            <Th>Name / company</Th>
            <Th>Mobile</Th>
            <Th>Status</Th>
          </tr>
        </TableHead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <EmptyState>No customers match the current search.</EmptyState>
              </td>
            </tr>
          ) : (
            items.map((customer) => (
              <tr key={customer.id} className="border-t border-slate-100">
                <Td>
                  <Link className="font-medium text-slate-900" href={`/customers/${customer.id}`}>
                    {customer.customerCode}
                  </Link>
                </Td>
                <Td>{customer.customerTypeLabel}</Td>
                <Td>{customer.companyName || customer.fullName}</Td>
                <Td>{customer.mobile}</Td>
                <Td>{customer.status}</Td>
              </tr>
            ))
          )}
        </tbody>
      </TableShell>
    </section>
  );
}
