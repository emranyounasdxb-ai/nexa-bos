import type { ReactNode } from "react";
import styles from "./page-patterns.module.css";
import { Card } from "./ui";
import { IconChevronRight } from "./icons";
import Link from "next/link";

/** Source asset tabs; the owning page supplies its existing authorized destinations. */
export function AssetWorkspaceTabs({ active, items }: { active: string; items: { href: string; label: string }[] }) {
  return <nav className={styles.assetTabs} aria-label="Asset workspace">{items.map(item => <Link key={item.href} href={item.href} aria-current={active === item.href ? "page" : undefined}>{item.label}</Link>)}</nav>;
}

/** Approved compact record composition; callers own links, data and actions. */
export function RecordIdentity({ icon, title, subtitle, navigable = true, tone = "brand" }: { icon: ReactNode; title: ReactNode; subtitle?: ReactNode; navigable?: boolean; tone?: "brand" | "success" | "info" | "warning" }) {
  return <><span className={styles.recordIcon} data-tone={tone}>{icon}</span><span className={styles.identityCopy}><strong data-amafh-record-primary="">{title}</strong>{subtitle && <small data-amafh-record-secondary="">{subtitle}</small>}</span>{navigable && <IconChevronRight className="size-4 shrink-0" />}</>;
}

export function RecordCard({ identity, status, children }: { identity: ReactNode; status: ReactNode; children?: ReactNode }) {
  return <Card data-amafh-list-record="" className={styles.compactRecord}><div className={styles.compactIdentity}>{identity}</div><div className={styles.recordStatus}>{status}</div>{children && <details className={styles.recordDetails}><summary>Record details</summary><div>{children}</div></details>}</Card>;
}

/** Presentation regions only: callers retain their data, actions and permissions. */
export function RecordFrame({ summary, children, variant = "detail" }: { summary: ReactNode; children: ReactNode; variant?: "detail" | "organization" | "permissions" | "balances" | "responsive" }) {
  return <div className={`${styles.record} ${variant === "detail" ? "" : styles[variant]}`}><aside className={styles.recordSummary} aria-label="Record summary">{summary}</aside><div className={styles.recordBody}>{children}</div></div>;
}

export function FormFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className={styles.form}><aside className={styles.formGuide}><span className={styles.marker} aria-hidden="true" /><h2>{title}</h2><p>{description}</p></aside><div className={styles.formBody}>{children}</div></div>;
}

export function ConfigurationWorkspace({ controls, children, wideControls = false, toolbar = false }: { controls: ReactNode; children: ReactNode; wideControls?: boolean; toolbar?: boolean }) {
  return <div className={`${styles.configuration} ${wideControls ? styles.configurationWide : ""} ${toolbar ? styles.configurationToolbar : ""}`}><aside className={styles.configurationControls} aria-label="Configuration context">{controls}</aside><div className={styles.recordBody}>{children}</div></div>;
}

export function RegisterWorkspace({ editor, children }: { editor: ReactNode; children: ReactNode }) {
  return <div className={editor ? styles.register : styles.recordBody}><div className={styles.recordBody}>{children}</div>{editor && <aside className={styles.registerEditor} aria-label="Register editor">{editor}</aside>}</div>;
}

export function ListWorkspace({ title, description, filters, children, variant = "records", summary, hideHeader = false }: { title: string; description?: ReactNode; filters: ReactNode; children: ReactNode; variant?: "records" | "report"; summary?: ReactNode; hideHeader?: boolean }) {
  return <section data-amafh-list-workspace="" className={`${styles.list} ${variant === "report" ? styles.report : ""} ${summary ? styles.withSummary : ""}`} aria-label={title}>{!hideHeader && <header className={styles.listHeader}><h2>{title}</h2>{description && <p>{description}</p>}</header>}<div data-amafh-list-filters="" className={styles.listFilters}>{filters}</div><div data-amafh-list-body="" className={styles.listBody}>{children}</div>{summary && <aside data-amafh-list-summary="" className={styles.listSummary} aria-label={`${title} summary`}>{summary}</aside>}</section>;
}
