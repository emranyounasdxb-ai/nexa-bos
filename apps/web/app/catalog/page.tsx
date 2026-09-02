"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  IconArrowsDiff,
  IconBuildingBank,
  IconEdit,
  IconPackages,
} from "@/components/icons";
import { Pagination, useClientPagination } from "@/components/pagination";
import { Tooltip as InfoTooltip } from "@/components/tooltip";
import {
  Badge,
  Button,
  Card,
  DialogPanel,
  EmptyState,
  ErrorText,
  LoadingState,
  SearchActionBar,
  Select,
  StatusBadge,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Textarea,
  Th,
  cx,
  focusRing,
} from "@/components/ui";
import { ApiClientError, apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { BankProductRecord, CatalogItem, ProductVariantRecord } from "@/lib/types";

const TAB_KEYS = ["banks", "products", "variants", "rules", "mappings"] as const;
type TabKey = (typeof TAB_KEYS)[number];
type StatusFilter = "all" | "active" | "inactive";
type MasterKind = "bank" | "product";
type Feedback = { tone: "success" | "error"; text: string };
type MasterDialogState = { kind: MasterKind; mode: "create" | "edit"; item?: CatalogItem };
type VariantDialogState = { mode: "create" | "edit"; item?: ProductVariantRecord };
type StatusDialogState = {
  kind: MasterKind | "mapping" | "variant";
  id: string;
  name: string;
  code: string;
  nextStatus: "active" | "inactive";
};
type RuleDraft = {
  requestedAmountRequired: boolean;
  approvedAmountRequired: boolean;
  bookedAmountRequired: boolean;
  fundedAmountRequired: boolean;
  targetMeasurement: "count" | "amount";
};

const tabs: Array<{ key: TabKey; label: string; description: string }> = [
  { key: "banks", label: "Banks", description: "Maintain bank names, immutable codes, and status." },
  { key: "products", label: "Products", description: "Maintain product names, immutable codes, and status." },
  { key: "variants", label: "Product Variants", description: "Manage the variants available within each active Bank–Product mapping." },
  { key: "rules", label: "Amount & Target Rules", description: "Configure product amount requirements and target measurement." },
  { key: "mappings", label: "Bank–Product Mapping", description: "Choose which products are available for each bank." },
];

const ruleFields: Array<{
  key: keyof Pick<
    RuleDraft,
    | "requestedAmountRequired"
    | "approvedAmountRequired"
    | "bookedAmountRequired"
    | "fundedAmountRequired"
  >;
  label: string;
  tooltip: string;
}> = [
  {
    key: "requestedAmountRequired",
    label: "Requested",
    tooltip: "When enabled, Requested Amount is required when a new application is created for this product.",
  },
  {
    key: "approvedAmountRequired",
    label: "Approved",
    tooltip: "When enabled, Approved Amount is required when an application enters the Approved stage for this product.",
  },
  {
    key: "bookedAmountRequired",
    label: "Booked",
    tooltip: "When enabled, Booked Amount is required when an application enters the Booked stage for this product.",
  },
  {
    key: "fundedAmountRequired",
    label: "Funded",
    tooltip: "When enabled, Funded Amount is required when an application enters the Fund Released stage for this product.",
  },
];

function activeTabFrom(query: string): TabKey {
  const value = new URLSearchParams(query).get("tab");
  return TAB_KEYS.includes(value as TabKey) ? (value as TabKey) : "banks";
}

function ruleDraftFrom(product: CatalogItem): RuleDraft {
  return {
    requestedAmountRequired: Boolean(product.requestedAmountRequired),
    approvedAmountRequired: Boolean(product.approvedAmountRequired),
    bookedAmountRequired: Boolean(product.bookedAmountRequired),
    fundedAmountRequired: Boolean(product.fundedAmountRequired),
    targetMeasurement: product.targetMeasurement === "amount" ? "amount" : "count",
  };
}

function sameRuleDraft(left: RuleDraft | null, right: RuleDraft | null): boolean {
  return Boolean(left && right && JSON.stringify(left) === JSON.stringify(right));
}

function fullLabel(item: CatalogItem | null | undefined): string {
  return item ? `${item.name} (${item.code})` : "Unavailable record";
}

function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) {
    if (error.body?.error?.code === "BANK_PRODUCT_DUPLICATE") {
      return "This bank and product are already mapped. Choose a different combination.";
    }
    if (error.body?.error?.code === "BANK_CODE_DUPLICATE") {
      return "That bank code already exists. Bank codes must be unique and cannot be changed later.";
    }
    if (error.body?.error?.code === "PRODUCT_CODE_DUPLICATE") {
      return "That product code already exists. Product codes must be unique and cannot be changed later.";
    }
    if (error.body?.error?.code === "PRODUCT_VARIANT_DUPLICATE") {
      return "A Product Variant with this code or name already exists for the selected Bank and Product Category.";
    }
    if (error.body?.error?.code === "PRODUCT_VARIANT_PARENT_INACTIVE") {
      return "The Bank, Product Category, and their mapping must be active for this Product Variant action.";
    }
  }
  return error instanceof Error ? error.message : fallback;
}

