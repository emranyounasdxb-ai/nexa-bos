import type { ReactNode } from "react";
import styles from "./page-patterns.module.css";

/** Presentation regions only: callers retain their data, actions and permissions. */
export function RecordFrame({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return <div className={styles.record}><aside className={styles.recordSummary} aria-label="Record summary">{summary}</aside><div className={styles.recordBody}>{children}</div></div>;
}

export function FormFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className={styles.form}><aside className={styles.formGuide}><span className={styles.marker} aria-hidden="true" /><h2>{title}</h2><p>{description}</p></aside><div className={styles.formBody}>{children}</div></div>;
}

export function ConfigurationWorkspace({ controls, children }: { controls: ReactNode; children: ReactNode }) {
  return <div className={styles.configuration}><aside className={styles.configurationControls} aria-label="Configuration context">{controls}</aside><div className={styles.recordBody}>{children}</div></div>;
}

export function RegisterWorkspace({ editor, children }: { editor: ReactNode; children: ReactNode }) {
  return <div className={editor ? styles.register : styles.recordBody}><div className={styles.recordBody}>{children}</div>{editor && <aside className={styles.registerEditor} aria-label="Register editor">{editor}</aside>}</div>;
}

export function ListWorkspace({ title, filters, children }: { title: string; filters: ReactNode; children: ReactNode }) {
  return <section className={styles.list} aria-label={title}><header className={styles.listHeader}><h2>{title}</h2></header><div className={styles.listFilters}>{filters}</div><div className={styles.listBody}>{children}</div></section>;
}
