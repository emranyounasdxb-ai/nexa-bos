"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ApplicationCreateDialog } from "@/components/application-create-dialog";
import { DateRangePicker } from "@/components/date-picker";
import {
  Pagination,
  type PaginatedResponse,
  SERVER_PAGE_SIZE_OPTIONS,
  type ServerPageSize,
} from "@/components/pagination";
import {
  Badge,
  Button,
  EmptyState,
  ErrorText,
  Field,
  PageHeader,
  SearchActionBar,
  Select,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
  primaryButtonClass,
} from "@/components/ui";
import { apiGet, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDuration } from "@/lib/duration";
import { getBrowserApiUrl } from "@/lib/env";
import type {
  ApplicationRecord,
  CatalogItem,
} from "@/lib/types";

const OUTCOMES = ["Completed", "Final Rejected", "Cancelled", "Withdrawn"];

const emptyFilters = {
  bank_id: "",
  product_id: "",
  current_stage_id: "",
  terminal_outcome: "",
  created_from: "",
  created_to: "",
};

const DASHBOARD_FILTER_LABELS: Record<string, string> = {
  applications: "My Applications",
  submitted: "Submitted",
  approved: "Approved",
  funded: "Funded",
  in_progress: "In Progress",
};

function ApplicationsPageInner() {
  const { can } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const api = getBrowserApiUrl();
  const initialMetric = searchParams.get("dashboard_metric") ?? "";
  const initialPeriod = searchParams.get("dashboard_period") ?? "mtd";
  const [dashboardFilter, setDashboardFilter] = useState({
    metric: DASHBOARD_FILTER_LABELS[initialMetric] ? initialMetric : "",
    period: ["mtd", "previous_month", "ytd"].includes(initialPeriod) ? initialPeriod : "mtd",
  });
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [items, setItems] = useState<ApplicationRecord[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<ServerPageSize>(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(searchParams.get("create") === "true");
  const [requestVersion, setRequestVersion] = useState(0);
  const [banks, setBanks] = useState<CatalogItem[]>([]);
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [stages, setStages] = useState<Array<{ id: string; code: string; name: string }>>([]);

  useEffect(() => {
    void Promise.all([
      apiGet<{ items: CatalogItem[] }>("/api/v1/banks", api),
      apiGet<{ items: CatalogItem[] }>("/api/v1/products", api),
      apiGet<{ items: Array<{ id: string; code: string; name: string }> }>(
        "/api/v1/applications/stages",
        api,
      ),
    ])
      .then(([bankData, productData, stageData]) => {
        setBanks(bankData.items);
        setProducts(productData.items);
        setStages(stageData.items);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Load failed"));
  }, [api, requestVersion]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (query) {
      params.set("q", query);
    }
    for (const [key, value] of Object.entries(applied)) {
      if (value) {
        params.set(key, value);
      }
    }
    if (dashboardFilter.metric) {
      params.set("dashboard_metric", dashboardFilter.metric);
      params.set("dashboard_period", dashboardFilter.period);
    }
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    setLoading(true);
    void apiGet<PaginatedResponse<ApplicationRecord>>(`/api/v1/applications${suffix}`, api)
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
        setError(err instanceof ApiClientError ? err.message : "Unable to load applications");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, applied, dashboardFilter, page, pageSize, query, requestVersion]);

  return (
    <section className="space-y-4">
      <PageHeader
        title="Applications"
        description="Search and filter applications in your current scope, then open permitted workflow records."
      />
      {dashboardFilter.metric ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[10px] border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <p className="min-w-0">
            Dashboard filter: <strong>{DASHBOARD_FILTER_LABELS[dashboardFilter.metric]}</strong> · {dashboardFilter.period === "mtd" ? "This Month" : dashboardFilter.period === "previous_month" ? "Last Month" : "YTD"}
          </p>
          <Button
            type="button"
            size="compact"
            variant="secondary"
            onClick={() => {
              setDashboardFilter({ metric: "", period: "mtd" });
              setPage(1);
              router.replace("/applications");
            }}
          >
            Clear dashboard filter
          </Button>
        </div>
      ) : null}
      <SearchActionBar
        search={
          <TextInput
            className="mt-0"
            placeholder="Search application, customer, Bank, Product Category, or Product Variant"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            aria-label="Search applications"
          />
        }
        actions={
          can("Applications.Create") ? (
            <button
              id="create-application-trigger"
              type="button"
              className={primaryButtonClass}
              onClick={() => {
                setMessage("");
                setCreateOpen(true);
              }}
            >
              Create application
            </button>
          ) : null
        }
      />
      {message ? (
        <p role="status" className="rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          {message}
        </p>
      ) : null}
      <form
        data-testid="application-filters"
        className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(12rem,1.35fr)_auto] xl:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setApplied({ ...filters });
        }}
      >
        <Field label="Bank" className="min-w-0">
          <Select
            aria-label="Filter by bank"
            value={filters.bank_id}
            onChange={(event) => setFilters({ ...filters, bank_id: event.target.value })}
          >
            <option value="">All banks</option>
            {banks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.code})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Product" className="min-w-0">
          <Select
            aria-label="Filter product"
            value={filters.product_id}
            onChange={(event) => setFilters({ ...filters, product_id: event.target.value })}
          >
            <option value="">All products</option>
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.code})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Stage" className="min-w-0">
          <Select
            aria-label="Filter current stage"
            value={filters.current_stage_id}
            onChange={(event) => setFilters({ ...filters, current_stage_id: event.target.value })}
          >
            <option value="">All stages</option>
            {stages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Outcome" className="min-w-0">
          <Select
            aria-label="Filter terminal outcome"
            value={filters.terminal_outcome}
            onChange={(event) => setFilters({ ...filters, terminal_outcome: event.target.value })}
          >
            <option value="">All outcomes</option>
            {OUTCOMES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Created Date" className="min-w-0">
          <DateRangePicker
            aria-label="Created Date"
            from={filters.created_from}
            to={filters.created_to}
            onChange={({ from: created_from, to: created_to }) =>
              setFilters({ ...filters, created_from, created_to })
            }
          />
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-2 self-end sm:col-span-2 xl:col-span-1 xl:flex-nowrap">
          <Button type="submit">Apply filters</Button>
          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              setFilters(emptyFilters);
              setApplied(emptyFilters);
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        </div>
      </form>
      <ErrorText>{error}</ErrorText>
      <TableShell className={loading && items.length > 0 ? "opacity-70" : undefined}>
        <TableHead>
          <tr>
            <Th>Application ID</Th>
            <Th>Bank File / Case Number</Th>
            <Th>Customer</Th>
            <Th>Bank / Product Category / Variant</Th>
            <Th>Case Owner</Th>
            <Th>Stage</Th>
            <Th>Outcome</Th>
            <Th>TAT</Th>
            <Th>Delay</Th>
          </tr>
        </TableHead>
        <tbody>
          {loading && items.length === 0 ? (
            <tr>
              <td colSpan={9}>
                <EmptyState>Loading applications…</EmptyState>
              </td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td colSpan={9}>
                <EmptyState>No applications match the current filters.</EmptyState>
              </td>
            </tr>
          ) : (
            items.map((item) => (
              <tr key={item.id} className="border-t border-slate-100">
                <Td>
                  <Link className="font-medium text-slate-900" href={`/applications/${item.id}`}>
                    {item.applicationCode}
                  </Link>
                </Td>
                <Td>{item.bankCaseNumber ?? "Not assigned"}</Td>
                <Td>
                  {item.customerCode} · {item.customerName}
                </Td>
                <Td>
                  <p>
                    {item.bankName ?? item.bankCode} ({item.bankCode})
                  </p>
                  <p className="text-xs text-slate-500">
                    {item.productName ?? item.productCode} ({item.productCode}) ·{" "}
                    {item.productVariantName
                      ? `${item.productVariantName} (${item.productVariantCode})`
                      : "Legacy: no Product Variant"}
                  </p>
                </Td>
                <Td>{item.caseOwnerName}</Td>
                <Td>{item.currentStage}</Td>
                <Td>{item.terminalOutcome ?? "Open"}</Td>
                <Td>
                  {item.terminal
                    ? formatDuration(item.totalDurationSeconds)
                    : formatDuration(item.currentElapsedSeconds)}
                </Td>
                <Td>
                  {item.hasActiveDelay && item.activeDelay ? (
                    <Badge>{`Delay · ${item.activeDelay.delayType}`}</Badge>
                  ) : (
                    "—"
                  )}
                </Td>
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
      <ApplicationCreateDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          if (searchParams.get("create") === "true") router.replace("/applications");
          window.setTimeout(() => document.getElementById("create-application-trigger")?.focus(), 0);
        }}
        onCreated={(created) => {
          setCreateOpen(false);
          if (searchParams.get("create") === "true") router.replace("/applications");
          setPage(1);
          setRequestVersion((value) => value + 1);
          setMessage(`Application ${created.applicationCode} created successfully.`);
          window.setTimeout(() => document.getElementById("create-application-trigger")?.focus(), 0);
        }}
      />
    </section>
  );
}

export default function ApplicationsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading applications…</p>}>
      <ApplicationsPageInner />
    </Suspense>
  );
}
