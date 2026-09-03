"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

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
import type { OrgRef, UserRecord, UserTypeSummary } from "@/lib/types";

const EMPLOYMENT_STATUSES = [
  "Active",
  "Probation",
  "Notice Period",
  "Resigned",
  "Terminated",
  "Inactive",
] as const;
const ACCOUNT_STATUSES = ["pending", "active", "deactivated"] as const;

type DepartmentOption = OrgRef & { office?: OrgRef | null };
type DirectoryOptions = {
  departments: DepartmentOption[];
  offices: OrgRef[];
  userTypes: UserTypeSummary[];
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function optionValue<T extends readonly string[]>(value: string | null, options: T): T[number] | "" {
  return value && options.includes(value as T[number]) ? (value as T[number]) : "";
}

function idValue(value: string | null): string {
  return value && UUID_PATTERN.test(value) ? value : "";
}

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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function UsersDirectory() {
  const { can } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const api = getBrowserApiUrl();
  const query = searchParams.get("q") ?? "";
  const employmentStatus = optionValue(searchParams.get("employmentStatus"), EMPLOYMENT_STATUSES);
  const accountStatus = optionValue(searchParams.get("accountStatus"), ACCOUNT_STATUSES);
  const officeId = idValue(searchParams.get("officeId"));
  const departmentId = idValue(searchParams.get("departmentId"));
  const userTypeId = idValue(searchParams.get("userTypeId"));
  const page = pageValue(searchParams.get("page"));
  const pageSize = pageSizeValue(searchParams.get("pageSize"));
  const [searchDraft, setSearchDraft] = useState(query);
  const [items, setItems] = useState<UserRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [requestVersion, setRequestVersion] = useState(0);
  const [options, setOptions] = useState<DirectoryOptions>({ departments: [], offices: [], userTypes: [] });
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");

  const updateUrl = useCallback(
    (updates: Record<string, string | null>, mode: "push" | "replace" = "push") => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const destination = params.size ? `/users?${params.toString()}` : "/users";
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
    let active = true;
    setOptionsLoading(true);
    setOptionsError("");
    const userTypes = can("UserTypes.View")
      ? apiGet<{ items: UserTypeSummary[] }>("/api/v1/user-types", api)
      : Promise.resolve({ items: [] });
    void Promise.all([
      apiGet<{ items: OrgRef[] }>("/api/v1/offices", api),
      apiGet<{ items: DepartmentOption[] }>("/api/v1/departments", api),
      userTypes,
    ])
      .then(([offices, departments, types]) => {
        if (!active) return;
        setOptions({ offices: offices.items, departments: departments.items, userTypes: types.items });
      })
      .catch((value: unknown) => {
        if (active) setOptionsError(value instanceof Error ? value.message : "Unable to load directory filters");
      })
      .finally(() => {
        if (active) setOptionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, can]);

  useEffect(() => {
    if (!can("Users.View")) return;
    let active = true;
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (query.trim()) params.set("q", query.trim());
    if (employmentStatus) params.set("employmentStatus", employmentStatus);
    if (accountStatus) params.set("accountStatus", accountStatus);
    if (officeId) params.set("officeId", officeId);
    if (departmentId) params.set("departmentId", departmentId);
    if (userTypeId) params.set("userTypeId", userTypeId);
    setLoading(true);
    setError("");
    void apiGet<PaginatedResponse<UserRecord>>(`/api/v1/users?${params.toString()}`, api)
      .then((data) => {
        if (!active) return;
        setItems(data.items);
        setTotal(data.pagination.total);
        setTotalPages(data.pagination.totalPages);
      })
      .catch((value: unknown) => {
        if (active) setError(value instanceof ApiClientError ? value.message : "Unable to load users");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountStatus, api, can, departmentId, employmentStatus, officeId, page, pageSize, query, requestVersion, userTypeId]);

  const departmentOptions = useMemo(
    () => options.departments.filter((department) => !officeId || department.office?.id === officeId || department.officeId === officeId),
    [officeId, options.departments],
  );
  const hasFilters = Boolean(query || employmentStatus || accountStatus || officeId || departmentId || userTypeId);

  if (!can("Users.View")) return <EmptyState>You do not have permission to view Users.</EmptyState>;

  return (
    <section className="min-w-0 space-y-4">
      <PageHeader
        title="Users"
        description="Find employees by organization, employment state, account state, or User Type and open the profile actions allowed by your permissions."
        actions={can("Users.Create") ? <ButtonLink href="/users/new">Create user</ButtonLink> : null}
      />

      <FilterBar className="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Field label="Search users" className="sm:col-span-2 lg:col-span-3 xl:col-span-2">
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled">⌕</span>
            <TextInput aria-label="Search users" className="pl-9" placeholder="Name, email, code, mobile, office or department" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} />
          </div>
        </Field>
        <Field label="Employment status">
          <Select aria-label="Employment status" value={employmentStatus} onChange={(event) => updateUrl({ employmentStatus: event.target.value || null, page: null })}>
            <option value="">All employment states</option>
            {EMPLOYMENT_STATUSES.map((value) => <option key={value}>{value}</option>)}
          </Select>
        </Field>
        <Field label="Account status">
          <Select aria-label="Account status" value={accountStatus} onChange={(event) => updateUrl({ accountStatus: event.target.value || null, page: null })}>
            <option value="">All account states</option>
            {ACCOUNT_STATUSES.map((value) => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}
          </Select>
        </Field>
        <Field label="Office">
          <Select aria-label="Office" disabled={optionsLoading} value={officeId} onChange={(event) => updateUrl({ officeId: event.target.value || null, departmentId: null, page: null })}>
            <option value="">All offices</option>
            {options.offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
          </Select>
        </Field>
        <Field label="Department">
          <Select aria-label="Department" disabled={optionsLoading} value={departmentId} onChange={(event) => updateUrl({ departmentId: event.target.value || null, page: null })}>
            <option value="">All departments</option>
            {departmentOptions.map((department) => <option key={department.id} value={department.id}>{officeId ? department.name : `${department.office?.name ?? "Office"} — ${department.name}`}</option>)}
          </Select>
        </Field>
        <Field label="User Type" help={!can("UserTypes.View") ? "Your role cannot view the User Type catalogue." : undefined}>
          <Select aria-label="User Type" disabled={optionsLoading || !can("UserTypes.View")} value={userTypeId} onChange={(event) => updateUrl({ userTypeId: event.target.value || null, page: null })}>
            <option value="">All User Types</option>
            {options.userTypes.map((type) => <option key={type.id} value={type.id}>{type.name} ({type.code})</option>)}
          </Select>
        </Field>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3 xl:col-span-1">
          <Button type="button" variant="secondary" className="w-full" disabled={!hasFilters} onClick={() => router.push("/users", { scroll: false })}>Clear filters</Button>
        </div>
      </FilterBar>

      {optionsError ? <ErrorText>{optionsError}</ErrorText> : null}
      {error ? <Card><ErrorText>{error}</ErrorText><Button type="button" variant="secondary" className="mt-3" onClick={() => setRequestVersion((value) => value + 1)}>Retry</Button></Card> : null}

      <Card className="!p-0">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-brand-border px-3 py-2 sm:px-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-primary">Users in scope</h2>
            <p className="text-xs text-text-secondary">{loading ? "Refreshing…" : `${total.toLocaleString()} authorized record${total === 1 ? "" : "s"}`}</p>
          </div>
          {hasFilters ? <Badge>Filtered</Badge> : <Badge>All authorized</Badge>}
        </div>

        {loading && items.length === 0 ? <LoadingState>Loading Users…</LoadingState> : null}
        {!loading && !error && items.length === 0 ? <EmptyState>No Users match the current filters.</EmptyState> : null}

        {items.length > 0 ? (
          <>
            <div className="hidden sm:block">
              <TableShell className={loading ? "rounded-none border-0 opacity-70 shadow-none" : "rounded-none border-0 shadow-none"}>
                <TableHead><tr><Th>User</Th><Th>Organization</Th><Th>User Type</Th><Th>Employment</Th><Th>Account</Th></tr></TableHead>
                <tbody>
                  {items.map((user) => (
                    <tr key={user.id}>
                      <Td><div className="flex min-w-56 items-center gap-3"><span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-primary">{initials(user.fullName)}</span><span className="min-w-0"><Link className="block font-medium text-brand-link underline" href={`/users/${user.id}`}>{user.userCode}</Link><span className="block truncate font-medium text-text-primary">{user.fullName}</span><span className="block truncate text-xs text-text-secondary">{user.email}</span></span></div></Td>
                      <Td>{user.office?.name ?? "No Office"}<span className="block text-xs text-text-secondary">{user.department?.name ?? "No Department"}</span></Td>
                      <Td>{user.userType?.code ? <Badge>{user.userType.code}</Badge> : "—"}</Td>
                      <Td><Badge>{user.employmentStatus}</Badge></Td>
                      <Td><StatusBadge value={user.accountStatus} /></Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>

            <div className={loading ? "grid gap-2 p-3 opacity-70 sm:hidden" : "grid gap-2 p-3 sm:hidden"}>
              {items.map((user) => (
                <article key={user.id} className="min-w-0 rounded-[10px] border border-brand-border p-3">
                  <div className="flex min-w-0 items-start gap-3"><span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-primary">{initials(user.fullName)}</span><div className="min-w-0 flex-1"><Link className="font-semibold text-brand-link underline" href={`/users/${user.id}`}>{user.userCode}</Link><p className="truncate font-medium text-text-primary">{user.fullName}</p><p className="truncate text-xs text-text-secondary">{user.email}</p></div></div>
                  <dl className="mt-3 grid min-w-0 grid-cols-2 gap-2 text-xs">
                    <div><dt className="text-text-secondary">Organization</dt><dd className="break-words text-text-primary">{user.office?.name ?? "No Office"}<span className="block">{user.department?.name ?? "No Department"}</span></dd></div>
                    <div><dt className="text-text-secondary">User Type</dt><dd className="text-text-primary">{user.userType?.code ?? "—"}</dd></div>
                    <div><dt className="text-text-secondary">Employment</dt><dd className="text-text-primary">{user.employmentStatus}</dd></div>
                    <div><dt className="text-text-secondary">Account</dt><dd><StatusBadge value={user.accountStatus} /></dd></div>
                  </dl>
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
          onPageSizeChange={(value) => { if (value !== "all") updateUrl({ pageSize: value === 10 ? null : String(value), page: null }); }}
        />
      </Card>
    </section>
  );
}

export default function UsersPage() {
  return <Suspense fallback={<LoadingState>Loading Users…</LoadingState>}><UsersDirectory /></Suspense>;
}
