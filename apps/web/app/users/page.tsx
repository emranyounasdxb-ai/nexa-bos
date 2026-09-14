"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  FilterBar,
  LoadingState,
  PageHeader,
  primaryButtonClass,
  ResponsiveFilterPanel,
  SearchActionBar,
  Select,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
} from "@/components/ui";
import { StaffBulkUploadDialog } from "@/components/staff-bulk-upload-dialog";
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

function DirectoryValue({
  value,
  className = "",
}: {
  value: string | null | undefined;
  className?: string;
}) {
  const display = value?.trim() || "—";
  return (
    <span
      className={`block min-w-0 truncate ${className}`}
      title={display === "—" ? undefined : display}
    >
      {display}
    </span>
  );
}

function UsersDirectory() {
  const { can, user: currentUser } = useAuth();
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
  const searchTimer = useRef<number | null>(null);
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
      if (searchTimer.current !== null) {
        window.clearTimeout(searchTimer.current);
        searchTimer.current = null;
      }
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      // A pending search starts a new result set. Apply its page reset last so
      // pagination from the old results cannot override it; retain page size.
      if (!("q" in updates) && searchDraft !== query) {
        if (searchDraft.trim()) params.set("q", searchDraft.trim());
        else params.delete("q");
        params.delete("page");
      }
      const destination = params.size ? `/users?${params.toString()}` : "/users";
      if (mode === "replace") router.replace(destination, { scroll: false });
      else router.push(destination, { scroll: false });
    },
    [query, router, searchDraft, searchParams],
  );

  useEffect(() => setSearchDraft(query), [query]);

  useEffect(() => {
    if (searchDraft === query) return;
    searchTimer.current = window.setTimeout(() => {
      updateUrl({ q: searchDraft.trim() || null, page: null }, "replace");
    }, 300);
    return () => {
      if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
      searchTimer.current = null;
    };
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
      />

      <div data-amafh-list-surface="">
      <SearchActionBar className="p-3 sm:p-4" search={
        <Field label="Search users">
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled">⌕</span>
            <TextInput aria-label="Search users" className="pl-9" placeholder="Name, email, mobile, office or department" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} />
          </div>
        </Field>
      } actions={currentUser?.userType?.code === "OWNER" || can("Users.Create") ? (
        <div className="flex flex-wrap items-center gap-2">
          <StaffBulkUploadDialog onImported={() => setRequestVersion((value) => value + 1)} />
          {can("Users.Create") ? <Link href="/users/new" className={primaryButtonClass} onClick={() => window.dispatchEvent(new Event("nexa:create-user-modal"))}>Create user</Link> : null}
        </div>
      ) : null} />
      <ResponsiveFilterPanel activeFilters={[
        query ? { label: "Search", value: "Applied" } : null,
        employmentStatus ? { label: "Employment", value: employmentStatus } : null,
        accountStatus ? { label: "Account", value: accountStatus } : null,
        officeId ? { label: "Office", value: options.offices.find((item) => item.id === officeId)?.name ?? officeId } : null,
        departmentId ? { label: "Department", value: options.departments.find((item) => item.id === departmentId)?.name ?? departmentId } : null,
        userTypeId ? { label: "User type", value: options.userTypes.find((item) => item.id === userTypeId)?.name ?? userTypeId } : null,
      ].filter((item): item is { label: string; value: string } => Boolean(item))}>
      <FilterBar className="grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Field label="Employment status" className="col-span-2 sm:col-span-1">
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
            {options.userTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
          </Select>
        </Field>
        <div className="col-span-2 flex items-end gap-2 lg:col-span-3 xl:col-span-1">
          <Button type="button" variant="secondary" className="w-full" disabled={!hasFilters} onClick={() => router.push("/users", { scroll: false })}>Clear filters</Button>
        </div>
      </FilterBar>
      </ResponsiveFilterPanel>

      {optionsError ? <ErrorText>{optionsError}</ErrorText> : null}
      {error ? <Card><ErrorText>{error}</ErrorText><Button type="button" variant="secondary" className="mt-3" onClick={() => setRequestVersion((value) => value + 1)}>Retry</Button></Card> : null}

      <div data-testid="users-list-card">
        <Card className="!p-0">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-brand-border px-3 py-2 sm:px-4">
          <div className="min-w-0">
            <h2 className="text-[length:var(--amafh-text-section)] font-semibold text-text-primary">Users in scope</h2>
            <p className="text-xs text-text-secondary">{loading ? "Refreshing…" : `${total.toLocaleString()} authorized record${total === 1 ? "" : "s"}`}</p>
          </div>
          {hasFilters ? <Badge>Filtered</Badge> : <Badge>All authorized</Badge>}
        </div>

        {loading && items.length === 0 ? <LoadingState>Loading Users…</LoadingState> : null}
        {!loading && !error && items.length === 0 ? <EmptyState>No Users match the current filters.</EmptyState> : null}

        {items.length > 0 ? (
          <>
            <div className="hidden min-[1400px]:block">
              <TableShell
                data-testid="users-directory-table"
                className={loading ? "rounded-none border-0 opacity-70 shadow-none [&_table]:!min-w-0 [&_table]:table-fixed" : "rounded-none border-0 shadow-none [&_table]:!min-w-0 [&_table]:table-fixed"}
              >
                <TableHead><tr><Th className="w-[8%] px-2 [padding-right:4px]">Code</Th><Th className="w-[24%] px-2 [padding-left:4px]">User</Th><Th className="w-[11%] px-2">Designation</Th><Th className="w-[10%] px-2">Phone</Th><Th className="w-[17%] px-2">Email</Th><Th className="w-[6%] px-2">Office</Th><Th className="w-[8%] px-2">Department</Th><Th className="w-[8%] px-2">Nationality</Th><Th className="w-[8%] px-2">Joining</Th></tr></TableHead>
                <tbody>
                  {items.map((user) => (
                    <tr key={user.id}>
                      <Td className="overflow-hidden whitespace-nowrap px-2 !py-1.5 [padding-right:4px]"><DirectoryValue value={user.employeeCode} className="w-full" /></Td>
                      <Td className="overflow-hidden whitespace-nowrap px-2 !py-1.5 [padding-left:4px]"><div className="flex w-full min-w-0 items-center gap-2"><span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-primary">{initials(user.fullName)}</span><Link className="min-w-0 flex-1 truncate font-medium text-brand-link underline" title={user.fullName} href={`/users/${user.id}`}>{user.fullName}</Link></div></Td>
                      <Td className="overflow-hidden whitespace-nowrap px-2 !py-1.5"><DirectoryValue value={user.designation?.name} className="w-full" /></Td>
                      <Td className="overflow-hidden whitespace-nowrap px-2 !py-1.5"><DirectoryValue value={user.mobile} className="w-full" /></Td>
                      <Td className="overflow-hidden whitespace-nowrap px-2 !py-1.5"><DirectoryValue value={user.email} className="w-full" /></Td>
                      <Td className="overflow-hidden whitespace-nowrap px-2 !py-1.5"><DirectoryValue value={user.office?.name} className="w-full" /></Td>
                      <Td className="overflow-hidden whitespace-nowrap px-2 !py-1.5"><DirectoryValue value={user.department?.name} className="w-full" /></Td>
                      <Td className="overflow-hidden whitespace-nowrap px-2 !py-1.5"><DirectoryValue value={user.nationality} className="w-full" /></Td>
                      <Td className="overflow-hidden whitespace-nowrap px-2 !py-1.5"><DirectoryValue value={user.joiningDate} className="w-full" /></Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>

            <div className={loading ? "grid gap-2 p-3 opacity-70 min-[1400px]:hidden" : "grid gap-2 p-3 min-[1400px]:hidden"}>
              {items.map((user) => (
                <article key={user.id} className="min-w-0 rounded-[10px] border border-brand-border p-3">
                  <div className="flex min-w-0 items-center gap-3"><span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-primary">{initials(user.fullName)}</span><Link className="min-w-0 flex-1 truncate font-semibold text-brand-link underline" title={user.fullName} href={`/users/${user.id}`}>{user.fullName}</Link></div>
                  <dl className="mt-3 grid min-w-0 grid-cols-2 gap-2 text-xs">
                    <div><dt className="text-text-secondary">Code</dt><dd className="text-text-primary"><DirectoryValue value={user.employeeCode} /></dd></div>
                    <div><dt className="text-text-secondary">Designation</dt><dd className="text-text-primary"><DirectoryValue value={user.designation?.name} /></dd></div>
                    <div><dt className="text-text-secondary">Phone</dt><dd className="text-text-primary"><DirectoryValue value={user.mobile} /></dd></div>
                    <div><dt className="text-text-secondary">Email</dt><dd className="text-text-primary"><DirectoryValue value={user.email} /></dd></div>
                    <div><dt className="text-text-secondary">Office</dt><dd className="text-text-primary"><DirectoryValue value={user.office?.name} /></dd></div>
                    <div><dt className="text-text-secondary">Department</dt><dd className="text-text-primary"><DirectoryValue value={user.department?.name} /></dd></div>
                    <div><dt className="text-text-secondary">Nationality</dt><dd className="text-text-primary"><DirectoryValue value={user.nationality} /></dd></div>
                    <div><dt className="text-text-secondary">Joining</dt><dd className="text-text-primary"><DirectoryValue value={user.joiningDate} /></dd></div>
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
      </div>
      </div>
    </section>
  );
}

export default function UsersPage() {
  return <Suspense fallback={<LoadingState>Loading Users…</LoadingState>}><UsersDirectory /></Suspense>;
}
