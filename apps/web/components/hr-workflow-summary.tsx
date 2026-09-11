"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, ErrorText, LoadingState, SectionHeader } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";

type Personal = { balances: { leaveType: { name: string }; available: number; pending: number }[] | null; requests: { id: string; status: string; startDate: string; endDate: string }[]; contract: { id: string; contractNumber: string; status: string; startDate: string; endDate: string | null } | null; transfers: { id: string; status: string }[]; exits: { id: string; status: string }[] };
const labels: Record<string, string> = { onLeave: "On leave today", pendingApprovals: "Pending approval steps", expiringContracts: "Contracts expiring in 90 days", transfersInProgress: "Transfers in progress", exitsInProgress: "Exits in progress" };

export function HrWorkflowSummary({ personal = false }: { personal?: boolean }) {
  const { can } = useAuth(); const allowed = personal ? can("Leave.View") || can("Contracts.ViewOwn") || can("Transfers.ViewOwn") || can("Exits.ViewOwn") : can("Approvals.View");
  const [data, setData] = useState<Personal | Record<string, number> | null>(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { if (!allowed) return; setLoading(true); setError(""); try { setData(await apiGet(`/api/v1/approvals/${personal ? "me" : "dashboard"}`, getBrowserApiUrl())); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load HR summary"); } finally { setLoading(false); } }, [allowed, personal]);
  useEffect(() => { void load(); }, [load]);
  if (!allowed) return null;
  const own = personal ? data as Personal | null : null;
  return <Card className="min-w-0"><SectionHeader title={personal ? "My HR requests & contract" : "HR workflows"} actions={<Button variant="secondary" disabled={loading} onClick={() => void load()}>Refresh HR summary</Button>} />{error ? <ErrorText>{error}</ErrorText> : !data ? <LoadingState>Loading HR summary…</LoadingState> : own ? <div className="mt-3 space-y-3">
    {can("Leave.View") && <><h3 className="text-base font-semibold">My leave balances</h3>{own.balances?.length ? <ul className="grid gap-2 sm:grid-cols-2">{own.balances.map((balance, index) => <li key={index} className="text-sm"><strong>{balance.leaveType.name}</strong> · {balance.available} days available · {balance.pending} pending</li>)}</ul> : <EmptyState>No configured leave balance.</EmptyState>}<details><summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2">My leave requests ({own.requests.length})</summary>{own.requests.length ? <ul className="mt-2 space-y-2">{own.requests.map(row => <li className="text-sm" key={row.id}>{row.startDate}–{row.endDate} · {row.status}</li>)}</ul> : <EmptyState>No leave requests.</EmptyState>}<Link className="text-sm text-brand-primary underline" href="/leave">Open my leave</Link></details></>}
    {can("Contracts.ViewOwn") && <div><h3 className="text-base font-semibold">My active contract</h3>{own.contract ? <p className="text-sm">{own.contract.contractNumber} · {own.contract.status} · {own.contract.startDate}–{own.contract.endDate ?? "No end date"}</p> : <p className="text-sm text-text-secondary">No active contract is available.</p>}<Link className="text-sm text-brand-primary underline" href="/contracts">Open my contract</Link></div>}
    {(["transfers", "exits"] as const).map(key => can(key === "transfers" ? "Transfers.ViewOwn" : "Exits.ViewOwn") && <details key={key}><summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2">My {key} ({own[key].length})</summary>{own[key].length ? <ul className="mt-2 text-sm">{own[key].map(row => <li key={row.id}>{row.status}</li>)}</ul> : <EmptyState>No {key} recorded.</EmptyState>}<Link className="text-sm text-brand-primary underline" href={`/${key}`}>Open my {key}</Link></details>)}
  </div> : <><dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">{Object.entries(data).map(([key, value]) => <div key={key}><dt className="text-xs text-text-secondary">{labels[key]}</dt><dd className="mt-1 text-3xl font-semibold tabular-nums">{value as number}</dd></div>)}</dl><Link className="mt-3 inline-block text-sm text-brand-primary underline" href="/approvals">Open Approval Centre</Link><p className="mt-2 text-xs text-text-secondary">Current authorized records; overdue means the request/effective date has passed, not an invented service-level deadline.</p></>}</Card>;
}
