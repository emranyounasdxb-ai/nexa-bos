"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import {
  Pagination,
  type PaginatedResponse,
  SERVER_PAGE_SIZE_OPTIONS,
  type ServerPageSize,
} from "@/components/pagination";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorText,
  Field,
  FilterBar,
  LoadingState,
  PageHeader,
  Select,
  StatusBadge,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
} from "@/components/ui";
import { apiGet, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import { canManageCustomers } from "@/lib/role-access";
import type { CustomerRecord } from "@/lib/types";

const CUSTOMER_STATUSES = ["Active", "Inactive", "Merged"] as const;

function pageValue(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function pageSizeValue(value: string | null): ServerPageSize {
  const parsed = Number(value);
  return SERVER_PAGE_SIZE_OPTIONS.includes(parsed as ServerPageSize)
    ? (parsed as ServerPageSize)
    : 10;
}

function statusValue(value: string | null): (typeof CUSTOMER_STATUSES)[number] | "" {
  return value && CUSTOMER_STATUSES.includes(value as (typeof CUSTOMER_STATUSES)[number])
    ? (value as (typeof CUSTOMER_STATUSES)[number])
    : "";
}

function displayName(customer: CustomerRecord): string {
  return customer.customerType === "company"
    ? displayValue(customer.companyName)
    : displayValue(customer.fullName);
}

function displayValue(value: string | null | undefined): string {
  return value?.trim() || "—";
}

function CustomersDirectory() {
  const { can, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const api = getBrowserApiUrl();
  const query = searchParams.get("q") ?? "";
  const status = statusValue(searchParams.get("status"));
  const page = pageValue(searchParams.get("page"));
  const pageSize = pageSizeValue(searchParams.get("pageSize"));
  const [searchDraft, setSearchDraft] = useState(query);
  const [items, setItems] = useState<CustomerRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [requestVersion, setRequestVersion] = useState(0);

  const updateUrl = useCallback(
    (updates: Record<string, string | null>, mode: "push" | "replace" = "push") => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const destination = next.size ? `/customers?${next.toString()}` : "/customers";
      if (mode === "replace") router.replace(destination, { scroll: false });
      else router.push(destination, { scroll: false });
    },
    [router, searchParams],
  );

  useEffect(() => setSearchDraft(query), [query]);

  useEffect(() => {
    if (searchDraft === query) return;
    const timer = window.setTimeout(() => {
      updateUrl({ q: searchDraft.trim() || null, page: null }, "replace");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, searchDraft, updateUrl]);

  useEffect(() => {
    if (!canManageCustomers(user)) return;
    let active = true;
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (query.trim()) params.set("q", query.trim());
    if (status) params.set("status", status);
    setLoading(true);
    setError("");
    void apiGet<PaginatedResponse<CustomerRecord>>(`/api/v1/customers?${params.toString()}`, api)
      .then((data) => {
        if (!active) return;
        setItems(data.items);
        setTotal(data.pagination.total);
        setTotalPages(data.pagination.totalPages);
      })
      .catch((value: unknown) => {
        if (active) setError(value instanceof ApiClientError ? value.message : "Unable to load customers");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, page, pageSize, query, requestVersion, status, user]);

  if (!canManageCustomers(user)) {
    return <EmptyState>You do not have permission to view Customers.</EmptyState>;
  }

  const hasFilters = Boolean(query || status);

  return (
    <section className="min-w-0 space-y-4">
      <PageHeader
        title="Customers"
        description="Find customer records within your assigned visibility scope and open their profile, applications, and preserved history."
        actions={can("Customers.Create") ? <ButtonLink href="/customers/new">Create customer</ButtonLink> : null}
      />

      <div data-amafh-list-surface="">
      <FilterBar className="sm:grid-cols-[minmax(0,2fr)_minmax(12rem,1fr)_auto]">
        <Field label="Search customers">
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled">⌕</span>
            <TextInput
              aria-label="Search customers"
              className="pl-9"
              placeholder="Code, name, company, mobile, email or identifier"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
          </div>
        </Field>
        <Field label="Customer status">
          <Select
            aria-label="Customer status"
            value={status}
            onChange={(event) => updateUrl({ status: event.target.value || null, page: null })}
          >
            <option value="">All statuses</option>
            {CUSTOMER_STATUSES.map((value) => <option key={value}>{value}</option>)}
          </Select>
        </Field>
        <div className="flex items-end">
          <Button
            type="button"
            variant="secondary"
            className="w-full sm:w-auto"
            disabled={!hasFilters}
            onClick={() => router.push("/customers", { scroll: false })}
          >
            Clear filters
          </Button>
        </div>
      </FilterBar>

      {error ? (
        <Card>
          <ErrorText>{error}</ErrorText>
          <Button type="button" variant="secondary" className="mt-3" onClick={() => setRequestVersion((value) => value + 1)}>
            Retry
          </Button>
        </Card>
      ) : null}

      <Card className="!p-0">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-brand-border px-3 py-2 sm:px-4">
          <div className="min-w-0">
            <h2 className="text-[length:var(--amafh-text-section)] font-semibold text-text-primary">Customers in scope</h2>
            <p className="text-xs text-text-secondary">
              {loading ? "Refreshing…" : `${total.toLocaleString()} authorized record${total === 1 ? "" : "s"}`}
            </p>
          </div>
          <Badge>{hasFilters ? "Filtered" : "All authorized"}</Badge>
        </div>

        {loading && items.length === 0 ? <LoadingState>Loading Customers…</LoadingState> : null}
        {!loading && !error && items.length === 0 ? <EmptyState>No Customers match the current filters.</EmptyState> : null}

        {items.length > 0 ? (
          <>
            <div className="hidden sm:block">
              <TableShell className={loading ? "rounded-none border-0 opacity-70 shadow-none [&_table]:min-w-[1800px]" : "rounded-none border-0 shadow-none [&_table]:min-w-[1800px]"}>
                <TableHead><tr><Th>Customer Code</Th><Th>Customer Type</Th><Th>Full Name / Company Name</Th><Th>Contact Person</Th><Th>Mobile</Th><Th>Email</Th><Th>Emirates ID</Th><Th>Passport</Th><Th>Employer</Th><Th>Trade License</Th><Th>Customer Status</Th><Th>Actions</Th></tr></TableHead>
                <tbody>
                  {items.map((customer) => (
                    <tr key={customer.id} className="border-t border-brand-border">
                      <Td className="whitespace-nowrap"><Link className="font-medium text-brand-link underline" href={`/customers/${customer.id}`}>{customer.customerCode}</Link></Td>
                      <Td className="whitespace-nowrap">{customer.customerTypeLabel}</Td>
                      <Td className="min-w-56 max-w-72 break-words font-medium">{displayName(customer)}</Td>
                      <Td className="min-w-44 max-w-64 break-words">{displayValue(customer.contactPerson)}</Td>
                      <Td className="whitespace-nowrap">{displayValue(customer.mobile)}</Td>
                      <Td className="min-w-52 max-w-72 break-all">{displayValue(customer.email)}</Td>
                      <Td className="min-w-44 whitespace-nowrap">{displayValue(customer.emiratesId)}</Td>
                      <Td className="min-w-36 whitespace-nowrap">{displayValue(customer.passport)}</Td>
                      <Td className="min-w-48 max-w-64 break-words">{displayValue(customer.employer)}</Td>
                      <Td className="min-w-40 whitespace-nowrap">{displayValue(customer.tradeLicense)}</Td>
                      <Td className="whitespace-nowrap"><StatusBadge value={customer.status} /></Td>
                      <Td className="whitespace-nowrap"><Link className="font-medium text-brand-link underline" href={`/customers/${customer.id}`}>View</Link></Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>

            <div className={loading ? "grid gap-2 p-3 opacity-70 sm:hidden" : "grid gap-2 p-3 sm:hidden"}>
              {items.map((customer) => (
                <article key={customer.id} className="min-w-0 rounded-[10px] border border-brand-border p-3">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link className="font-semibold text-brand-link underline" href={`/customers/${customer.id}`}>{customer.customerCode}</Link>
                      <p className="truncate font-medium text-text-primary">{displayName(customer)}</p>
                      <p className="text-xs text-text-secondary">{customer.customerTypeLabel}</p>
                    </div>
                    <StatusBadge value={customer.status} />
                  </div>
                  <dl className="mt-3 grid min-w-0 gap-2 text-xs">
                    <div><dt className="text-text-secondary">Contact Person</dt><dd className="break-all text-text-primary">{displayValue(customer.contactPerson)}</dd></div>
                    <div><dt className="text-text-secondary">Mobile</dt><dd className="break-all text-text-primary">{displayValue(customer.mobile)}</dd></div>
                    <div><dt className="text-text-secondary">Email</dt><dd className="break-all text-text-primary">{displayValue(customer.email)}</dd></div>
                    <div><dt className="text-text-secondary">Emirates ID</dt><dd className="break-all text-text-primary">{displayValue(customer.emiratesId)}</dd></div>
                    <div><dt className="text-text-secondary">Passport</dt><dd className="break-all text-text-primary">{displayValue(customer.passport)}</dd></div>
                    <div><dt className="text-text-secondary">Employer</dt><dd className="break-all text-text-primary">{displayValue(customer.employer)}</dd></div>
                    <div><dt className="text-text-secondary">Trade License</dt><dd className="break-all text-text-primary">{displayValue(customer.tradeLicense)}</dd></div>
                  </dl>
                  <Link className="mt-3 inline-flex font-medium text-brand-link underline" href={`/customers/${customer.id}`}>View customer</Link>
                </article>
              ))}
            </div>
          </>
        ) : null}

        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          totalPages={totalPages}
          pageSizeOptions={SERVER_PAGE_SIZE_OPTIONS}
          onPageChange={(nextPage) => updateUrl({ page: nextPage === 1 ? null : String(nextPage) })}
          onPageSizeChange={(value) => {
            if (value !== "all") updateUrl({ pageSize: value === 10 ? null : String(value), page: null });
          }}
        />
      </Card>
      </div>
    </section>
  );
}

export default function CustomersPage() {
  return <Suspense fallback={<LoadingState>Loading Customers…</LoadingState>}><CustomersDirectory /></Suspense>;
}
