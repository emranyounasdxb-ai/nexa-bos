"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  Badge,
  ButtonLink,
  EmptyState,
  ErrorText,
  FilterBar,
  PageHeader,
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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (query) {
      params.set("q", query);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    setLoading(true);
    void apiGet<{ items: UserRecord[] }>(`/api/v1/users${suffix}`, getBrowserApiUrl())
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
  }, [query]);

  return (
    <section className="space-y-4">
      <PageHeader
        title="User directory"
        description="Search and review employees visible within your authorized user scope."
        actions={
          can("Users.Create") ? <ButtonLink href="/users/new">Create user</ButtonLink> : null
        }
      />
      <FilterBar className="sm:grid-cols-1 lg:grid-cols-1">
        <label className="text-sm font-medium text-slate-700">
          Search users
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              ⌕
            </span>
            <TextInput
              className="pl-9"
              placeholder="Name, email, code, mobile, office or department"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search users"
            />
          </div>
        </label>
      </FilterBar>
      <ErrorText>{error}</ErrorText>
      <TableShell>
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
          {loading ? (
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
    </section>
  );
}
