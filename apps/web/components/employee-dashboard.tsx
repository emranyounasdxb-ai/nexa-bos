"use client";

import styles from "./employee-dashboard.module.css";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { IconRefresh } from "@/components/icons";
import { HrWorkflowSummary } from "@/components/hr-workflow-summary";
import { Pagination, SERVER_PAGE_SIZE_OPTIONS, type ServerPageSize } from "@/components/pagination";
import { Button, Card, EmptyState, ErrorText, Field, LoadingState, PageHeader, SectionHeader, Select, StatusBadge, TextInput } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";
import { formatLocalDateTime, formatStatusLabel, humanizeTechnicalLabel } from "@/lib/presentation";

type Breakdown = { label: string; count: number };
type HrDashboard = {
  generatedAt: string;
  cards: Record<string, number>;
  breakdowns: Record<string, Breakdown[]>;
  newJoiners: { id: string; name: string; employeeCode: string; joiningDate: string }[];
  probation: { id: string; name: string; endDate: string | null; state: string }[];
  pendingActions: { id: string; name: string; completion: { state: string; missing: string[] } }[];
  recentActivity: { id: string; actor: string; action: string; employee: string; createdAt: string }[];
};
type Expiry = { employeeId: string; employee: string; label: string; expiryDate: string; remainingDays: number; status: string };
type ProDashboard = {
  generatedAt: string;
  cards: Record<string, number>;
  compliance: { employeeId: string; employee: string; documents: Record<string, { status: string; documentId: string | null; expiryDate: string | null }> }[];
  compliancePagination: { page: number; pageSize: ServerPageSize; total: number; totalPages: number };
  expiry: { within7: Expiry[]; within30: Expiry[]; within60: Expiry[]; expired: Expiry[] };
};

const cardLabels: Record<string, string> = {
  totalEmployees: "Total Employees", activeEmployees: "Active Employees", onProbation: "On Probation",
  newJoiners: "New Joiners", pendingHrActions: "Pending HR Actions", documentsActive: "Documents Active",
  expiringSoon: "Expiring Soon", expired: "Expired", pendingDocuments: "Pending Documents",
};

const documentLabels: Record<string, string> = {
  passport: "Passport",
  visa: "Visa",
  emirates_id: "Emirates ID",
};

function titleCaseLabel(value: string) {
  return humanizeTechnicalLabel(value)
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bHr\b/g, "HR");
}

function MetricCards({ cards }: { cards: Record<string, number> }) {
  return <dl className={styles.metrics}>{Object.entries(cards).map(([key, count]) => <div key={key} className={styles.metric}><dt>{cardLabels[key] ?? key}</dt><dd>{count.toLocaleString()}</dd></div>)}</dl>;
}

