"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  Pagination,
  type PaginatedResponse,
  SERVER_PAGE_SIZE_OPTIONS,
  type ServerPageSize,
} from "@/components/pagination";
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<ServerPageSize>(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (query) {
      params.set("q", query);
    }
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    setLoading(true);
    void apiGet<PaginatedResponse<CustomerRecord>>(
      `/api/v1/customers${suffix}`,
      getBrowserApiUrl(),
    )
      .then((data) => {
        if (!active) {
          return;
        }
        setItems(data.items);
        setTotal(data.pagination.total);
        setTotalPages(data.pagination.totalPages);
        setError("");
      })
      .catch((err: unknown) => {
        if (!active) {
          return;
        }
        setError(err instanceof ApiClientError ? err.message : "Unable to load customers");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, pageSize, query]);

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
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(1);
        }}
        aria-label="Search customers"
      />
      <ErrorText>{error}</ErrorText>
      <TableShell className={loading && items.length > 0 ? "opacity-70" : undefined}>
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
          {loading && items.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <EmptyState>Loading customers…</EmptyState>
              </td>
            </tr>
          ) : items.length === 0 ? (
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
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        totalPages={totalPages}
        pageSizeOptions={SERVER_PAGE_SIZE_OPTIONS}
        onPageChange={setPage}
        onPageSizeChange={(value) => {
          if (value !== "all") setPageSize(value);
        }}
      />
    </section>
  );
}
