"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import {
  Badge,
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
      if (next.size === 0) loaded.rootIds.forEach((id) => next.add(id));
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
    <section className="space-y-6">
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <Card className="overflow-x-auto p-4">
          {data?.rootIds.length ? (
            <ul aria-label="Reporting tree" className="min-w-max space-y-4">
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
}: {
  nodeId: string;
  nodes: Map<string, HierarchyNode>;
  expanded: Set<string>;
  selectedId: string;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const node = nodes.get(nodeId);
  if (!node) return null;
  const open = expanded.has(node.id);
  return (
    <li>
      <div
        id={`hierarchy-node-${node.id}`}
        data-testid={`hierarchy-node-${node.id}`}
        data-highlighted={selectedId === node.id ? "true" : "false"}
        className={cx(
          "inline-flex min-w-72 items-start gap-2 rounded-lg border bg-white p-3",
          selectedId === node.id
            ? "border-[#0f4c81] bg-blue-50 ring-2 ring-[#0f4c81]/20"
            : "border-slate-200",
        )}
      >
        {node.directReportIds.length ? (
          <button
            type="button"
            aria-label={`${open ? "Collapse" : "Expand"} branch for ${node.fullName}`}
            aria-expanded={open}
            className="mt-0.5 h-6 w-6 rounded border border-slate-300 text-sm"
            onClick={() => onToggle(node.id)}
          >
            {open ? "−" : "+"}
          </button>
        ) : (
          <span className="mt-0.5 inline-block h-6 w-6" />
        )}
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(node.id)}>
          <span className="block font-semibold text-slate-900">{node.fullName}</span>
          <span className="block text-xs text-slate-600">{node.employeeCode}</span>
          <span className="mt-1 block text-xs text-slate-500">
            {node.designation?.name ?? "No designation"}
          </span>
          {node.contextOnly ? <Badge>Ancestor context</Badge> : null}
        </button>
      </div>
      {open && node.directReportIds.length ? (
        <ul className="ml-6 mt-3 space-y-3 border-l border-slate-300 pl-5">
          {node.directReportIds.map((childId) => (
            <HierarchyBranch
              key={childId}
              nodeId={childId}
              nodes={nodes}
              expanded={expanded}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
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
      <Link className="text-sm font-medium text-[#0f4c81] underline" href={`/users/${node.id}`}>
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