function CatalogInner() {
  const { can } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const api = getBrowserApiUrl();
  const activeTab = activeTabFrom(searchParams.toString());
  const [banks, setBanks] = useState<CatalogItem[]>([]);
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [mappings, setMappings] = useState<BankProductRecord[]>([]);
  const [variants, setVariants] = useState<ProductVariantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [masterDialog, setMasterDialog] = useState<MasterDialogState | null>(null);
  const [variantDialog, setVariantDialog] = useState<VariantDialogState | null>(null);
  const [statusDialog, setStatusDialog] = useState<StatusDialogState | null>(null);
  const [masterName, setMasterName] = useState("");
  const [masterCode, setMasterCode] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [dialogSaving, setDialogSaving] = useState(false);
  const [variantName, setVariantName] = useState("");
  const [variantCode, setVariantCode] = useState("");
  const [variantDescription, setVariantDescription] = useState("");
  const [variantSearch, setVariantSearch] = useState("");
  const [variantStatus, setVariantStatus] = useState<StatusFilter>("all");
  const [variantBankId, setVariantBankId] = useState("");
  const [variantProductId, setVariantProductId] = useState("");
  const [bankSearch, setBankSearch] = useState("");
  const [bankStatus, setBankStatus] = useState<StatusFilter>("all");
  const [productSearch, setProductSearch] = useState("");
  const [productStatus, setProductStatus] = useState<StatusFilter>("all");
  const [mappingSearch, setMappingSearch] = useState("");
  const [mappingStatus, setMappingStatus] = useState<StatusFilter>("all");
  const [mappingBankId, setMappingBankId] = useState("");
  const [mappingProductId, setMappingProductId] = useState("");
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingError, setMappingError] = useState("");
  const [ruleProductId, setRuleProductId] = useState("");
  const [ruleInitial, setRuleInitial] = useState<RuleDraft | null>(null);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleFeedback, setRuleFeedback] = useState<Feedback | null>(null);

  const canSeeInactive = can("Banks.Edit") || can("Products.Edit") || can("BankProducts.Create");
  const canSeeInactiveVariants =
    can("ProductVariants.Edit") ||
    can("ProductVariants.Activate") ||
    can("ProductVariants.Deactivate");

  const refresh = useCallback(async () => {
    const suffix = canSeeInactive ? "?includeInactive=true" : "";
    const variantSuffix = canSeeInactiveVariants ? "?includeInactive=true" : "";
    const [bankData, productData, mappingData, variantData] = await Promise.all([
      apiGet<{ items: CatalogItem[] }>(`/api/v1/banks${suffix}`, api),
      apiGet<{ items: CatalogItem[] }>(`/api/v1/products${suffix}`, api),
      apiGet<{ items: BankProductRecord[] }>(`/api/v1/bank-products${suffix}`, api),
      apiGet<{ items: ProductVariantRecord[] }>(`/api/v1/product-variants${variantSuffix}`, api),
    ]);
    setBanks(bankData.items);
    setProducts(productData.items);
    setMappings(mappingData.items);
    setVariants(variantData.items);
    setMappingBankId((current) => current || bankData.items[0]?.id || "");
    setMappingProductId((current) => current || productData.items[0]?.id || "");
    setRuleProductId((current) => current || productData.items[0]?.id || "");
    const firstActiveMapping = mappingData.items.find(
      (item) =>
        item.status === "active" && item.bank?.status === "active" && item.product?.status === "active",
    ) ?? mappingData.items[0];
    setVariantBankId((current) => current || firstActiveMapping?.bankId || "");
    setVariantProductId((current) => current || firstActiveMapping?.productId || "");
  }, [api, canSeeInactive, canSeeInactiveVariants]);

  useEffect(() => {
    setLoading(true);
    void refresh()
      .catch((error: unknown) => setFeedback({ tone: "error", text: friendlyError(error, "Catalogue failed to load.") }))
      .finally(() => setLoading(false));
  }, [refresh]);

  const selectedRuleProduct = useMemo(
    () => products.find((product) => product.id === ruleProductId) ?? products[0] ?? null,
    [products, ruleProductId],
  );

  useEffect(() => {
    if (!selectedRuleProduct) {
      setRuleInitial(null);
      setRuleDraft(null);
      return;
    }
    const next = ruleDraftFrom(selectedRuleProduct);
    setRuleInitial(next);
    setRuleDraft(next);
  }, [selectedRuleProduct]);

  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (statusDialog) setStatusDialog(null);
      else if (variantDialog) setVariantDialog(null);
      else if (masterDialog) setMasterDialog(null);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [masterDialog, statusDialog, variantDialog]);

  const filteredBanks = useMemo(() => filterMasters(banks, bankSearch, bankStatus), [banks, bankSearch, bankStatus]);
  const filteredProducts = useMemo(
    () => filterMasters(products, productSearch, productStatus),
    [products, productSearch, productStatus],
  );
  const filteredMappings = useMemo(() => {
    const query = mappingSearch.trim().toLowerCase();
    return mappings.filter((mapping) => {
      const matchesStatus = mappingStatus === "all" || mapping.status.toLowerCase() === mappingStatus;
      const haystack = `${mapping.bank?.name ?? ""} ${mapping.bank?.code ?? ""} ${mapping.product?.name ?? ""} ${mapping.product?.code ?? ""}`.toLowerCase();
      return matchesStatus && (!query || haystack.includes(query));
    });
  }, [mappingSearch, mappingStatus, mappings]);
  const variantMappings = useMemo(
    () => mappings.filter((mapping) => mapping.bank && mapping.product),
    [mappings],
  );
  const variantProductMappings = useMemo(
    () => variantMappings.filter((mapping) => mapping.bankId === variantBankId),
    [variantBankId, variantMappings],
  );
  const selectedVariantMapping = useMemo(
    () =>
      variantProductMappings.find((mapping) => mapping.productId === variantProductId) ?? null,
    [variantProductId, variantProductMappings],
  );
  const filteredVariants = useMemo(() => {
    const query = variantSearch.trim().toLowerCase();
    return variants.filter((variant) => {
      const matchesMapping = selectedVariantMapping
        ? variant.bankProductId === selectedVariantMapping.id
        : false;
      const matchesStatus =
        variantStatus === "all" || variant.status.toLowerCase() === variantStatus;
      const haystack = `${variant.name} ${variant.code} ${variant.description ?? ""}`.toLowerCase();
      return matchesMapping && matchesStatus && (!query || haystack.includes(query));
    });
  }, [selectedVariantMapping, variantSearch, variantStatus, variants]);

  function changeTab(next: TabKey) {
    setFeedback(null);
    router.replace(`/catalog?tab=${next}`, { scroll: false });
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, current: TabKey) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = TAB_KEYS.indexOf(current);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? TAB_KEYS.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % TAB_KEYS.length
            : (currentIndex - 1 + TAB_KEYS.length) % TAB_KEYS.length;
    changeTab(TAB_KEYS[nextIndex]);
    document.getElementById(`catalog-tab-${TAB_KEYS[nextIndex]}`)?.focus();
  }

  function openMasterDialog(kind: MasterKind, item?: CatalogItem) {
    setMasterDialog({ kind, mode: item ? "edit" : "create", item });
    setMasterName(item?.name ?? "");
    setMasterCode(item?.code ?? "");
    setDialogError("");
  }

  function openVariantDialog(item?: ProductVariantRecord) {
    setVariantDialog({ mode: item ? "edit" : "create", item });
    setVariantName(item?.name ?? "");
    setVariantCode(item?.code ?? "");
    setVariantDescription(item?.description ?? "");
    setDialogError("");
  }

  async function saveMaster() {
    if (!masterDialog) return;
    setDialogSaving(true);
    setDialogError("");
    const plural = masterDialog.kind === "bank" ? "banks" : "products";
    try {
      if (masterDialog.mode === "create") {
        await apiRequest(`/api/v1/${plural}`, api, {
          method: "POST",
          body: JSON.stringify({ name: masterName, code: masterCode }),
        });
      } else {
        await apiRequest(`/api/v1/${plural}/${masterDialog.item?.id}`, api, {
          method: "PATCH",
          body: JSON.stringify({ name: masterName }),
        });
      }
      await refresh();
      const noun = masterDialog.kind === "bank" ? "Bank" : "Product";
      setFeedback({
        tone: "success",
        text: `${noun} ${masterDialog.mode === "create" ? "created" : "updated"} successfully.`,
      });
      setMasterDialog(null);
    } catch (error) {
      setDialogError(friendlyError(error, "Record could not be saved."));
    } finally {
      setDialogSaving(false);
    }
  }

  async function saveVariant() {
    if (!variantDialog || (variantDialog.mode === "create" && !selectedVariantMapping)) return;
    setDialogSaving(true);
    setDialogError("");
    try {
      if (variantDialog.mode === "create") {
        await apiRequest("/api/v1/product-variants", api, {
          method: "POST",
          body: JSON.stringify({
            bank_product_id: selectedVariantMapping?.id,
            name: variantName,
            code: variantCode,
            description: variantDescription || null,
          }),
        });
      } else {
        await apiRequest(`/api/v1/product-variants/${variantDialog.item?.id}`, api, {
          method: "PATCH",
          body: JSON.stringify({
            name: variantName,
            description: variantDescription || null,
          }),
        });
      }
      await refresh();
      setFeedback({
        tone: "success",
        text: `Product Variant ${variantDialog.mode === "create" ? "created" : "updated"} successfully.`,
      });
      setVariantDialog(null);
    } catch (error) {
      setDialogError(friendlyError(error, "Product Variant could not be saved."));
    } finally {
      setDialogSaving(false);
    }
  }

  async function changeStatus() {
    if (!statusDialog) return;
    setDialogSaving(true);
    setDialogError("");
    const base =
      statusDialog.kind === "bank"
        ? "banks"
        : statusDialog.kind === "product"
          ? "products"
          : statusDialog.kind === "mapping"
            ? "bank-products"
            : "product-variants";
    const verb = statusDialog.nextStatus === "active" ? "activate" : "deactivate";
    try {
      await apiRequest(`/api/v1/${base}/${statusDialog.id}/${verb}`, api, { method: "POST" });
      await refresh();
      setFeedback({
        tone: "success",
        text: `${statusDialog.name} ${statusDialog.nextStatus === "active" ? "activated" : "deactivated"} successfully.`,
      });
      setStatusDialog(null);
    } catch (error) {
      setDialogError(friendlyError(error, "Status could not be changed."));
    } finally {
      setDialogSaving(false);
    }
  }

  async function saveRules() {
    if (!selectedRuleProduct || !ruleDraft) return;
    setRuleSaving(true);
    setRuleFeedback(null);
    try {
      const saved = await apiRequest<CatalogItem>(
        `/api/v1/products/${selectedRuleProduct.id}/field-rules`,
        api,
        {
          method: "PUT",
          body: JSON.stringify({
            requested_amount_required: ruleDraft.requestedAmountRequired,
            approved_amount_required: ruleDraft.approvedAmountRequired,
            booked_amount_required: ruleDraft.bookedAmountRequired,
            funded_amount_required: ruleDraft.fundedAmountRequired,
            target_measurement: ruleDraft.targetMeasurement,
          }),
        },
      );
      setProducts((current) => current.map((product) => (product.id === saved.id ? saved : product)));
      const next = ruleDraftFrom(saved);
      setRuleInitial(next);
      setRuleDraft(next);
      setRuleFeedback({ tone: "success", text: `Rules saved for ${fullLabel(saved)}.` });
    } catch (error) {
      setRuleFeedback({ tone: "error", text: friendlyError(error, "Rules could not be saved.") });
    } finally {
      setRuleSaving(false);
    }
  }

  async function createMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMappingSaving(true);
    setMappingError("");
    setFeedback(null);
    try {
      await apiRequest("/api/v1/bank-products", api, {
        method: "POST",
        body: JSON.stringify({ bank_id: mappingBankId, product_id: mappingProductId }),
      });
      await refresh();
      setFeedback({ tone: "success", text: "Bank–product mapping added successfully." });
    } catch (error) {
      setMappingError(friendlyError(error, "Mapping could not be added."));
    } finally {
      setMappingSaving(false);
    }
  }

  if (loading) return <LoadingState>Loading banks and products…</LoadingState>;

  const activeTabDefinition = tabs.find((tab) => tab.key === activeTab) ?? tabs[0];

  return (
    <section className="w-full space-y-4 pb-4">
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">Catalogue workspace</h2>
            <p className="mt-1 max-w-4xl text-sm leading-5 text-slate-600">
              Manage banks, product categories, Product Variants, amount and target rules, and the products available for each bank.
            </p>
          </div>
          <Badge tone="blue">{activeTabDefinition.label}</Badge>
        </div>
        <div className="overflow-x-auto border-t border-slate-200" aria-label="Catalogue task tabs">
          <div className="flex min-w-max px-2 sm:px-3" role="tablist" aria-label="Banks and products tasks">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                id={`catalog-tab-${tab.key}`}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                aria-controls={`catalog-panel-${tab.key}`}
                tabIndex={activeTab === tab.key ? 0 : -1}
                className={cx(
                  "border-b-2 px-3 py-3 text-sm font-medium transition-colors sm:px-4",
                  focusRing,
                  activeTab === tab.key
                    ? "border-brand-primary text-brand-primary"
                    : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-950",
                )}
                onClick={() => changeTab(tab.key)}
                onKeyDown={(event) => handleTabKey(event, tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {feedback?.tone === "error" ? <ErrorText>{feedback.text}</ErrorText> : null}
      {feedback?.tone === "success" ? (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {feedback.text}
        </p>
      ) : null}

      {activeTab === "banks" ? (
        <MasterCatalogTab
          panelId="catalog-panel-banks"
          kind="bank"
          title="Banks"
          description={tabs[0].description}
          items={filteredBanks}
          totalItems={banks.length}
          search={bankSearch}
          status={bankStatus}
          canCreate={can("Banks.Create")}
          canEdit={can("Banks.Edit")}
          canActivate={can("Banks.Activate")}
          canDeactivate={can("Banks.Deactivate")}
          onSearch={setBankSearch}
          onStatus={setBankStatus}
          onCreate={() => openMasterDialog("bank")}
          onEdit={(item) => openMasterDialog("bank", item)}
          onStatusChange={(item) =>
            setStatusDialog({
              kind: "bank",
              id: item.id,
              name: item.name,
              code: item.code,
              nextStatus: item.status.toLowerCase() === "active" ? "inactive" : "active",
            })
          }
        />
      ) : null}

      {activeTab === "products" ? (
        <MasterCatalogTab
          panelId="catalog-panel-products"
          kind="product"
          title="Products"
          description={tabs[1].description}
          items={filteredProducts}
          totalItems={products.length}
          search={productSearch}
          status={productStatus}
          canCreate={can("Products.Create")}
          canEdit={can("Products.Edit")}
          canActivate={can("Products.Activate")}
          canDeactivate={can("Products.Deactivate")}
          onSearch={setProductSearch}
          onStatus={setProductStatus}
          onCreate={() => openMasterDialog("product")}
          onEdit={(item) => openMasterDialog("product", item)}
          onStatusChange={(item) =>
            setStatusDialog({
              kind: "product",
              id: item.id,
              name: item.name,
              code: item.code,
              nextStatus: item.status.toLowerCase() === "active" ? "inactive" : "active",
            })
          }
        />
      ) : null}

      {activeTab === "variants" ? (
        <ProductVariantsTab
          panelId="catalog-panel-variants"
          mappings={variantMappings}
          productMappings={variantProductMappings}
          selectedMapping={selectedVariantMapping}
          items={filteredVariants}
          totalItems={
            selectedVariantMapping
              ? variants.filter((variant) => variant.bankProductId === selectedVariantMapping.id)
                  .length
              : 0
          }
          bankId={variantBankId}
          productId={variantProductId}
          search={variantSearch}
          status={variantStatus}
          canCreate={can("ProductVariants.Create")}
          canEdit={can("ProductVariants.Edit")}
          canActivate={can("ProductVariants.Activate")}
          canDeactivate={can("ProductVariants.Deactivate")}
          onBank={(bankId) => {
            const firstMapping = variantMappings.find((mapping) => mapping.bankId === bankId);
            setVariantBankId(bankId);
            setVariantProductId(firstMapping?.productId ?? "");
          }}
          onProduct={setVariantProductId}
          onSearch={setVariantSearch}
          onStatus={setVariantStatus}
          onCreate={() => openVariantDialog()}
          onEdit={openVariantDialog}
          onStatusChange={(item) =>
            setStatusDialog({
              kind: "variant",
              id: item.id,
              name: item.name,
              code: item.code,
              nextStatus: item.status.toLowerCase() === "active" ? "inactive" : "active",
            })
          }
        />
      ) : null}

      {activeTab === "rules" ? (
        <Card className="min-w-0">
          <div id="catalog-panel-rules" role="tabpanel" aria-labelledby="catalog-tab-rules">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Amount & Target Rules</h2>
                <p className="mt-1 text-sm text-slate-500">{tabs[3].description}</p>
              </div>
              {ruleDraft && !sameRuleDraft(ruleDraft, ruleInitial) ? <Badge tone="amber">Unsaved changes</Badge> : null}
            </div>

            {!can("Products.Edit") ? (
              <EmptyState>Products.Edit permission is required to view and change product rules.</EmptyState>
            ) : products.length === 0 ? (
              <EmptyState>Create a product before configuring amount and target rules.</EmptyState>
            ) : (
              <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[minmax(220px,0.32fr)_minmax(0,0.68fr)]">
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <label className="block text-sm font-medium text-slate-700">
                    Product
                    <Select
                      aria-label="Rule product"
                      value={selectedRuleProduct?.id ?? ""}
                      disabled={ruleSaving}
                      onChange={(event) => {
                        setRuleFeedback(null);
                        setRuleProductId(event.target.value);
                      }}
                    >
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>{fullLabel(product)}</option>
                      ))}
                    </Select>
                  </label>
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    Changes are staged for one product and saved through the existing product field-rules endpoint.
                  </p>
                  {selectedRuleProduct ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusBadge value={selectedRuleProduct.status} />
                      <Badge>{selectedRuleProduct.code}</Badge>
                    </div>
                  ) : null}
                </div>

                {ruleDraft ? (
                  <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
                    <fieldset disabled={ruleSaving}>
                      <legend className="text-sm font-semibold text-slate-900">Application stages included</legend>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Select the application points where the corresponding amount is mandatory for this product.
                      </p>
                      <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {ruleFields.map((field, index) => (
                          <label key={field.key} className="flex min-w-0 items-start gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                            <input
                              type="checkbox"
                              className="mt-0.5 size-4 shrink-0 rounded border-slate-300 text-brand-primary"
                              aria-label={`${field.label} amount required`}
                              checked={ruleDraft[field.key]}
                              onChange={(event) => {
                                setRuleFeedback(null);
                                setRuleDraft({ ...ruleDraft, [field.key]: event.target.checked });
                              }}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                                {field.label}
                                <InfoTooltip
                                  label={`About ${field.label} amount rule`}
                                  text={field.tooltip}
                                  align={index % 2 === 1 ? "right" : "left"}
                                />
                              </span>
                              <span className="mt-0.5 block text-xs text-slate-500">Amount required</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <fieldset className="mt-4" disabled={ruleSaving}>
                      <legend className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                        Target Measurement
                        <InfoTooltip
                          label="About Target Measurement"
                          align="right"
                          text="Count measures the number of qualifying applications. Amount measures the qualifying monetary value. Existing targets may store their own measurement; otherwise this product setting is the default."
                        />
                      </legend>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Choose the product default used when a target does not store its own measurement.
                      </p>
                      <div className="mt-2 grid max-w-md grid-cols-2 gap-2">
                        {(["count", "amount"] as const).map((measurement) => (
                          <label
                            key={measurement}
                            className={cx(
                              "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium",
                              ruleDraft.targetMeasurement === measurement
                                ? "border-brand-primary bg-brand-soft text-brand-primary"
                                : "border-slate-200 bg-white text-slate-700",
                            )}
                          >
                            <input
                              type="radio"
                              name="target-measurement"
                              value={measurement}
                              checked={ruleDraft.targetMeasurement === measurement}
                              onChange={() => {
                                setRuleFeedback(null);
                                setRuleDraft({ ...ruleDraft, targetMeasurement: measurement });
                              }}
                            />
                            {measurement === "count" ? "Count" : "Amount"}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {ruleFeedback?.tone === "error" ? <div className="mt-4"><ErrorText>{ruleFeedback.text}</ErrorText></div> : null}
                    {ruleFeedback?.tone === "success" ? (
                      <p role="status" className="mt-4 text-sm font-medium text-emerald-700">{ruleFeedback.text}</p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={ruleSaving || sameRuleDraft(ruleDraft, ruleInitial)}
                        onClick={() => {
                          setRuleDraft(ruleInitial);
                          setRuleFeedback(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        disabled={ruleSaving || sameRuleDraft(ruleDraft, ruleInitial)}
                        onClick={() => void saveRules()}
                      >
                        {ruleSaving ? "Saving…" : "Save rule changes"}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </Card>
      ) : null}

      {activeTab === "mappings" ? (
        <MappingTab
          panelId="catalog-panel-mappings"
          banks={banks}
          products={products}
          items={filteredMappings}
          totalItems={mappings.length}
          search={mappingSearch}
          status={mappingStatus}
          bankId={mappingBankId}
          productId={mappingProductId}
          canCreate={can("BankProducts.Create")}
          canActivate={can("BankProducts.Activate")}
          canDeactivate={can("BankProducts.Deactivate")}
          saving={mappingSaving}
          error={mappingError}
          onSearch={setMappingSearch}
          onStatus={setMappingStatus}
          onBank={setMappingBankId}
          onProduct={setMappingProductId}
          onCreate={createMapping}
          onStatusChange={(item) =>
            setStatusDialog({
              kind: "mapping",
              id: item.id,
              name: `${item.bank?.name ?? "Bank"} – ${item.product?.name ?? "Product"}`,
              code: `${item.bank?.code ?? "—"} / ${item.product?.code ?? "—"}`,
              nextStatus: item.status.toLowerCase() === "active" ? "inactive" : "active",
            })
          }
        />
      ) : null}

      {masterDialog ? (
        <DialogPanel
          title={`${masterDialog.mode === "create" ? "Add" : "Edit"} ${masterDialog.kind}`}
          description={
            masterDialog.mode === "create"
              ? `Create a new ${masterDialog.kind} master record.`
              : `Update the ${masterDialog.kind} name. Its code is immutable.`
          }
          onClose={() => !dialogSaving && setMasterDialog(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveMaster();
            }}
          >
            <label className="block text-sm font-medium text-slate-700">
              Full name
              <TextInput
                autoFocus
                aria-label={`${masterDialog.kind === "bank" ? "Bank" : "Product"} name`}
                value={masterName}
                maxLength={120}
                required
                disabled={dialogSaving}
                onChange={(event) => setMasterName(event.target.value)}
              />
            </label>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Code
              <TextInput
                aria-label={`${masterDialog.kind === "bank" ? "Bank" : "Product"} code`}
                value={masterCode}
                maxLength={32}
                required
                disabled={dialogSaving || masterDialog.mode === "edit"}
                onChange={(event) => setMasterCode(event.target.value)}
              />
            </label>
            <p className="mt-1.5 text-xs leading-5 text-slate-500">
              The code is a unique system identifier and cannot be changed after creation.
            </p>
            <div className="mt-4"><ErrorText>{dialogError}</ErrorText></div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button type="button" variant="secondary" disabled={dialogSaving} onClick={() => setMasterDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={dialogSaving || !masterName.trim() || !masterCode.trim()}>
                {dialogSaving ? "Saving…" : masterDialog.mode === "create" ? `Add ${masterDialog.kind}` : "Save changes"}
              </Button>
            </div>
          </form>
        </DialogPanel>
      ) : null}

      {variantDialog ? (
        <DialogPanel
          title={`${variantDialog.mode === "create" ? "Add" : "Edit"} Product Variant`}
          description={
            variantDialog.mode === "create"
              ? selectedVariantMapping
                ? `${fullLabel(selectedVariantMapping.bank)} → ${fullLabel(selectedVariantMapping.product)}`
                : "Select an active Bank and Product Category first."
              : `${fullLabel(variantDialog.item?.bank)} → ${fullLabel(variantDialog.item?.product)}`
          }
          onClose={() => !dialogSaving && setVariantDialog(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveVariant();
            }}
          >
            <label className="block text-sm font-medium text-slate-700">
              Variant name
              <TextInput
                autoFocus
                aria-label="Variant name"
                value={variantName}
                maxLength={120}
                required
                disabled={dialogSaving}
                onChange={(event) => setVariantName(event.target.value)}
              />
            </label>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Variant code
              <TextInput
                aria-label="Variant code"
                value={variantCode}
                maxLength={32}
                required
                disabled={dialogSaving || variantDialog.mode === "edit"}
                onChange={(event) => setVariantCode(event.target.value)}
              />
            </label>
            <p className="mt-1.5 text-xs leading-5 text-slate-500">
              The code is unique within this Bank–Product mapping and cannot be changed after creation.
            </p>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Description (optional)
              <Textarea
                aria-label="Variant description"
                value={variantDescription}
                maxLength={500}
                rows={3}
                disabled={dialogSaving}
                onChange={(event) => setVariantDescription(event.target.value)}
              />
            </label>
            <div className="mt-4"><ErrorText>{dialogError}</ErrorText></div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button type="button" variant="secondary" disabled={dialogSaving} onClick={() => setVariantDialog(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={dialogSaving || !variantName.trim() || !variantCode.trim() || (variantDialog.mode === "create" && !selectedVariantMapping)}
              >
                {dialogSaving ? "Saving…" : variantDialog.mode === "create" ? "Add Product Variant" : "Save changes"}
              </Button>
            </div>
          </form>
        </DialogPanel>
      ) : null}

      {statusDialog ? (
        <DialogPanel
          title={`Confirm ${statusDialog.nextStatus === "active" ? "activation" : "deactivation"}`}
          description={`${statusDialog.name} (${statusDialog.code})`}
          onClose={() => !dialogSaving && setStatusDialog(null)}
        >
          <p className="text-sm leading-6 text-slate-600">
            This will mark the record {statusDialog.nextStatus}. The existing API does not provide a dependency count for this action.
          </p>
          <div className="mt-4"><ErrorText>{dialogError}</ErrorText></div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" disabled={dialogSaving} onClick={() => setStatusDialog(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={statusDialog.nextStatus === "inactive" ? "danger" : "primary"}
              disabled={dialogSaving}
              onClick={() => void changeStatus()}
            >
              {dialogSaving ? "Updating…" : statusDialog.nextStatus === "active" ? "Activate" : "Deactivate"}
            </Button>
          </div>
        </DialogPanel>
      ) : null}
    </section>
  );
}

function filterMasters(items: CatalogItem[], search: string, status: StatusFilter) {
  const query = search.trim().toLowerCase();
  return items.filter((item) => {
    const matchesStatus = status === "all" || item.status.toLowerCase() === status;
    return matchesStatus && (!query || `${item.name} ${item.code}`.toLowerCase().includes(query));
  });
}

function MasterCatalogTab({
  panelId,
  kind,
  title,
  description,
  items,
  totalItems,
  search,
  status,
  canCreate,
  canEdit,
  canActivate,
  canDeactivate,
  onSearch,
  onStatus,
  onCreate,
  onEdit,
  onStatusChange,
}: {
  panelId: string;
  kind: MasterKind;
  title: string;
  description: string;
  items: CatalogItem[];
  totalItems: number;
  search: string;
  status: StatusFilter;
  canCreate: boolean;
  canEdit: boolean;
  canActivate: boolean;
  canDeactivate: boolean;
  onSearch: (value: string) => void;
  onStatus: (value: StatusFilter) => void;
  onCreate: () => void;
  onEdit: (item: CatalogItem) => void;
  onStatusChange: (item: CatalogItem) => void;
}) {
  const pagination = useClientPagination(items, `${search}:${status}`);
  const noun = kind === "bank" ? "bank" : "product";
  const createLabel = `Add ${noun}`;
  return (
    <Card className="min-w-0 p-0">
      <div id={panelId} role="tabpanel" aria-labelledby={`catalog-tab-${kind === "bank" ? "banks" : "products"}`}>
        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950">{title}</h2>
              <p className="mt-1 text-sm text-slate-500">{description}</p>
            </div>
            <Badge>{totalItems} total</Badge>
          </div>
          <SearchActionBar
            className="mt-4"
            search={
              <label className="block text-sm font-medium text-slate-700">
                Search {title.toLowerCase()}
                <TextInput
                  type="search"
                  aria-label={`Search ${title.toLowerCase()}`}
                  placeholder="Name or code"
                  value={search}
                  onChange={(event) => onSearch(event.target.value)}
                />
              </label>
            }
            actions={
              <>
                <label className="block min-w-36 text-sm font-medium text-slate-700">
                  Status
                  <Select
                    aria-label={`${title} status`}
                    value={status}
                    onChange={(event) => onStatus(event.target.value as StatusFilter)}
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </Select>
                </label>
                {canCreate ? (
                  <Button type="button" className="sm:mt-[26px]" onClick={onCreate}>
                    {kind === "bank" ? <IconBuildingBank className="size-4" /> : <IconPackages className="size-4" />}
                    {createLabel}
                  </Button>
                ) : null}
              </>
            }
          />
        </div>

        <TableShell className="rounded-none border-x-0 border-b-0 shadow-none">
          <TableHead>
            <tr>
              <Th>Full name</Th>
              <Th>Code</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </TableHead>
          <tbody>
            {pagination.pagedItems.map((item) => {
              const isActive = item.status.toLowerCase() === "active";
              const canChangeStatus = isActive ? canDeactivate : canActivate;
              return (
                <tr key={item.id}>
                  <Td className="font-medium text-slate-900">{item.name}</Td>
                  <Td><code className="text-xs text-slate-600">{item.code}</code></Td>
                  <Td><StatusBadge value={item.status} /></Td>
                  <Td>
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {canEdit ? (
                        <Button type="button" variant="ghost" size="compact" aria-label={`Edit ${item.name}`} onClick={() => onEdit(item)}>
                          <IconEdit className="size-4" />
                          Edit
                        </Button>
                      ) : null}
                      {canChangeStatus ? (
                        <Button
                          type="button"
                          variant={isActive ? "danger" : "secondary"}
                          size="compact"
                          aria-label={`${isActive ? "Deactivate" : "Activate"} ${item.name}`}
                          onClick={() => onStatusChange(item)}
                        >
                          {isActive ? "Deactivate" : "Activate"}
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              );
            })}
            {items.length === 0 ? (
              <tr>
                <td className="p-0" colSpan={4}>
                  <EmptyState>
                    <p>{totalItems === 0 ? `No ${title.toLowerCase()} have been created.` : `No ${title.toLowerCase()} match the current filters.`}</p>
                    {totalItems === 0 && canCreate ? <Button type="button" className="mt-3" onClick={onCreate}>{createLabel}</Button> : null}
                  </EmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </TableShell>
        {pagination.totalPages > 1 ? (
          <Pagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            totalPages={pagination.totalPages}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        ) : null}
      </div>
    </Card>
  );
}

function ProductVariantsTab({
  panelId,
  mappings,
  productMappings,
  selectedMapping,
  items,
  totalItems,
  bankId,
  productId,
  search,
  status,
  canCreate,
  canEdit,
  canActivate,
  canDeactivate,
  onBank,
  onProduct,
  onSearch,
  onStatus,
  onCreate,
  onEdit,
  onStatusChange,
}: {
  panelId: string;
  mappings: BankProductRecord[];
  productMappings: BankProductRecord[];
  selectedMapping: BankProductRecord | null;
  items: ProductVariantRecord[];
  totalItems: number;
  bankId: string;
  productId: string;
  search: string;
  status: StatusFilter;
  canCreate: boolean;
  canEdit: boolean;
  canActivate: boolean;
  canDeactivate: boolean;
  onBank: (value: string) => void;
  onProduct: (value: string) => void;
  onSearch: (value: string) => void;
  onStatus: (value: StatusFilter) => void;
  onCreate: () => void;
  onEdit: (item: ProductVariantRecord) => void;
  onStatusChange: (item: ProductVariantRecord) => void;
}) {
  const pagination = useClientPagination(items, `${bankId}:${productId}:${search}:${status}`);
  const bankOptions = Array.from(
    new Map(
      mappings
        .filter((mapping) => mapping.bank)
        .map((mapping) => [mapping.bankId, mapping.bank!]),
    ).entries(),
  );
  const parentActive = Boolean(
    selectedMapping &&
      selectedMapping.status === "active" &&
      selectedMapping.bank?.status === "active" &&
      selectedMapping.product?.status === "active",
  );

  return (
    <Card className="min-w-0 p-0">
      <div id={panelId} role="tabpanel" aria-labelledby="catalog-tab-variants">
        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Product Variants</h2>
              <p className="mt-1 text-sm text-slate-500">
                Select a Bank and Product Category, then manage its actual Product Variants.
              </p>
            </div>
            <Badge>{totalItems} for selected mapping</Badge>
          </div>

          {mappings.length === 0 ? (
            <EmptyState>
              Create a Bank–Product mapping before adding Product Variants.
            </EmptyState>
          ) : (
            <div className="mt-4 grid min-w-0 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <label className="block min-w-0 text-sm font-medium text-slate-700">
                Bank
                <Select aria-label="Variant bank" value={bankId} onChange={(event) => onBank(event.target.value)}>
                  {bankOptions.map(([id, bank]) => (
                    <option key={id} value={id}>{fullLabel(bank)}</option>
                  ))}
                </Select>
              </label>
              <label className="block min-w-0 text-sm font-medium text-slate-700">
                Product Category
                <Select aria-label="Variant product category" value={productId} onChange={(event) => onProduct(event.target.value)}>
                  {productMappings.map((mapping) => (
                    <option key={mapping.id} value={mapping.productId}>
                      {fullLabel(mapping.product)}{mapping.status !== "active" ? " — inactive mapping" : ""}
                    </option>
                  ))}
                </Select>
              </label>
              {canCreate ? (
                <Button type="button" disabled={!parentActive} onClick={onCreate}>
                  <IconPackages className="size-4" />
                  Add Product Variant
                </Button>
              ) : null}
              {!parentActive && selectedMapping ? (
                <p className="text-xs leading-5 text-amber-700 md:col-span-3">
                  New variants require an active Bank, Product Category, and Bank–Product mapping.
                </p>
              ) : null}
            </div>
          )}

          <SearchActionBar
            className="mt-4"
            search={
              <label className="block text-sm font-medium text-slate-700">
                Search Product Variants
                <TextInput
                  type="search"
                  aria-label="Search Product Variants"
                  placeholder="Name, code, or description"
                  value={search}
                  onChange={(event) => onSearch(event.target.value)}
                />
              </label>
            }
            actions={
              <label className="block min-w-36 text-sm font-medium text-slate-700">
                Status
                <Select aria-label="Product Variant status" value={status} onChange={(event) => onStatus(event.target.value as StatusFilter)}>
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </label>
            }
          />
        </div>

        <TableShell className="rounded-none border-x-0 border-b-0 shadow-none">
          <TableHead>
            <tr>
              <Th>Product Variant</Th>
              <Th>Bank</Th>
              <Th>Product Category</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </TableHead>
          <tbody>
            {pagination.pagedItems.map((item) => {
              const isActive = item.status.toLowerCase() === "active";
              const canChangeStatus = isActive ? canDeactivate : canActivate;
              return (
                <tr key={item.id}>
                  <Td>
                    <span className="block font-medium text-slate-900">{item.name}</span>
                    <code className="text-xs text-slate-500">{item.code}</code>
                    {item.description ? <span className="mt-1 block text-xs text-slate-500">{item.description}</span> : null}
                  </Td>
                  <Td>
                    <span className="block text-slate-900">{item.bank?.name ?? "Unavailable bank"}</span>
                    <code className="text-xs text-slate-500">{item.bank?.code ?? "—"}</code>
                  </Td>
                  <Td>
                    <span className="block text-slate-900">{item.product?.name ?? "Unavailable product"}</span>
                    <code className="text-xs text-slate-500">{item.product?.code ?? "—"}</code>
                  </Td>
                  <Td><StatusBadge value={item.status} /></Td>
                  <Td>
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {canEdit ? (
                        <Button type="button" variant="ghost" size="compact" aria-label={`Edit ${item.name}`} onClick={() => onEdit(item)}>
                          <IconEdit className="size-4" />
                          Edit
                        </Button>
                      ) : null}
                      {canChangeStatus ? (
                        <Button
                          type="button"
                          variant={isActive ? "danger" : "secondary"}
                          size="compact"
                          aria-label={`${isActive ? "Deactivate" : "Activate"} ${item.name}`}
                          onClick={() => onStatusChange(item)}
                        >
                          {isActive ? "Deactivate" : "Activate"}
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              );
            })}
            {items.length === 0 ? (
              <tr>
                <td className="p-0" colSpan={5}>
                  <EmptyState>
                    {!selectedMapping
                      ? "Select a Bank and Product Category to view Product Variants."
                      : totalItems === 0
                        ? canCreate && parentActive
                          ? "No Product Variants exist for this mapping. Add the first variant above."
                          : "No Product Variants are available for this mapping."
                        : "No Product Variants match the current filters."}
                  </EmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </TableShell>
        {pagination.totalPages > 1 ? (
          <Pagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            totalPages={pagination.totalPages}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        ) : null}
      </div>
    </Card>
  );
}

function MappingTab({
  panelId,
  banks,
  products,
  items,
  totalItems,
  search,
  status,
  bankId,
  productId,
  canCreate,
  canActivate,
  canDeactivate,
  saving,
  error,
  onSearch,
  onStatus,
  onBank,
  onProduct,
  onCreate,
  onStatusChange,
}: {
  panelId: string;
  banks: CatalogItem[];
  products: CatalogItem[];
  items: BankProductRecord[];
  totalItems: number;
  search: string;
  status: StatusFilter;
  bankId: string;
  productId: string;
  canCreate: boolean;
  canActivate: boolean;
  canDeactivate: boolean;
  saving: boolean;
  error: string;
  onSearch: (value: string) => void;
  onStatus: (value: StatusFilter) => void;
  onBank: (value: string) => void;
  onProduct: (value: string) => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onStatusChange: (item: BankProductRecord) => void;
}) {
  const pagination = useClientPagination(items, `${search}:${status}`);
  return (
    <Card className="min-w-0 p-0">
      <div id={panelId} role="tabpanel" aria-labelledby="catalog-tab-mappings">
        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Bank–Product Mapping</h2>
              <p className="mt-1 text-sm text-slate-500">Choose which products are available for each bank.</p>
            </div>
            <Badge>{totalItems} total</Badge>
          </div>

          {canCreate ? (
            banks.length > 0 && products.length > 0 ? (
              <form className="mt-4 grid min-w-0 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end" onSubmit={onCreate}>
                <label className="block min-w-0 text-sm font-medium text-slate-700">
                  Bank
                  <Select aria-label="Mapping bank" value={bankId} disabled={saving} onChange={(event) => onBank(event.target.value)}>
                    {banks.map((bank) => <option key={bank.id} value={bank.id}>{fullLabel(bank)}</option>)}
                  </Select>
                </label>
                <label className="block min-w-0 text-sm font-medium text-slate-700">
                  Product
                  <Select aria-label="Mapping product" value={productId} disabled={saving} onChange={(event) => onProduct(event.target.value)}>
                    {products.map((product) => <option key={product.id} value={product.id}>{fullLabel(product)}</option>)}
                  </Select>
                </label>
                <Button type="submit" disabled={saving || !bankId || !productId}>
                  <IconArrowsDiff className="size-4" />
                  {saving ? "Adding…" : "Add mapping"}
                </Button>
                {error ? <div className="md:col-span-3"><ErrorText>{error}</ErrorText></div> : null}
              </form>
            ) : (
              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                At least one bank and one product are required before a mapping can be added.
              </p>
            )
          ) : null}

          <SearchActionBar
            className="mt-4"
            search={
              <label className="block text-sm font-medium text-slate-700">
                Search mappings
                <TextInput
                  type="search"
                  aria-label="Search mappings"
                  placeholder="Bank or product name or code"
                  value={search}
                  onChange={(event) => onSearch(event.target.value)}
                />
              </label>
            }
            actions={
              <label className="block min-w-36 text-sm font-medium text-slate-700">
                Status
                <Select aria-label="Mapping status" value={status} onChange={(event) => onStatus(event.target.value as StatusFilter)}>
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </label>
            }
          />
        </div>

        <TableShell className="rounded-none border-x-0 border-b-0 shadow-none">
          <TableHead>
            <tr>
              <Th>Bank</Th>
              <Th>Product</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </TableHead>
          <tbody>
            {pagination.pagedItems.map((item) => {
              const isActive = item.status.toLowerCase() === "active";
              const canChangeStatus = isActive ? canDeactivate : canActivate;
              return (
                <tr key={item.id}>
                  <Td>
                    <span className="block font-medium text-slate-900">{item.bank?.name ?? "Unavailable bank"}</span>
                    <code className="text-xs text-slate-500">{item.bank?.code ?? "—"}</code>
                  </Td>
                  <Td>
                    <span className="block font-medium text-slate-900">{item.product?.name ?? "Unavailable product"}</span>
                    <code className="text-xs text-slate-500">{item.product?.code ?? "—"}</code>
                  </Td>
                  <Td><StatusBadge value={item.status} /></Td>
                  <Td>
                    <div className="flex justify-end">
                      {canChangeStatus ? (
                        <Button
                          type="button"
                          variant={isActive ? "danger" : "secondary"}
                          size="compact"
                          aria-label={`${isActive ? "Deactivate" : "Activate"} ${item.bank?.name ?? "bank"} ${item.product?.name ?? "product"} mapping`}
                          onClick={() => onStatusChange(item)}
                        >
                          {isActive ? "Deactivate" : "Activate"}
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              );
            })}
            {items.length === 0 ? (
              <tr>
                <td className="p-0" colSpan={4}>
                  <EmptyState>
                    {totalItems === 0
                      ? canCreate
                        ? "No mappings exist. Choose a bank and product above to add the first mapping."
                        : "No mappings are available."
                      : "No mappings match the current filters."}
                  </EmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </TableShell>
        {pagination.totalPages > 1 ? (
          <Pagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            totalPages={pagination.totalPages}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        ) : null}
      </div>
    </Card>
  );
}

export default function CatalogPage() {
  return (
    <Suspense fallback={<LoadingState>Loading banks and products…</LoadingState>}>
      <CatalogInner />
    </Suspense>
  );
}
