import type { ApplicationEventRecord, ApplicationRecord } from "./types";

export type CaseJourneyStep = {
  key: string;
  label: string;
  at: string | null;
  actor: string | null;
  actorRole: string | null;
  state: "completed" | "current" | "upcoming";
  durationSeconds: number | null;
  currentSince: string | null;
};

const recordedTime = (value: string | null | undefined) => value && !Number.isNaN(Date.parse(value)) ? value : null;
const secondsBetween = (from: string | null, to: string | null) =>
  from && to ? Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 1000)) : null;

export function buildCaseJourney(item: ApplicationRecord, events: ApplicationEventRecord[]): CaseJourneyStep[] {
  const sorted = [...events].sort((a, b) => Date.parse(a.bosUpdatedAt) - Date.parse(b.bosUpdatedAt) || a.id.localeCompare(b.id));
  const first = (...types: string[]) => sorted.find(event => types.includes(event.eventType));
  const created = first("application_created", "created");
  const review = first("internal_review_started");
  const booked = first("internal_booked");
  const approved = first("internal_sm_approved");
  const submitted = first("submission");
  const completed = first("completed", "final_rejected", "cancelled", "withdrawn");
  const createdAt = recordedTime(item.createdAt) ?? recordedTime(created?.bosUpdatedAt);
  const bookedAt = recordedTime(item.bookedAt) ?? recordedTime(booked?.bosUpdatedAt);
  const approvedAt = recordedTime(item.salesManagerApprovedAt) ?? recordedTime(approved?.bosUpdatedAt);
  const submittedAt = recordedTime(item.submittedAt) ?? recordedTime(submitted?.bosUpdatedAt);
  const completedAt = recordedTime(item.completedAt) ?? recordedTime(completed?.bosUpdatedAt) ?? recordedTime(item.tatStoppedAt);
  const source = [
    { key: "created", label: "Case Created", at: createdAt, actor: created?.updatedBy ?? null, role: null, done: Boolean(bookedAt || review || item.terminal) },
    { key: "tl", label: bookedAt ? "TL Booked" : "TL Review", at: bookedAt ?? recordedTime(review?.bosUpdatedAt), actor: booked?.updatedBy ?? review?.updatedBy ?? null, role: booked ? "Team Leader" : null, done: Boolean(bookedAt) },
    { key: "coordinator", label: "Coordinator Assigned", at: bookedAt && item.routedCoordinatorId ? bookedAt : null, actor: booked?.updatedBy ?? null, role: booked ? "Team Leader" : null, done: Boolean(bookedAt && item.routedCoordinatorId) },
    { key: "sm", label: "Sales Manager Approved", at: approvedAt, actor: approved?.updatedBy ?? null, role: approved ? "Sales Manager" : null, done: Boolean(approvedAt) },
    { key: "bank", label: "Submitted to Bank", at: submittedAt, actor: submitted?.updatedBy ?? null, role: submitted?.updatedById && submitted.updatedById === item.routedCoordinatorId ? "Coordinator" : null, done: Boolean(submittedAt) },
    { key: "final", label: item.terminalOutcome ?? item.currentStage ?? "Current Stage", at: completedAt ?? (submittedAt && item.currentStageEnteredAt && Date.parse(item.currentStageEnteredAt) >= Date.parse(submittedAt) ? recordedTime(item.currentStageEnteredAt) : null), actor: completed?.updatedBy ?? null, role: null, done: Boolean(item.terminal && completedAt) },
  ];
  const firstIncomplete = source.findIndex(step => !step.done);
  return source.map((step, index) => {
    const previousAt = index ? source[index - 1].at : null;
    const state = step.done ? "completed" : index === firstIncomplete ? "current" : "upcoming";
    return {
      key: step.key,
      label: step.label,
      at: step.at,
      actor: step.actor,
      actorRole: step.role,
      state,
      durationSeconds: state === "completed" ? secondsBetween(previousAt, step.at) : null,
      currentSince: state === "current" ? (step.at ?? previousAt) : null,
    };
  });
}

export function caseTotalSeconds(item: ApplicationRecord, now = Date.now()): number | null {
  const started = Date.parse(item.createdAt);
  if (Number.isNaN(started)) return null;
  if (item.terminal && !item.completedAt && !item.tatStoppedAt) return null;
  const ended = item.terminal ? Date.parse(item.completedAt || item.tatStoppedAt!) : now;
  return Number.isNaN(ended) ? null : Math.max(0, Math.floor((ended - started) / 1000));
}

export function caseLastActivity(item: ApplicationRecord, events: ApplicationEventRecord[]): number {
  return Math.max(Date.parse(item.updatedAt) || 0, ...events.map(event => Date.parse(event.bosUpdatedAt) || 0));
}

export function caseStageLabel(item: ApplicationRecord, review: { status?: string | null; tlName?: string | null }): string {
  if (item.terminalOutcome) return item.terminalOutcome;
  const status = item.routingStatus || review.status;
  if (status === "pending_review") return review.tlName ? "Pending TL Review" : "Awaiting TL Assignment";
  if (status === "resubmitted") return "Pending TL Review";
  if (status === "booked") return "Pending SM Approval";
  if (status === "sm_approved") return "Coordinator Processing";
  if (status === "submitted") return "Submitted to Bank";
  if (status === "returned") return "Returned for Correction";
  return item.currentStage || "In progress";
}
