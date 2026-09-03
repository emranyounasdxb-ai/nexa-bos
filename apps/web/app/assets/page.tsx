"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { IconX } from "@/components/icons";
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
  const [pageError, setPageError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerDirty, setDrawerDirty] = useState(false);
  const [drawerError, setDrawerError] = useState("");
  const [saving, setSaving] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);

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
    setLoading(true);
    setPageError("");
    try {
      const data = await apiGet<PaginatedResponse<AssetRecord>>(
        `/api/v1/assets?${params.toString()}`,
        api,
      );
      setAssets(data.items);
      setTotal(data.pagination.total);
      setTotalPages(data.pagination.totalPages);
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to load Assets");
    } finally {
      setLoading(false);
    }
  }, [api, category, office, page, pageSize, q, status]);

  useEffect(() => {
    if (!can("Assets.View")) return;
    void Promise.all([apiGet<AssetOptions>("/api/v1/assets/options", api), refresh()])
      .then(([loaded]) => setOptions(loaded))
      .catch((reason: unknown) =>
        setPageError(reason instanceof Error ? reason.message : "Unable to load Assets"),
      );
  }, [api, can, refresh]);

  function closeDrawer() {
    setDrawerOpen(false);
    setDiscardConfirmOpen(false);
    setDrawerDirty(false);
    setDrawerError("");
    setForm(EMPTY_FORM);
    window.setTimeout(() => {
      if (drawerTriggerRef.current?.isConnected) drawerTriggerRef.current.focus();
    }, 0);
  }

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || saving) return;
      event.preventDefault();
      if (discardConfirmOpen) setDiscardConfirmOpen(false);
      else if (drawerDirty) setDiscardConfirmOpen(true);
      else closeDrawer();
    }
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [discardConfirmOpen, drawerDirty, drawerOpen, saving]);

  useEffect(() => {
    if (!drawerDirty) return;
    function preventUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [drawerDirty]);

  function defaultForm(): AssetForm {
    return {
      ...EMPTY_FORM,
      category_id: options?.categories[0]?.id ?? "",
      office_id: options?.offices[0]?.id ?? "",
      condition: options?.conditions[0] ?? "New",
    };
  }

  function openDrawer(trigger: HTMLElement) {
    drawerTriggerRef.current = trigger;
    setForm(defaultForm());
    setDrawerDirty(false);
    setDrawerError("");
    setDiscardConfirmOpen(false);
    setDrawerOpen(true);
  }

  function requestDrawerClose() {
    if (saving) return;
    if (drawerDirty) setDiscardConfirmOpen(true);
    else closeDrawer();
  }

  function trapDrawerFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      drawerRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function setField(field: keyof AssetForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setDrawerDirty(true);
    setDrawerError("");
  }

  function categoryField(definition: AssetCategoryRecord["fields"][number]) {
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
              setDrawerDirty(true);
              setDrawerError("");
            }
          }}
        />
      </Field>
    );
  }

  async function createAsset(event: FormEvent) {
    event.preventDefault();
    setDrawerError("");
    if (!form.category_id || !form.office_id || !form.condition) {
      setDrawerError("Choose a category, current Office, and condition.");
      return;
    }
    const customKeys = new Set(
      selectedCategory?.fields.filter((item) => !BUILTINS[item.key]).map((item) => item.key) ?? [],
    );
    const attributes = Object.fromEntries(
      Object.entries(form.attributes).filter(([key, value]) => customKeys.has(key) && value.trim()),
    );
    setSaving(true);
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
      closeDrawer();
      await refresh();
    } catch (reason) {
      setDrawerError(reason instanceof Error ? reason.message : "Asset creation failed");
    } finally {
      setSaving(false);
    }
  }

  if (!can("Assets.View")) {
    return <EmptyState>You do not have permission to view Assets.</EmptyState>;
  }

  return (
    <section className="min-w-0 space-y-4">
      <PageHeader
        title="Asset Register"
        description="Track company Assets, current Office custody, and employee assignments."
        actions={can("Assets.ManageStock") ? (
          <Button type="button" disabled={!options} onClick={(event) => openDrawer(event.currentTarget)}>
            Add asset
          </Button>
        ) : null}
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

      {pageError ? <ErrorText>{pageError}</ErrorText> : null}
      {message ? <p role="status" className="text-sm font-medium text-success">{message}</p> : null}
      <Card className="!p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-border px-3 py-2 sm:px-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Assets in scope</h2>
            <p className="text-xs text-text-secondary">{loading ? "Refreshing…" : `${total.toLocaleString()} authorized record${total === 1 ? "" : "s"}`}</p>
          </div>
          {loading && assets.length > 0 ? <span role="status" className="text-xs text-text-secondary">Updating results…</span> : null}
        </div>
        {loading && assets.length === 0 ? <LoadingState>Loading Assets…</LoadingState> : null}
        {!loading && assets.length === 0 ? <EmptyState>No authorized Assets match the filters.</EmptyState> : null}
        {assets.length > 0 ? (
          <TableShell className={loading ? "opacity-70" : undefined}>
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
                  <Td><Link className="font-medium text-brand-link underline" href={`/assets/${asset.id}`}>{asset.assetCode}</Link></Td>
                  <Td>{asset.category.name}</Td>
                  <Td>{identity(asset)}</Td>
                  <Td>{asset.office?.name ?? "—"}</Td>
                  <Td><Badge>{asset.status}</Badge>{asset.outstanding ? <span className="ml-2 text-xs font-semibold text-danger">Outstanding</span> : null}</Td>
                  <Td>{asset.currentAllocation?.employeeName ?? "Stock"}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        ) : null}
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
      </Card>

      {drawerOpen ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/40"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) requestDrawerClose();
          }}
        >
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-drawer-title"
            aria-describedby="asset-drawer-description"
            className="flex h-full w-full min-w-0 flex-col bg-surface shadow-2xl sm:max-w-xl"
            onKeyDown={trapDrawerFocus}
          >
            <div className="flex items-start justify-between gap-3 border-b border-brand-border px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 id="asset-drawer-title" className="text-lg font-semibold text-text-primary">Add asset</h2>
                <p id="asset-drawer-description" className="mt-0.5 text-sm text-text-secondary">
                  Record stock identity and its initial Office custody. The Asset Code is generated and immutable.
                </p>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="Close asset drawer" disabled={saving} onClick={requestDrawerClose}>
                <IconX className="size-4" />
              </Button>
            </div>

            <form id="asset-create-form" className="min-h-0 flex-1 overflow-y-auto" onSubmit={createAsset}>
              <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
                <Field label="Category" help="Controls which identity fields are required for this Asset.">
                  <Select
                    aria-label="Asset category"
                    autoFocus
                    required
                    value={form.category_id}
                    onChange={(event) => {
                      setForm((current) => ({
                        ...EMPTY_FORM,
                        category_id: event.target.value,
                        office_id: current.office_id,
                        condition: current.condition,
                      }));
                      setDrawerDirty(true);
                      setDrawerError("");
                    }}
                  >
                    {options?.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                </Field>
                <Field label="Current Office custody" help="The Office responsible for this stock before employee allocation.">
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
                <Field label="Description" className="sm:col-span-2">
                  <TextInput aria-label="Asset description" value={form.description} onChange={(event) => setField("description", event.target.value)} />
                </Field>
                {drawerError ? <div className="sm:col-span-2"><ErrorText>{drawerError}</ErrorText></div> : null}
              </div>
            </form>

            <div className="sticky bottom-0 border-t border-brand-border bg-surface px-4 py-3 sm:px-5">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-text-secondary">{drawerDirty ? "Unsaved asset details" : "No staged changes"}</p>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" disabled={saving} onClick={requestDrawerClose}>Cancel</Button>
                  <Button type="submit" form="asset-create-form" disabled={saving}>{saving ? "Creating…" : "Create asset"}</Button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {discardConfirmOpen ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4" role="presentation">
          <section role="alertdialog" aria-modal="true" aria-labelledby="asset-discard-title" aria-describedby="asset-discard-description" className="w-full max-w-md rounded-[10px] border border-brand-border bg-surface p-4 shadow-2xl">
            <h2 id="asset-discard-title" className="text-base font-semibold text-text-primary">Discard unsaved asset?</h2>
            <p id="asset-discard-description" className="mt-2 text-sm text-text-secondary">The asset has not been created. Your staged details will be lost.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" autoFocus onClick={() => setDiscardConfirmOpen(false)}>Keep editing</Button>
              <Button type="button" variant="danger" onClick={closeDrawer}>Discard changes</Button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
