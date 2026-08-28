"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
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
      <div>
        <h2 className="text-xl font-semibold">{item.applicationCode}</h2>
        <p className="text-sm text-slate-600">
          {item.customerCode} · {item.customerName} · {item.bankCode} / {item.productCode} · Case
          Owner {item.caseOwnerName}
          {item.terminalOutcome ? ` · ${item.terminalOutcome}` : ""}
        </p>
        <p className="text-sm text-slate-500">
          Bank and Product are immutable. Workflow version {item.workflowVersion}.
        </p>
      </div>
      {message ? <p className="text-sm text-red-700">{message}</p> : null}

      <div>
        <h3 className="font-semibold">Progress</h3>
        <p className="text-xs text-slate-500">Workflow version {version}</p>
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
            className="w-full rounded-md border px-3 py-2 text-sm"
            aria-label="Bank File / Case Number"
            value={caseNumber}
            onChange={(event) => setCaseNumber(event.target.value)}
            required
          />
          {item.submitted ? (
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              aria-label="Case number correction reason"
              placeholder="Correction reason"
              value={caseReason}
              onChange={(event) => setCaseReason(event.target.value)}
              required
            />
          ) : null}
          <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" type="submit">
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
            className="w-full rounded-md border px-3 py-2 text-sm"
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
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            type="date"
            aria-label="Bank Stage Date"
            value={bankDate}
            onChange={(event) => setBankDate(event.target.value)}
            required
          />
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            aria-label="Stage note"
            placeholder="Stage note (optional)"
            value={stageNote}
            onChange={(event) => setStageNote(event.target.value)}
          />
          {selectedNext?.systemKey === "returned_requirement_pending" ? (
            <textarea
              className="w-full rounded-md border px-3 py-2 text-sm"
              aria-label="Requirement reason"
              placeholder="Requirement / query (required)"
              value={requirement}
              onChange={(event) => setRequirement(event.target.value)}
              required
            />
          ) : null}
          {selectedNext?.systemKey === "approved" ? (
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              aria-label="Approved amount"
              placeholder="Approved amount"
              value={approvedAmount}
              onChange={(event) => setApprovedAmount(event.target.value)}
            />
          ) : null}
          {selectedNext?.systemKey === "booked" ? (
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              aria-label="Booked amount"
              placeholder="Booked amount"
              value={bookedAmount}
              onChange={(event) => setBookedAmount(event.target.value)}
            />
          ) : null}
          {selectedNext?.systemKey === "fund_released" ? (
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              aria-label="Funded amount"
              placeholder="Funded amount"
              value={fundedAmount}
              onChange={(event) => setFundedAmount(event.target.value)}
            />
          ) : null}
          <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" type="submit">
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
            className="w-full rounded-md border px-3 py-2 text-sm"
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
            className="w-full rounded-md border px-3 py-2 text-sm"
            aria-label="Stage correction reason"
            placeholder="Correction reason"
            value={correctReason}
            onChange={(event) => setCorrectReason(event.target.value)}
            required
          />
          <button className="rounded-md border px-3 py-2 text-sm" type="submit">
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
            className="w-full rounded-md border px-3 py-2 text-sm"
            aria-label="Corrected requested amount"
            placeholder="Requested amount"
            value={correctionAmount}
            onChange={(event) => setCorrectionAmount(event.target.value)}
          />
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            aria-label="Submitted data correction reason"
            placeholder="Correction reason"
            value={correctReason}
            onChange={(event) => setCorrectReason(event.target.value)}
            required
          />
          <button className="rounded-md border px-3 py-2 text-sm" type="submit">
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
            className="w-full rounded-md border px-3 py-2 text-sm"
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
            className="w-full rounded-md border px-3 py-2 text-sm"
            aria-label="Reassignment reason"
            placeholder="Reason (optional)"
            value={ownerReason}
            onChange={(event) => setOwnerReason(event.target.value)}
          />
          <button className="rounded-md border px-3 py-2 text-sm" type="submit">
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
            className="w-full rounded-md border px-3 py-2 text-sm"
            aria-label="Terminal outcome"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
          >
            <option>Final Rejected</option>
            <option>Cancelled</option>
            <option>Withdrawn</option>
          </select>
          <textarea
            className="w-full rounded-md border px-3 py-2 text-sm"
            aria-label="Outcome reason"
            placeholder="Reason (mandatory)"
            value={outcomeReason}
            onChange={(event) => setOutcomeReason(event.target.value)}
            required
          />
          <button className="rounded-md border px-3 py-2 text-sm" type="submit">
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
            className="w-full rounded-md border px-3 py-2 text-sm"
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
            className="w-full rounded-md border px-3 py-2 text-sm"
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
            className="w-full rounded-md border px-3 py-2 text-sm"
            aria-label="Migration reason"
            placeholder="Reason"
            value={migrateReason}
            onChange={(event) => setMigrateReason(event.target.value)}
            required
          />
          <button className="rounded-md border px-3 py-2 text-sm" type="submit">
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
