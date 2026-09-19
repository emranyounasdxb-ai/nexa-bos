"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The frame owns the heading; page content retains its description and actions. */
export const PageHeaderSlots = createContext<{ description: HTMLElement | null; actions: HTMLElement | null; setTitle?: (title: string | null) => void } | null>(null);

export function PageHeader({ description, actions, frameTitle }: { title: string; frameTitle?: string; description?: string; actions?: ReactNode }) {
  const slots = useContext(PageHeaderSlots);
  const setTitle = slots?.setTitle;
  useEffect(() => { if (!frameTitle || !setTitle) return; setTitle(frameTitle); return () => setTitle(null); }, [frameTitle, setTitle]);
  const purpose = description ? <p data-testid="page-purpose" className="min-w-0 text-text-secondary">{description}</p> : null;
  if (slots?.description && slots.actions) {
    return <>{purpose && createPortal(purpose, slots.description)}{actions && createPortal(actions, slots.actions)}</>;
  }
  if (!description && !actions) return null;
  return <div data-amafh-page-purpose="" className="flex min-w-0 flex-wrap items-center justify-between gap-2 sm:gap-3">
    {purpose ?? <span aria-hidden="true" />}
    {actions && <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
  </div>;
}
