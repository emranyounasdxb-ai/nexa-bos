"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, ErrorText, PageHeader, Select, TextInput } from "@/components/ui";
import { apiGet, apiRequest, ApiClientError } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";
import type {
  ApplicationRecord,
  BankProductRecord,
  CatalogItem,
  CustomerRecord,
  ManagerOption,
  ProductVariantRecord,
} from "@/lib/types";

export default function CreateApplicationPage() {
  const router = useRouter();
  const api = getBrowserApiUrl();
  const [error, setError] = useState("");
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [mappings, setMappings] = useState<BankProductRecord[]>([]);
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [variants, setVariants] = useState<ProductVariantRecord[]>([]);
  const [owners, setOwners] = useState<ManagerOption[]>([]);
  const [form, setForm] = useState({
    customer_id: "",
    bank_id: "",
    product_id: "",
    product_variant_id: "",
    case_owner_id: "",
    requested_amount: "",
    bank_case_number: "",
  });

  useEffect(() => {
    void Promise.all([
      apiGet<{ items: BankProductRecord[] }>("/api/v1/bank-products", api),
      apiGet<{ items: CatalogItem[] }>("/api/v1/products", api),
      apiGet<{ items: ProductVariantRecord[] }>("/api/v1/product-variants", api),
      apiGet<{ items: ManagerOption[] }>("/api/v1/users/case-owners", api),
    ])
      .then(([mappingData, productData, variantData, ownerData]) => {
        setMappings(mappingData.items.filter((item) => item.status === "active"));
        setProducts(productData.items);
        setVariants(variantData.items);
        setOwners(ownerData.items);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Load failed"));
  }, [api]);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ page: "1", page_size: "50", status: "Active" });
    if (customerQuery.trim()) query.set("q", customerQuery.trim());
    void apiGet<{ items: CustomerRecord[] }>(`/api/v1/customers?${query}`, api)
      .then((data) => {
        if (active) setCustomers(data.items);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load customers");
      });
    return () => {
      active = false;
    };
  }, [api, customerQuery]);

  const bankOptions = Array.from(
    new Map(
      mappings
        .filter((item) => item.bank)
        .map((item) => [item.bankId, item.bank!]),
    ).entries(),
  );
  const productMappings = mappings.filter((item) => item.bankId === form.bank_id);
  const selectedMapping = productMappings.find((item) => item.productId === form.product_id);
  const variantOptions = variants.filter((item) => item.bankProductId === selectedMapping?.id);
  const selectedProduct = products.find((item) => item.id === form.product_id);
  const requestedRequired = Boolean(selectedProduct?.requestedAmountRequired);

  async function submit() {
    setError("");
    if (!selectedMapping || !form.product_variant_id) {
      setError("Select an active Bank, Product Category, and Product Variant");
      return;
    }
    try {
      const created = await apiRequest<ApplicationRecord>("/api/v1/applications", api, {
        method: "POST",
        body: JSON.stringify({
          customer_id: form.customer_id,
          bank_id: selectedMapping.bankId,
          product_id: selectedMapping.productId,
          product_variant_id: form.product_variant_id,
          case_owner_id: form.case_owner_id,
          requested_amount: form.requested_amount ? form.requested_amount : null,
          bank_case_number: form.bank_case_number || null,
        }),
      });
      router.push(`/applications/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Create failed");
    }
  }

  return (
    <section className="max-w-2xl space-y-4">
      <PageHeader
        title="Create application"
        description="There is no draft. The application is created immediately with ID PRODUCT-BANK-YEAR-SEQUENCE and enters Application Created."
      />
      <ErrorText>{error}</ErrorText>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="block text-sm">
          Search customers
          <TextInput
            aria-label="Search customers"
            value={customerQuery}
            placeholder="Customer code, name, company, mobile, or identifier"
            onChange={(event) => setCustomerQuery(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          Customer
          <Select
            required
            aria-label="Customer"
            value={form.customer_id}
            onChange={(event) => setForm({ ...form, customer_id: event.target.value })}
          >
            <option value="">Select customer</option>
            {customers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.customerCode} — {item.companyName || item.fullName}
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-sm">
          Bank
          <Select
            required
            aria-label="Bank"
            value={form.bank_id}
            onChange={(event) =>
              setForm({
                ...form,
                bank_id: event.target.value,
                product_id: "",
                product_variant_id: "",
              })
            }
          >
            <option value="">Select bank</option>
            {bankOptions.map(([id, bank]) => (
              <option key={id} value={id}>
                {bank.name} ({bank.code})
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-sm">
          Product Category
          <Select
            required
            aria-label="Product Category"
            value={form.product_id}
            disabled={!form.bank_id}
            onChange={(event) =>
              setForm({ ...form, product_id: event.target.value, product_variant_id: "" })
            }
          >
            <option value="">Select product category</option>
            {productMappings.map((item) => (
              <option key={item.id} value={item.productId}>
                {item.product?.name} ({item.product?.code})
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-sm">
          Product Variant
          <Select
            required
            aria-label="Product Variant"
            value={form.product_variant_id}
            disabled={!selectedMapping}
            onChange={(event) => setForm({ ...form, product_variant_id: event.target.value })}
          >
            <option value="">Select product variant</option>
            {variantOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.code})
              </option>
            ))}
          </Select>
          {selectedMapping && variantOptions.length === 0 ? (
            <span className="mt-1 block text-xs text-amber-700">
              No active Product Variants are configured for this Bank and Product Category.
            </span>
          ) : null}
        </label>
        <label className="block text-sm">
          Case Owner
          <Select
            required
            aria-label="Case Owner"
            value={form.case_owner_id}
            onChange={(event) => setForm({ ...form, case_owner_id: event.target.value })}
          >
            <option value="">Select Case Owner</option>
            {owners.map((item) => (
              <option key={item.id} value={item.id}>
                {item.fullName} ({item.userCode})
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-sm">
          Requested amount{requestedRequired ? " (required)" : " (optional)"}
          <TextInput
            type="number"
            min="0"
            step="0.01"
            required={requestedRequired}
            aria-label="Requested amount"
            value={form.requested_amount}
            onChange={(event) => setForm({ ...form, requested_amount: event.target.value })}
          />
        </label>
        <label className="block text-sm">
          Bank File / Case Number (optional)
          <TextInput
            aria-label="Bank File / Case Number"
            value={form.bank_case_number}
            onChange={(event) => setForm({ ...form, bank_case_number: event.target.value })}
          />
        </label>
        <Button type="submit">Create application</Button>
      </form>
    </section>
  );
}
