"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  LoadingState,
  PageHeader,
  Select,
  StatusBadge,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
  cx,
} from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { ApplicationRecord, CustomerRecord } from "@/lib/types";

type DetailTab = "overview" | "applications" | "history" | "merge";

type CustomerHistory = {
  identifiers: Array<{
    kind: string;
    value: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
  fields: Array<{
    field: string;
    value: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
  merges: Array<{
    sourceCustomerId: string;
    primaryCustomerId: string;
    sourceCustomerCode: string;
    mergedAt: string;
  }>;
};

type Confirmation = {
  kind: "activate" | "deactivate" | "merge";
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  path: string;
  body?: Record<string, string>;
  success: string;
};

const TABS: Array<{ id: Exclude<DetailTab, "merge">; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "applications", label: "Applications" },
  { id: "history", label: "History" },
];

function validTab(value: string | null): DetailTab {
  return value === "applications" || value === "history" || value === "merge" ? value : "overview";
}

function displayName(customer: CustomerRecord): string {
  return customer.companyName || customer.fullName || "Unnamed customer";
}

function displayField(value: string | null | undefined): string {
  return value?.trim() || "Not provided";
}

function fieldLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [others, setOthers] = useState<CustomerRecord[]>([]);
  const [otherQuery, setOtherQuery] = useState("");
  const [primaryId, setPrimaryId] = useState("");
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmationError, setConfirmationError] = useState("");
  const [form, setForm] = useState({
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
  const confirmationRef = useRef<HTMLElement>(null);
  const confirmationTriggerRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiGet<CustomerRecord>(`/api/v1/customers/${params.id}`, api);
      setCustomer(data);
      setForm({
        full_name: data.fullName ?? "",
        company_name: data.companyName ?? "",
        contact_person: data.contactPerson ?? "",
        mobile: data.mobile,
        email: data.email ?? "",
        emirates_id: data.emiratesId ?? "",
        passport: data.passport ?? "",
        employer: data.employer ?? "",
        trade_license: data.tradeLicense ?? "",
      });
      const [applicationData, historyData] = await Promise.all([
        apiGet<{ items: ApplicationRecord[] }>(`/api/v1/customers/${params.id}/applications`, api),
        apiGet<CustomerHistory>(`/api/v1/customers/${params.id}/history`, api),
      ]);
      setApplications(applicationData.items);
      setHistory(historyData);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to load customer");
    } finally {
      setLoading(false);
    }
  }, [api, params.id]);

  const restoreActionFocus = useCallback((fallbackTab: DetailTab = activeTab) => {
    window.setTimeout(() => {
      if (confirmationTriggerRef.current?.isConnected) confirmationTriggerRef.current.focus();
      else document.getElementById(`customer-tab-${fallbackTab}`)?.focus();
    }, 0);
  }, [activeTab]);

  const closeConfirmation = useCallback(() => {
    if (busy) return;
    setConfirmation(null);
    setConfirmationError("");
    restoreActionFocus();
  }, [busy, restoreActionFocus]);

  useEffect(() => {
    function restoreTab() {
      setActiveTab(validTab(new URLSearchParams(window.location.search).get("tab")));
    }
    restoreTab();
    window.addEventListener("popstate", restoreTab);
    if (can("Customers.View")) void refresh();
    return () => window.removeEventListener("popstate", restoreTab);
  }, [can, refresh]);

  useEffect(() => {
    if (!customer || activeTab !== "merge") return;
    if (can("Customers.Merge") && customer.status !== "Merged") return;
    setActiveTab("overview");
    const query = new URLSearchParams(window.location.search);
    query.delete("tab");
    window.history.replaceState(null, "", `${window.location.pathname}${query.size ? `?${query.toString()}` : ""}`);
  }, [activeTab, can, customer]);

  useEffect(() => {
    if (!confirmation) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      closeConfirmation();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [busy, closeConfirmation, confirmation]);

  useEffect(() => {
    if (!customer || !can("Customers.Merge") || customer.status === "Merged") return;
    let active = true;
    const query = new URLSearchParams({ page: "1", page_size: "50" });
    if (otherQuery.trim()) query.set("q", otherQuery.trim());
    void apiGet<{ items: CustomerRecord[] }>(`/api/v1/customers?${query}`, api)
      .then((directory) => {
        if (!active) return;
        setOthers(directory.items.filter((item) => item.id !== customer.id && item.status !== "Merged"));
      })
      .catch((value: unknown) => {
        if (active) setError(value instanceof Error ? value.message : "Unable to load merge candidates");
      });
    return () => {
      active = false;
    };
  }, [api, can, customer, otherQuery]);

  const selectedPrimary = useMemo(
    () => others.find((item) => item.id === primaryId) ?? null,
    [others, primaryId],
  );

  function selectTab(nextTab: DetailTab, replace = false) {
    if (nextTab === activeTab && !replace) return;
    setActiveTab(nextTab);
    const query = new URLSearchParams(window.location.search);
    if (nextTab === "overview") query.delete("tab");
    else query.set("tab", nextTab);
    const destination = `${window.location.pathname}${query.size ? `?${query.toString()}` : ""}`;
    if (replace) window.history.replaceState(null, "", destination);
    else window.history.pushState(null, "", destination);
  }

  function handleTabKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number, availableTabs: Array<{ id: DetailTab }>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? availableTabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + availableTabs.length) % availableTabs.length;
    const next = availableTabs[nextIndex];
    selectTab(next.id);
    document.getElementById(`customer-tab-${next.id}`)?.focus();
  }

  function requestConfirmation(trigger: HTMLElement, next: Confirmation) {
    confirmationTriggerRef.current = trigger;
    setConfirmationError("");
    setConfirmation(next);
  }

  function trapConfirmationFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      confirmationRef.current?.querySelectorAll<HTMLElement>(
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

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!customer) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(`/api/v1/customers/${customer.id}`, api, {
        method: "PATCH",
        body: JSON.stringify(
          customer.customerType === "individual"
            ? {
                full_name: form.full_name,
                mobile: form.mobile,
                email: form.email || null,
                emirates_id: form.emirates_id || null,
                passport: form.passport || null,
                employer: form.employer || null,
              }
            : {
                company_name: form.company_name,
                contact_person: form.contact_person,
                mobile: form.mobile,
                email: form.email || null,
                trade_license: form.trade_license || null,
              },
        ),
      });
      await refresh();
      setMessage("Customer corrections saved");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to save customer");
    } finally {
      setBusy(false);
    }
  }

  async function runConfirmed() {
    if (!confirmation) return;
    setBusy(true);
    setConfirmationError("");
    setMessage("");
    try {
      await apiRequest(confirmation.path, api, {
        method: "POST",
        body: confirmation.body ? JSON.stringify(confirmation.body) : undefined,
      });
      const completed = confirmation;
      if (completed.kind === "merge") {
        setPrimaryId("");
        setOtherQuery("");
        selectTab("overview", true);
      }
      await refresh();
      setMessage(completed.success);
      setConfirmation(null);
      restoreActionFocus(completed.kind === "merge" ? "overview" : activeTab);
    } catch (value) {
      setConfirmationError(value instanceof Error ? value.message : "Customer operation failed");
    } finally {
      setBusy(false);
    }
  }

  if (!can("Customers.View")) {
    return <EmptyState>You do not have permission to view Customers.</EmptyState>;
  }

  if (loading && !customer) return <LoadingState>Loading Customer…</LoadingState>;
  if (!customer) {
    return (
      <Card>
        <ErrorText>{error || "Customer could not be loaded"}</ErrorText>
        <Button type="button" variant="secondary" className="mt-3" onClick={() => void refresh()}>Retry</Button>
      </Card>
    );
  }

  const merged = customer.status === "Merged";
  const individual = customer.customerType === "individual";
  const availableTabs: Array<{ id: DetailTab; label: string }> = [
    ...TABS,
    ...(can("Customers.Merge") && !merged ? [{ id: "merge" as const, label: "Merge" }] : []),
  ];

  return (
    <section className="min-w-0 space-y-4">
      <PageHeader
        title={customer.customerCode}
        description="Customer identity, application relationships, corrections, and immutable history."
        actions={<Link className="text-sm font-medium text-brand-link underline" href="/customers">Back to Customers</Link>}
      />

      <Card>
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="break-words text-xl font-semibold text-text-primary">{displayName(customer)}</h2>
              <StatusBadge value={customer.status} />
              <Badge>{customer.customerTypeLabel}</Badge>
            </div>
            <p className="mt-1 break-words text-sm text-text-secondary">{customer.mobile}{customer.email ? ` · ${customer.email}` : ""}</p>
            {merged && customer.mergedIntoId ? <p className="mt-2 text-sm text-text-secondary">Merged into customer record {customer.mergedIntoId}. This source record is read-only.</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {can("Customers.Deactivate") && customer.status === "Active" ? (
              <Button
                type="button"
                variant="danger"
                onClick={(event) => requestConfirmation(event.currentTarget, {
                  kind: "deactivate",
                  title: "Deactivate customer?",
                  description: "This customer will become unavailable for new applications. Deactivation is blocked if an active application still depends on the record.",
                  confirmLabel: "Deactivate customer",
                  danger: true,
                  path: `/api/v1/customers/${customer.id}/deactivate`,
                  success: "Customer deactivated",
                })}
              >
                Deactivate
              </Button>
            ) : null}
            {can("Customers.Activate") && customer.status === "Inactive" ? (
              <Button
                type="button"
                onClick={(event) => requestConfirmation(event.currentTarget, {
                  kind: "activate",
                  title: "Activate customer?",
                  description: "The customer will return to active use and can be selected for eligible new applications.",
                  confirmLabel: "Activate customer",
                  path: `/api/v1/customers/${customer.id}/activate`,
                  success: "Customer activated",
                })}
              >
                Activate
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {message ? <p role="status" className="rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}

      <div className="overflow-x-auto rounded-[10px] border border-brand-border bg-surface px-2" role="tablist" aria-label="Customer workspace">
        <div className="flex min-w-max gap-1">
          {availableTabs.map((tab, index) => (
            <button
              key={tab.id}
              id={`customer-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`customer-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={cx(
                "min-h-10 border-b-2 px-3 text-sm font-medium",
                activeTab === tab.id ? "border-brand-primary text-brand-primary" : "border-transparent text-text-secondary hover:text-text-primary",
              )}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => handleTabKey(event, index, availableTabs)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "overview" ? (
        <div id="customer-panel-overview" role="tabpanel" aria-labelledby="customer-tab-overview" className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
          <Card>
            <SectionHeader title="Customer details" description={merged ? "Merged records remain available as preserved read-only history." : "Correct contact and identifier data using the existing customer update workflow."} />
            <form className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2" onSubmit={(event) => void save(event)}>
              {individual ? (
                <>
                  <InputField label="Full name" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} disabled={merged || busy} />
                  <InputField label="Mobile" value={form.mobile} onChange={(value) => setForm({ ...form, mobile: value })} disabled={merged || busy} />
                  <InputField label="Email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} disabled={merged || busy} />
                  <InputField label="Employer" value={form.employer} onChange={(value) => setForm({ ...form, employer: value })} disabled={merged || busy} />
                  <InputField label="Emirates ID" value={form.emirates_id} onChange={(value) => setForm({ ...form, emirates_id: value })} disabled={merged || busy} />
                  <InputField label="Passport" value={form.passport} onChange={(value) => setForm({ ...form, passport: value })} disabled={merged || busy} />
                </>
              ) : (
                <>
                  <InputField label="Company name" value={form.company_name} onChange={(value) => setForm({ ...form, company_name: value })} disabled={merged || busy} />
                  <InputField label="Contact person" value={form.contact_person} onChange={(value) => setForm({ ...form, contact_person: value })} disabled={merged || busy} />
                  <InputField label="Mobile" value={form.mobile} onChange={(value) => setForm({ ...form, mobile: value })} disabled={merged || busy} />
                  <InputField label="Email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} disabled={merged || busy} />
                  <InputField label="Trade license" value={form.trade_license} onChange={(value) => setForm({ ...form, trade_license: value })} disabled={merged || busy} />
                </>
              )}
              {can("Customers.Edit") && !merged ? (
                <div className="flex justify-end sm:col-span-2">
                  <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save corrections"}</Button>
                </div>
              ) : null}
            </form>
          </Card>

          <Card>
            <SectionHeader title="Record summary" description="Current canonical values for this customer." />
            <dl className="mt-3 grid gap-3 text-sm">
              <Detail label="Customer code">{customer.customerCode}</Detail>
              <Detail label="Type">{customer.customerTypeLabel}</Detail>
              <Detail label="Status"><StatusBadge value={customer.status} /></Detail>
              <Detail label={individual ? "Emirates ID" : "Trade license"}>{displayField(individual ? customer.emiratesId : customer.tradeLicense)}</Detail>
              {individual ? <Detail label="Passport">{displayField(customer.passport)}</Detail> : null}
            </dl>
          </Card>
        </div>
      ) : null}

      {activeTab === "applications" ? (
        <div id="customer-panel-applications" role="tabpanel" aria-labelledby="customer-tab-applications">
          <Card>
            <SectionHeader title="Applications" description="Only applications already visible within your assigned access scope are listed." />
            {applications.length ? (
              <>
                <div className="mt-3 hidden md:block">
                  <TableShell>
                    <TableHead><tr><Th>Application</Th><Th>Bank / Product</Th><Th>Stage</Th><Th>Outcome</Th></tr></TableHead>
                    <tbody>
                      {applications.map((application) => (
                        <tr key={application.id} className="border-t border-brand-border">
                          <Td><Link className="font-medium text-brand-link underline" href={`/applications/${application.id}`}>{application.applicationCode}</Link></Td>
                          <Td>{application.bankCode} / {application.productCode} / {application.productVariantCode ?? "Legacy"}</Td>
                          <Td>{application.currentStage}</Td>
                          <Td>{application.terminalOutcome ?? (application.hasActiveDelay && application.activeDelay ? `Delay · ${application.activeDelay.delayType}` : "In progress")}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </TableShell>
                </div>
                <div className="mt-3 grid gap-2 md:hidden">
                  {applications.map((application) => (
                    <article key={application.id} className="min-w-0 rounded-[10px] border border-brand-border p-3 text-sm">
                      <Link className="font-semibold text-brand-link underline" href={`/applications/${application.id}`}>{application.applicationCode}</Link>
                      <p className="mt-1 break-words text-text-primary">{application.bankCode} / {application.productCode} / {application.productVariantCode ?? "Legacy"}</p>
                      <p className="mt-1 text-text-secondary">{application.currentStage}{application.terminalOutcome ? ` · ${application.terminalOutcome}` : ""}</p>
                    </article>
                  ))}
                </div>
              </>
            ) : <EmptyState>No visible applications are linked to this customer.</EmptyState>}
          </Card>
        </div>
      ) : null}

      {activeTab === "history" ? (
        <div id="customer-panel-history" role="tabpanel" aria-labelledby="customer-tab-history" className="grid min-w-0 gap-4 xl:grid-cols-2">
          <Card>
            <SectionHeader title="Field history" description="Previous and current customer values preserved by the existing correction workflow." />
            {history?.fields.length ? <HistoryList items={history.fields.map((item) => ({ key: `${item.field}-${item.effectiveFrom}`, title: fieldLabel(item.field), value: displayField(item.value), from: item.effectiveFrom, to: item.effectiveTo }))} /> : <EmptyState>No field history is recorded.</EmptyState>}
          </Card>
          <Card>
            <SectionHeader title="Identifier history" description="Identifier reuse protection retains effective periods for every recorded value." />
            {history?.identifiers.length ? <HistoryList items={history.identifiers.map((item) => ({ key: `${item.kind}-${item.effectiveFrom}`, title: fieldLabel(item.kind), value: item.value, from: item.effectiveFrom, to: item.effectiveTo }))} /> : <EmptyState>No identifier history is recorded.</EmptyState>}
          </Card>
          <Card className="xl:col-span-2">
            <SectionHeader title="Merge history" description="Irreversible source-to-primary relationships remain preserved." />
            {history?.merges.length ? (
              <ul className="mt-3 divide-y divide-brand-border text-sm">
                {history.merges.map((item) => (
                  <li key={`${item.sourceCustomerId}-${item.primaryCustomerId}`} className="min-w-0 py-2 first:pt-0 last:pb-0">
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-text-primary">{item.sourceCustomerCode} merged into primary record</span>
                      <time className="text-xs text-text-secondary">{formatDate(item.mergedAt)}</time>
                    </div>
                    <p className="mt-1 break-all text-xs text-text-secondary">Primary ID: {item.primaryCustomerId}</p>
                  </li>
                ))}
              </ul>
            ) : <EmptyState>No merge history is recorded.</EmptyState>}
          </Card>
        </div>
      ) : null}

      {activeTab === "merge" && can("Customers.Merge") && !merged ? (
        <div id="customer-panel-merge" role="tabpanel" aria-labelledby="customer-tab-merge">
          <Card className="max-w-3xl">
            <SectionHeader title="Merge into a primary customer" description="Use only for a confirmed duplicate. The source code is retired permanently, applications are relinked when safe, and all source history is preserved." />
            <div className="mt-4 grid gap-3">
              <InputField label="Search primary customers" value={otherQuery} onChange={setOtherQuery} placeholder="Customer code, name, company, mobile or identifier" />
              <label className="block min-w-0 text-sm font-medium text-text-primary">
                Primary customer
                <Select className="mt-1" value={primaryId} onChange={(event) => setPrimaryId(event.target.value)} aria-label="Primary customer">
                  <option value="">Select primary customer</option>
                  {others.map((item) => <option key={item.id} value={item.id}>{item.customerCode} — {displayName(item)}</option>)}
                </Select>
              </label>
              {selectedPrimary ? <p className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Selected primary: {selectedPrimary.customerCode} — {displayName(selectedPrimary)}. This operation cannot be reversed.</p> : null}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="danger"
                  disabled={!selectedPrimary}
                  onClick={(event) => {
                    if (!selectedPrimary) return;
                    requestConfirmation(event.currentTarget, {
                      kind: "merge",
                      title: `Merge ${customer.customerCode}?`,
                      description: `${customer.customerCode} will be retired permanently and merged into ${selectedPrimary.customerCode}. Applications will be relinked only if dependency checks pass. This cannot be undone.`,
                      confirmLabel: "Merge permanently",
                      danger: true,
                      path: `/api/v1/customers/${customer.id}/merge`,
                      body: { primary_customer_id: selectedPrimary.id },
                      success: `Customer merged into ${selectedPrimary.customerCode}`,
                    });
                  }}
                >
                  Review permanent merge
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {confirmation ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/40 p-4" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeConfirmation(); }}>
          <section ref={confirmationRef} role="alertdialog" aria-modal="true" aria-labelledby="customer-confirm-title" aria-describedby="customer-confirm-description" className="w-full max-w-md rounded-[10px] border border-brand-border bg-surface p-4 shadow-2xl" onKeyDown={trapConfirmationFocus}>
            <h2 id="customer-confirm-title" className="text-base font-semibold text-text-primary">{confirmation.title}</h2>
            <p id="customer-confirm-description" className="mt-2 text-sm leading-6 text-text-secondary">{confirmation.description}</p>
            {confirmationError ? <div className="mt-3"><ErrorText>{confirmationError}</ErrorText></div> : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" autoFocus disabled={busy} onClick={closeConfirmation}>Cancel</Button>
              <Button type="button" variant={confirmation.danger ? "danger" : "primary"} disabled={busy} onClick={() => void runConfirmed()}>{busy ? "Working…" : confirmation.confirmLabel}</Button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-base font-semibold text-text-primary">{title}</h2><p className="mt-1 text-sm text-text-secondary">{description}</p></div>;
}

function InputField({ label, value, onChange, disabled, placeholder }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; placeholder?: string }) {
  return (
    <label className="block min-w-0 text-sm font-medium text-text-primary">
      {label}
      <TextInput className="mt-1" aria-label={label} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
    </label>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs font-medium text-text-secondary">{label}</dt><dd className="mt-0.5 break-words text-text-primary">{children}</dd></div>;
}

function HistoryList({ items }: { items: Array<{ key: string; title: string; value: string; from: string; to: string | null }> }) {
  return (
    <ul className="mt-3 divide-y divide-brand-border text-sm">
      {items.map((item) => (
        <li key={item.key} className="min-w-0 py-2 first:pt-0 last:pb-0">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <span className="font-medium text-text-primary">{item.title}</span>
            <Badge>{item.to ? "Previous" : "Current"}</Badge>
          </div>
          <p className="mt-1 break-words text-text-primary">{item.value}</p>
          <p className="mt-1 text-xs text-text-secondary">From {formatDate(item.from)}{item.to ? ` to ${formatDate(item.to)}` : ""}</p>
        </li>
      ))}
    </ul>
  );
}
