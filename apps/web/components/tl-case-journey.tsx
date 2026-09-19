"use client";

import { useEffect, useMemo, useState } from "react";
import type { ApplicationEventRecord, ApplicationRecord } from "@/lib/types";
import { buildCaseJourney, caseTotalSeconds } from "@/lib/tl-case-journey";
import { formatDuration } from "@/lib/duration";
import styles from "./tl-case-journey.module.css";

export function caseJourneyDate(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).format(date).replace(/\b(am|pm)\b/g, part => part.toUpperCase());
}

export function TlCaseJourney({ item, events }: { item: ApplicationRecord; events: ApplicationEventRecord[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const steps = useMemo(() => buildCaseJourney(item, events), [item, events]);
  return <div className={styles.journey}>
    <div className={styles.heading}><h3>Case journey</h3><span>Total elapsed <strong>{formatDuration(caseTotalSeconds(item, now))}</strong></span></div>
    <ol className={styles.steps} aria-label="Case journey">
      {steps.map((step, index) => <li key={step.key} className={styles.step} data-state={step.state}>
        <div className={styles.stepTop}><span className={styles.marker} aria-hidden="true">{index + 1}</span><span className={styles.state}>{step.state}</span></div>
        <strong className={styles.name}>{step.label}</strong>
        <time className={styles.date} dateTime={step.at ?? undefined}>{step.state === "upcoming" ? "Upcoming" : caseJourneyDate(step.at)}</time>
        {step.state !== "upcoming" && <span className={styles.actor}>{step.actor ? `${step.actor}${step.actorRole ? ` · ${step.actorRole}` : ""}` : "Action by —"}</span>}
        {step.durationSeconds != null && index > 0 && <span className={styles.duration}>From previous · {step.durationSeconds === 0 ? (Date.parse(step.at ?? "") > Date.parse(steps[index - 1]?.at ?? "") ? "Under 1s" : "Same recorded action") : formatDuration(step.durationSeconds)}</span>}
        {step.state === "current" && step.currentSince && <span className={styles.duration}>Current stage · {formatDuration(Math.max(0, Math.floor((now - Date.parse(step.currentSince)) / 1000)))}</span>}
      </li>)}
    </ol>
  </div>;
}
