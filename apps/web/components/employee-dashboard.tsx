"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { IconRefresh } from "@/components/icons";
import { Button, Card, EmptyState, ErrorText, LoadingState, PageHeader, SectionHeader, StatusBadge } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";

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
  expiry: { within7: Expiry[]; within30: Expiry[]; within60: Expiry[]; expired: Expiry[] };
};

const cardLabels: Record<string, string> = {
  totalEmployees: "Total Employees", activeEmployees: "Active Employees", onProbation: "On Probation",
  newJoiners: "New Joiners", pendingHrActions: "Pending HR Actions", documentsActive: "Documents Active",
  expiringSoon: "Expiring Soon", expired: "Expired", pendingDocuments: "Pending Documents",
};

function MetricCards({ cards }: { cards: Record<string, number> }) {
  return <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-5">{Object.entries(cards).map(([key, count]) => <Card key={key} className="!p-3"><p className="text-xs font-medium text-text-secondary">{cardLabels[key] ?? key}</p><p className="mt-2 text-3xl font-semibold tabular-nums text-text-primary">{count.toLocaleString()}</p></Card>)}</div>;
}

export function EmployeeDashboard({ mode }: { mode: "hr" | "pro" }) {
  const [data, setData] = useState<HrDashboard | ProDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await apiGet(`/api/v1/employee-profiles/dashboards/${mode}`, getBrowserApiUrl())); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Dashboard could not be loaded."); }
    finally { setLoading(false); }
  }, [mode]);
  useEffect(() => { void load(); }, [load]);
  if (loading && !data) return <LoadingState>Loading {mode.toUpperCase()} dashboard…</LoadingState>;
  if (!data) return <Card><ErrorText>{error}</ErrorText><Button className="mt-3" variant="secondary" onClick={() => void load()}><IconRefresh className="size-4" />Retry</Button></Card>;
  const hr = mode === "hr" ? data as HrDashboard : null;
  const pro = mode === "pro" ? data as ProDashboard : null;
  return <section className="min-w-0 space-y-4">
    <PageHeader description={mode === "hr" ? "Implemented employee-profile completion, workforce and probation work only." : "Private employee-document compliance derived from current records."} actions={<Button variant="secondary" onClick={() => void load()} disabled={loading}><IconRefresh className="size-4" />{loading ? "Refreshing…" : "Refresh"}</Button>} title={mode === "hr" ? "HR Dashboard" : "PRO Dashboard"} />
    {error ? <ErrorText>{error}</ErrorText> : null}<MetricCards cards={data.cards} />
    {hr ? <>
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">{Object.entries(hr.breakdowns).map(([key, rows]) => <Card key={key}><SectionHeader title={`${key.replace(/([A-Z])/g, " $1").trim()} breakdown`} />{rows.length ? <ul className="mt-3 space-y-2">{rows.map((row) => <li key={row.label} className="flex justify-between gap-3 text-sm"><span>{row.label}</span><strong>{row.count}</strong></li>)}</ul> : <EmptyState>No data is recorded.</EmptyState>}</Card>)}</div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-3"><ListCard title="New joiners" items={hr.newJoiners.map((row) => ({ id: row.id, name: row.name, detail: `${row.employeeCode} · ${row.joiningDate}` }))} /><ListCard title="Probation tracking" items={hr.probation.map((row) => ({ id: row.id, name: row.name, detail: `${row.state} · ${row.endDate ?? "End date missing"}` }))} /><ListCard title="Pending HR actions" items={hr.pendingActions.map((row) => ({ id: row.id, name: row.name, detail: row.completion.missing.join(", ") }))} /></div>
      <Card><SectionHeader title="Recent HR activity" />{hr.recentActivity.length ? <ul className="mt-3 space-y-2">{hr.recentActivity.map((row) => <li key={row.id} className="text-sm"><strong>{row.actor}</strong> · {row.action} · {row.employee}<span className="block text-xs text-text-secondary">{new Date(row.createdAt).toLocaleString("en-AE")}</span></li>)}</ul> : <EmptyState>No recent HR profile activity.</EmptyState>}</Card>
    </> : null}
    {pro ? <>
      <Card><SectionHeader title="Employee compliance" description="Required Passport, Visa, Emirates ID, Work Permit, Medical and Insurance records." />{pro.compliance.length ? <div className="mt-3 grid gap-3 lg:grid-cols-2">{pro.compliance.map((row) => <article key={row.employeeId} className="rounded-lg border border-brand-border p-3"><Link href={`/users/${row.employeeId}?tab=pro`} className="text-sm font-semibold text-brand-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary">{row.employee}</Link><div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(row.documents).map(([kind, document]) => <Link key={kind} href={`/users/${row.employeeId}?tab=pro${document.documentId ? `&document=${document.documentId}` : ""}`} aria-label={`${row.employee} ${kind.replaceAll("_", " ")} ${document.status}`}><StatusBadge value={`${kind.replaceAll("_", " ")}: ${document.status}`} /></Link>)}</div></article>)}</div> : <EmptyState>No employees are visible in the current scope.</EmptyState>}</Card>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2"><ExpiryCard title="Expiring in 7 days" rows={pro.expiry.within7} /><ExpiryCard title="Expiring in 30 days" rows={pro.expiry.within30} /><ExpiryCard title="Expiring in 60 days" rows={pro.expiry.within60} /><ExpiryCard title="Expired" rows={pro.expiry.expired} /></div>
    </> : null}
  </section>;
}

function ListCard({ title, items }: { title: string; items: { id: string; name: string; detail: string }[] }) {
  return <Card><SectionHeader title={title} />{items.length ? <ul className="mt-3 space-y-2">{items.map((row) => <li key={row.id}><Link className="text-sm font-medium text-brand-primary hover:underline" href={`/users/${row.id}?tab=hr`}>{row.name}</Link><p className="text-xs text-text-secondary">{row.detail}</p></li>)}</ul> : <EmptyState>Nothing requires attention.</EmptyState>}</Card>;
}
function ExpiryCard({ title, rows }: { title: string; rows: Expiry[] }) {
  return <Card><SectionHeader title={title} />{rows.length ? <ul className="mt-3 space-y-2">{rows.map((row) => <li key={`${row.employeeId}-${row.label}`}><Link href={`/users/${row.employeeId}?tab=pro`} className="text-sm font-medium text-brand-primary hover:underline">{row.employee} · {row.label}</Link><p className="text-xs text-text-secondary">{row.expiryDate} · {row.remainingDays} days</p></li>)}</ul> : <EmptyState>No matching documents.</EmptyState>}</Card>;
}
