"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DateRangePicker } from "@/components/date-picker";
import { TlCaseJourney, caseJourneyDate } from "@/components/tl-case-journey";
import { IconChevronDown, IconFilter } from "@/components/icons";
import { Badge, Button, Card, EmptyState, ErrorText, Field, Select, StatusBadge, TextInput, cx, focusRing } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";
import { formatDuration } from "@/lib/duration";
import { caseLastActivity, caseStageLabel, caseTotalSeconds } from "@/lib/tl-case-journey";
import type { ApplicationEventRecord, ApplicationRecord } from "@/lib/types";
import styles from "./tl-case-timeline.module.css";

type CaseOption = { id: string; name: string; ownerId: string };
type StaffOption = { id: string; name: string };
type CaseRow = { item: ApplicationRecord; events: ApplicationEventRecord[]; review: { status: string | null; tlName: string | null } };
type FilterDraft = { member: string; from: string; to: string; search: string; caseId: string; stage: string };

export function TlCaseTimeline({ caseOptions, staff, view }: { caseOptions: CaseOption[]; staff: StaffOption[]; view: "own" | "team" }) {
  const searchParams = useSearchParams();
  const filters = useMemo(() => ({
    member: searchParams.get("member_id") ?? "",
    from: searchParams.get("date_from") ?? "",
    to: searchParams.get("date_to") ?? "",
    search: searchParams.get("case_search") ?? "",
    caseId: searchParams.get("case_id") ?? "",
    stage: searchParams.get("case_stage") ?? "",
  }), [searchParams]);
  const [draft, setDraft] = useState<FilterDraft>(filters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [visibleCount, setVisibleCount] = useState(12);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setDraft(filters), [filters]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const api = getBrowserApiUrl();
    void (async () => {
      const loaded: CaseRow[] = [];
      let failed = 0;
      for (let start = 0; start < caseOptions.length; start += 4) {
        const group = await Promise.allSettled(caseOptions.slice(start, start + 4).map(async option => {
          const item = await apiGet<ApplicationRecord>(`/api/v1/applications/${option.id}`, api);
          const [history, review] = await Promise.all([
            apiGet<{ items: ApplicationEventRecord[] }>(`/api/v1/applications/${option.id}/timeline`, api),
            apiGet<{ status?: string | null; tlName?: string | null }>(`/api/v1/applications/${option.id}/internal-review`, api),
          ]);
          return { item, events: history.items, review: { status: review.status ?? null, tlName: review.tlName ?? null } };
        }));
        for (const result of group) {
          if (result.status === "fulfilled") loaded.push(result.value);
          else failed += 1;
        }
        if (!active) return;
      }
      if (active) {
        setRows(loaded.sort((a, b) => caseLastActivity(b.item, b.events) - caseLastActivity(a.item, a.events) || a.item.applicationCode.localeCompare(b.item.applicationCode)));
        setError(failed ? `${failed} case${failed === 1 ? "" : "s"} could not be loaded in your current access scope.` : "");
      }
    })().finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [caseOptions]);

  const stages = useMemo(() => [...new Set(rows.map(row => caseStageLabel(row.item, row.review)))].sort(), [rows]);
  const shown = rows.filter(row => {
    const item = row.item;
    const created = item.createdAt.slice(0, 10);
    return (!filters.member || item.caseOwnerId === filters.member)
      && (!filters.from || created >= filters.from)
      && (!filters.to || created <= filters.to)
      && (!filters.caseId || item.id === filters.caseId)
      && (!filters.search || item.applicationCode.toLowerCase().includes(filters.search.toLowerCase()))
      && (!filters.stage || caseStageLabel(item, row.review) === filters.stage);
  });
  const visible = shown.slice(0, visibleCount);
  const applied = [
    filters.member && ["Team member", staff.find(person => person.id === filters.member)?.name ?? "Selected member", "member_id"],
    filters.from && filters.to && ["Created", `${filters.from} – ${filters.to}`, "date_from"],
    filters.search && ["Search", filters.search, "case_search"],
    filters.caseId && ["Case", caseOptions.find(option => option.id === filters.caseId)?.name ?? "Selected case", "case_id"],
    filters.stage && ["Stage", filters.stage, "case_stage"],
  ].filter((value): value is string[] => Boolean(value));

  function navigate(changes: Record<string, string>) {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
    next.set("page", "1");
    window.history.pushState(null, "", `/reports?${next}`);
    setVisibleCount(12);
    setExpanded(new Set());
  }
  function clear() {
    setDraft({ member: "", from: "", to: "", search: "", caseId: "", stage: "" });
    navigate({ member_id: "", date_from: "", date_to: "", case_search: "", case_id: "", case_stage: "" });
    setFilterOpen(false);
  }
  function toggle(id: string) { setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  return <div className={styles.workspace}>
    <Card className={styles.controls}>
      <div className={styles.controlTop}>
        <div role="tablist" aria-label="Timeline ownership" className={styles.ownership}>
          <Button role="tab" aria-selected={view === "own"} variant={view === "own" ? "primary" : "secondary"} onClick={() => navigate({ view: "own", member_id: "" })}>My Timeline</Button>
          <Button role="tab" aria-selected={view === "team"} variant={view === "team" ? "primary" : "secondary"} onClick={() => navigate({ view: "team" })}>Team Timeline</Button>
        </div>
        <Button variant="secondary" className={styles.mobileFilter} aria-expanded={filterOpen} aria-controls="tl-case-filters" onClick={() => setFilterOpen(value => !value)}><IconFilter aria-hidden="true" className="size-4" />Filters</Button>
      </div>
      <div id="tl-case-filters" className={styles.fields} data-open={filterOpen} data-view={view}>
        {view === "team" && <Field label="Team member"><Select value={draft.member} onChange={event => setDraft(current => ({ ...current, member: event.target.value }))}><option value="">All direct SE members</option>{staff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</Select></Field>}
        <div className={styles.dateField}><span>Created date range</span><DateRangePicker aria-label="Case created date range" from={draft.from} to={draft.to} onChange={range => setDraft(current => ({ ...current, from: range.from, to: range.to }))} /></div>
        <Field label="Search case"><TextInput value={draft.search} onChange={event => setDraft(current => ({ ...current, search: event.target.value }))} placeholder="Case number" /></Field>
        <Field label="Case"><Select value={draft.caseId} onChange={event => setDraft(current => ({ ...current, caseId: event.target.value }))}><option value="">All cases</option>{caseOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</Select></Field>
        <Field label="Current stage"><Select value={draft.stage} onChange={event => setDraft(current => ({ ...current, stage: event.target.value }))}><option value="">All stages</option>{stages.map(stage => <option key={stage} value={stage}>{stage}</option>)}</Select></Field>
        <div className={styles.actions}><Button disabled={Boolean(draft.from) !== Boolean(draft.to)} onClick={() => { navigate({ member_id: view === "team" ? draft.member : "", date_from: draft.from, date_to: draft.to, case_search: draft.search, case_id: draft.caseId, case_stage: draft.stage }); setFilterOpen(false); }}>Apply</Button><Button variant="ghost" onClick={clear}>Clear filters</Button></div>
      </div>
      {applied.length > 0 && <div className={styles.chips} aria-label="Applied case filters">{applied.map(([label, value, key]) => <button key={key} type="button" className={cx(focusRing, styles.chip)} onClick={() => navigate(key === "date_from" ? { date_from: "", date_to: "" } : { [key]: "" })}>{label}: {value} <span aria-hidden="true">×</span></button>)}</div>}
    </Card>
    <Card className={styles.list}>
      <header className={styles.listHeader}><div><h2>{view === "own" ? "My Timeline" : "Team Timeline"}</h2><p>Cases ordered by latest recorded activity</p></div><Badge>{shown.length} {shown.length === 1 ? "case" : "cases"}</Badge></header>
      <ErrorText>{error}</ErrorText>
      {loading ? <div className={styles.empty}>Loading authorized cases…</div> : visible.length ? <ul className={styles.caseList}>{visible.map(({ item, events, review }) => {
        const open = expanded.has(item.id);
        const stage = caseStageLabel(item, review);
        return <li key={item.id} className={styles.caseItem} data-expanded={open}>
          <div className={styles.caseRow}>
            <Link href={`/applications/${item.id}`} className={cx(focusRing, styles.caseLink)}>{item.applicationCode}</Link>
            <button type="button" className={cx(focusRing, styles.rowToggle)} aria-expanded={open} aria-controls={`tl-case-journey-${item.id}`} aria-label={`${open ? "Collapse" : "Expand"} journey for ${item.applicationCode}`} onClick={() => toggle(item.id)}>
              <span className={styles.rowStage}><StatusBadge value={stage} /></span>
              <span><small>Case Owner</small>{item.caseOwnerName || "—"}</span>
              <span><small>Team Leader</small>{review.tlName || "—"}</span>
              <span><small>Sales Manager</small>{item.routedSalesManagerName || "—"}</span>
              <span><small>Coordinator</small>{item.routedCoordinatorName || "—"}</span>
              <span><small>Created</small>{caseJourneyDate(item.createdAt)}</span>
              <span><small>Total elapsed</small>{formatDuration(caseTotalSeconds(item, now))}</span>
              <IconChevronDown aria-hidden="true" className={styles.chevron} />
            </button>
          </div>
          {open && <div id={`tl-case-journey-${item.id}`} className={styles.expanded}><TlCaseJourney item={item} events={events} /></div>}
        </li>;
      })}</ul> : <div className={styles.empty}><EmptyState>No cases match the selected filters.</EmptyState></div>}
      {shown.length > visibleCount && <div className={styles.loadMore}><span>Showing {visible.length} of {shown.length} cases</span><Button variant="secondary" onClick={() => setVisibleCount(count => count + 12)}>Load more cases</Button></div>}
    </Card>
  </div>;
}
