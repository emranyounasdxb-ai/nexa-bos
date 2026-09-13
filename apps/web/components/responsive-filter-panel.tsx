"use client";

import { useEffect, useState, type ReactNode } from "react";
import { IconChevronDown, IconFilter } from "@/components/icons";

export function ResponsiveFilterPanel({
  children,
  activeFilters = [],
  title = "Filters",
}: {
  children: ReactNode;
  activeFilters?: Array<{ label: string; value: string }>;
  title?: string;
}) {
  const [desktop, setDesktop] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const expanded = desktop || mobileOpen;
  return (
    <section data-amafh-responsive-filters="" className="min-w-0">
      <button
        type="button"
        data-amafh-filter-toggle=""
        className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
        aria-expanded={expanded}
        onClick={() => { if (!desktop) setMobileOpen((current) => !current); }}
      >
        <IconFilter className="size-4 text-brand-primary" />
        <span>{title}</span>
        {activeFilters.length ? <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-primary">{activeFilters.length} active</span> : <span className="text-xs font-normal text-text-secondary">All permitted records</span>}
        <IconChevronDown className={`ml-auto size-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {activeFilters.length ? (
        <div className="flex min-w-0 flex-wrap gap-2 px-3 pb-2" aria-label="Active filters">
          {activeFilters.map((filter) => <span key={`${filter.label}-${filter.value}`} className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-brand-border bg-surface px-2.5 py-1 text-xs text-text-secondary"><strong className="font-semibold text-text-primary">{filter.label}:</strong><span className="truncate">{filter.value}</span></span>)}
        </div>
      ) : null}
      <div data-amafh-filter-content="" hidden={!expanded} className="min-w-0 px-3 pb-3">{children}</div>
    </section>
  );
}
