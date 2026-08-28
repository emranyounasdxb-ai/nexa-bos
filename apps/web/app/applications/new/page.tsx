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
} from "@/lib/types";

export default function CreateApplicationPage() {
  const router = useRouter();
  const api = getBrowserApiUrl();
  const [error, setError] = useState("");
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [mappings, setMappings] = useState<BankProductRecord[]>([]);
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [owners, setOwners] = useState<ManagerOption[]>([]);
  const [form, setForm] = useState({
    customer_id: "",
    mapping_id: "",
    case_owner_id: "",
    requested_amount: "",
    bank_case_number: "",
  });

  useEffect(() => {
    void Promise.all([
      apiGet<{ items: CustomerRecord[] }>("/api/v1/customers", api),
      apiGet<{ items: BankProductRecord[] }>("/api/v1/bank-products", api),
      apiGet<{ items: CatalogItem[] }>("/api/v1/products", api),
      apiGet<{ items: ManagerOption[] }>("/api/v1/users/case-owners", api),
    ])
      .then(([customerData, mappingData, productData, ownerData]) => {
        setCustomers(customerData.items.filter((item) => item.status === "Active"));
        setMappings(mappingData.items.filter((item) => item.status === "active"));
        setProducts(productData.items);
        setOwners(ownerData.items);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Load failed"));
  }, [api]);

  const selectedMapping = mappings.find((item) => item.id === form.mapping_id);
  const selectedProduct = products.find((item) => item.id === selectedMapping?.productId);
  const requestedRequired = Boolean(selectedProduct?.requestedAmountRequired);

  async function submit() {
    setError("");
    if (!selectedMapping) {
      setError("Select an active Bank and Product mapping");
      return;
    }
    try {
      const created = await apiRequest<ApplicationRecord>("/api/v1/applications", api, {
        method: "POST",
        body: JSON.stringify({
          customer_id: form.customer_id,
          bank_id: selectedMapping.bankId,
          product_id: selectedMapping.productId,
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
          Bank and product
          <Select
            required
            aria-label="Bank and product"
            value={form.mapping_id}
            onChange={(event) => setForm({ ...form, mapping_id: event.target.value })}
          >
            <option value="">Select mapping</option>
            {mappings.map((item) => (
              <option key={item.id} value={item.id}>
                {item.bank?.code} / {item.product?.code}
              </option>
            ))}
          </Select>
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
