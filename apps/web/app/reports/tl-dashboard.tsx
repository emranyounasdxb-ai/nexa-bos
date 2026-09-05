"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Button, Card, ErrorText, Field, PageHeader, Select, primaryButtonClass } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import { formatDuration } from "@/lib/duration";
import { formatAed, formatPct, type PersonalPerformance, type PersonalAttendance } from "@/lib/reports";
import { PersonalPerformanceAttendance } from "./personal-dashboard";

type Case = {
  id: string; fileNumber: string; customer: string; caseOwner: string; bank: string; product: string;
  requestedAmount: string | null; routingLabel: string; bankStage: string; bankNumber: string | null;
  tatSeconds: number; delayed: boolean; updatedAt: string; reason: string | null; canReview: boolean;
};
type Bar = { name: string; count: number };
type Payload = {
  office: string; team: string; updatedAt: string; period: string; view: string; queue: string; queueLabel: string;
  cards: Array<{ key: string; label: string; count: number }>;
  items: Case[]; total: number; page: number; pageSize: number; attention: Case[]; returned: Case[];
  charts: Record<"trend" | "ownership" | "review" | "stages" | "products" | "outcomes" | "tat", Bar[]>;
  staff: Array<{ id: string; name: string; applications: number; cc: number; pf: number; submitted: number;
    approved: number; funded: number; conversion: number | null; pendingReview: number;
    target: { assigned: string | null; achieved: string | null; remaining: string | null; achievementPct: number | null; measurement: string | null } }>;
  activity: Array<{ id: string; fileNumber: string; applicationId: string; event: string; at: string; reason: string | null }>;
  personalPerformance: PersonalPerformance; personalAttendance: PersonalAttendance;
};

function Chart({ title, rows, description }: { title: string; rows: Bar[]; description?: string }) {
  const maximum = Math.max(1, ...rows.map(row => row.count));
  return <Card className="min-w-0 p-4"><h2 className="font-semibold text-text-primary">{title}</h2>
    {description && <p className="mt-1 text-xs text-text-secondary">{description}</p>}
    {!rows.length || rows.every(row => row.count === 0) ? <p className="mt-3 text-sm text-text-secondary">No activity for this scope.</p> : null}
    <ul aria-label={title} className="mt-3 space-y-2">{rows.map((row, index) => <li key={`${row.name}-${index}`}>
      <div className="flex min-w-0 justify-between gap-2 text-xs"><span className="break-words">{row.name}</span><span className="font-semibold tabular-nums">{row.count}</span></div>
      <div className="mt-1 h-2 rounded-full bg-surface-subtle" aria-hidden="true"><div className="h-full rounded-full bg-brand-primary" style={{ width: `${row.count / maximum * 100}%` }} /></div>
    </li>)}</ul></Card>;
}

function Cases({ rows }: { rows: Case[] }) {
  return rows.length ? <ul className="grid min-w-0 gap-3 lg:grid-cols-2">{rows.map(item => <li key={item.id} className="min-w-0 rounded-lg border border-brand-border p-3">
    <div className="flex flex-wrap justify-between gap-2"><Link className="break-all font-semibold text-brand-link hover:underline" href={`/applications/${item.id}`}>{item.fileNumber}</Link><Badge>{item.routingLabel}</Badge></div>
    <dl className="mt-2 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-xs">{[
      ["Customer", item.customer], ["Case owner", item.caseOwner], ["Bank / Product", `${item.bank} · ${item.product}`],
      ["Requested amount", formatAed(item.requestedAmount)], ["Bank stage", item.bankStage], ["Bank number", item.bankNumber ?? "Not assigned"],
      ["TAT", `${formatDuration(item.tatSeconds)}${item.delayed ? " · Delayed" : ""}`], ["Updated", new Date(item.updatedAt).toLocaleString()],
    ].map(([label, value]) => <div className="min-w-0" key={label}><dt className="text-text-secondary">{label}</dt><dd className="break-words font-medium text-text-primary">{value}</dd></div>)}</dl>
    {item.reason && <p className="mt-2 break-words text-sm text-text-secondary">Return reason: {item.reason}</p>}
    <Link href={`/applications/${item.id}`} className="mt-3 inline-flex text-sm font-semibold text-brand-link hover:underline">{item.canReview ? "Review Application" : "Open Application"}</Link>
  </li>)}</ul> : <p className="py-4 text-sm text-text-secondary">No Applications in this queue.</p>;
}

