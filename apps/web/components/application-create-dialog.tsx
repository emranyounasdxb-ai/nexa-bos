"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Button,
  ErrorText,
  Field,
  Select,
  TextInput,
} from "@/components/ui";
import { apiGet, apiRequest, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type {
  ApplicationRecord,
  BankProductRecord,
  CatalogItem,
  ProductVariantRecord,
} from "@/lib/types";

type MatchHistory = {
  applicationId: string;
  applicationCode: string;
  bank: string | null;
  product: string | null;
  status: string;
};

type CustomerMatch = {
  matched: boolean;
  message: string | null;
  customer: {
    customerType: "individual" | "company";
    status: string;
    fullName: string | null;
    mobile: string;
    email: string | null;
    emiratesId: string | null;
    passport: string | null;
    employer: string | null;
  } | null;
  history: MatchHistory[];
};

type CustomerDraft = {
  customer_type: "individual" | "company";
  full_name: string;
  company_name: string;
  contact_person: string;
  mobile: string;
  email: string;
  emirates_id: string;
  passport: string;
  employer: string;
  trade_license: string;
};

const emptyCustomer: CustomerDraft = {
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
};

const emptyApplication = {
  bank_id: "",
  product_id: "",
  product_variant_id: "",
  requested_amount: "",
};

export function ApplicationCreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (application: ApplicationRecord) => void;
}) {
  const { user } = useAuth();
  const api = getBrowserApiUrl();
  const dialogRef = useRef<HTMLElement>(null);
  const lastMatchKey = useRef("");
  const matchVersion = useRef(0);
  const [customer, setCustomer] = useState<CustomerDraft>(emptyCustomer);
  const [form, setForm] = useState(emptyApplication);
  const [mappings, setMappings] = useState<BankProductRecord[]>([]);
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [variants, setVariants] = useState<ProductVariantRecord[]>([]);
  const [match, setMatch] = useState<CustomerMatch | null>(null);
  const [matching, setMatching] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reset = useCallback(() => {
    setCustomer(emptyCustomer);
    setForm(emptyApplication);
    setMatch(null);
    setMatching(false);
    setSaving(false);
    setError("");
    lastMatchKey.current = "";
    matchVersion.current += 1;
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
    setLoadingOptions(true);
    void Promise.all([
      apiGet<{ items: BankProductRecord[] }>("/api/v1/bank-products", api),
      apiGet<{ items: CatalogItem[] }>("/api/v1/products", api),
      apiGet<{ items: ProductVariantRecord[] }>("/api/v1/product-variants", api),
    ])
      .then(([mappingData, productData, variantData]) => {
        setMappings(mappingData.items.filter((item) => item.status === "active"));
        setProducts(productData.items);
        setVariants(variantData.items.filter((item) => item.status === "active"));
      })
      .catch((value: unknown) => {
        setError(value instanceof Error ? value.message : "Application options could not be loaded");
      })
      .finally(() => setLoadingOptions(false));
  }, [api, open, reset]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = dialogRef.current?.querySelector<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!focusable.length) return;
      const firstItem = focusable[0];
      const lastItem = focusable.at(-1);
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem?.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open, saving]);

  const bankOptions = useMemo(
    () =>
      Array.from(
        new Map(
          mappings.filter((item) => item.bank).map((item) => [item.bankId, item.bank!]),
        ).entries(),
      ),
    [mappings],
  );
  const productMappings = mappings.filter((item) => item.bankId === form.bank_id);
  const selectedMapping = productMappings.find((item) => item.productId === form.product_id);
  const variantOptions = variants.filter((item) => item.bankProductId === selectedMapping?.id);
  const selectedProduct = products.find((item) => item.id === form.product_id);
  const requestedRequired = Boolean(selectedProduct?.requestedAmountRequired);
  const identityLocked = Boolean(match?.matched);

  function clearIdentityMatch() {
    matchVersion.current += 1;
    lastMatchKey.current = "";
    setMatch(null);
    setError("");
    setCustomer((current) => ({
      ...current,
      full_name: "",
      emirates_id: "",
      passport: "",
    }));
  }

  async function matchIdentity() {
    if (customer.customer_type !== "individual" || identityLocked) return;
    const emiratesId = customer.emirates_id.trim();
    const passport = customer.passport.trim();
    if (!emiratesId && !passport) {
      setMatch(null);
      lastMatchKey.current = "";
      return;
    }
    const key = `${emiratesId.toUpperCase()}|${passport.toUpperCase()}`;
    if (key === lastMatchKey.current) return;
    lastMatchKey.current = key;
    const version = ++matchVersion.current;
    setMatching(true);
    setError("");
    try {
      const result = await apiRequest<CustomerMatch>("/api/v1/applications/customer-match", api, {
        method: "POST",
        body: JSON.stringify({
          emirates_id: emiratesId || null,
          passport: passport || null,
        }),
      });
      if (version !== matchVersion.current) return;
      setMatch(result);
      if (result.matched && result.customer) {
        setCustomer((current) => ({
          ...current,
          customer_type: result.customer!.customerType,
          full_name: result.customer!.fullName ?? "",
          mobile: result.customer!.mobile,
          email: result.customer!.email ?? "",
          emirates_id: result.customer!.emiratesId ?? "",
          passport: result.customer!.passport ?? "",
          employer: result.customer!.employer ?? "",
        }));
      }
    } catch (value) {
      if (version !== matchVersion.current) return;
      setMatch(null);
      setError(value instanceof ApiClientError ? value.message : "Customer identity could not be checked");
    } finally {
      if (version === matchVersion.current) setMatching(false);
    }
  }

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
    setSaving(true);
    try {
      const created = await apiRequest<ApplicationRecord>("/api/v1/applications", api, {
        method: "POST",
        body: JSON.stringify({
          customer: {
            customer_type: customer.customer_type,
            full_name: customer.customer_type === "individual" ? customer.full_name : null,
            company_name: customer.customer_type === "company" ? customer.company_name : null,
            contact_person: customer.customer_type === "company" ? customer.contact_person : null,
            mobile: customer.mobile,
            email: customer.email || null,
            emirates_id:
              customer.customer_type === "individual" ? customer.emirates_id || null : null,
            passport: customer.customer_type === "individual" ? customer.passport || null : null,
            employer: customer.customer_type === "individual" ? customer.employer || null : null,
            trade_license:
              customer.customer_type === "company" ? customer.trade_license || null : null,
            create_anyway: false,
          },
          bank_id: selectedMapping.bankId,
          product_id: selectedMapping.productId,
          product_variant_id: form.product_variant_id,
          requested_amount: form.requested_amount || null,
        }),
      });
      onCreated(created);
    } catch (value) {
      setError(value instanceof ApiClientError ? value.message : "Application could not be created");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !saving) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-application-title"
        aria-describedby="create-application-description"
        className="flex h-full max-h-full w-full min-w-0 flex-col bg-surface shadow-2xl sm:h-auto sm:max-h-[calc(100vh-2rem)] sm:max-w-4xl sm:rounded-[10px] sm:border sm:border-brand-border"
      >
        <header className="flex min-w-0 items-start justify-between gap-3 border-b border-brand-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id="create-application-title" className="text-lg font-semibold text-text-primary">
              Create application
            </h2>
            <p id="create-application-description" className="mt-1 text-sm text-text-secondary">
              Match the customer by exact identity, then select the Bank, Product and Product Variant.
            </p>
          </div>
          <Button type="button" variant="ghost" size="compact" disabled={saving} onClick={onClose}>
            Close
          </Button>
        </header>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
            {error ? <ErrorText>{error}</ErrorText> : null}
            <fieldset className="min-w-0 rounded-[10px] border border-brand-border p-3 sm:p-4">
              <legend className="px-1 text-sm font-semibold text-text-primary">Customer</legend>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <Field label="Customer type">
                  <Select
                    aria-label="Customer type"
                    value={customer.customer_type}
                    disabled={identityLocked}
                    onChange={(event) => {
                      const customerType = event.target.value as CustomerDraft["customer_type"];
                      setCustomer({ ...emptyCustomer, customer_type: customerType });
                      setMatch(null);
                      lastMatchKey.current = "";
                    }}
                  >
                    <option value="individual">Individual</option>
                    <option value="company">Company / Business</option>
                  </Select>
                </Field>

                {customer.customer_type === "individual" ? (
                  <>
                    <Field label="Emirates ID" help="Checked by exact server-side match only.">
                      <TextInput
                        aria-label="Customer Emirates ID"
                        value={customer.emirates_id}
                        readOnly={identityLocked}
                        onBlur={() => void matchIdentity()}
                        onChange={(event) => {
                          lastMatchKey.current = "";
                          setMatch(null);
                          setCustomer({ ...customer, emirates_id: event.target.value });
                        }}
                      />
                    </Field>
                    <Field label="Passport Number" help="Checked by exact server-side match only.">
                      <TextInput
                        aria-label="Customer Passport Number"
                        value={customer.passport}
                        readOnly={identityLocked}
                        onBlur={() => void matchIdentity()}
                        onChange={(event) => {
                          lastMatchKey.current = "";
                          setMatch(null);
                          setCustomer({ ...customer, passport: event.target.value });
                        }}
                      />
                    </Field>
                    <div className="flex min-w-0 items-end gap-2 sm:col-span-2">
                      {identityLocked ? (
                        <Button type="button" variant="secondary" onClick={clearIdentityMatch}>
                          Use a different identity
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={matching || (!customer.emirates_id.trim() && !customer.passport.trim())}
                          onClick={() => void matchIdentity()}
                        >
                          {matching ? "Checking…" : "Check exact identity"}
                        </Button>
                      )}
                    </div>
                    <Field label="Full Name">
                      <TextInput
                        aria-label="Customer Full Name"
                        required
                        value={customer.full_name}
                        readOnly={identityLocked}
                        onChange={(event) => setCustomer({ ...customer, full_name: event.target.value })}
                      />
                    </Field>
                    <Field label="Employer">
                      <TextInput
                        aria-label="Customer Employer"
                        value={customer.employer}
                        onChange={(event) => setCustomer({ ...customer, employer: event.target.value })}
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Company Name">
                      <TextInput
                        aria-label="Customer Company Name"
                        required
                        value={customer.company_name}
                        onChange={(event) => setCustomer({ ...customer, company_name: event.target.value })}
                      />
                    </Field>
                    <Field label="Contact Person">
                      <TextInput
                        aria-label="Customer Contact Person"
                        required
                        value={customer.contact_person}
                        onChange={(event) => setCustomer({ ...customer, contact_person: event.target.value })}
                      />
                    </Field>
                    <Field label="Trade License">
                      <TextInput
                        aria-label="Customer Trade License"
                        value={customer.trade_license}
                        onChange={(event) => setCustomer({ ...customer, trade_license: event.target.value })}
                      />
                    </Field>
                  </>
                )}

                <Field label="Mobile">
                  <TextInput
                    aria-label="Customer Mobile"
                    required
                    value={customer.mobile}
                    onChange={(event) => setCustomer({ ...customer, mobile: event.target.value })}
                  />
                </Field>
                <Field label="Email">
                  <TextInput
                    aria-label="Customer Email"
                    type="email"
                    value={customer.email}
                    onChange={(event) => setCustomer({ ...customer, email: event.target.value })}
                  />
                </Field>
              </div>

              {match?.matched ? (
                <div className="mt-3 rounded-[10px] border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950" role="status">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{match.message}</p>
                    <span className="text-xs">Status: {match.customer?.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-blue-800">
                    Name and identity fields are locked. You may update the contact details shown above.
                  </p>
                  <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide">Limited application history</h3>
                  {match.history.length ? (
                    <ul className="mt-1 divide-y divide-blue-200">
                      {match.history.map((item) => (
                        <li key={item.applicationId} className="grid min-w-0 gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                          <span className="break-words font-medium">{item.applicationCode}</span>
                          <span className="break-words">{item.bank ?? "Bank unavailable"} · {item.product ?? "Product unavailable"}</span>
                          <span className="break-words text-blue-800">{item.status}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-blue-800">No applications are visible in your authorized scope.</p>
                  )}
                </div>
              ) : null}
            </fieldset>

            <fieldset className="min-w-0 rounded-[10px] border border-brand-border p-3 sm:p-4">
              <legend className="px-1 text-sm font-semibold text-text-primary">Application</legend>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <Field label="Bank">
                  <Select
                    required
                    aria-label="Bank"
                    value={form.bank_id}
                    disabled={loadingOptions}
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
                      <option key={id} value={id}>{bank.name} ({bank.code})</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Product">
                  <Select
                    required
                    aria-label="Product"
                    value={form.product_id}
                    disabled={!form.bank_id}
                    onChange={(event) =>
                      setForm({ ...form, product_id: event.target.value, product_variant_id: "" })
                    }
                  >
                    <option value="">Select product</option>
                    {productMappings.map((item) => (
                      <option key={item.id} value={item.productId}>{item.product?.name} ({item.product?.code})</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Product Variant">
                  <Select
                    required
                    aria-label="Product Variant"
                    value={form.product_variant_id}
                    disabled={!selectedMapping}
                    onChange={(event) => setForm({ ...form, product_variant_id: event.target.value })}
                  >
                    <option value="">Select product variant</option>
                    {variantOptions.map((item) => (
                      <option key={item.id} value={item.id}>{item.name} ({item.code})</option>
                    ))}
                  </Select>
                </Field>
                <Field label={`Requested amount${requestedRequired ? " (required)" : " (optional)"}`}>
                  <TextInput
                    type="number"
                    min="0"
                    step="0.01"
                    required={requestedRequired}
                    aria-label="Requested amount"
                    value={form.requested_amount}
                    onChange={(event) => setForm({ ...form, requested_amount: event.target.value })}
                  />
                </Field>
              </div>
              <p className="mt-3 rounded-[10px] border border-brand-border bg-brand-soft px-3 py-2 text-sm text-text-primary">
                Initial Case Owner: {user?.fullName ?? "Current user"}. Ownership and commission attribution begin with the creator.
              </p>
            </fieldset>
          </div>

          <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-brand-border px-4 py-3 sm:px-5">
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || loadingOptions || matching}>
              {saving ? "Creating…" : "Create application"}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}
