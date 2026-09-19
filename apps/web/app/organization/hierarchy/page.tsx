"use client";

import { PanelPopup } from "@/components/panel-popup";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorText,
  Field,
  PageHeader,
  Select,
  SearchActionBar,
  TextInput,
  cx,
} from "@/components/ui";
import { apiGet } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";
import { staffDesignationName } from "@/lib/staff-designation";
import { ConfigurationWorkspace } from "@/components/page-patterns";
import { ProfilePhoto } from "@/components/profile-photo";
import type { HierarchyNode, HierarchyPayload } from "@/lib/types";
import styles from "./hierarchy.module.css";

export default function OrganizationHierarchyPage() {
  const api = getBrowserApiUrl();
  const [data, setData] = useState<HierarchyPayload | null>(null);
  const [officeId, setOfficeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [businessUnitId, setBusinessUnitId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const seenBranches = useRef(new Set<string>());
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (officeId) params.set("officeId", officeId);
    if (departmentId) params.set("departmentId", departmentId);
    if (businessUnitId) params.set("businessUnitId", businessUnitId);
    if (teamId) params.set("teamId", teamId);
    if (includeInactive) params.set("includeInactive", "true");
    if (searchQuery) params.set("q", searchQuery);
    if (selectedId) params.set("selectedUserId", selectedId);
    const loaded = await apiGet<HierarchyPayload>(
      `/api/v1/organization/hierarchy${params.size ? `?${params.toString()}` : ""}`,
      api,
      { signal },
    );
    setData(loaded);
    const rootIds = new Set(loaded.rootIds);
    const newBranches = loaded.nodes.filter((node) =>
      !seenBranches.current.has(node.id) && node.directReportIds.length > 0 &&
      (rootIds.has(node.id) || hierarchyOrder(node) <= 2),
    ).map((node) => node.id);
    newBranches.forEach((id) => seenBranches.current.add(id));
    setExpanded((current) => {
      const next = new Set(current);
      newBranches.forEach((id) => next.add(id));
      loaded.upwardChainIds.forEach((id) => next.add(id));
      return next;
    });
    setError("");
  }, [api, departmentId, businessUnitId, includeInactive, officeId, searchQuery, selectedId, teamId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "Unable to load hierarchy");
      }
    });
    return () => controller.abort();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`hierarchy-node-${selectedId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [data, selectedId]);

  const nodes = useMemo(
    () => new Map((data?.nodes ?? []).map((node) => [node.id, node])),
    [data],
  );
  const selected = selectedId ? nodes.get(selectedId) ?? null : null;
  const orderedRoots = orderHierarchyIds(data?.rootIds ?? [], nodes);

  function resetSelection() {
    setSelectedId("");
    setSearchDraft("");
    setSearchQuery("");
  }

  function chooseNode(id: string) {
    setSelectedId(id);
    setContextOpen(true);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSearchQuery(searchDraft.trim());
    setSelectedId("");
  }

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setAll(open: boolean) {
    setExpanded(open ? new Set(data?.nodes.map((node) => node.id) ?? []) : new Set());
  }

  return (
    <section className={`${styles.hierarchy} space-y-4`}>
      <PageHeader
        title="Organization hierarchy"
        description="Current reporting relationships from saved employee reporting-manager data."
        actions={
          <>
            <ButtonLink href="/organization" variant="secondary">
              Organization masters
            </ButtonLink>
            <Button type="button" variant="secondary" onClick={() => setRefreshKey((key) => key + 1)}>
              Refresh hierarchy
            </Button>
          </>
        }
      />
      <ErrorText>{error}</ErrorText>

      <ConfigurationWorkspace toolbar controls={<Card className={`${styles.toolbar} space-y-4`}>
        <form onSubmit={submitSearch}>
        <SearchActionBar search={<Field label="Employee search" htmlFor="hierarchy-search">
          <TextInput id="hierarchy-search" aria-label="Employee search" placeholder="Search people or employee code" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} />
        </Field>} activeFilters={[
          ...(officeId ? [{ label: "Office", value: data?.filters.offices.find(office => office.id === officeId)?.name ?? officeId }] : []),
          ...(departmentId ? [{ label: "Department", value: data?.filters.departments.find(department => department.id === departmentId)?.name ?? departmentId }] : []),
          ...(businessUnitId ? [{ label: "Business Unit", value: data?.filters.businessUnits.find(unit => unit.id === businessUnitId)?.name ?? businessUnitId }] : []),
          ...(teamId ? [{ label: "Team", value: data?.filters.teams.find(team => team.id === teamId)?.name ?? teamId }] : []),
          ...(includeInactive ? [{ label: "Employees", value: "Includes inactive" }] : []),
        ]} filters={<div className="grid gap-3 md:grid-cols-4">
          <Field label="Company / Office" htmlFor="hierarchy-office">
            <Select
              id="hierarchy-office"
              aria-label="Office filter"
              value={officeId}
              onChange={(event) => {
                setOfficeId(event.target.value);
                setDepartmentId("");
                setBusinessUnitId("");
                setTeamId("");
                setSelectedId("");
              }}
            >
              <option value="">Company view</option>
              {data?.filters.offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Department" htmlFor="hierarchy-department">
            <Select
              id="hierarchy-department"
              aria-label="Department filter"
              value={departmentId}
              onChange={(event) => {
                setDepartmentId(event.target.value);
                setBusinessUnitId("");
                setTeamId("");
                setSelectedId("");
              }}
            >
              <option value="">All departments</option>
              {data?.filters.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Business Unit" htmlFor="hierarchy-business-unit">
            <Select id="hierarchy-business-unit" aria-label="Business Unit" value={businessUnitId} onChange={(event) => { setBusinessUnitId(event.target.value); setTeamId(""); resetSelection(); }}>
              <option value="">All Business Units</option>
              {data?.filters.businessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </Select>
          </Field>
          <Field label="Team" htmlFor="hierarchy-team">
            <Select
              id="hierarchy-team"
              aria-label="Team filter"
              value={teamId}
              onChange={(event) => {
                setTeamId(event.target.value);
                setSelectedId("");
              }}
            >
              <option value="">All teams</option>
              {data?.filters.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm text-slate-900">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => {
                setIncludeInactive(event.target.checked);
                setSelectedId("");
              }}
            />
            Include inactive / historical employees
          </label>
        </div>} actions={<>
          <Button type="submit">Search</Button>
          <Button type="button" variant="secondary" onClick={resetSelection}>
            Clear search
          </Button>
        </>} />
        </form>
        {searchQuery ? (
          <div aria-label="Hierarchy search results" className="flex flex-wrap gap-2">
            {data?.searchResults.length ? (
              data.searchResults.map((result) => (
                <Button key={result.id} type="button" variant="secondary" onClick={() => chooseNode(result.id)}>
                  {result.employeeCode} — {result.fullName}
                </Button>
              ))
            ) : (
              <p className="text-sm text-slate-600">No authorized employees found.</p>
            )}
          </div>
        ) : null}
      </Card>}>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {data?.nodes.length ?? 0} visible employees · {data?.scope ?? "—"} scope
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setAll(true)}>
            Expand all
          </Button>
          <Button type="button" variant="secondary" onClick={() => setAll(false)}>
            Collapse all
          </Button>
        </div>
      </div>

      <div className={`${styles.treeLayout} grid min-w-0 gap-6`}>
        <div data-testid="hierarchy-canvas" className="min-w-0">
          <Card className={styles.canvasSurface} tabIndex={0} aria-label="Organization reporting canvas">
            {data?.rootIds.length ? (
              <>
                <p className={styles.rootNote}>
                  {orderedRoots.length} independent reporting {orderedRoots.length === 1 ? "root" : "roots"}. Saved manager links determine every branch; no links are drawn between independent roots. A root&apos;s manager may be unassigned or outside your permitted scope.
                </p>
                <ul aria-label="Reporting tree" className={styles.forest}>
                  {orderedRoots.map((rootId) => (
                    <HierarchyBranch
                      key={rootId}
                      nodeId={rootId}
                      nodes={nodes}
                      expanded={expanded}
                      selectedId={selectedId}
                      onToggle={toggle}
                      onSelect={chooseNode}
                      rootLabel="Independent root · No visible manager"
                    />
                  ))}
                </ul>
              </>
            ) : (
              <EmptyState kind="search" title="No records match the selected filters" />
            )}
          </Card>
        </div>
        <PanelPopup label="Employee reporting details" open={contextOpen} onOpenChange={setContextOpen}><SelectedContext node={selected} payload={data} nodes={nodes} /></PanelPopup>
      </div>
      </ConfigurationWorkspace>
    </section>
  );
}

function HierarchyBranch({
  nodeId,
  nodes,
  expanded,
  selectedId,
  onToggle,
  onSelect,
  siblingIndex,
  siblingCount,
  depth = 0,
  rootLabel,
}: {
  nodeId: string;
  nodes: Map<string, HierarchyNode>;
  expanded: Set<string>;
  selectedId: string;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  siblingIndex?: number;
  siblingCount?: number;
  depth?: number;
  rootLabel?: string;
}) {
  const node = nodes.get(nodeId);
  if (!node) return null;
  const open = expanded.has(node.id);
  const hasParentConnector = siblingIndex !== undefined && siblingCount !== undefined;
  const multipleSiblings = hasParentConnector && siblingCount > 1;
  return (
    <li data-hierarchy-branch="" className={cx(styles.branch, hasParentConnector && styles.childBranch)}>
      {rootLabel ? <p className={styles.rootLabel}>{rootLabel}</p> : null}
      {hasParentConnector ? (
        <>
          <span
            aria-hidden="true"
            className={styles.parentConnector}
          />
          {multipleSiblings ? (
            <span
              aria-hidden="true"
              className={cx(
                styles.siblingConnector,
                siblingIndex === 0
                  ? styles.firstConnector
                  : siblingIndex === siblingCount - 1
                    ? styles.lastConnector
                    : styles.middleConnector,
              )}
            />
          ) : null}
        </>
      ) : null}
      <div className={styles.nodeRow}>
        <button
          id={`hierarchy-node-${node.id}`}
          data-testid={`hierarchy-node-${node.id}`}
          data-highlighted={selectedId === node.id ? "true" : "false"}
          data-root={!hasParentConnector ? "true" : "false"}
          data-has-reports={node.directReportIds.length ? "true" : "false"}
          data-depth={Math.min(depth, 2)}
          type="button"
          aria-label={`Select ${node.fullName}`}
          aria-haspopup="dialog"
          className={cx(styles.employeeCard, "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-primary")}
          onClick={() => onSelect(node.id)}
        >
          <span data-testid={`hierarchy-avatar-${node.id}`}>
            <ProfilePhoto userId={node.id} fullName={node.fullName} hasPhoto={node.hasPhoto} version={node.photoUpdatedAt} size="list" className={styles.avatar} />
          </span>
          <span className={styles.employeeCopy}>
            <span
              className={styles.employeeName}
              title={node.fullName}
            >
              {node.fullName}
            </span>
            <span
              className={styles.employeeDesignation}
              title={staffDesignationName(node) ?? "No designation"}
            >
              {staffDesignationName(node) ?? "No designation"}
            </span>
          </span>
        </button>
        {node.directReportIds.length ? (
          <button
            type="button"
            aria-label={`${open ? "Collapse" : "Expand"} branch for ${node.fullName}`}
            aria-expanded={open}
            className={cx(styles.branchToggle, "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-primary")}
            onClick={() => onToggle(node.id)}
          >
            <span aria-hidden="true">{open ? "−" : "+"}</span>
          </button>
        ) : (
          null
        )}
      </div>
      {open && node.directReportIds.length ? (
        <div className={styles.childrenGroup}>
          <ul className={styles.siblingList}>
            {orderHierarchyIds(node.directReportIds, nodes).map((childId, index) => (
              <HierarchyBranch
                key={childId}
                nodeId={childId}
                nodes={nodes}
                expanded={expanded}
                selectedId={selectedId}
                onToggle={onToggle}
                onSelect={onSelect}
                siblingIndex={index}
                siblingCount={node.directReportIds.length}
                depth={depth + 1}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

function hierarchyOrder(node: HierarchyNode | undefined) {
  switch (node?.userType?.code) {
    case "OWNER": return 0;
    case "MD": return 1;
    case "SM": return 2;
    case "TL": return 3;
    case "COD": return 4;
    default: return 5;
  }
}

// Presentation order only: neither parent IDs nor direct-report membership changes.
function orderHierarchyIds(ids: string[], nodes: Map<string, HierarchyNode>) {
  return [...ids].sort((leftId, rightId) => {
    const left = nodes.get(leftId);
    const right = nodes.get(rightId);
    return hierarchyOrder(left) - hierarchyOrder(right) ||
      (left?.employeeCode ?? "").localeCompare(right?.employeeCode ?? "") ||
      (left?.fullName ?? "").localeCompare(right?.fullName ?? "");
  });
}

function SelectedContext({
  node,
  payload,
  nodes,
}: {
  node: HierarchyNode | null;
  payload: HierarchyPayload | null;
  nodes: Map<string, HierarchyNode>;
}) {
  if (!node || !payload) {
    return <Card><EmptyState>Select an employee to inspect reporting context.</EmptyState></Card>;
  }
  const manager = node.reportingManagerId ? nodes.get(node.reportingManagerId) : null;
  const chain = payload.upwardChainIds.map((id) => nodes.get(id)).filter(Boolean) as HierarchyNode[];
  const reports = payload.directReportIds.map((id) => nodes.get(id)).filter(Boolean) as HierarchyNode[];
  return (
    <Card className="space-y-4" >
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Selected employee</h3>
        <p className="text-sm text-slate-600">{node.employeeCode}</p>
      </div>
      <dl className="grid gap-2 text-sm">
        <Detail label="Full name" value={node.fullName} />
        <Detail label="Designation" value={staffDesignationName(node)} />
        <Detail label="Office" value={node.office?.name} />
        <Detail label="Department" value={node.department?.name} />
        <Detail label="Business Unit" value={node.businessUnit?.name} />
        <Detail label="Team" value={node.team?.name} />
        <Detail label="Reporting manager" value={manager?.fullName ?? "No visible reporting manager"} />
        <Detail label="Employment status" value={node.employmentStatus} />
        {node.contextOnly ? (
          <Detail label="Hierarchy context" value="Included as reporting context for the current filters." />
        ) : null}
      </dl>
      <div className="space-y-1 text-sm">
        <h4 className="font-medium text-slate-900">Upward reporting chain</h4>
        <p>{chain.map((item) => item.fullName).join(" → ") || "No visible manager chain"}</p>
      </div>
      <div className="space-y-1 text-sm">
        <h4 className="font-medium text-slate-900">Direct reports ({reports.length})</h4>
        {reports.length ? (
          <ul className="space-y-1">
            {reports.map((report) => (
              <li key={report.id}>{report.employeeCode} — {report.fullName}</li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-600">No authorized direct reports.</p>
        )}
      </div>
      <Link className="text-sm font-medium text-brand-link underline" href={`/users/${node.id}`}>
        Open employee profile
      </Link>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value ?? "—"}</dd>
    </div>
  );
}
