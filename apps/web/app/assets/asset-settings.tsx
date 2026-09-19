"use client";

import { RecordCard, RecordIdentity } from "@/components/page-patterns";
import styles from "./assets.module.css";
import { AssetActionPopup as PanelPopup } from "./asset-action-popup";

import { useCallback, useEffect, useState } from "react";

import { IconEdit, IconPower, IconAsset } from "@/components/icons";
import { Pagination, useClientPagination } from "@/components/pagination";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  PageHeader,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
} from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { AssetCategoryField, AssetCategoryRecord } from "@/lib/types";

export function AssetSettings({ onMutation, editable }: { onMutation?: () => void; editable: boolean }) {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [items, setItems] = useState<AssetCategoryRecord[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<AssetCategoryField[]>([]);
  const [fieldKey, setFieldKey] = useState("");
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldRequired, setFieldRequired] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pagination = useClientPagination(items);

  const refresh = useCallback(async () => {
    const data = await apiGet<{ items: AssetCategoryRecord[] }>(
      "/api/v1/assets/categories",
      api,
    );
    setItems(data.items);
  }, [api]);

  useEffect(() => {
    if (can("Assets.View")) {
      void refresh().catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Unable to load categories"),
      );
    }
  }, [can, refresh]);

  function addField() {
    if (!fieldKey.trim() || !fieldLabel.trim()) return;
    setFields((current) => [
      ...current,
      { key: fieldKey.trim(), label: fieldLabel.trim(), required: fieldRequired },
    ]);
    setFieldKey("");
    setFieldLabel("");
    setFieldRequired(false);
  }

  async function createCategory(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const created = await apiRequest<AssetCategoryRecord>("/api/v1/assets/categories", api, {
        method: "POST",
        body: JSON.stringify({ name, description: description || null, fields }),
      });
      setMessage(`${created.name} created`);
      setName("");
      setDescription("");
      setFields([]);
      await refresh();
      onMutation?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Category creation failed");
    }
  }

  async function rename(item: AssetCategoryRecord) {
    const nextName = window.prompt("Category name", item.name);
    if (!nextName || nextName === item.name) return;
    try {
      await apiRequest(`/api/v1/assets/categories/${item.id}`, api, {
        method: "PATCH",
        body: JSON.stringify({ name: nextName }),
      });
      await refresh();
      onMutation?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Category update failed");
    }
  }

  async function toggle(item: AssetCategoryRecord) {
    const action = item.status === "active" ? "deactivate" : "activate";
    try {
      await apiRequest(`/api/v1/assets/categories/${item.id}/${action}`, api, {
        method: "POST",
      });
      await refresh();
      onMutation?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Category status update failed");
    }
  }

  if (!can("Assets.ManageMaster") || !editable) {
    return <EmptyState>You do not have permission to manage Asset categories.</EmptyState>;
  }

  return (
    <section data-figma-large-header="" className={`${styles.assetPage} ${styles.categoryPage}`}>
      <PageHeader
        title="Categories"
        description="Configure future individually tracked Asset types without changing the custody model."
        actions={<PanelPopup label="New Category" feedback={<><ErrorText>{error}</ErrorText>{message ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}</>}>
          <Card>
        <h3 className="text-lg font-semibold text-slate-900">New category</h3>
        <form className="mt-4 space-y-4" onSubmit={createCategory}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name"><TextInput aria-label="Category name" required value={name} onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="Description"><TextInput aria-label="Category description" value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h4 className="text-sm font-semibold">Category fields</h4>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <Field label="Field key"><TextInput aria-label="Category field key" value={fieldKey} placeholder="manufacturer" onChange={(event) => setFieldKey(event.target.value)} /></Field>
              <Field label="Display label"><TextInput aria-label="Category field label" value={fieldLabel} placeholder="Manufacturer" onChange={(event) => setFieldLabel(event.target.value)} /></Field>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={fieldRequired} onChange={(event) => setFieldRequired(event.target.checked)} />Required</label>
              <div className="flex items-end"><Button type="button" onClick={addField}>Add field</Button></div>
            </div>
            {fields.length ? <ul className="mt-3 space-y-1 text-sm">{fields.map((field) => <li key={field.key}>{field.label} ({field.key}){field.required ? " — required" : ""}</li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No fields added yet.</p>}
          </div>
          <Button type="submit">Create category</Button>
        </form>
      </Card>
        </PanelPopup>}
      />

      <h2 className={`${styles.categoryCount} ${styles.compactRecords}`}>{items.length} categories · {items.filter(item => item.status === "active").length} active</h2>
      <ErrorText>{error}</ErrorText>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      <Card className={styles.categoryRegister}>
      <div className={styles.categoryRegisterHeading}><h2>Configured categories</h2><p>{items.length} categories · {items.filter(item => item.status === "active").length} active</p></div>
      <TableShell headerTone="subtle" mobileCards={false} className={`${styles.desktopRecords} rounded-b-none`}>
        <TableHead><tr><Th>Category</Th><Th>Fields</Th><Th>Status</Th><Th>Actions</Th></tr></TableHead>
        <tbody>
          {pagination.pagedItems.map((item) => (
            <tr key={item.id} className="border-t border-slate-100">
              <Td><p className="font-medium">{item.name}</p><p className="text-xs text-slate-500">{item.description}</p></Td>
              <Td>{item.fields.map((field) => field.label).join(", ") || "No additional fields"}</Td>
              <Td><Badge>{item.status}</Badge></Td>
              <Td><div className={styles.categoryActions}><Button type="button" size="compact" onClick={() => void rename(item)}><IconEdit className="size-4" />Rename</Button><Button type="button" variant="secondary" size="compact" onClick={() => void toggle(item)}><IconPower className="size-4" />{item.status === "active" ? "Deactivate" : "Activate"}</Button></div></Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <Pagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        totalPages={pagination.totalPages}
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
      />
      </Card>
      <div className={styles.compactRecords}>{pagination.pagedItems.map(item => <RecordCard key={item.id} identity={<div className="flex items-center gap-3"><RecordIdentity title={item.name} subtitle={item.fields.map(field => field.label).join(" · ") || "No additional fields"} icon={<IconAsset />} tone="success" navigable={false} /></div>} status={<Badge tone={item.status === "active" ? "green" : "neutral"}>{item.status}</Badge>}><p>{item.description}</p><div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="secondary" size="compact" onClick={() => void rename(item)}><IconEdit className="size-4" />Rename</Button><Button type="button" variant="secondary" size="compact" onClick={() => void toggle(item)}><IconPower className="size-4" />{item.status === "active" ? "Deactivate" : "Activate"}</Button></div></RecordCard>)}</div>
      <Pagination
        className={styles.compactPagination}
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        totalPages={pagination.totalPages}
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
      />
    </section>
  );
}