export function EmployeeDashboard({ mode }: { mode: "hr" | "pro" }) {
  const [data, setData] = useState<HrDashboard | ProDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [complianceSearch, setComplianceSearch] = useState("");
  const [complianceStatus, setComplianceStatus] = useState("");
  const [compliancePage, setCompliancePage] = useState(1);
  const [compliancePageSize, setCompliancePageSize] = useState<ServerPageSize>(10);
  const handleComplianceSearch = useCallback((value: string) => {
    setComplianceSearch(value);
    setCompliancePage(1);
  }, []);
  const handleComplianceStatus = useCallback((value: string) => {
    setComplianceStatus(value);
    setCompliancePage(1);
  }, []);
  const handleCompliancePageSize = useCallback((value: ServerPageSize) => {
    setCompliancePageSize(value);
    setCompliancePage(1);
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    const params = new URLSearchParams();
    if (mode === "pro") {
      if (complianceSearch) params.set("q", complianceSearch);
      if (complianceStatus) params.set("status", complianceStatus);
      params.set("page", String(compliancePage));
      params.set("pageSize", String(compliancePageSize));
    }
    try { setData(await apiGet(`/api/v1/employee-profiles/dashboards/${mode}${params.size ? `?${params}` : ""}`, getBrowserApiUrl(), { signal })); }
    catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "Dashboard could not be loaded.");
    }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [compliancePage, compliancePageSize, complianceSearch, complianceStatus, mode]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  if (loading && !data) return <LoadingState>Loading {mode.toUpperCase()} dashboard…</LoadingState>;
  if (!data) return <Card><ErrorText>{error}</ErrorText><Button className="mt-3" variant="secondary" onClick={() => void load()}><IconRefresh className="size-4" />Retry</Button></Card>;
  const hr = mode === "hr" ? data as HrDashboard : null;
  const pro = mode === "pro" ? data as ProDashboard : null;
  return <section className="min-w-0 space-y-6">
    <PageHeader description={mode === "hr" ? "Monitor workforce readiness, profile completeness, new joiners and actions requiring HR attention." : "Private employee-document compliance derived from current records."} actions={<Button variant="secondary" onClick={() => void load()} disabled={loading}><IconRefresh className="size-4" />{loading ? "Refreshing…" : "Refresh"}</Button>} title={mode === "hr" ? "HR Dashboard" : "PRO Dashboard"} />
    {error ? <ErrorText>{error}</ErrorText> : null}
    <div className={styles.overview}>
    <MetricCards cards={data.cards} />
    <div className={styles.activity}>
    {hr ? <>
      <HrWorkflowSummary />
      <div className={styles.attention}><ListCard previewLimit={5} collapsible title="Pending HR Actions" items={hr.pendingActions.map((row) => ({ id: row.id, name: row.name, detail: row.completion.missing.join(", ") }))} /><ListCard title="New Joiners" items={hr.newJoiners.map((row) => ({ id: row.id, name: row.name, detail: `${row.employeeCode} · ${row.joiningDate}` }))} /><ListCard title="Probation Tracking" items={hr.probation.map((row) => ({ id: row.id, name: row.name, detail: `${row.state} · ${row.endDate ?? "End date missing"}` }))} /></div>
      <ProfileCompleteness breakdowns={hr.breakdowns} />
      <RecentActivityCard rows={hr.recentActivity} />
    </> : null}
    {pro ? <>
      <ComplianceCard
        rows={pro.compliance}
        pagination={pro.compliancePagination}
        search={complianceSearch}
        status={complianceStatus}
        onSearch={handleComplianceSearch}
        onStatus={handleComplianceStatus}
        onPage={setCompliancePage}
        onPageSize={handleCompliancePageSize}
      />
      <div className="grid min-w-0 gap-4 lg:grid-cols-2"><ExpiryCard title="Expiring In 7 Days" rows={pro.expiry.within7} /><ExpiryCard title="Expiring In 30 Days" rows={pro.expiry.within30} /><ExpiryCard title="Expiring In 60 Days" rows={pro.expiry.within60} /><ExpiryCard title="Expired" rows={pro.expiry.expired} /></div>
    </> : null}
    </div>
    </div>
  </section>;
}

function ComplianceCard({ rows, pagination, search, status, onSearch, onStatus, onPage, onPageSize }: {
  rows: ProDashboard["compliance"];
  pagination: ProDashboard["compliancePagination"];
  search: string;
  status: string;
  onSearch: (value: string) => void;
  onStatus: (value: string) => void;
  onPage: (value: number) => void;
  onPageSize: (value: ServerPageSize) => void;
}) {
  const [searchDraft, setSearchDraft] = useState(search);
  useEffect(() => {
    const timer = window.setTimeout(() => onSearch(searchDraft.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [onSearch, searchDraft]);

  return <Card>
    <SectionHeader title="Employee Compliance" description="Required Passport, Visa, Emirates ID, Work Permit, Medical and Insurance records." />
    {rows.length || search || status ? <>
      <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,.45fr)]">
        <Field label="Search employees"><TextInput aria-label="Search employee compliance" placeholder="Search by employee name" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /></Field>
        <Field label="Document status"><Select aria-label="Compliance status" value={status} onChange={(event) => onStatus(event.target.value)}><option value="">All statuses</option><option value="Active">Active</option><option value="Expiring Soon">Expiring Soon</option><option value="Expired">Expired</option><option value="Missing">Missing</option></Select></Field>
      </div>
      <p className="mt-3 text-xs text-text-secondary" aria-live="polite">{pagination.total.toLocaleString()} matching employee{pagination.total === 1 ? "" : "s"}</p>
      {rows.length ? <div data-testid="employee-compliance-list" className="mt-3 grid gap-3 lg:grid-cols-2">{rows.map((row) => <article key={row.employeeId} className="rounded-lg border border-brand-border p-3"><Link href={`/users/${row.employeeId}?tab=pro`} className="text-sm font-semibold text-brand-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary">{row.employee}</Link><div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(row.documents).map(([kind, document]) => { const label = documentLabels[kind] ?? titleCaseLabel(kind); return <Link key={kind} href={`/users/${row.employeeId}?tab=pro${document.documentId ? `&document=${document.documentId}` : ""}`} aria-label={`${row.employee} ${label} ${document.status}`}><StatusBadge value={`${label}: ${formatStatusLabel(document.status)}`} /></Link>; })}</div></article>)}</div> : <EmptyState kind="search" title="No records match the selected filters" action={<Button type="button" variant="secondary" size="compact" onClick={() => { setSearchDraft(""); onSearch(""); onStatus(""); }}>Clear filters</Button>} />}
      <Pagination page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages} pageSizeOptions={SERVER_PAGE_SIZE_OPTIONS} onPageChange={onPage} onPageSizeChange={(value) => { if (value !== "all") onPageSize(value); }} />
    </> : <EmptyState>No employees are visible in the current scope.</EmptyState>}
  </Card>;
}

