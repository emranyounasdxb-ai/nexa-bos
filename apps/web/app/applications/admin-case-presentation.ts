import type { ApplicationRecord } from "@/lib/types";

export type CaseReview = { status: string; tlId: string | null; tlName?: string | null; label?: string };
export function caseStage(item: ApplicationRecord, review?: CaseReview | null): string {
  if (item.terminalOutcome) return item.terminalOutcome === "Final Rejected" ? "Rejected" : item.terminalOutcome;
  if (item.approvedAt) return "Approved";
  if (item.submittedAt || item.submitted) return "Submitted";
  if (review?.status === "returned") return "Returned for correction";
  if (review && ["pending_review", "resubmitted"].includes(review.status)) return review.tlId ? "Pending TL Review" : "Awaiting TL Assignment";
  if (review && ["booked", "forwarded", "sm_approved"].includes(review.status)) return "In Review";
  return item.currentStage || "Case Created";
}
export function caseTone(stage: string): "neutral" | "amber" | "blue" | "green" | "red" {
  if (/rejected|cancelled/i.test(stage)) return "red";
  if (/approved|completed/i.test(stage)) return "green";
  if (/awaiting|pending|correction/i.test(stage)) return "amber";
  if (/review|submitted/i.test(stage)) return "blue";
  return "neutral";
}
export function caseDate(value?: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not recorded";
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date).replace("Sept", "Sep");
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(date);
  return `${day}, ${time}`;
}
export function caseAmount(value: string | null): string {
  return value !== null && Number.isFinite(Number(value)) ? `AED ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))}` : "Not recorded";
}
