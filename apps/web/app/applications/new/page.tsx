"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, ErrorText, PageHeader, Select, TextInput } from "@/components/ui";
import { apiGet, apiRequest, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type {
  ApplicationRecord,
  BankProductRecord,
  CatalogItem,
  CustomerRecord,
  ProductVariantRecord,
} from "@/lib/types";

type CustomerMode = "new" | "existing";

export default function CreateApplicationPage() {
  const router = useRouter();
  const api = getBrowserApiUrl();
  const { can, user } = useAuth();
  const [error, setError] = useState("");
  const [customerMode, setCustomerMode] = useState<CustomerMode>("new");
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [mappings, setMappings] = useState<BankProductRecord[]>([]);
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [variants, setVariants] = useState<ProductVariantRecord[]>([]);
  const [customer, setCustomer] = useState({
    customer_type: "individual",
    full_name: "",
    company_name: "",
    contact_person: "",
    mobile: "",
    email: "",
    emirates_id: "",
    passport: "",
    employer: "",
    trade_license: "",
  });
  const [form, setForm] = useState({
    customer_id: "",
    bank_id: "",
    product_id: "",
    product_variant_id: "",
    requested_amount: "",
    bank_case_number: "",
  });

  useEffect(() => {
    void Promise.all([
      apiGet<{ items: BankProductRecord[] }>("/api/v1/bank-products", api),
      apiGet<{ items: CatalogItem[] }>("/api/v1/products", api),
      apiGet<{ items: ProductVariantRecord[] }>("/api/v1/product-variants", api),
    ])
      .then(([mappingData, productData, variantData]) => {
        setMappings(mappingData.items.filter((item) => item.status === "active"));
        setProducts(productData.items);
        setVariants(variantData.items);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Load failed"));
  }, [api]);

  useEffect(() => {
    if (customerMode !== "existing") return;
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
  }, [api, customerMode, customerQuery]);

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
    if (!user) {
      setError("Your authenticated user profile is unavailable");
      return;
    }
    try {
      const customerPayload = {
        customer_type: customer.customer_type,
        full_name: customer.customer_type === "individual" ? customer.full_name : null,
        company_name: customer.customer_type === "company" ? customer.company_name : null,
        contact_person: customer.customer_type === "company" ? customer.contact_person : null,
        mobile: customer.mobile,
        email: customer.email || null,
        emirates_id: customer.customer_type === "individual" ? customer.emirates_id || null : null,
        passport: customer.customer_type === "individual" ? customer.passport || null : null,
        employer: customer.customer_type === "individual" ? customer.employer || null : null,
        trade_license: customer.customer_type === "company" ? customer.trade_license || null : null,
        create_anyway: false,
      };
      const created = await apiRequest<ApplicationRecord>("/api/v1/applications", api, {
        method: "POST",
        body: JSON.stringify({
          customer_id: customerMode === "existing" ? form.customer_id : undefined,
          customer: customerMode === "new" ? customerPayload : undefined,
          bank_id: selectedMapping.bankId,
          product_id: selectedMapping.productId,
          product_variant_id: form.product_variant_id,
          requested_amount: form.requested_amount ? form.requested_amount : null,
          bank_case_number: can("Applications.Submit") ? form.bank_case_number || null : null,
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
        <fieldset className="rounded-lg border border-brand-border p-3">
          <legend className="px-1 text-sm font-medium">Customer</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label><input className="mr-2" type="radio" name="customer-mode" checked={customerMode === "new"} onChange={() => setCustomerMode("new")} />Create and link new customer</label>
            <label><input className="mr-2" type="radio" name="customer-mode" checked={customerMode === "existing"} onChange={() => setCustomerMode("existing")} />Link visible existing customer</label>
          </div>
          {customerMode === "existing" ? (
            <div className="mt-3 grid gap-3">
              <label className="block text-sm">Search customers<TextInput aria-label="Search customers" value={customerQuery} placeholder="Customer code, name, company, mobile, or identifier" onChange={(event) => setCustomerQuery(event.target.value)} /></label>
              <label className="block text-sm">Customer<Select required aria-label="Customer" value={form.customer_id} onChange={(event) => setForm({ ...form, customer_id: event.target.value })}><option value="">Select customer</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.customerCode} — {item.companyName || item.fullName}</option>)}</Select></label>
            </div>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">Customer type<Select aria-label="Customer type" value={customer.customer_type} onChange={(event) => setCustomer({ ...customer, customer_type: event.target.value })}><option value="individual">Individual</option><option value="company">Company / Business</option></Select></label>
              {customer.customer_type === "individual" ? <label className="block text-sm">Full name<TextInput aria-label="Customer full name" required value={customer.full_name} onChange={(event) => setCustomer({ ...customer, full_name: event.target.value })} /></label> : <><label className="block text-sm">Company name<TextInput aria-label="Customer company name" required value={customer.company_name} onChange={(event) => setCustomer({ ...customer, company_name: event.target.value })} /></label><label className="block text-sm">Contact person<TextInput aria-label="Customer contact person" required value={customer.contact_person} onChange={(event) => setCustomer({ ...customer, contact_person: event.target.value })} /></label></>}
              <label className="block text-sm">Mobile<TextInput aria-label="Customer mobile" required value={customer.mobile} onChange={(event) => setCustomer({ ...customer, mobile: event.target.value })} /></label>
              <label className="block text-sm">Email<TextInput aria-label="Customer email" type="email" value={customer.email} onChange={(event) => setCustomer({ ...customer, email: event.target.value })} /></label>
              {customer.customer_type === "individual" ? <><label className="block text-sm">Emirates ID<TextInput aria-label="Customer Emirates ID" value={customer.emirates_id} onChange={(event) => setCustomer({ ...customer, emirates_id: event.target.value })} /></label><label className="block text-sm">Passport<TextInput aria-label="Customer passport" value={customer.passport} onChange={(event) => setCustomer({ ...customer, passport: event.target.value })} /></label><label className="block text-sm">Employer<TextInput aria-label="Customer employer" value={customer.employer} onChange={(event) => setCustomer({ ...customer, employer: event.target.value })} /></label></> : <label className="block text-sm">Trade license<TextInput aria-label="Customer trade license" value={customer.trade_license} onChange={(event) => setCustomer({ ...customer, trade_license: event.target.value })} /></label>}
            </div>
          )}
        </fieldset>
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
        <div className="rounded-lg border border-brand-border bg-brand-soft p-3 text-sm">
          <span className="font-medium">Initial Case Owner:</span> {user?.fullName ?? "Current user"}. Ownership and commission attribution begin with the creator; reassignment remains a separate audited action.
        </div>
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
        {can("Applications.Submit") ? <label className="block text-sm">Bank File / Case Number (optional)<TextInput aria-label="Bank File / Case Number" value={form.bank_case_number} onChange={(event) => setForm({ ...form, bank_case_number: event.target.value })} /></label> : null}
        <Button type="submit">Create application</Button>
      </form>
    </section>
  );
}
