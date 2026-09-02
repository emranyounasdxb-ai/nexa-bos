"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
  ButtonLink,
  EmptyState,
  ErrorText,
  PageHeader,
  SearchActionBar,
  Select,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
} from "@/components/ui";
import { apiGet, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDuration } from "@/lib/duration";
import { getBrowserApiUrl } from "@/lib/env";
import type {
  ApplicationRecord,
  CatalogItem,
  ManagerOption,
  OrgRef,
  ProductVariantRecord,
  WorkflowRecord,
} from "@/lib/types";

type ApplicationVariantFilter = Pick<
  ProductVariantRecord,
  "id" | "bankId" | "productId" | "code" | "name" | "status"
>;

const OUTCOMES = ["Completed", "Final Rejected", "Cancelled", "Withdrawn"];

const emptyFilters = {
  bank_id: "",
  product_id: "",
  product_variant_id: "",
  case_owner_id: "",
  office_id: "",
  department_id: "",
  team_id: "",
  current_stage_id: "",
  terminal_outcome: "",
  submission_from: "",
  submission_to: "",
  bank_stage_from: "",
  bank_stage_to: "",
  created_from: "",
  created_to: "",
  requested_min: "",
  requested_max: "",
  approved_min: "",
  approved_max: "",
  booked_min: "",
  booked_max: "",
  funded_min: "",
  funded_max: "",
};

