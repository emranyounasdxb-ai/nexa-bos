"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, ErrorText, PageHeader } from "@/components/ui";
import { ApplicationInternalReview, type InternalReview } from "@/components/application-internal-review";
import type { ApplicationEventRecord, ApplicationRecord } from "@/lib/types";
import { caseAmount, caseDate, caseStage, caseTone } from "./admin-case-presentation";

const eventLabels: Record<string, string> = {
  created: "Case Created", application_created: "Case Created", internal_review_started: "TL review requested",
  internal_booked: "TL Review Completed", internal_forwarded: "TL Review Completed", internal_sm_approved: "Manager Approval Completed",
  internal_returned: "Returned for correction", internal_resubmitted: "Sent for TL Review", submitted: "Bank Submission",
  stage_updated: "Progress updated", stage_changed: "Progress updated", completed: "Final Outcome", outcome_set: "Final Outcome",
  submission: "Bank Submission", stage_moved: "Progress updated", stage_corrected: "Progress corrected",
  returned_requirement_pending: "Additional information requested", resubmission: "Resubmitted to bank", approval: "Approved", booking: "Booked", fund_release: "Funded", final_rejected: "Rejected", cancelled: "Cancelled", withdrawn: "Withdrawn",
  case_owner_reassigned: "Assignment updated", submitted_data_corrected: "Case information corrected", case_number_corrected: "Bank reference updated", workflow_migrated: "Case process updated", customer_relinked: "Customer updated", delay_marked: "Follow-up required", delay_resolved: "Follow-up resolved",
  corrected: "Case updated", updated: "Case updated",
};
export function AdminCaseDetails({ item, review, events, error, onSaved }: {
  item: ApplicationRecord; review: InternalReview | null; events: ApplicationEventRecord[]; error: string; onSaved: (message: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<"Overview" | "Progress" | "Activity">("Overview");
  const stage = caseStage(item, review);
  const waiting = Boolean(review && ["pending_review", "resubmitted"].includes(review.status) && !review.tlId && !item.submitted && !item.terminal);
  const ordered = [...events].sort((a, b) => new Date(a.bosUpdatedAt).getTime() - new Date(b.bosUpdatedAt).getTime());
  const eventDate = (...types: string[]) => ordered.find(event => types.includes(event.eventType))?.bosUpdatedAt;
  const tlCompleted = Boolean(eventDate("internal_booked", "internal_forwarded") || (review && ["booked", "forwarded", "sm_approved"].includes(review.status)));
  const managerCompleted = Boolean(item.salesManagerApprovedAt || eventDate("internal_sm_approved"));
  const submitted = Boolean(item.submittedAt || item.submitted);
  const reviewing = Boolean(review && ["returned", "resubmitted", "pending_review"].includes(review.status));
  const current = item.terminal ? 6 : submitted ? 5 : reviewing ? 1 : managerCompleted ? 3 : tlCompleted ? 2 : 1;
  const steps = ["Case Created", "TL Review", "Manager Approval", "Coordinator Processing", "Bank Submission", "Final Outcome"];
  const section = (title: string, values: Array<[string, string]>) => <Card className="min-w-0 p-3"><h2 className="mb-2 font-semibold">{title}</h2><dl className="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">{values.map(([label, value]) => <div key={label} className="contents"><dt className="text-text-secondary">{label}</dt><dd className="min-w-0 break-words font-medium">{value}</dd></div>)}</dl></Card>;
  return <section className="min-w-0 space-y-3">
    <PageHeader title={item.applicationCode} frameTitle={item.applicationCode} description="Case details and progress." actions={<Link className="font-medium text-brand-link" href="/applications">← My Cases</Link>} />
    <Card className="min-w-0 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{item.applicationCode}</strong><Badge tone={caseTone(stage)}>{stage}</Badge></div><dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {[["Customer", `${item.customerName ?? "Not recorded"}${item.customerCode ? ` · ${item.customerCode}` : ""}`], ["Bank / Product", [item.bankName, item.productName, item.productVariantName].filter(Boolean).join(" · ") || "Not recorded"], ["Requested amount", caseAmount(item.requestedAmount)], ["Created", caseDate(item.createdAt)], ["Assigned to", [review?.tlName && `TL: ${review.tlName}`, item.routedCoordinatorName && `Coordinator: ${item.routedCoordinatorName}`].filter(Boolean).join(" · ") || "Not assigned"]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-text-secondary">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value}</dd></div>)}
    </dl></Card>
    {waiting && <div role="status" className="rounded-xl border border-warning-soft bg-warning-soft px-3 py-2 text-sm"><p className="font-semibold">TL assignment required</p><p>This case cannot move to review until a TL is assigned. Contact your administrator.</p></div>}
    {review?.reason && <p className="rounded-xl border border-brand-border bg-surface px-3 py-2 text-sm"><strong>Review note: </strong>{review.reason}</p>}
    {review && review.actions.length > 0 && <ApplicationInternalReview compact applicationId={item.id} state={review} requestedAmount={item.requestedAmount} onSaved={onSaved} />}
    <ErrorText>{error}</ErrorText>
    <div role="tablist" aria-label="Case views" className="flex flex-wrap gap-2 border-b border-brand-border pb-2">{(["Overview", "Progress", "Activity"] as const).map(name => <Button key={name} id={`case-${name}-tab`} role="tab" aria-selected={tab === name} aria-controls="admin-case-panel" size="compact" variant={tab === name ? "primary" : "secondary"} onClick={() => setTab(name)}>{name}</Button>)}</div>
    <div id="admin-case-panel" role="tabpanel" aria-labelledby={`case-${tab}-tab`}>
      {tab === "Overview" && <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {section("Customer", [["Name", item.customerName ?? "Not recorded"], ["Customer code", item.customerCode ?? "Not recorded"], ["Mobile", item.customerMobile ?? "Not recorded"]])}
        {section("Product", [["Bank", item.bankName ?? "Not recorded"], ["Category", item.productName ?? "Not recorded"], ["Variant", item.productVariantName ?? "Not recorded"]])}
        {section("Case values", [["Requested", caseAmount(item.requestedAmount)], ["Approved", caseAmount(item.approvedAmount)], ["Funded", caseAmount(item.fundedAmount)]])}
        {section("Assignment", [["Team leader", review?.tlName ?? "Not assigned"], ["Sales manager", item.routedSalesManagerName ?? "Not assigned"], ["Coordinator", item.routedCoordinatorName ?? "Not assigned"]])}
        {section("Submission", [["Status", submitted ? "Submitted to bank" : "Not submitted"], ["Submission date", item.submittedAt ? caseDate(item.submittedAt) : "Not submitted"], ["Bank reference", item.bankCaseNumber ?? "Not assigned"]])}
        {section("Important dates", [["Created", caseDate(item.createdAt)], ["Last updated", caseDate(item.updatedAt)], ["Approved", caseDate(item.approvedAt)], ["Completed", caseDate(item.completedAt)]])}
      </div>}
      {tab === "Progress" && <Card className="p-3"><h2 className="mb-3 font-semibold">Case progress</h2><ol className="grid gap-0">{steps.map((name, index) => {
        const completed = [true, tlCompleted, managerCompleted, submitted, submitted, item.terminal][index];
        const state = index === current ? "Current" : completed ? "Completed" : item.terminal ? "Not reached" : "Upcoming";
        const at = index === 0 ? item.createdAt : index === 1 ? eventDate("internal_booked", "internal_forwarded") : index === 2 ? item.salesManagerApprovedAt : index === 4 ? item.submittedAt : index === 5 ? item.completedAt : null;
        return <li key={name} aria-current={state === "Current" ? "step" : undefined} className="relative ml-3 min-w-0 border-l border-brand-border pb-4 pl-5 last:border-l-0 last:pb-0"><div className="flex items-center gap-2"><span className="absolute -left-3 top-0"><Badge tone={state === "Completed" ? "green" : state === "Current" ? "blue" : "neutral"}>{index + 1}</Badge></span><strong className="text-sm">{name}</strong></div><p className="mt-2 text-xs text-text-secondary">{state}{state === "Current" && waiting ? " · Awaiting TL Assignment" : ""}</p>{at && <p className="mt-1 text-xs text-text-secondary">{caseDate(at)}</p>}</li>;
      })}</ol></Card>}
      {tab === "Activity" && <Card className="p-3"><h2 className="mb-3 font-semibold">Case activity</h2><ol className="divide-y divide-brand-border">{ordered.map(event => <li key={event.id} className="flex min-w-0 flex-wrap justify-between gap-2 py-2"><div className="min-w-0"><p className="text-sm font-medium">{eventLabels[event.eventType] ?? "Case updated"}</p>{["stage_moved", "stage_corrected"].includes(event.eventType) && event.newStage && <p className="text-xs text-text-secondary">{event.newStage}</p>}{event.updatedBy && <p className="text-xs text-text-secondary">{event.updatedBy}</p>}{(event.stageNote || event.reason) && <p className="mt-1 break-words text-sm">{event.stageNote || event.reason}</p>}</div><time className="text-xs text-text-secondary">{caseDate(event.bosUpdatedAt)}</time></li>)}</ol>{!ordered.length && <p className="text-sm text-text-secondary">No activity recorded.</p>}</Card>}
    </div>
  </section>;
}
