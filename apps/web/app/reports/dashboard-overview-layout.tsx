import type { HTMLAttributes, ReactNode } from "react";
import { IconChevronDown } from "@/components/icons";
import { Card, SectionHeader } from "@/components/ui";
import styles from "./overview.module.css";

/** Native disclosure keeps existing controls mounted and releases height at once. */
export function DashboardCard({ owner, title, description, summary, actions, legacyHeader, children, className, ...props }: {
  owner: boolean; title: string; description?: string; summary?: ReactNode;
  actions?: ReactNode; legacyHeader?: ReactNode; children: ReactNode; className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  return <Card className={className} {...props}>
    {owner ? <details open data-dashboard-section={title} className={styles.sectionDisclosure}>
      <summary><SectionHeader title={title} description={description} actions={summary} /><IconChevronDown className="size-4" /></summary>
      <div className={styles.sectionBody}>
        {actions && <div className={styles.sectionActions}>{actions}</div>}
        {children}
      </div>
    </details> : <>{legacyHeader ?? <SectionHeader title={title} description={description} actions={actions ?? summary} />}{children}</>}
  </Card>;
}

type OverviewSlots = {
  owner: boolean;
  hero: ReactNode;
  shortcuts: ReactNode;
  trend: ReactNode;
  pipeline: ReactNode;
  stages: ReactNode;
  conversion: ReactNode;
  attention: ReactNode;
  targets: ReactNode;
  rankings: ReactNode;
  personal: ReactNode;
};

/** Presentation only: the existing dashboard supplies every record and action. */
export function DashboardOverviewLayout(slots: OverviewSlots) {
  if (!slots.owner) return <div data-testid="dashboard-overview" className="space-y-4">
    {slots.hero}
    <div data-testid="dashboard-kpi-charts" className={styles.summary}>
      {slots.shortcuts}
      <div className={styles.primary}>{slots.trend}{slots.pipeline}</div>
    </div>
    <div data-testid="dashboard-analysis-grid" className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
      {slots.stages}{slots.conversion}{slots.attention}{slots.targets}
    </div>
    {slots.rankings}{slots.personal}
  </div>;

  return <div data-testid="dashboard-overview" data-owner-overview="" className={styles.ownerOverview}>
    {slots.hero}{slots.shortcuts}
    <div data-testid="dashboard-business-overview" className={styles.ownerColumns}>
      <section aria-label="Business overview" className={styles.ownerPrimary}>
        {slots.attention}{slots.stages}{slots.trend}{slots.rankings}
        <details data-testid="my-workspace" className={styles.personalWorkspace}>
          <summary><span><strong>My workspace</strong><small>My performance, attendance and personal HR details</small></span><IconChevronDown className="size-5" /></summary>
          <div className={styles.personalWorkspaceBody}>{slots.personal}</div>
        </details>
      </section>
      <aside aria-label="Business performance" className={styles.ownerSecondary}>
        {slots.pipeline}{slots.conversion}{slots.targets}
      </aside>
    </div>
  </div>;
}
