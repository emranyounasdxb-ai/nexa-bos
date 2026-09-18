"use client";

import Link from "next/link";
import { AdminCaseList } from "./admin-case-list";
import type { CaseReview } from "./admin-case-presentation";
import styles from "./applications.module.css";
import { IconFileDescription, IconPlus } from "@/components/icons";
import { RecordCard, RecordIdentity } from "@/components/page-patterns";
import { PanelPopup } from "@/components/panel-popup";
import { PageHeaderSlots } from "@/components/page-header";
import { Suspense, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
  Card,
  EmptyState,
  ErrorText,
  Field,
  PageHeader,
  ResponsiveFilterPanel,
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
import { formatLocalDateTime } from "@/lib/presentation";
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
  new_cases: "New Cases",
  awaiting_submission: "Awaiting Submission",
  missing_bank_number: "Missing Bank Number",
  requirements_pending: "Requirements Pending",
  delayed: "Delayed",
  completed_funded: "Completed / Funded",
};

function ApplicationsPageInner() {
  const headerSlots = useContext(PageHeaderSlots);
  const headingTarget = headerSlots?.description?.parentElement;
  const { can, user } = useAuth();
  const adminOfficer = user?.userType?.code === "ADMIN_OFFICER";
  const [caseReviews, setCaseReviews] = useState<Record<string, CaseReview>>({});
  const router = useRouter();
  const searchParams = useSearchParams();
  const api = getBrowserApiUrl();
  const initialMetric = searchParams.get("dashboard_metric") ?? "";
  const initialPeriod = searchParams.get("dashboard_period") ?? "mtd";
  const [dashboardFilter, setDashboardFilter] = useState({
    metric: DASHBOARD_FILTER_LABELS[initialMetric] ? initialMetric : "",
    period: ["today", "mtd", "previous_month", "ytd"].includes(initialPeriod) ? initialPeriod : "mtd",
  });
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  // List responses must not restart the open dialog's focus-management effect.
  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    if (searchParams.get("create") === "true") router.replace("/applications");
    window.setTimeout(() => document.getElementById("create-application-trigger")?.focus(), 0);
  }, [router, searchParams]);

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

  useEffect(() => {
    if (!adminOfficer) return;
    let active = true;
    setCaseReviews({});
    void Promise.allSettled(items.map(async item => [item.id, await apiGet<CaseReview>(`/api/v1/applications/${item.id}/internal-review`, api)] as const)).then(results => {
      if (active) setCaseReviews(Object.fromEntries(results.flatMap(result => result.status === "fulfilled" ? [result.value] : [])));
    });
    return () => { active = false; };
  }, [adminOfficer, items, api]);

  const hasResultFilters = Boolean(query || dashboardFilter.metric || Object.values(applied).some(Boolean));
  const createAction = can("Applications.Create") ? <button
    id="create-application-trigger" type="button" className={`${primaryButtonClass} ${styles.createAction}`}
    onClick={() => { setMessage(""); setCreateOpen(true); }}
  ><IconPlus className="size-4" />{adminOfficer ? "New Case" : "Create application"}</button> : null;

  return (
    <section className={styles.applications}>
      <PageHeader
        title={adminOfficer ? "My Cases" : "Applications"}
        description={adminOfficer ? "Create and track your own cases through the existing application workflow." : "Search and filter applications in your current scope, then open permitted workflow records."}
        actions={adminOfficer ? undefined : <div className={styles.headerActions}>{createAction}<PanelPopup label="Case inbox"><Card><h2 className="text-lg font-semibold">Case inbox</h2><p className="mt-4 text-sm text-text-secondary">Authorized applications</p><p className="mt-2 text-2xl font-bold tabular-nums">{loading ? "Loading…" : error ? "Unavailable" : total.toLocaleString()}</p></Card></PanelPopup></div>}
      />
      {headingTarget ? createPortal(<span className={styles.compactTotal}><strong>{loading ? "Loading…" : error ? "Unavailable" : total.toLocaleString()}</strong><span>{adminOfficer ? total === 1 ? "case" : "cases" : "Authorized applications"}</span></span>, headingTarget) : <span className={styles.compactTotal}><strong>{loading ? "Loading…" : error ? "Unavailable" : total.toLocaleString()}</strong><span>{adminOfficer ? total === 1 ? "case" : "cases" : "Authorized applications"}</span></span>}
      {dashboardFilter.metric ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[10px] border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <p className="min-w-0">
            Dashboard filter: <strong>{DASHBOARD_FILTER_LABELS[dashboardFilter.metric]}</strong> · {dashboardFilter.period === "today" ? "Today" : dashboardFilter.period === "mtd" ? "This Month" : dashboardFilter.period === "previous_month" ? "Last Month" : "YTD"}
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
      <div data-amafh-list-surface="">
      <SearchActionBar
        className={`p-4 ${styles.searchActions}`}
        actions={adminOfficer ? <><Button type="button" variant="secondary" aria-expanded={filtersOpen} aria-controls="admin-case-filters" onClick={() => setFiltersOpen(value => !value)}>Filters {filtersOpen ? "▴" : "▾"}</Button>{createAction}</> : undefined}
        search={
          <TextInput
            className="mt-0"
            placeholder={adminOfficer ? "Search case, customer, bank or product" : "Search application, customer, Bank, Product Category, or Product Variant"}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            aria-label={adminOfficer ? "Search my cases" : "Search applications"}
          />
        }
      />
      {message ? (
        <p role="status" className="rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          {message}
        </p>
      ) : null}
      {(!adminOfficer || filtersOpen) && <div id="admin-case-filters"><ResponsiveFilterPanel activeFilters={[
        applied.bank_id ? { label: "Bank", value: banks.find((item) => item.id === applied.bank_id)?.name ?? applied.bank_id } : null,
        applied.product_id ? { label: "Product", value: products.find((item) => item.id === applied.product_id)?.name ?? applied.product_id } : null,
        applied.current_stage_id ? { label: "Stage", value: stages.find((item) => item.id === applied.current_stage_id)?.name ?? applied.current_stage_id } : null,
        applied.terminal_outcome ? { label: "Outcome", value: applied.terminal_outcome } : null,
        applied.created_from || applied.created_to ? { label: "Created", value: `${applied.created_from || "Any"} – ${applied.created_to || "Any"}` } : null,
      ].filter((item): item is { label: string; value: string } => Boolean(item))}>
      <form
        data-testid="application-filters"
        className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-3 rounded-xl border border-slate-200 bg-surface p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(15.5rem,1.6fr)_auto] xl:items-end"
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
                {item.name}
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
                {item.name}
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
        <Field label="Created Date" className="min-w-0 sm:col-span-2 xl:col-span-1">
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
      </ResponsiveFilterPanel></div>}
      <ErrorText>{error}</ErrorText>
      {adminOfficer ? <AdminCaseList items={items} reviews={caseReviews} loading={loading} /> : <>
      <div className={`applications-table-scroll-frame ${styles.desktopRecords}`}>
        <TableShell
          headerTone="bright"
          tabletCards
          aria-label="Applications records"
          className={loading && items.length > 0 ? "opacity-70" : undefined}
          data-testid="applications-table-scroll-region"
          tabIndex={0}
        >
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
              {adminOfficer && <><Th>Assigned TL / Coordinator</Th><Th>Submission date</Th><Th>Last updated</Th></>}
            </tr>
          </TableHead>
          <tbody>
          {loading && items.length === 0 ? (
            <tr>
              <td colSpan={adminOfficer ? 12 : 9}>
                <EmptyState>Loading applications…</EmptyState>
              </td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td colSpan={9}>
                {hasResultFilters ? (
                  <EmptyState
                    kind="search"
                    title="No records match the selected filters"
                  />
                ) : <EmptyState kind="records">No applications are available in your authorized scope.</EmptyState>}
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
                    {item.bankName ?? "Unavailable bank"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {item.productName ?? "Unavailable product"} ·{" "}
                    {item.productVariantName
                      ? item.productVariantName
                      : "No Product Variant assigned"}
                  </p>
                </Td>
                <Td>{item.caseOwnerName}</Td>
                <Td>{item.currentStage}</Td>
                <Td>{adminOfficer ? caseReviews[item.id]?.label ?? item.terminalOutcome ?? "Open" : item.terminalOutcome ?? "Open"}</Td>
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
                {adminOfficer && <><Td>{caseReviews[item.id]?.tlName ?? "Not assigned"}<span className="block text-xs text-text-secondary">{item.routedCoordinatorName ?? "Coordinator not assigned"}</span></Td><Td>{item.submittedAt ? formatLocalDateTime(item.submittedAt) : "Not submitted"}</Td><Td>{formatLocalDateTime(item.updatedAt)}</Td></>}
              </tr>
            ))
          )}
          </tbody>
        </TableShell>
      </div>
      <div className={styles.appRecords} aria-label="Application cards">
        {loading && items.length === 0 ? <EmptyState>Loading applications…</EmptyState> : items.length === 0 ? (
          hasResultFilters ? <EmptyState kind="search" title="No records match the selected filters" /> : <EmptyState kind="records">No applications are available in your authorized scope.</EmptyState>
        ) : items.map(item => (
          <RecordCard key={item.id} identity={<Link href={`/applications/${item.id}`}><RecordIdentity icon={<IconFileDescription />} title={item.customerName} subtitle={<>{item.bankName ?? "Unavailable bank"} · {item.applicationCode}</>} /></Link>} status={<span className={styles.stage}>{item.currentStage ?? "Unavailable stage"}</span>}>
              <dl>
                <div><dt>Application ID</dt><dd>{item.applicationCode}</dd></div>
                <div><dt>Bank File / Case Number</dt><dd>{item.bankCaseNumber ?? "Not assigned"}</dd></div>
                <div><dt>Customer</dt><dd>{item.customerCode} · {item.customerName}</dd></div>
                <div><dt>Bank / Product Category / Variant</dt><dd>{item.bankName ?? "Unavailable bank"} · {item.productName ?? "Unavailable product"} · {item.productVariantName ?? "No Product Variant assigned"}</dd></div>
                <div><dt>Case Owner</dt><dd>{item.caseOwnerName}</dd></div>
                <div><dt>Stage</dt><dd>{item.currentStage}</dd></div>
                <div><dt>{adminOfficer ? "Status" : "Outcome"}</dt><dd>{adminOfficer ? caseReviews[item.id]?.label ?? item.terminalOutcome ?? "Open" : item.terminalOutcome ?? "Open"}</dd></div>
                <div><dt>TAT</dt><dd>{formatDuration(item.terminal ? item.totalDurationSeconds : item.currentElapsedSeconds)}</dd></div>
                {adminOfficer && <><div><dt>Assigned TL / Coordinator</dt><dd>{caseReviews[item.id]?.tlName ?? "Not assigned"} · {item.routedCoordinatorName ?? "Not assigned"}</dd></div><div><dt>Submission date</dt><dd>{item.submittedAt ? formatLocalDateTime(item.submittedAt) : "Not submitted"}</dd></div><div><dt>Last updated</dt><dd>{formatLocalDateTime(item.updatedAt)}</dd></div></>}
                <div><dt>Delay</dt><dd>{item.hasActiveDelay && item.activeDelay ? `Delay · ${item.activeDelay.delayType}` : "—"}</dd></div>
              </dl>
          </RecordCard>
        ))}
      </div>
      </>}
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
      </div>
      <ApplicationCreateDialog
        open={createOpen}
        onClose={closeCreate}
        onCreated={(created) => {
          setCreateOpen(false);
          if (searchParams.get("create") === "true") router.replace("/applications");
          setPage(1);
          setRequestVersion((value) => value + 1);
          setMessage(`${adminOfficer ? "Case" : "Application"} ${created.applicationCode} created successfully.`);
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
