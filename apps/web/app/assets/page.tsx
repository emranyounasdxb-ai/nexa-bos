"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  PageHeader,
  Select,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
} from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { AssetCategoryRecord, AssetOptions, AssetRecord } from "@/lib/types";

const BUILTINS: Record<string, keyof AssetForm> = {
  brand: "brand",
  model: "model",
  serial_number: "serial_number",
  imei: "imei",
  iccid: "iccid",
  mobile_number: "mobile_number",
  operator: "operator",
};

type AssetForm = {
  category_id: string;
  office_id: string;
  condition: string;
  brand: string;
  model: string;
  serial_number: string;
  imei: string;
  iccid: string;
  mobile_number: string;
  operator: string;
  description: string;
  attributes: Record<string, string>;
};

const EMPTY_FORM: AssetForm = {
  category_id: "",
  office_id: "",
  condition: "New",
  brand: "",
  model: "",
  serial_number: "",
  imei: "",
  iccid: "",
  mobile_number: "",
  operator: "",
  description: "",
  attributes: {},
};

function identity(asset: AssetRecord): string {
  return (
    asset.serialNumber ??
    asset.imei ??
    asset.iccid ??
    asset.mobileNumber ??
    asset.model ??
    "—"
  );
}
export default function AssetsPage() {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [options, setOptions] = useState<AssetOptions | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<ServerPageSize>(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [office, setOffice] = useState("");
  const [category, setCategory] = useState("");
  const [form, setForm] = useState<AssetForm>(EMPTY_FORM);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedCategory = useMemo(
    () => options?.categories.find((item) => item.id === form.category_id) ?? null,
    [form.category_id, options],
  );

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (office) params.set("officeId", office);
    if (category) params.set("categoryId", category);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    const suffix = params.size ? `?${params.toString()}` : "";
    setLoading(true);
    try {
      const data = await apiGet<PaginatedResponse<AssetRecord>>(`/api/v1/assets${suffix}`, api);
      setAssets(data.items);
      setTotal(data.pagination.total);
      setTotalPages(data.pagination.totalPages);
    } finally {
      setLoading(false);
    }
  }, [api, category, office, page, pageSize, q, status]);

  useEffect(() => {
    if (!can("Assets.View")) return;
    void Promise.all([apiGet<AssetOptions>("/api/v1/assets/options", api), refresh()])
      .then(([loaded]) => {
        setOptions(loaded);
        setForm((current) => ({
          ...current,
          category_id: current.category_id || loaded.categories[0]?.id || "",
          office_id: current.office_id || loaded.offices[0]?.id || "",
          condition: current.condition || loaded.conditions[0] || "New",
        }));
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Unable to load Assets"),
      );
  }, [api, can, refresh]);

  function setField(field: keyof AssetForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function categoryField(
    definition: AssetCategoryRecord["fields"][number],
  ) {
    const builtin = BUILTINS[definition.key];
    const value = builtin ? String(form[builtin]) : (form.attributes[definition.key] ?? "");
    return (
      <Field key={definition.key} label={definition.label}>
        <TextInput
          aria-label={definition.label}
          value={value}
          required={definition.required}
          onChange={(event) => {
            if (builtin) {
              setField(builtin, event.target.value);
            } else {
              setForm((current) => ({
                ...current,
                attributes: { ...current.attributes, [definition.key]: event.target.value },
              }));
            }
          }}
        />
      </Field>
    );
  }

  async function createAsset(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    const customKeys = new Set(
      selectedCategory?.fields.filter((item) => !BUILTINS[item.key]).map((item) => item.key) ?? [],
    );
    const attributes = Object.fromEntries(
      Object.entries(form.attributes).filter(([key, value]) => customKeys.has(key) && value.trim()),
    );
    try {
      const created = await apiRequest<AssetRecord>("/api/v1/assets", api, {
        method: "POST",
        body: JSON.stringify({
          category_id: form.category_id,
          office_id: form.office_id,
          condition: form.condition,
          brand: form.brand || null,
          model: form.model || null,
          serial_number: form.serial_number || null,
          imei: form.imei || null,
          iccid: form.iccid || null,
          mobile_number: form.mobile_number || null,
          operator: form.operator || null,
          attributes,
          description: form.description || null,
        }),
      });
      setMessage(`${created.assetCode} created`);
      setForm((current) => ({
        ...EMPTY_FORM,
        category_id: current.category_id,
        office_id: current.office_id,
        condition: "New",
      }));
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Asset creation failed");
    }
  }

  if (!can("Assets.View")) {
    return <EmptyState>You do not have permission to view Assets.</EmptyState>;
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Asset Register"
        description="Individually tracked company Assets and current Office or employee custody."
      />

      <FilterBar className="sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1.5fr)_repeat(3,minmax(9rem,1fr))_auto]">
        <Field label="Search">
          <TextInput
            aria-label="Search Assets"
            value={q}
            placeholder="Asset Code or identifier"
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="Status">
          <Select aria-label="Asset status filter" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {options?.statuses.map((item) => <option key={item}>{item}</option>)}
          </Select>
        </Field>
        <Field label="Office">
          <Select aria-label="Asset office filter" value={office} onChange={(event) => { setOffice(event.target.value); setPage(1); }}>
            <option value="">All authorized Offices</option>
            {options?.offices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        </Field>
        <Field label="Category">
          <Select aria-label="Asset category filter" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
            <option value="">All categories</option>
            {options?.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        </Field>
        <div className="flex items-end">
          <Button type="button" onClick={() => void refresh()}>Apply filters</Button>
        </div>
      </FilterBar>

      {can("Assets.ManageStock") ? (
        <Card>
          <h3 className="font-semibold text-slate-900">Create Asset</h3>
          <p className="mt-1 text-sm text-slate-600">
            Asset Code is generated automatically and cannot be edited.
          </p>
          <form className="mt-4 grid gap-4 md:grid-cols-3" onSubmit={createAsset}>
            <Field label="Category">
              <Select
                aria-label="Asset category"
                required
                value={form.category_id}
                onChange={(event) =>
                  setForm((current) => ({
                    ...EMPTY_FORM,
                    category_id: event.target.value,
                    office_id: current.office_id,
                    condition: current.condition,
                  }))
                }
              >
                {options?.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </Field>
            <Field label="Current Office custody">
              <Select aria-label="Current Office custody" required value={form.office_id} onChange={(event) => setField("office_id", event.target.value)}>
                {options?.offices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </Field>
            <Field label="Condition">
              <Select aria-label="Asset condition" required value={form.condition} onChange={(event) => setField("condition", event.target.value)}>
                {options?.conditions.map((item) => <option key={item}>{item}</option>)}
              </Select>
            </Field>
            {selectedCategory?.fields.map(categoryField)}
            <Field label="Description" className="md:col-span-2">
              <TextInput aria-label="Asset description" value={form.description} onChange={(event) => setField("description", event.target.value)} />
            </Field>
            <div className="flex items-end">
              <Button type="submit">Create Asset</Button>
            </div>
          </form>
        </Card>
      ) : null}

      <ErrorText>{error}</ErrorText>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      <TableShell className={loading && assets.length > 0 ? "opacity-70" : undefined}>
        <TableHead>
          <tr>
            <Th>Asset Code</Th>
            <Th>Category</Th>
            <Th>Identity</Th>
            <Th>Office</Th>
            <Th>Status</Th>
            <Th>Employee</Th>
          </tr>
        </TableHead>
        <tbody>
          {assets.map((asset) => (
            <tr key={asset.id} className="border-t border-slate-100">
              <Td><Link className="font-medium text-[#0f4c81] underline" href={`/assets/${asset.id}`}>{asset.assetCode}</Link></Td>
              <Td>{asset.category.name}</Td>
              <Td>{identity(asset)}</Td>
              <Td>{asset.office?.name ?? "—"}</Td>
              <Td><Badge>{asset.status}</Badge>{asset.outstanding ? <span className="ml-2 text-xs font-semibold text-red-700">Outstanding</span> : null}</Td>
              <Td>{asset.currentAllocation?.employeeName ?? "Stock"}</Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      {loading && assets.length === 0 ? <EmptyState>Loading Assets…</EmptyState> : null}
      {!loading && assets.length === 0 ? <EmptyState>No authorized Assets match the filters.</EmptyState> : null}
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
