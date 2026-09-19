import Link from "next/link";
import { Badge, EmptyState, TableHead, TableShell, Td, Th } from "@/components/ui";
import type { ApplicationRecord } from "@/lib/types";
import { caseAmount, caseDate, caseStage, caseTone, type CaseReview } from "./admin-case-presentation";

export function AdminCaseList({ items, reviews, loading }: { items: ApplicationRecord[]; reviews: Record<string, CaseReview>; loading: boolean }) {
  const empty = <EmptyState>{loading ? "Loading cases…" : "No cases match your current view."}</EmptyState>;
  const product = (item: ApplicationRecord) => <><p>{item.bankName ?? "Not recorded"}</p><p className="text-xs text-text-secondary">{[item.productName, item.productVariantName].filter(Boolean).join(" · ") || "Not recorded"}</p></>;
  const assigned = (item: ApplicationRecord) => (item.submitted || item.routingStatus === "sm_approved" ? item.routedCoordinatorName ?? reviews[item.id]?.tlName : reviews[item.id]?.tlName ?? item.routedCoordinatorName) ?? "Not assigned";
  return <>
    <div className="hidden lg:block"><TableShell aria-label="My Cases" headerTone="bright"><TableHead><tr>{["Case ID", "Customer", "Product", "Amount", "Stage", "Assigned To", "Last Updated", "Action"].map(label => <Th key={label}>{label}</Th>)}</tr></TableHead><tbody>
      {!items.length ? <tr><td colSpan={8}>{empty}</td></tr> : items.map(item => {
        const stage = caseStage(item, reviews[item.id]);
        return <tr key={item.id} className="border-t border-brand-border">
          <Td><Link className="whitespace-nowrap font-semibold text-brand-link" href={`/applications/${item.id}`}>{item.applicationCode}</Link></Td>
          <Td><p>{item.customerName}</p><p className="text-xs text-text-secondary">{item.customerCode}</p></Td><Td>{product(item)}</Td>
          <Td><span className="whitespace-nowrap tabular-nums">{caseAmount(item.requestedAmount)}</span></Td>
          <Td><Badge tone={caseTone(stage)}>{stage}</Badge></Td><Td>{assigned(item)}</Td><Td><span className="whitespace-nowrap">{caseDate(item.updatedAt)}</span></Td>
          <Td><Link className="whitespace-nowrap font-medium text-brand-link" href={`/applications/${item.id}`}>View Case</Link></Td>
        </tr>;
      })}
    </tbody></TableShell></div>
    <div className="grid min-w-0 gap-3 p-3 sm:grid-cols-2 lg:hidden">{!items.length ? empty : items.map(item => {
      const stage = caseStage(item, reviews[item.id]);
      return <article key={item.id} className="min-w-0 rounded-xl border border-brand-border bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><Link className="font-semibold text-brand-link" href={`/applications/${item.id}`}>{item.applicationCode}</Link><Badge tone={caseTone(stage)}>{stage}</Badge></div>
        <p className="mt-2 font-medium">{item.customerName} <span className="text-xs text-text-secondary">{item.customerCode}</span></p><div className="mt-1">{product(item)}</div>
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm"><dt className="text-text-secondary">Amount</dt><dd>{caseAmount(item.requestedAmount)}</dd><dt className="text-text-secondary">Assigned to</dt><dd>{assigned(item)}</dd><dt className="text-text-secondary">Updated</dt><dd>{caseDate(item.updatedAt)}</dd></dl>
        <Link className="mt-3 inline-block font-medium text-brand-link" href={`/applications/${item.id}`}>View Case →</Link>
      </article>;
    })}</div>
  </>;
}
