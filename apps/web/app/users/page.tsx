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
  Badge,
  ButtonLink,
  EmptyState,
  ErrorText,
  FilterBar,
  SearchActionBar,
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
import type { UserRecord } from "@/lib/types";

export default function UsersPage() {
  const { can } = useAuth();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<UserRecord[]>([]);
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
    void apiGet<PaginatedResponse<UserRecord>>(`/api/v1/users${suffix}`, getBrowserApiUrl())
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
        setError(err instanceof ApiClientError ? err.message : "Unable to load users");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [page, pageSize, query]);

  return (
    <section className="space-y-4">
      <FilterBar className="block">
        <SearchActionBar
          search={
            <label className="block text-sm font-medium text-slate-700">
              Search users
              <div className="relative">
                <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  ⌕
                </span>
                <TextInput
                  className="pl-9"
                  placeholder="Name, email, code, mobile, office or department"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                  aria-label="Search users"
                />
              </div>
            </label>
          }
          actions={can("Users.Create") ? <ButtonLink href="/users/new">Create user</ButtonLink> : null}
        />
      </FilterBar>
      <ErrorText>{error}</ErrorText>
      <TableShell className={loading && items.length > 0 ? "opacity-70" : undefined}>
        <TableHead>
          <tr>
            <Th>User code</Th>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Type</Th>
            <Th>Status</Th>
          </tr>
        </TableHead>
        <tbody>
          {loading && items.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <EmptyState>Loading users…</EmptyState>
              </td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <EmptyState>No users match the current search.</EmptyState>
              </td>
            </tr>
          ) : (
            items.map((user) => (
              <tr key={user.id} className="border-t border-slate-100">
                <Td>
                  <Link className="font-medium text-slate-900" href={`/users/${user.id}`}>
                    {user.userCode}
                  </Link>
                </Td>
                <Td>
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-[#0f4c81]"
                    >
                      {user.fullName
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((part) => part.charAt(0).toUpperCase())
                        .join("")}
                    </span>
                    <span className="font-medium text-slate-900">{user.fullName}</span>
                  </div>
                </Td>
                <Td className="whitespace-nowrap">{user.email}</Td>
                <Td>{user.userType?.code ? <Badge>{user.userType.code}</Badge> : "—"}</Td>
                <Td><StatusBadge value={user.accountStatus} /></Td>
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
