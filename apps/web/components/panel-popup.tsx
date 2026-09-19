"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, DialogPanel } from "./ui";
import styles from "./panel-popup.module.css";

/** Keeps the existing editor mounted so closing a panel does not discard drafts. */
export function PanelPopup({ label, children, feedback, open: controlledOpen, onOpenChange, parentModalSelector }: {
  label: string;
  children: ReactNode;
  feedback?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** A lower containing drawer must not prevent this popup from owning focus. */
  parentModalSelector?: string;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const open = controlledOpen ?? localOpen;
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const setOpen = (value: boolean) => { setLocalOpen(value); onOpenChange?.(value); };
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!open || !mounted) return;
    const current = panel.current;
    const opener = trigger.current?.querySelector("button");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const stops = () => Array.from(current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])') ?? []).filter(item => item.getClientRects().length && !item.closest("[inert]"));
    // Existing confirmations/editors remain above this panel and own their focus.
    const anotherModal = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"],dialog[open]')).some(item => !current?.contains(item) && item !== current && !(parentModalSelector && item.matches(parentModalSelector)) && item.getClientRects().length);
    if (!anotherModal()) (stops()[0] ?? current)?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || anotherModal()) return;
      if (event.key === "Escape" && current?.querySelector('[role="combobox"][aria-expanded="true"]')) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setLocalOpen(false); onOpenChange?.(false); }
      if (event.key !== "Tab") return;
      const elements = stops(), first = elements[0], last = elements.at(-1);
      if (!first) { event.preventDefault(); current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      if (!anotherModal() && opener?.isConnected && opener.getClientRects().length) opener.focus();
    };
  }, [open, mounted, onOpenChange, parentModalSelector]);
  return <div ref={trigger} className={styles.control}>
    <Button type="button" variant="secondary" aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen(true)}>{label}</Button>
    {mounted && createPortal(<div hidden={!open} className={styles.backdrop} data-amafh-workspace="" data-amafh-page-typography="" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div id={`${id}-panel`} ref={panel} className={styles.panel} role={open ? "dialog" : undefined} aria-modal={open ? true : undefined} aria-labelledby={`${id}-title`} tabIndex={-1}>
        <DialogPanel embedded titleId={`${id}-title`} title={label} onClose={() => setOpen(false)}>{children}{feedback && <div className="mt-3" aria-live="polite">{feedback}</div>}</DialogPanel>
      </div>
    </div>, document.body)}
  </div>;
}