function ListCard({ title, items, collapsible = false, previewLimit }: { title: string; items: { id: string; name: string; detail: string }[]; collapsible?: boolean; previewLimit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = previewLimit && !expanded ? items.slice(0, previewLimit) : items;
  return <Card><SectionHeader title={title} />{items.length ? <><ul aria-label={title} className="mt-2 divide-y divide-slate-100">{visibleItems.map((row) => <li key={row.id} className="py-2"><Link className="text-sm font-medium text-brand-primary hover:underline" href={`/users/${row.id}?tab=hr`}>{row.name}</Link>{collapsible ? <details className="mt-1 text-xs text-text-secondary"><summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-brand-primary">Review missing fields</summary><p className="mt-2 rounded-lg bg-surface-subtle p-2.5">{row.detail}</p></details> : <p className="text-xs text-text-secondary">{row.detail}</p>}</li>)}</ul>{previewLimit && items.length > previewLimit ? <Button type="button" variant="ghost" size="compact" className="mt-2" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? "Show Fewer" : `View All (${items.length})`}</Button> : null}</> : <EmptyState>Nothing requires attention.</EmptyState>}</Card>;
}

function ProfileCompleteness({ breakdowns }: { breakdowns: HrDashboard["breakdowns"] }) {
  const summaries = Object.entries(breakdowns).map(([key, rows]) => {
    const missing = rows.find((row) => row.label.trim().toLowerCase() === "not recorded")?.count ?? 0;
    const recordedRows = rows.filter((row) => row.label.trim().toLowerCase() !== "not recorded");
    const recorded = recordedRows.reduce((total, row) => total + row.count, 0);
    return { key, label: titleCaseLabel(key), missing, recorded, recordedRows };
  });
  return <Card><SectionHeader title="Profile Data Completeness" description="A concise view of recorded and missing workforce profile information." />{summaries.length ? <ul className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">{summaries.map((summary) => <li key={summary.key} className="rounded-lg border border-brand-border bg-surface-subtle p-3"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-text-primary">{summary.label}</span><span className="text-xs tabular-nums text-text-secondary">{summary.recorded} complete · {summary.missing} missing</span></div>{summary.recordedRows.length ? <details className="mt-2 text-xs text-text-secondary"><summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-brand-primary">View Recorded Breakdown</summary><ul className="mt-2 space-y-1">{summary.recordedRows.map((row) => <li key={row.label} className="flex justify-between gap-3"><span>{row.label}</span><strong>{row.count}</strong></li>)}</ul></details> : null}</li>)}</ul> : <EmptyState title="—" description="No data yet" />}</Card>;
}

function RecentActivityCard({ rows }: { rows: HrDashboard["recentActivity"] }) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? rows : rows.slice(0, 6);
  return <Card><SectionHeader title="Recent HR Activity" />{rows.length ? <><ul className="mt-2 divide-y divide-slate-100">{visibleRows.map((row) => <li key={row.id} className="py-2 text-sm"><strong>{row.actor}</strong> · {humanizeTechnicalLabel(row.action)} · {row.employee}<span className="block text-xs text-text-secondary">{formatLocalDateTime(row.createdAt)}</span></li>)}</ul>{rows.length > 6 ? <Button type="button" variant="ghost" size="compact" className="mt-2" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? "Show Fewer" : `View All (${rows.length})`}</Button> : null}</> : <EmptyState>No recent HR profile activity.</EmptyState>}</Card>;
}
function ExpiryCard({ title, rows }: { title: string; rows: Expiry[] }) {
  return <Card><SectionHeader title={title} />{rows.length ? <ul className="mt-3 divide-y divide-slate-100">{rows.map((row) => <li key={`${row.employeeId}-${row.label}`}><Link href={`/users/${row.employeeId}?tab=pro`} className="text-sm font-medium text-brand-primary hover:underline">{row.employee} · {row.label}</Link><p className="text-xs text-text-secondary">{row.expiryDate} · {row.remainingDays} days</p></li>)}</ul> : <EmptyState>No matching documents.</EmptyState>}</Card>;
}
