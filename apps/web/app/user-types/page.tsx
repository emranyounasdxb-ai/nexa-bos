"use client";

import { RegisterWorkspace } from "@/components/page-patterns";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Pagination, useClientPagination } from "@/components/pagination";
import { Button, ErrorText, PageHeader, StatusBadge, TableHead, TableShell, Td, TextInput, Th } from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { UserTypeSummary } from "@/lib/types";

export default function UserTypesPage() {
  const { can } = useAuth();
  const [items, setItems] = useState<UserTypeSummary[]>([]);
  const [form, setForm] = useState({ name: "", code: "", description: "" });
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState("");
  const api = getBrowserApiUrl();
  const pagination = useClientPagination(items);

  const refresh = useCallback(async () => {
    const data = await apiGet<{ items: UserTypeSummary[] }>("/api/v1/user-types", api);
    setItems(data.items);
  }, [api]);

  useEffect(() => {
    void refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : "Load failed"));
  }, [refresh]);

  async function createType(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiRequest("/api/v1/user-types", api, {
        method: "POST",
        body: JSON.stringify({ ...form, can_be_reporting_manager: canManage }),
      });
      setForm({ name: "", code: "", description: "" });
      setCanManage(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="User types"
        description="Review and manage the existing role templates and their configured visibility scopes."
      />
      <ErrorText>{error}</ErrorText>
      <RegisterWorkspace editor={can("UserTypes.Create") ? (
        <form onSubmit={(event) => void createType(event)} className="grid min-w-0 gap-4 rounded-lg border border-brand-border bg-surface p-4 md:grid-cols-3 sm:p-5">
          <label className="min-w-0 text-sm">Name <span aria-hidden="true">*</span><TextInput
            placeholder="Name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          /></label>
          <label className="min-w-0 text-sm">Unique code <span aria-hidden="true">*</span><TextInput
            placeholder="Unique code"
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value })}
            required
          /></label>
          <label className="min-w-0 text-sm">Description<TextInput
            placeholder="Description"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          /></label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={canManage}
              onChange={(event) => setCanManage(event.target.checked)}
            />
            Can be reporting manager
          </label>
          <div className="flex justify-end md:col-span-2"><Button type="submit">Create custom type</Button></div>
        </form>
      ) : null}>
      <TableShell className="rounded-b-none">
        <TableHead>
          <tr>
            <Th>Code</Th>
            <Th>Name</Th>
            <Th>Status</Th>
            <Th>User directory scope</Th>
            <Th>Customer scope</Th>
            <Th>Can be reporting manager</Th>
          </tr>
        </TableHead>
        <tbody>
          {pagination.pagedItems.map((item) => (
            <tr key={item.id}>
              <Td>
                <Link className="font-medium" href={`/user-types/${item.id}`}>
                  {item.code}
                </Link>
              </Td>
              <Td>{item.name}</Td>
              <Td><StatusBadge value={item.status} /></Td>
              <Td>{item.visibilityScope ?? "none"}</Td>
              <Td>{item.customerVisibilityScope ?? "none"}</Td>
              <Td>{item.canBeReportingManager ? "Yes" : "No"}</Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <Pagination
        className="-mt-6 rounded-b-[10px] border border-slate-200"
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        totalPages={pagination.totalPages}
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
      />
      </RegisterWorkspace>
    </section>
  );
}
