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
import type { UserRecord } from "@/lib/types";

export default function UsersPage() {
  const { can } = useAuth();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<UserRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query) {
      params.set("q", query);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    setLoading(true);
    void apiGet<{ items: UserRecord[] }>(`/api/v1/users${suffix}`, getBrowserApiUrl())
      .then((data) => {
        setItems(data.items);
        setError("");
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err.message : "Unable to load users");
      })
      .finally(() => setLoading(false));
  }, [query]);

  return (
    <section className="space-y-4">
      <PageHeader
        title="User directory"
        actions={
          can("Users.Create") ? <ButtonLink href="/users/new">Create user</ButtonLink> : null
        }
      />
      <TextInput
        className="mt-0"
        placeholder="Search name, email, codes, mobile, office, department..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search users"
      />
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
                <Td>{user.fullName}</Td>
                <Td>{user.email}</Td>
                <Td>{user.userType?.code ?? "—"}</Td>
                <Td>{user.accountStatus}</Td>
              </tr>
            ))
          )}
        </tbody>
      </TableShell>
    </section>
  );
}