export function TlDashboard() {
  const { can } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const queueHeading = useRef<HTMLHeadingElement>(null);
  const period = ["today", "mtd", "previous_month", "ytd"].includes(search.get("period") ?? "") ? search.get("period")! : "mtd";
  const view = ["own", "team", "combined"].includes(search.get("view") ?? "") ? search.get("view")! : "combined";
  const queue = search.get("queue") || "pending_review";
  const page = Math.max(1, Number(search.get("page")) || 1);
  const query = new URLSearchParams({ period, view, queue, page: String(page) }).toString();
  useEffect(() => {
    let active = true;
    apiGet<Payload>(`/api/v1/reports/tl-dashboard?${query}`, getBrowserApiUrl())
      .then(result => { if (active) { setData(result); setError(""); } })
      .catch((failure: unknown) => { if (active) { setData(null); setError(failure instanceof Error ? failure.message : "Unable to load TL dashboard."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, reload]);
  function navigate(changes: Record<string, string>) {
    setLoading(true);
    const next = new URLSearchParams({ period, view, queue, page: "1", ...changes });
    router.push(`/reports?${next}`, { scroll: false });
  }
  return <section className="min-w-0 space-y-4" data-testid="tl-dashboard" aria-busy={loading}>
    <h2 className="text-xl font-semibold tracking-tight text-text-primary">Team Leader Dashboard</h2>
    <PageHeader title="Team Leader Dashboard" description={`${data?.office ?? "Loading office…"} · ${data?.team ?? "Loading team…"} · My Team`} actions={can("Applications.Create") ? <Link className={primaryButtonClass} href="/applications?create=true">Create Application</Link> : undefined} />
    <Card className="flex min-w-0 flex-wrap items-end gap-3 p-3">
      <Field label="Review period"><Select aria-label="Review period" value={period} onChange={e => navigate({ period: e.target.value })}><option value="today">Today</option><option value="mtd">This Month</option><option value="previous_month">Last Month</option><option value="ytd">YTD</option></Select></Field>
      <Field label="Case scope"><Select aria-label="Case scope" value={view} onChange={e => navigate({ view: e.target.value })}><option value="own">My Cases</option><option value="team">Team Cases</option><option value="combined">Combined</option></Select></Field>
      <Button variant="secondary" disabled={loading} onClick={() => { setLoading(true); setReload(value => value + 1); }}>Refresh</Button>
      <p className="text-xs text-text-secondary" role="status">{loading ? "Updating dashboard…" : data ? `Updated ${new Date(data.updatedAt).toLocaleTimeString()}` : "Dashboard unavailable"}</p>
    </Card>
    <ErrorText>{error}</ErrorText>
    {data && <>
      <div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4" data-testid="tl-cards">{data.cards.map(card => <button type="button" key={card.key} aria-label={`${card.label} queue`} aria-pressed={queue === card.key} onClick={() => { navigate({ queue: card.key }); queueHeading.current?.focus(); }} className={`min-w-0 rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-brand-primary ${queue === card.key ? "border-brand-primary bg-brand-soft" : "border-brand-border bg-surface"}`}>
        <span className="block text-xs font-medium text-text-secondary">{card.label}</span><span className="mt-1 block text-2xl font-semibold text-text-primary">{card.count}</span>
      </button>)}</div>
      <Card className="min-w-0 p-4"><div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h2 ref={queueHeading} tabIndex={-1} className="font-semibold text-text-primary">{data.queueLabel} · Review queue</h2><p className="mt-1 text-xs text-text-secondary">Open review work spans all dates. Submitted, approved and completed activity uses the selected period. Ownership never changes during review.</p></div>
        <Button variant="secondary" onClick={() => navigate({ queue: "all" })}>All period cases</Button></div>
        <Cases rows={data.items} /><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span>{data.total} cases · Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</span><div className="flex gap-2"><Button variant="secondary" disabled={loading || page <= 1} onClick={() => navigate({ page: String(page - 1) })}>Previous</Button><Button variant="secondary" disabled={loading || page * data.pageSize >= data.total} onClick={() => navigate({ page: String(page + 1) })}>Next</Button></div></div>
      </Card>
      <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Chart title="Applications trend" rows={data.charts.trend} description="Created Applications over the last six months." />
        <Chart title="My vs Team" rows={data.charts.ownership} /><Chart title="Internal Review tracker" rows={data.charts.review} description="Current review funnel; internal routing does not change bank stages." />
        <Chart title="Bank Stage tracker" rows={data.charts.stages} description="Configured stages for this team's Application workflows." /><Chart title="Product mix" rows={data.charts.products} /><Chart title="Outcomes" rows={data.charts.outcomes} />
        <Chart title="TAT and delays" rows={data.charts.tat} description="Recorded delay status, not an inferred SLA. Per-case elapsed TAT appears in the queue." />
      </div>
      <section data-testid="tl-team-performance"><Card className="min-w-0 p-4"><h2 className="font-semibold text-text-primary">Team target progress & performance</h2><p className="mt-1 text-xs text-text-secondary">Only SEs directly assigned to your team. Mixed target units are never added together.</p>
        {!data.staff.length && <p className="mt-3 text-sm text-text-secondary">No SEs assigned to this team.</p>}
        <div className="mt-3 hidden xl:block"><table className="w-full table-fixed text-left text-xs"><caption className="sr-only">Assigned SE performance for the selected period</caption><thead><tr>{["SE", "Assigned", "Achieved", "Remaining", "Progress", "Cases", "CC / PF", "Submitted", "Approved", "Funded", "Conversion", "Review"].map(label => <th key={label} scope="col" className="break-words border-b border-brand-border px-1 py-2 text-[10px] font-semibold text-text-secondary">{label}</th>)}</tr></thead><tbody>{data.staff.map(staff => <tr key={staff.id} className="border-b border-brand-border align-top">
          <th scope="row" className="break-words px-1 py-3 font-medium">{staff.name}</th>
          {[staff.target.assigned, staff.target.achieved, staff.target.remaining].map((value, index) => <td key={index} className="break-words px-1 py-3 tabular-nums">{value ?? "—"}{value && staff.target.measurement === "amount" ? <span className="block text-[10px] text-text-secondary">AED</span> : null}</td>)}
          <td className="px-1 py-3">{formatPct(staff.target.achievementPct)}{staff.target.achievementPct !== null && <progress className="h-2 w-full accent-brand-primary" aria-label={`${staff.name} target progress`} max={100} value={Math.min(100, staff.target.achievementPct)} />}</td>
          {[staff.applications, `${staff.cc} / ${staff.pf}`, staff.submitted, staff.approved, staff.funded, formatPct(staff.conversion), staff.pendingReview].map((value, index) => <td key={index} className="break-words px-1 py-3 tabular-nums">{value}</td>)}
        </tr>)}</tbody></table></div>
        <ul className="mt-3 grid min-w-0 gap-3 md:grid-cols-2 xl:hidden">{data.staff.map(staff => <li key={staff.id} className="min-w-0 rounded-lg border border-brand-border p-3"><h3 className="break-words font-semibold">{staff.name}</h3>
          <p className="mt-1 text-xs">Target: {staff.target.assigned ?? "Not assigned"} · Achieved: {staff.target.achieved ?? "—"} · Remaining: {staff.target.remaining ?? "—"}{staff.target.measurement === "amount" ? " AED" : ""}</p>
          {staff.target.achievementPct !== null && <><progress className="mt-2 h-2 w-full accent-brand-primary" max={100} value={Math.min(100, staff.target.achievementPct)} aria-label={`${staff.name} target achievement`} /><p className="text-xs">{formatPct(staff.target.achievementPct)} achieved</p></>}
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">{[["Applications", staff.applications], ["CC / PF", `${staff.cc} / ${staff.pf}`], ["Submitted", staff.submitted], ["Approved", staff.approved], ["Funded", staff.funded], ["Conversion", formatPct(staff.conversion)], ["Pending review", staff.pendingReview]].map(([name, value]) => <div key={name}><dt className="text-text-secondary">{name}</dt><dd className="font-semibold">{value}</dd></div>)}</dl>
        </li>)}</ul>
      </Card></section>
      <Card className="min-w-0 p-4"><h2 className="mb-3 font-semibold">Attention Required</h2><Cases rows={data.attention} /></Card>
      <Card className="min-w-0 p-4"><h2 className="mb-3 font-semibold">Returned · Awaiting correction</h2><Cases rows={data.returned} /></Card>
      <Card className="min-w-0 p-4"><h2 className="font-semibold">Recent team activity</h2>{!data.activity.length && <p className="mt-3 text-sm text-text-secondary">No recorded activity.</p>}<ol className="mt-3 divide-y divide-brand-border">{data.activity.map(event => <li key={event.id} className="min-w-0 py-2 text-sm"><Link className="break-all font-semibold text-brand-link" href={`/applications/${event.applicationId}`}>{event.fileNumber}</Link><p className="break-words">{event.event.replaceAll("_", " ")}{event.reason ? ` · ${event.reason}` : ""}</p><time className="text-xs text-text-secondary">{new Date(event.at).toLocaleString()}</time></li>)}</ol></Card>
      <PersonalPerformanceAttendance performance={data.personalPerformance} attendance={data.personalAttendance} />
    </>}
  </section>;
}
