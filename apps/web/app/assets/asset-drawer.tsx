"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
import { PageHeaderSlots } from "@/components/page-header";
import { IconX } from "@/components/icons";
import styles from "./workspace.module.css";

/** Asset-local drawer; nested action popups keep ownership of keyboard focus. */
export function AssetDrawer({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const hasChildModal = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"]')).some(element => element !== panel.current && element.getClientRects().length > 0);
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || hasChildModal()) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
      const first = elements[0], last = elements.at(-1);
      if (!first) { event.preventDefault(); panel.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); document.body.style.overflow = previous; if (opener?.isConnected) opener.focus(); };
  }, [onClose]);
  return createPortal(<div className={styles.backdrop} data-amafh-workspace="" data-amafh-page-typography="" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside data-asset-workspace-drawer="" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="asset-workspace-drawer-title" className={styles.drawer}>
      <div className={styles.drawerHeading}><h2 id="asset-workspace-drawer-title">{title}</h2><Button variant="ghost" size="icon" aria-label={`Close ${title}`} onClick={onClose}><IconX className="size-4" /></Button></div>
      <div className={styles.drawerBody}><PageHeaderSlots.Provider value={null}>{children}</PageHeaderSlots.Provider></div>
    </aside>
  </div>, document.body);
}
