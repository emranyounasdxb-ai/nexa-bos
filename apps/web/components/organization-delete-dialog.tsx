"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ErrorText, Field, TextInput } from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";

type Preview = { dependencies: { type: string; count: number }[]; canDelete: boolean };

export function OrganizationDeleteDialog({ endpoint, api, item, trigger, onClose, onDeleted }: {
  endpoint: string;
  api: string;
  item: { id: string; code: string; name: string };
  trigger: HTMLElement;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const requestPending = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    let current = true;
    void apiGet<Preview>(`${endpoint}/${item.id}/deletion-preview`, api)
      .then((result) => { if (current) setPreview(result); })
      .catch((caught: unknown) => { if (current) setError(caught instanceof Error ? caught.message : "Dependencies could not be checked."); });
    return () => {
      current = false;
      element?.close();
      if (trigger.isConnected) trigger.focus();
      else document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    };
  }, [api, endpoint, item.id, trigger]);

  async function remove() {
    if (requestPending.current || !preview?.canDelete || confirmation !== "DELETE" || !reason.trim()) return;
    requestPending.current = true;
    setSaving(true);
    setError("");
    try {
      await apiRequest(`${endpoint}/${item.id}`, api, { method: "DELETE", body: JSON.stringify({ reason: reason.trim(), confirmation }) });
      await onDeleted();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Deletion failed. No changes were made.");
    } finally {
      requestPending.current = false;
      setSaving(false);
    }
  }

  return <dialog ref={dialog} aria-labelledby="org-delete-title" aria-describedby="org-delete-description"
    className="fixed inset-0 m-auto max-h-[calc(100dvh_-_32px)] w-[calc(100%_-_32px)] max-w-lg overflow-y-auto rounded-[24px] border border-brand-border bg-surface p-5 text-text-primary shadow-[var(--amafh-shadow-elevated)] backdrop:bg-[#100916]/65 backdrop:backdrop-blur-sm"
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'));
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onCancel={(event) => { event.preventDefault(); if (!requestPending.current) onClose(); }}>
    <header className="flex items-start justify-between gap-3">
      <h2 id="org-delete-title" className="text-[17px] font-semibold">Delete organization master</h2>
      <Button type="button" variant="ghost" disabled={saving} onClick={onClose} aria-label="Close delete dialog">Close</Button>
    </header>
    <p id="org-delete-description" className="mt-4 rounded-2xl bg-danger-soft p-3 break-words text-sm text-danger">Permanently delete <strong>{item.name}</strong> (<span className="font-mono">{item.code}</span>) only if unused. Name history and audit evidence are retained. This cannot be undone.</p>
    <div className="my-3 rounded-2xl bg-surface-subtle p-3 text-sm" role="status">
      {!preview && !error ? "Checking dependencies…" : preview?.canDelete ? "No usage dependencies found. The server will check again when deleting." : preview ? <><p className="font-semibold">Deletion is blocked by:</p><ul className="mt-1 list-inside list-disc">{preview.dependencies.map((entry) => <li key={entry.type}>{entry.type.replaceAll("_", " ")}: {entry.count}</li>)}</ul><p className="mt-2">Use Deactivate where permitted.</p></> : null}
    </div>
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void remove(); }}>
      <Field label="Deletion reason" htmlFor="org-delete-reason"><TextInput id="org-delete-reason" required maxLength={1000} value={reason} disabled={saving || !preview?.canDelete} onChange={(event) => setReason(event.target.value)} /></Field>
      <Field label="Type DELETE to confirm" htmlFor="org-delete-confirmation"><TextInput id="org-delete-confirmation" autoComplete="off" spellCheck={false} value={confirmation} disabled={saving || !preview?.canDelete} onChange={(event) => setConfirmation(event.target.value)} /></Field>
      <ErrorText>{error}</ErrorText>
      <footer className="flex justify-end gap-2 border-t border-brand-border pt-3">
        <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="danger" disabled={saving || !preview?.canDelete || confirmation !== "DELETE" || !reason.trim()}>{saving ? "Deleting…" : "Delete"}</Button>
      </footer>
    </form>
  </dialog>;
}
