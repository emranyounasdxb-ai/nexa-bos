"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, ErrorText, Field, Textarea, TextInput } from "@/components/ui";
import { apiRequest } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";

export type InternalReview = {
  status: string; label: string; eventId: string | null; tlId: string | null; reason: string | null;
  actions: Array<"forward" | "return" | "resubmit">;
  history: Array<{ id: string; action: string; at: string; reason: string | null }>;
};
const labels = { forward: "Forward to COD", return: "Return to SE", resubmit: "Resubmit to TL", correct: "Save correction" };
type Action = keyof typeof labels;

export function ApplicationInternalReview({ applicationId, state, requestedAmount, onSaved }: {
  applicationId: string; state: InternalReview; requestedAmount: string | null; onSaved: (message: string) => Promise<void>;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(requestedAmount ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const pending = useRef(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (action) dialog.current?.showModal();
    else dialog.current?.close();
  }, [action]);
  function close() {
    if (pending.current) return;
    setAction(null);
    (trigger.current?.isConnected ? trigger.current : panel.current)?.focus();
  }
  function open(next: Action, target: HTMLElement) {
    trigger.current = target;
    setError(""); setReason(""); setAmount(requestedAmount ?? ""); setAction(next);
  }
  async function confirm() {
    if (!action || pending.current) return;
    if (action === "return" && !reason.trim()) { setError("Enter a reason for the SE to correct."); return; }
    if (action === "correct" && (!amount.trim() || !Number.isFinite(Number(amount)) || Number(amount) < 0)) { setError("Enter a valid non-negative requested amount."); return; }
    pending.current = true; setBusy(true); setError("");
    try {
      await apiRequest(`/api/v1/applications/${applicationId}${action === "correct" ? "" : "/internal-review"}`, getBrowserApiUrl(), {
        method: action === "correct" ? "PATCH" : "POST",
        body: JSON.stringify(action === "correct" ? { requested_amount: amount } : { action, expected_event_id: state.eventId, reason: reason.trim() || null }),
      });
      pending.current = false; setAction(null);
      await onSaved(`${labels[action]} completed. Case Owner and bank stage are unchanged.`);
      (trigger.current?.isConnected ? trigger.current : panel.current)?.focus();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to save. Refresh the case before retrying."); }
    finally { pending.current = false; setBusy(false); }
  }
  if (state.status === "legacy") return null;
  return <section ref={panel} tabIndex={-1} data-testid="internal-review" className="min-w-0">
    <Card className="min-w-0 border-brand-primary/30 bg-brand-soft/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Internal Review tracker</h2><Badge>{state.label}</Badge></div>
      <p className="mt-1 text-xs text-text-secondary">SE → TL → office COD. Bank workflow and original Case Owner / commission remain separate and unchanged.</p>
      {!state.tlId && state.status === "pending_review" && <p className="mt-2 text-sm text-danger">No valid TL assignment. Contact your administrator; COD processing is blocked.</p>}
      {state.reason && <p className="mt-2 break-words text-sm"><strong>Return reason:</strong> {state.reason}</p>}
      <ol className="mt-3 grid gap-2 sm:grid-cols-3">{state.history.map(entry => <li key={entry.id} className="min-w-0 rounded-md border border-brand-border bg-surface p-2 text-xs"><p className="font-medium capitalize">{entry.action.replace("internal_", "").replaceAll("_", " ")}</p><time className="text-text-secondary">{new Date(entry.at).toLocaleString()}</time>{entry.reason && <p className="mt-1 break-words">{entry.reason}</p>}</li>)}</ol>
      <div className="mt-3 flex flex-wrap gap-2">{state.actions.map(item => <Button key={item} disabled={busy} variant={item === "return" ? "secondary" : "primary"} onClick={event => open(item, event.currentTarget)}>{labels[item]}</Button>)}
        {state.actions.includes("resubmit") && <Button variant="secondary" disabled={busy} onClick={event => open("correct", event.currentTarget)}>Correct requested amount</Button>}
      </div>
    </Card>
    <dialog ref={dialog} aria-labelledby="review-confirm-title" aria-describedby="review-confirm-description" onCancel={event => { event.preventDefault(); close(); }} className="m-auto w-[calc(100%_-_2rem)] max-w-md rounded-xl border border-brand-border bg-surface p-4 text-text-primary shadow-xl backdrop:bg-black/40">
      <form onSubmit={event => { event.preventDefault(); void confirm(); }}>
        <h2 id="review-confirm-title" className="text-lg font-semibold">{action && labels[action]}</h2>
        <p id="review-confirm-description" className="mt-2 text-sm text-text-secondary">{action === "return" ? "Return to the original SE for correction. A reason is required and recorded permanently." : action === "forward" ? "Send to the assigned office COD for bank processing. The SE cannot edit while forwarded." : action === "resubmit" ? "Send the corrected case back to the same TL for review." : "Correct the requested amount before resubmitting. This change is audited."}</p>
        {action === "return" && <Field label="Return reason" className="mt-3"><Textarea aria-label="Return reason" required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></Field>}
        {action === "correct" && <Field label="Requested amount" className="mt-3"><TextInput aria-label="Requested amount" type="number" min="0" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} disabled={busy} /></Field>}
        <ErrorText>{error}</ErrorText>
        <div className="mt-4 flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Confirm"}</Button></div>
      </form>
    </dialog>
  </section>;
}
