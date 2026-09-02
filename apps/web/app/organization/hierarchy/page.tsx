"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorText,
  Field,
  PageHeader,
  Select,
  TextInput,
  cx,
} from "@/components/ui";
import { apiGet } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";
import type { HierarchyNode, HierarchyPayload } from "@/lib/types";

export default function OrganizationHierarchyPage() {
  const api = getBrowserApiUrl();
  const [data, setData] = useState<HierarchyPayload | null>(null);
  const [officeId, setOfficeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (officeId) params.set("officeId", officeId);
    if (departmentId) params.set("departmentId", departmentId);
    if (teamId) params.set("teamId", teamId);
    if (includeInactive) params.set("includeInactive", "true");
    if (searchQuery) params.set("q", searchQuery);
    if (selectedId) params.set("selectedUserId", selectedId);
    const loaded = await apiGet<HierarchyPayload>(
      `/api/v1/organization/hierarchy${params.size ? `?${params.toString()}` : ""}`,
      api,
    );
    setData(loaded);
    setExpanded((current) => {
      const next = new Set(current);
      loaded.upwardChainIds.forEach((id) => next.add(id));
      return next;
    });
    setError("");
  }, [api, departmentId, includeInactive, officeId, searchQuery, selectedId, teamId]);

  useEffect(() => {
    void load().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : "Unable to load hierarchy"),
    );
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

  function resetSelection() {
    setSelectedId("");
    setSearchDraft("");
    setSearchQuery("");
  }

  function chooseNode(id: string) {
    setSelectedId(id);
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
    <section className="space-y-4">
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

      <Card className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Company / Office" htmlFor="hierarchy-office">
            <Select
              id="hierarchy-office"
              aria-label="Office filter"
              value={officeId}
              onChange={(event) => {
                setOfficeId(event.target.value);
                setDepartmentId("");
                setTeamId("");
                setSelectedId("");
              }}
            >
              <option value="">Company view</option>
              {data?.filters.offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.code} — {office.name}
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
                setTeamId("");
                setSelectedId("");
              }}
            >
              <option value="">All departments</option>
              {data?.filters.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.code} — {department.name}
                </option>
              ))}
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
                  {team.code} — {team.name}
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
        </div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={submitSearch}>
          <Field label="Employee search" htmlFor="hierarchy-search" className="min-w-72 flex-1">
            <TextInput
              id="hierarchy-search"
              aria-label="Employee search"
              placeholder="Employee code or name"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
          </Field>
          <Button type="submit">Search</Button>
          <Button type="button" variant="secondary" onClick={resetSelection}>
            Clear search
          </Button>
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
      </Card>

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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div data-testid="hierarchy-canvas" className="min-w-0">
          <Card className="min-w-0 overflow-x-auto p-3">
            {data?.rootIds.length ? (
              <ul
                aria-label="Reporting tree"
                className="flex w-max min-w-full items-start justify-center py-1"
              >
                {data.rootIds.map((rootId) => (
                  <HierarchyBranch
                    key={rootId}
                    nodeId={rootId}
                    nodes={nodes}
                    expanded={expanded}
                    selectedId={selectedId}
                    onToggle={toggle}
                    onSelect={chooseNode}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState>No employees match the authorized hierarchy filters.</EmptyState>
            )}
          </Card>
        </div>
        <SelectedContext node={selected} payload={data} nodes={nodes} />
      </div>
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
}: {
  nodeId: string;
  nodes: Map<string, HierarchyNode>;
  expanded: Set<string>;
  selectedId: string;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  siblingIndex?: number;
  siblingCount?: number;
}) {
  const node = nodes.get(nodeId);
  if (!node) return null;
  const open = expanded.has(node.id);
  const hasParentConnector = siblingIndex !== undefined && siblingCount !== undefined;
  const multipleSiblings = hasParentConnector && siblingCount > 1;
  return (
    <li className={cx("relative flex flex-col items-center px-2", hasParentConnector && "pt-5")}>
      {hasParentConnector ? (
        <>
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-0 h-5 border-l border-slate-300"
          />
          {multipleSiblings ? (
            <span
              aria-hidden="true"
              className={cx(
                "absolute top-0 border-t border-slate-300",
                siblingIndex === 0
                  ? "left-1/2 right-0"
                  : siblingIndex === siblingCount - 1
                    ? "left-0 right-1/2"
                    : "inset-x-0",
              )}
            />
          ) : null}
        </>
      ) : null}
      <div
        id={`hierarchy-node-${node.id}`}
        data-testid={`hierarchy-node-${node.id}`}
        data-highlighted={selectedId === node.id ? "true" : "false"}
        className={cx(
          "flex w-52 items-center gap-1.5 rounded-md border bg-white px-2 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.05)]",
          selectedId === node.id
            ? "border-brand-primary bg-brand-soft ring-2 ring-brand-primary/20"
            : "border-slate-200",
        )}
      >
        <button
          type="button"
          aria-label={`Select ${node.fullName}`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-primary"
          onClick={() => onSelect(node.id)}
        >
          <span
            data-testid={`hierarchy-avatar-${node.id}`}
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700"
          >
            {employeeInitials(node.fullName)}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className="line-clamp-2 block text-sm font-semibold leading-4 text-slate-900"
              title={node.fullName}
            >
              {node.fullName}
            </span>
            <span
              className="mt-0.5 block truncate text-xs leading-4 text-slate-500"
              title={node.designation?.name ?? "No designation"}
            >
              {node.designation?.name ?? "No designation"}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[10px] leading-3 text-slate-400">
              <span className="min-w-0 truncate">{node.employeeCode}</span>
              {node.contextOnly ? (
                <span className="rounded bg-slate-100 px-1 text-slate-500">Context</span>
              ) : null}
            </span>
          </span>
        </button>
        {node.directReportIds.length ? (
          <button
            type="button"
            aria-label={`${open ? "Collapse" : "Expand"} branch for ${node.fullName}`}
            aria-expanded={open}
            className="mt-0.5 size-5 shrink-0 rounded border border-slate-300 text-xs leading-none text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-primary"
            onClick={() => onToggle(node.id)}
          >
            {open ? "−" : "+"}
          </button>
        ) : (
          <span className="mt-0.5 inline-block size-5 shrink-0" />
        )}
      </div>
      {open && node.directReportIds.length ? (
        <div className="relative mt-5 flex flex-col items-center">
          <span
            aria-hidden="true"
            className="absolute -top-5 left-1/2 h-5 border-l border-slate-300"
          />
          <ul className="flex items-start justify-center">
            {node.directReportIds.map((childId, index) => (
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
              />
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

function employeeInitials(fullName: string) {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "?";
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
        <h3 className="font-semibold text-slate-900">Selected employee</h3>
        <p className="text-sm text-slate-600">{node.employeeCode}</p>
      </div>
      <dl className="grid gap-2 text-sm">
        <Detail label="Full name" value={node.fullName} />
        <Detail label="Designation" value={node.designation?.name} />
        <Detail label="User type" value={node.userType?.name} />
        <Detail label="Office" value={node.office?.name} />
        <Detail label="Department" value={node.department?.name} />
        <Detail label="Team" value={node.team?.name} />
        <Detail label="Reporting manager" value={manager?.fullName} />
        <Detail label="Employment status" value={node.employmentStatus} />
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