export default function ApplicationsPage() {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
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
  const [banks, setBanks] = useState<CatalogItem[]>([]);
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [variants, setVariants] = useState<ApplicationVariantFilter[]>([]);
  const [owners, setOwners] = useState<ManagerOption[]>([]);
  const [offices, setOffices] = useState<OrgRef[]>([]);
  const [departments, setDepartments] = useState<OrgRef[]>([]);
  const [teams, setTeams] = useState<OrgRef[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);

  useEffect(() => {
    void Promise.all([
      apiGet<{ items: CatalogItem[] }>("/api/v1/banks", api),
      apiGet<{ items: CatalogItem[] }>("/api/v1/products", api),
      apiGet<{ items: ApplicationVariantFilter[] }>("/api/v1/applications/product-variants", api),
      apiGet<{ items: OrgRef[] }>("/api/v1/offices", api),
      apiGet<{ items: OrgRef[] }>("/api/v1/departments", api),
      apiGet<{ items: OrgRef[] }>("/api/v1/teams", api),
      apiGet<{ items: WorkflowRecord[] }>("/api/v1/workflows", api),
      apiGet<{ items: ManagerOption[] }>("/api/v1/applications/case-owners", api),
    ])
      .then(([
        bankData,
        productData,
        variantData,
        officeData,
        deptData,
        teamData,
        workflowData,
        ownerData,
      ]) => {
        setBanks(bankData.items);
        setProducts(productData.items);
        setVariants(variantData.items);
        setOffices(officeData.items);
        setDepartments(deptData.items);
        setTeams(teamData.items);
        setWorkflows(workflowData.items);
        setOwners(ownerData.items);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Load failed"));
  }, [api]);

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
  }, [api, applied, page, pageSize, query]);

  const stages = useMemo(
    () =>
      workflows.flatMap((workflow) =>
        workflow.stages.map((stage) => ({
          id: stage.id,
          label: `${workflow.bank?.code ?? ""}/${workflow.product?.code ?? ""} v${workflow.version}: ${stage.name}`,
        })),
      ),
    [workflows],
  );

  const officeDepartments = departments.filter(
    (item) => !filters.office_id || item.officeId === filters.office_id,
  );
  const officeTeams = teams.filter(
    (item) =>
      (!filters.office_id || item.officeId === filters.office_id) &&
      (!filters.department_id || item.departmentId === filters.department_id),
  );
  const applicableVariants = variants.filter(
    (item) =>
      (!filters.bank_id || item.bankId === filters.bank_id) &&
      (!filters.product_id || item.productId === filters.product_id),
  );

  return (
    <section className="space-y-4">
      <PageHeader
        title="Applications"
        description="Search and filter applications in your current scope, then open permitted workflow records."
      />
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
            <ButtonLink href="/applications/new">Create application</ButtonLink>
          ) : null
        }
      />
      <form
        data-testid="application-filters"
        className="grid grid-cols-1 gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setApplied({ ...filters });
        }}
      >
        <Select
          className="mt-0 self-end"
          aria-label="Filter by bank"
          value={filters.bank_id}
          onChange={(event) => {
            const bankId = event.target.value;
            setFilters({
              ...filters,
              bank_id: bankId,
              product_variant_id:
                !filters.product_variant_id ||
                variants.some(
                  (item) =>
                    item.id === filters.product_variant_id &&
                    (!bankId || item.bankId === bankId),
                )
                  ? filters.product_variant_id
                  : "",
            });
          }}
        >
          <option value="">All banks</option>
          {banks.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.code})
            </option>
          ))}
        </Select>
        <Select
          className="mt-0 self-end"
          aria-label="Filter product"
          value={filters.product_id}
          onChange={(event) => {
            const productId = event.target.value;
            setFilters({
              ...filters,
              product_id: productId,
              product_variant_id:
                !filters.product_variant_id ||
                variants.some(
                  (item) =>
                    item.id === filters.product_variant_id &&
                    (!productId || item.productId === productId),
                )
                  ? filters.product_variant_id
                  : "",
            });
          }}
        >
          <option value="">All products</option>
          {products.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.code})
            </option>
          ))}
        </Select>
        <Select
          className="mt-0 self-end"
          aria-label="Filter product variant"
          value={filters.product_variant_id}
          onChange={(event) =>
            setFilters({ ...filters, product_variant_id: event.target.value })
          }
        >
          <option value="">All Product Variants</option>
          {applicableVariants.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.code}){item.status === "inactive" ? " — Inactive" : ""}
            </option>
          ))}
        </Select>
        <Select
          className="mt-0 self-end"
          aria-label="Filter case owner"
          value={filters.case_owner_id}
          onChange={(event) => setFilters({ ...filters, case_owner_id: event.target.value })}
        >
          <option value="">All case owners</option>
          {owners.map((item) => (
            <option key={item.id} value={item.id}>
              {item.fullName}
            </option>
          ))}
        </Select>
        <Select
          className="mt-0 self-end"
          aria-label="Filter office"
          value={filters.office_id}
          onChange={(event) =>
            setFilters({ ...filters, office_id: event.target.value, department_id: "", team_id: "" })
          }
        >
          <option value="">All offices</option>
          {offices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.name}
            </option>
          ))}
        </Select>
        <Select
          className="mt-0 self-end"
          aria-label="Filter department"
          value={filters.department_id}
          onChange={(event) =>
            setFilters({ ...filters, department_id: event.target.value, team_id: "" })
          }
        >
          <option value="">All departments</option>
          {officeDepartments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.name}
            </option>
          ))}
        </Select>
        <Select
          className="mt-0 self-end"
          aria-label="Filter team"
          value={filters.team_id}
          onChange={(event) => setFilters({ ...filters, team_id: event.target.value })}
        >
          <option value="">All teams</option>
          {officeTeams.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.name}
            </option>
          ))}
        </Select>
        <Select
          className="mt-0 self-end"
          aria-label="Filter current stage"
          value={filters.current_stage_id}
          onChange={(event) => setFilters({ ...filters, current_stage_id: event.target.value })}
        >
          <option value="">All stages</option>
          {stages.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
        <Select
          className="mt-0 self-end"
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
        <label className="flex h-full flex-col justify-end text-xs font-medium leading-4 text-slate-600">
          Submission date
          <DateRangePicker
            aria-label="Submission date"
            from={filters.submission_from}
            to={filters.submission_to}
            onChange={({ from: submission_from, to: submission_to }) =>
              setFilters({ ...filters, submission_from, submission_to })
            }
          />
        </label>
        <label className="flex h-full flex-col justify-end text-xs font-medium leading-4 text-slate-600">
          Bank stage date
          <DateRangePicker
            aria-label="Bank stage date"
            from={filters.bank_stage_from}
            to={filters.bank_stage_to}
            onChange={({ from: bank_stage_from, to: bank_stage_to }) =>
              setFilters({ ...filters, bank_stage_from, bank_stage_to })
            }
          />
        </label>
        <label className="flex h-full flex-col justify-end text-xs font-medium leading-4 text-slate-600">
          Created date
          <DateRangePicker
            aria-label="Created date"
            from={filters.created_from}
            to={filters.created_to}
            onChange={({ from: created_from, to: created_to }) =>
              setFilters({ ...filters, created_from, created_to })
            }
          />
        </label>
        {(
          [
            ["requested_min", "Requested min"],
            ["requested_max", "Requested max"],
            ["approved_min", "Approved min"],
            ["approved_max", "Approved max"],
            ["booked_min", "Booked min"],
            ["booked_max", "Booked max"],
            ["funded_min", "Funded min"],
            ["funded_max", "Funded max"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex h-full flex-col justify-end text-xs font-medium leading-4 text-slate-600">
            {label}
            <TextInput
              className="mt-1"
              type="number"
              min="0"
              step="0.01"
              aria-label={`Filter ${label.toLowerCase()}`}
              value={filters[key]}
              onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}
            />
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-2 self-end">
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
              <td colSpan={8}>
                <EmptyState>Loading applications…</EmptyState>
              </td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td colSpan={8}>
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
    </section>
  );
}
