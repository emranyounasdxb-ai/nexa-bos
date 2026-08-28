"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { DatePicker } from "@/components/date-picker";
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  PageHeader,
  Select,
  Textarea,
  controlClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDuration } from "@/lib/duration";
import { getBrowserApiUrl } from "@/lib/env";
import type {
  ApplicationEventRecord,
  ApplicationRecord,
  ManagerOption,
  WorkflowRecord,
  WorkflowStageRecord,
} from "@/lib/types";

const today = () => new Date().toISOString().slice(0, 10);

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [item, setItem] = useState<ApplicationRecord | null>(null);
  const [progress, setProgress] = useState<WorkflowStageRecord[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [timeline, setTimeline] = useState<ApplicationEventRecord[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowRecord | null>(null);
  const [owners, setOwners] = useState<ManagerOption[]>([]);
  const [versions, setVersions] = useState<WorkflowRecord[]>([]);
  const [message, setMessage] = useState("");
  const [caseNumber, setCaseNumber] = useState("");
  const [caseReason, setCaseReason] = useState("");
  const [stageId, setStageId] = useState("");
  const [bankDate, setBankDate] = useState(today());
  const [stageNote, setStageNote] = useState("");
  const [requirement, setRequirement] = useState("");
  const [approvedAmount, setApprovedAmount] = useState("");
  const [bookedAmount, setBookedAmount] = useState("");
  const [fundedAmount, setFundedAmount] = useState("");
  const [correctReason, setCorrectReason] = useState("");
  const [outcome, setOutcome] = useState("Final Rejected");
  const [outcomeReason, setOutcomeReason] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [ownerReason, setOwnerReason] = useState("");
  const [migrateWorkflowId, setMigrateWorkflowId] = useState("");
  const [migrateStageId, setMigrateStageId] = useState("");
  const [migrateReason, setMigrateReason] = useState("");
  const [correctionAmount, setCorrectionAmount] = useState("");
  const [delayType, setDelayType] = useState("Bank");
  const [delayReason, setDelayReason] = useState("");
  const [delayOther, setDelayOther] = useState("");
  const [delayAction, setDelayAction] = useState("cancel");
  const [delayCorrectionReason, setDelayCorrectionReason] = useState("");

  const refresh = useCallback(async () => {
    const data = await apiGet<ApplicationRecord>(`/api/v1/applications/${params.id}`, api);
    setItem(data);
    setCaseNumber(data.bankCaseNumber ?? "");
    const [progressData, timelineData, workflowData, ownerData, versionData] = await Promise.all([
      apiGet<{ version: number; stages: WorkflowStageRecord[] }>(
        `/api/v1/applications/${params.id}/progress`,
        api,
      ),
      apiGet<{ items: ApplicationEventRecord[] }>(
        `/api/v1/applications/${params.id}/timeline`,
        api,
      ),
      apiGet<WorkflowRecord>(`/api/v1/workflows/${data.workflowId}`, api),
      can("Applications.ReassignCaseOwner")
        ? apiGet<{ items: ManagerOption[] }>("/api/v1/users/case-owners", api)
        : Promise.resolve({ items: [] as ManagerOption[] }),
      apiGet<{ items: WorkflowRecord[] }>(
        `/api/v1/workflows?bank_id=${data.bankId}&product_id=${data.productId}`,
        api,
      ),
    ]);
    setProgress(progressData.stages);
    setVersion(progressData.version);
    setTimeline(timelineData.items);
    setWorkflow(workflowData);
    setOwners(ownerData.items);
    setVersions(versionData.items);
  }, [api, can, params.id]);

  useEffect(() => {
    void refresh().catch((err: unknown) =>
      setMessage(err instanceof Error ? err.message : "Load failed"),
    );
  }, [refresh]);

  if (!item) {
    return <p className="text-sm">{message || "Loading…"}</p>;
  }

  const nextStages = (workflow?.transitions ?? [])
    .filter((row) => row.fromStageId === item.currentStageId)
    .map((row) => workflow?.stages.find((stage) => stage.id === row.toStageId))
    .filter((stage): stage is WorkflowStageRecord => Boolean(stage && stage.status === "active"));

  async function post(path: string, body: Record<string, unknown>) {
    setMessage("");
    try {
      await apiRequest(path, api, { method: "POST", body: JSON.stringify(body) });
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Action failed");
    }
  }

  const selectedNext = nextStages.find((stage) => stage.id === stageId);

  return (
    <section className="space-y-6">
      <PageHeader
        title={item.applicationCode}
        description={`${item.customerCode} · ${item.customerName} · ${item.bankCode} / ${item.productCode} · Case Owner ${item.caseOwnerName}${item.terminalOutcome ? ` · ${item.terminalOutcome}` : ""}`}
        actions={
          item.hasActiveDelay && item.activeDelay ? (
            <Badge>{`Delay · ${item.activeDelay.delayType}`}</Badge>
          ) : undefined
        }
      />
      <p className="text-sm text-slate-500">
        Bank and Product are immutable. Workflow version {item.workflowVersion}.
      </p>
      <ErrorText>{message}</ErrorText>

      <Card>
        <h3 className="font-semibold">Turnaround time</h3>
        <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <div>
            {item.terminal ? "Total duration" : "Elapsed TAT"}:{" "}
            {item.terminal
              ? formatDuration(item.totalDurationSeconds)
              : formatDuration(item.currentElapsedSeconds)}
          </div>
          <div>Current stage elapsed: {formatDuration(item.currentStageElapsedSeconds)}</div>
          <div>Started: {item.tatStartedAt}</div>
          <div>Stopped: {item.tatStoppedAt ?? "running"}</div>
        </dl>
        <h4 className="mt-4 text-sm font-semibold">Stage durations</h4>
        <ul className="mt-2 space-y-2 text-sm">
          {item.stageDurations.map((row) => (
            <li key={row.id} className="rounded-md border border-slate-200 p-3">
              <p className="font-medium">
                {row.stageName}
                {row.completed ? "" : " (current)"}
              </p>
              <p className="text-slate-600">Duration: {formatDuration(row.durationSeconds)}</p>
              <p className="text-xs text-slate-500">
                Entered {row.enteredAt}
                {row.exitedAt ? ` · Exited ${row.exitedAt}` : ""}
              </p>
              {row.bankStageDate ? <p>Bank Stage Date: {row.bankStageDate}</p> : null}
              {row.stageNote ? <p>Note: {row.stageNote}</p> : null}
              <p className="text-xs text-slate-500">
                BOS {row.bosUpdatedAt} · {row.updatedBy}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <div>
        <h3 className="font-semibold">Progress</h3>
        <p className="text-xs text-slate-500">Workflow version {version}</p>
        {item.activeDelay ? (
          <p className="mt-2 text-sm">
            <Badge>{`Active delay · ${item.activeDelay.delayType} · ${item.activeDelay.stageName}`}</Badge>
          </p>
        ) : null}
        <ol className="mt-3 flex flex-wrap gap-2">
          {progress.map((stage) => (
            <li
              key={stage.id}
              className={
                stage.current
                  ? "rounded-full bg-slate-900 px-3 py-1 text-sm text-white"
                  : "rounded-full border px-3 py-1 text-sm text-slate-600"
              }
            >
              {stage.name}
              {stage.current && item.currentStageElapsedSeconds != null
                ? ` · ${formatDuration(item.currentStageElapsedSeconds)}`
                : ""}
            </li>
          ))}
        </ol>
      </div>

      <dl className="grid gap-2 text-sm md:grid-cols-2">
        <div>Requested amount: {item.requestedAmount ?? "—"}</div>
        <div>Approved amount: {item.approvedAmount ?? "—"}</div>
        <div>Booked amount: {item.bookedAmount ?? "—"}</div>
        <div>Funded amount: {item.fundedAmount ?? "—"}</div>
        <div>Bank File / Case Number: {item.bankCaseNumber ?? "—"}</div>
        <div>Submitted: {item.submittedAt ?? "not submitted"}</div>
      </dl>

      {item.activeDelay ? (
        <Card>
          <h3 className="font-semibold">Active delay</h3>
          <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
            <div>Type: {item.activeDelay.delayType}</div>
            <div>Stage: {item.activeDelay.stageName}</div>
            <div>Marked by: {item.activeDelay.markedBy}</div>
            <div>Started: {item.activeDelay.startedAt}</div>
          </dl>
          <p className="mt-2 text-sm">Reason: {item.activeDelay.reason}</p>
          {item.activeDelay.otherExplanation ? (
            <p className="text-sm">Explanation: {item.activeDelay.otherExplanation}</p>
          ) : null}
          {!item.terminal && can("Applications.CorrectDelay") ? (
            <form
              className="mt-4 space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void post(`/api/v1/applications/${item.id}/delays/${item.activeDelay!.id}/correct`, {
                  action: delayAction,
                  reason: delayCorrectionReason,
                }).then(() => {
                  setDelayCorrectionReason("");
                });
              }}
            >
              <Field label="Correction action">
                <Select
                  aria-label="Correction action"
                  value={delayAction}
                  onChange={(event) => setDelayAction(event.target.value)}
                >
                  <option value="cancel">Cancel delay</option>
                  <option value="correct">Correct delay</option>
                </Select>
              </Field>
              <Field label="Correction reason">
                <Textarea
                  aria-label="Correction reason"
                  placeholder="Correction reason (mandatory)"
                  value={delayCorrectionReason}
                  onChange={(event) => setDelayCorrectionReason(event.target.value)}
                  required
                />
              </Field>
              <Button variant="secondary" type="submit">
                Correct Delay
              </Button>
            </form>
          ) : null}
        </Card>
      ) : null}

      {!item.terminal && !item.activeDelay && can("Applications.MarkDelay") ? (
        <form
          className="space-y-2 rounded-xl border bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void post(`/api/v1/applications/${item.id}/delays`, {
              delay_type: delayType,
              reason: delayReason,
              other_explanation: delayType === "Other" ? delayOther : null,
            }).then(() => {
              setDelayReason("");
              setDelayOther("");
            });
          }}
        >
          <h3 className="font-semibold">Mark Delay</h3>
          <Field label="Delay type">
            <Select
              aria-label="Delay type"
              value={delayType}
              onChange={(event) => setDelayType(event.target.value)}
            >
              <option>Bank</option>
              <option>Customer</option>
              <option>Internal</option>
              <option>Other</option>
            </Select>
          </Field>
          <Field label="Delay reason">
            <Textarea
              aria-label="Delay reason"
              placeholder="Delay reason (mandatory)"
              value={delayReason}
              onChange={(event) => setDelayReason(event.target.value)}
              required
            />
          </Field>
          {delayType === "Other" ? (
            <Field label="Other explanation">
              <Textarea
                aria-label="Other explanation"
                placeholder="Explain Other delay type"
                value={delayOther}
                onChange={(event) => setDelayOther(event.target.value)}
                required
              />
            </Field>
          ) : null}
          <Button type="submit">Mark Delay</Button>
        </form>
      ) : null}

      {!item.terminal && can("Applications.Submit") ? (
        <form
          className="space-y-2 rounded-xl border bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void post(`/api/v1/applications/${item.id}/case-number`, {
              bank_case_number: caseNumber,
              reason: item.submitted ? caseReason : null,
            });
          }}
        >
          <h3 className="font-semibold">Bank File / Case Number</h3>
          <input
            className={controlClass}
            aria-label="Bank File / Case Number"
            value={caseNumber}
            onChange={(event) => setCaseNumber(event.target.value)}
            required
          />
          {item.submitted ? (
            <input
              className={controlClass}
              aria-label="Case number correction reason"
              placeholder="Correction reason"
              value={caseReason}
              onChange={(event) => setCaseReason(event.target.value)}
              required
            />
          ) : null}
          <button className={primaryButtonClass} type="submit">
            {item.submitted ? "Correct case number" : "Save and submit"}
          </button>
        </form>
      ) : null}

      {!item.terminal && can("Applications.UpdateStage") ? (
        <form
          className="space-y-2 rounded-xl border bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void post(`/api/v1/applications/${item.id}/stage`, {
              stage_id: stageId,
              bank_stage_date: bankDate,
              stage_note: stageNote || null,
              requirement_text: requirement || null,
              approved_amount: approvedAmount || null,
              booked_amount: bookedAmount || null,
              funded_amount: fundedAmount || null,
            });
          }}
        >
          <h3 className="font-semibold">Update stage</h3>
          <select
            className={controlClass}
            aria-label="Next stage"
            value={stageId}
            onChange={(event) => setStageId(event.target.value)}
            required
          >
            <option value="">Allowed next stage</option>
            {nextStages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
          <DatePicker
            required
            aria-label="Bank Stage Date"
            value={bankDate}
            onChange={setBankDate}
          />
          <input
            className={controlClass}
            aria-label="Stage note"
            placeholder="Stage note (optional)"
            value={stageNote}
            onChange={(event) => setStageNote(event.target.value)}
          />
          {selectedNext?.systemKey === "returned_requirement_pending" ? (
            <textarea
              className={controlClass}
              aria-label="Requirement reason"
              placeholder="Requirement / query (required)"
              value={requirement}
              onChange={(event) => setRequirement(event.target.value)}
              required
            />
          ) : null}
          {selectedNext?.systemKey === "approved" ? (
            <input
              className={controlClass}
              aria-label="Approved amount"
              placeholder="Approved amount"
              value={approvedAmount}
              onChange={(event) => setApprovedAmount(event.target.value)}
            />
          ) : null}
          {selectedNext?.systemKey === "booked" ? (
            <input
              className={controlClass}
              aria-label="Booked amount"
              placeholder="Booked amount"
              value={bookedAmount}
              onChange={(event) => setBookedAmount(event.target.value)}
            />
          ) : null}
          {selectedNext?.systemKey === "fund_released" ? (
            <input
              className={controlClass}
              aria-label="Funded amount"
              placeholder="Funded amount"
              value={fundedAmount}
              onChange={(event) => setFundedAmount(event.target.value)}
            />
          ) : null}
          <button className={primaryButtonClass} type="submit">
            Save stage
          </button>
        </form>
      ) : null}

      {!item.terminal && can("Applications.CorrectStage") ? (
        <form
          className="space-y-2 rounded-xl border bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void post(`/api/v1/applications/${item.id}/correct-stage`, {
              stage_id: stageId,
              bank_stage_date: bankDate,
              stage_note: stageNote || null,
              reason: correctReason,
            });
          }}
        >
          <h3 className="font-semibold">Correct stage</h3>
          <p className="text-xs text-slate-500">Original history is preserved. Reason is mandatory.</p>
          <select
            className={controlClass}
            aria-label="Corrected stage"
            value={stageId}
            onChange={(event) => setStageId(event.target.value)}
            required
          >
            <option value="">Target stage</option>
            {(workflow?.stages ?? [])
              .filter((stage) => stage.status === "active")
              .map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
          </select>
          <input
            className={controlClass}
            aria-label="Stage correction reason"
            placeholder="Correction reason"
            value={correctReason}
            onChange={(event) => setCorrectReason(event.target.value)}
            required
          />
          <button className={secondaryButtonClass} type="submit">
            Append correction
          </button>
        </form>
      ) : null}

      {!item.terminal && can("Applications.CorrectSubmittedData") && item.submitted ? (
        <form
          className="space-y-2 rounded-xl border bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void post(`/api/v1/applications/${item.id}/correct-submitted`, {
              reason: correctReason,
              requested_amount: correctionAmount || null,
            });
          }}
        >
          <h3 className="font-semibold">Correct submitted data</h3>
          <input
            className={controlClass}
            aria-label="Corrected requested amount"
            placeholder="Requested amount"
            value={correctionAmount}
            onChange={(event) => setCorrectionAmount(event.target.value)}
          />
          <input
            className={controlClass}
            aria-label="Submitted data correction reason"
            placeholder="Correction reason"
            value={correctReason}
            onChange={(event) => setCorrectReason(event.target.value)}
            required
          />
          <button className={secondaryButtonClass} type="submit">
            Correct submitted data
          </button>
        </form>
      ) : null}

      {!item.terminal && can("Applications.ReassignCaseOwner") ? (
        <form
          className="space-y-2 rounded-xl border bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void post(`/api/v1/applications/${item.id}/reassign-owner`, {
              case_owner_id: ownerId,
              reason: ownerReason || null,
            });
          }}
        >
          <h3 className="font-semibold">Reassign Case Owner</h3>
          <select
            className={controlClass}
            aria-label="New Case Owner"
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
            required
          >
            <option value="">Select Case Owner</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.fullName}
              </option>
            ))}
          </select>
          <input
            className={controlClass}
            aria-label="Reassignment reason"
            placeholder="Reason (optional)"
            value={ownerReason}
            onChange={(event) => setOwnerReason(event.target.value)}
          />
          <button className={secondaryButtonClass} type="submit">
            Reassign
          </button>
        </form>
      ) : null}

      {!item.terminal && can("Applications.SetOutcome") ? (
        <form
          className="space-y-2 rounded-xl border bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void post(`/api/v1/applications/${item.id}/outcome`, {
              outcome,
              reason: outcomeReason,
            });
          }}
        >
          <h3 className="font-semibold">Terminal outcome</h3>
          <select
            className={controlClass}
            aria-label="Terminal outcome"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
          >
            <option>Final Rejected</option>
            <option>Cancelled</option>
            <option>Withdrawn</option>
          </select>
          <textarea
            className={controlClass}
            aria-label="Outcome reason"
            placeholder="Reason (mandatory)"
            value={outcomeReason}
            onChange={(event) => setOutcomeReason(event.target.value)}
            required
          />
          <button className={secondaryButtonClass} type="submit">
            Close application
          </button>
        </form>
      ) : null}

      {!item.terminal && can("Workflows.MigrateApplication") ? (
        <form
          className="space-y-2 rounded-xl border bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void post(`/api/v1/applications/${item.id}/migrate`, {
              workflow_id: migrateWorkflowId,
              target_stage_id: migrateStageId,
              reason: migrateReason,
            });
          }}
        >
          <h3 className="font-semibold">Migrate workflow version</h3>
          <select
            className={controlClass}
            aria-label="Target workflow"
            value={migrateWorkflowId}
            onChange={(event) => setMigrateWorkflowId(event.target.value)}
            required
          >
            <option value="">Target workflow version</option>
            {versions
              .filter((row) => row.id !== item.workflowId)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  Version {row.version} ({row.status})
                </option>
              ))}
          </select>
          <select
            className={controlClass}
            aria-label="Migration target stage"
            value={migrateStageId}
            onChange={(event) => setMigrateStageId(event.target.value)}
            required
          >
            <option value="">Target stage</option>
            {(versions.find((row) => row.id === migrateWorkflowId)?.stages ?? [])
              .filter((stage) => stage.status === "active")
              .map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
          </select>
          <input
            className={controlClass}
            aria-label="Migration reason"
            placeholder="Reason"
            value={migrateReason}
            onChange={(event) => setMigrateReason(event.target.value)}
            required
          />
          <button className={secondaryButtonClass} type="submit">
            Migrate this application
          </button>
        </form>
      ) : null}

      <div>
        <h3 className="font-semibold">Timeline</h3>
        <ol className="mt-3 space-y-3">
          {timeline.map((event) => (
            <li key={event.id} className="rounded-xl border bg-white p-3 text-sm">
              <p className="font-medium">{event.eventType.replaceAll("_", " ")}</p>
              <p className="text-slate-600">
                {event.previousStage ? `${event.previousStage} → ` : ""}
                {event.newStage ?? ""}
              </p>
              {event.bankStageDate ? <p>Bank Stage Date: {event.bankStageDate}</p> : null}
              {event.stageNote ? <p>Note: {event.stageNote}</p> : null}
              {event.reason ? <p>Reason: {event.reason}</p> : null}
              {event.payload &&
              typeof event.payload.delayType === "string" ? (
                <p>
                  Delay: {event.payload.delayType}
                  {typeof event.payload.otherExplanation === "string" && event.payload.otherExplanation
                    ? ` · ${event.payload.otherExplanation}`
                    : ""}
                </p>
              ) : null}
              {event.payload && typeof event.payload.startedAt === "string" ? (
                <p className="text-xs text-slate-500">
                  Delay start {event.payload.startedAt}
                  {typeof event.payload.endedAt === "string" && event.payload.endedAt
                    ? ` · end ${event.payload.endedAt}`
                    : ""}
                  {typeof event.payload.durationSeconds === "number"
                    ? ` · ${formatDuration(event.payload.durationSeconds)}`
                    : ""}
                </p>
              ) : null}
              <p className="text-xs text-slate-500">
                BOS {event.bosUpdatedAt} · {event.updatedBy}
              </p>
            </li>
          ))}
        </ol>
      </div>
      <p className="text-sm">
        <Link className="underline" href={`/customers/${item.customerId}`}>
          Open customer
        </Link>
      </p>
    </section>
  );
}
