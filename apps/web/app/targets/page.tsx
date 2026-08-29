"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DatePicker } from "@/components/date-picker";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorText,
  Field,
  FilterBar,
  PageHeader,
  Select,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
} from "@/components/ui";
import { apiGet, apiRequest, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import { formatAed, formatPct } from "@/lib/reports";

type Named = { id: string; name: string; code?: string; employeeCode?: string; employmentStatus?: string };
type ProductOpt = {
  id: string;
  code: string;
  name: string;
  requestedAmountRequired: boolean;
  defaultMeasurement: string;
};
type TargetResult = {
  target: string;
  effectiveTarget: string;
  actual: string;
  achievementPct: number | null;
  gap: string;
  exceeded: boolean;
  dailyRequiredRunRate: string | null;
  remainingWorkingDays: number;
  period: string;
  from: string;
  to: string;
};
type Target = {
  id: string;
  level: string;
  entityId: string;
  entityName: string | null;
  periodMonth: string;
  productCode: string | null;
  bankCode: string | null;
  milestone: string;
  measurement: string;
  targetValue: string;
  prorate: boolean;
  status: string;
  locked: boolean;
  result: TargetResult | null;
  history?: { id: string; reason: string; oldValues: object; newValues: object; createdAt: string }[];
};
type Options = {
  employees: Named[];
  teams: Named[];
  offices: Named[];
  products: ProductOpt[];
  banks: { id: string; code: string; name: string }[];
  lockedMonths: string[];
};

function monthFirst(value: string): string {
  return value ? `${value.slice(0, 7)}-01` : "";
}

export default function TargetsPage() {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [options, setOptions] = useState<Options | null>(null);
  const [items, setItems] = useState<Target[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState("employee");
  const [entityId, setEntityId] = useState("");
  const [periodMonth, setPeriodMonth] = useState(monthFirst(new Date().toISOString().slice(0, 10)));
  const [productId, setProductId] = useState("");
  const [bankId, setBankId] = useState("");
  const [milestone, setMilestone] = useState("submitted");
  const [measurement, setMeasurement] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [prorate, setProrate] = useState(false);
  const [filterLevel, setFilterLevel] = useState("");
  const [filterPeriod, setFilterPeriod] = useState("month");
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editReason, setEditReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<Target["history"]>([]);

  const entities = useMemo(() => {
    if (!options) return [];
    if (level === "team") return options.teams;
    if (level === "office") return options.offices;
    return options.employees;
  }, [level, options]);

  const selectedProduct = options?.products.find((item) => item.id === productId);

  const load = useCallback(async () => {
    try {
      setError("");
      const query = new URLSearchParams({ period: filterPeriod });
      if (filterLevel) query.set("level", filterLevel);
      if (periodMonth) query.set("period_month", monthFirst(periodMonth));
      const [opts, listed] = await Promise.all([
        apiGet<Options>("/api/v1/targets/options", api),
        apiGet<{ items: Target[] }>(`/api/v1/targets?${query}`, api),
      ]);
      setOptions(opts);
      setItems(listed.items);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to load targets");
    }
  }, [api, filterLevel, filterPeriod, periodMonth]);

  useEffect(() => {
    if (can("Targets.View")) void load();
  }, [can, load]);

  useEffect(() => {
    if (selectedProduct && !measurement) {
      setMeasurement(selectedProduct.defaultMeasurement);
    }
  }, [measurement, selectedProduct]);

  async function createTarget() {
    setError("");
    setMessage("");
    try {
      await apiRequest("/api/v1/targets", api, {
        method: "POST",
        body: JSON.stringify({
          level,
          entity_id: entityId,
          period_month: monthFirst(periodMonth),
          product_id: productId,
          bank_id: bankId || null,
          milestone,
          measurement: measurement || null,
          target_value: targetValue,
          prorate,
        }),
      });
      setTargetValue("");
      setMessage("Target saved.");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Save failed");
    }
  }

  async function saveEdit() {
    if (!editId) return;
    setError("");
    try {
      await apiRequest(`/api/v1/targets/${editId}`, api, {
        method: "PATCH",
        body: JSON.stringify({ target_value: editValue, reason: editReason }),
      });
      setEditId(null);
      setEditReason("");
      setMessage("Target updated.");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Update failed");
    }
  }

  async function setStatus(id: string, active: boolean) {
    setError("");
    try {
      await apiRequest(`/api/v1/targets/${id}/${active ? "activate" : "deactivate"}`, api, {
        method: "POST",
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Status change failed");
    }
  }

  async function lockMonth() {
    setError("");
    try {
      await apiRequest(`/api/v1/targets/periods/${monthFirst(periodMonth)}/lock`, api, { method: "POST" });
      setMessage("Target period locked.");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Lock failed");
    }
  }

  async function reopenMonth() {
    setError("");
    try {
      await apiRequest(`/api/v1/targets/periods/${monthFirst(periodMonth)}/reopen`, api, {
        method: "POST",
        body: JSON.stringify({ reason: reopenReason }),
      });
      setReopenReason("");
      setMessage("Target period reopened.");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Reopen failed");
    }
  }

  async function showHistory(id: string) {
    try {
      const detail = await apiGet<Target>(`/api/v1/targets/${id}`, api);
      setHistoryId(id);
      setHistory(detail.history ?? []);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to load history");
    }
  }

  if (!can("Targets.View")) {
    return (
      <section>
        <PageHeader title="Targets" />
        <EmptyState>You do not have permission to view targets.</EmptyState>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Targets"
        description="Employee, team, and office targets with actuals from application milestones."
        actions={
          can("Targets.View") ? (
            <ButtonLink href="/targets/kpi" variant="secondary">
              KPI scorecards
            </ButtonLink>
          ) : null
        }
      />
      <FilterBar>
        <label className="text-sm">
          Level
          <Select aria-label="Filter level" value={filterLevel} onChange={(event) => setFilterLevel(event.target.value)}>
            <option value="">All levels</option>
            <option value="employee">Employee</option>
            <option value="team">Team</option>
            <option value="office">Office</option>
          </Select>
        </label>
        <label className="text-sm">
          Result period
          <Select
            aria-label="Result period"
            value={filterPeriod}
            onChange={(event) => setFilterPeriod(event.target.value)}
          >
            <option value="month">Monthly</option>
            <option value="qtd">QTD</option>
            <option value="half_year">Half-Year</option>
            <option value="ytd">YTD</option>
          </Select>
        </label>
        <Button type="button" variant="secondary" onClick={() => void load()}>
          Refresh
        </Button>
      </FilterBar>
      {can("Targets.Create") ? (
        <Card>
          <h3 className="text-sm font-semibold">Create target</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Field label="Level">
              <Select aria-label="Target level" value={level} onChange={(event) => setLevel(event.target.value)}>
                <option value="employee">Employee</option>
                <option value="team">Team</option>
                <option value="office">Office</option>
              </Select>
            </Field>
            <Field label="Entity">
              <Select aria-label="Target entity" value={entityId} onChange={(event) => setEntityId(event.target.value)}>
                <option value="">Select</option>
                {entities.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.employeeCode ? ` (${item.employeeCode})` : ""}
                    {item.code ? ` (${item.code})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Month">
              <DatePicker aria-label="Target month" value={periodMonth} onChange={(value) => setPeriodMonth(monthFirst(value))} />
            </Field>
            <Field label="Product">
              <Select aria-label="Product" value={productId} onChange={(event) => setProductId(event.target.value)}>
                <option value="">Select</option>
                {options?.products.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} — {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Bank (optional)">
              <Select aria-label="Bank" value={bankId} onChange={(event) => setBankId(event.target.value)}>
                <option value="">Overall product</option>
                {options?.banks.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Milestone">
              <Select aria-label="Milestone" value={milestone} onChange={(event) => setMilestone(event.target.value)}>
                <option value="submitted">Submitted</option>
                <option value="approved">Approved</option>
                <option value="booked">Booked</option>
                <option value="funded">Funded</option>
              </Select>
            </Field>
            <Field label="Measurement">
              <Select
                aria-label="Measurement"
                value={measurement}
                onChange={(event) => setMeasurement(event.target.value)}
              >
                <option value="amount">Amount (AED)</option>
                <option value="count">Count</option>
              </Select>
            </Field>
            <Field label="Target value">
              <TextInput
                aria-label="Target value"
                value={targetValue}
                onChange={(event) => setTargetValue(event.target.value)}
              />
            </Field>
            <Field label="Prorate">
              <Select
                aria-label="Prorate"
                value={prorate ? "yes" : "no"}
                onChange={(event) => setProrate(event.target.value === "yes")}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </Select>
            </Field>
          </div>
          <div className="mt-4">
            <Button type="button" onClick={() => void createTarget()}>
              Save target
            </Button>
          </div>
        </Card>
      ) : null}
      <Card>
        <h3 className="text-sm font-semibold">Period lock</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          {can("Targets.Edit") ? (
            <Button type="button" variant="secondary" onClick={() => void lockMonth()}>
              Lock month
            </Button>
          ) : null}
          {can("Targets.ReopenPeriod") ? (
            <>
              <Field label="Reopen reason" className="min-w-64">
                <TextInput
                  aria-label="Reopen reason"
                  value={reopenReason}
                  onChange={(event) => setReopenReason(event.target.value)}
                />
              </Field>
              <Button type="button" variant="secondary" onClick={() => void reopenMonth()}>
                Reopen month
              </Button>
            </>
          ) : null}
        </div>
      </Card>
      <ErrorText>{error}</ErrorText>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
      {items.length === 0 ? (
        <EmptyState>No targets in scope for the selected filters.</EmptyState>
      ) : (
        <TableShell>
          <TableHead>
            <tr>
              <Th>Level</Th>
              <Th>Entity</Th>
              <Th>Month</Th>
              <Th>Product</Th>
              <Th>Bank</Th>
              <Th>Milestone</Th>
              <Th>Target</Th>
              <Th>Actual</Th>
              <Th>Achievement</Th>
              <Th>Gap</Th>
              <Th>Run-rate</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </TableHead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <Td>{item.level}</Td>
                <Td>
                  {item.level === "employee" ? (
                    <Link className="underline" href={`/reports/employees/${item.entityId}`}>
                      {item.entityName}
                    </Link>
                  ) : (
                    item.entityName
                  )}
                </Td>
                <Td>{item.periodMonth}</Td>
                <Td>{item.productCode}</Td>
                <Td>{item.bankCode ?? "Overall"}</Td>
                <Td>{item.milestone}</Td>
                <Td>{item.measurement === "amount" ? formatAed(item.result?.effectiveTarget ?? item.targetValue) : item.result?.effectiveTarget ?? item.targetValue}</Td>
                <Td>{item.measurement === "amount" ? formatAed(item.result?.actual) : item.result?.actual}</Td>
                <Td>{formatPct(item.result?.achievementPct)}</Td>
                <Td>{item.result?.gap}</Td>
                <Td>{item.result?.dailyRequiredRunRate ?? "—"}</Td>
                <Td>
                  {item.status}
                  {item.locked ? <Badge>Locked</Badge> : null}
                  {item.prorate ? <Badge>Prorate</Badge> : null}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={() => void showHistory(item.id)}>
                      History
                    </Button>
                    {can("Targets.Edit") && !item.locked ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setEditId(item.id);
                          setEditValue(item.targetValue);
                          setEditReason("");
                        }}
                      >
                        Edit
                      </Button>
                    ) : null}
                    {can("Targets.Deactivate") && item.status === "active" ? (
                      <Button type="button" variant="secondary" onClick={() => void setStatus(item.id, false)}>
                        Deactivate
                      </Button>
                    ) : null}
                    {can("Targets.Activate") && item.status === "inactive" ? (
                      <Button type="button" variant="secondary" onClick={() => void setStatus(item.id, true)}>
                        Activate
                      </Button>
                    ) : null}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      {editId ? (
        <Card>
          <h3 className="text-sm font-semibold">Edit target</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Target value">
              <TextInput
                aria-label="Edit target value"
                value={editValue}
                onChange={(event) => setEditValue(event.target.value)}
              />
            </Field>
            <Field label="Reason">
              <TextInput
                aria-label="Edit reason"
                value={editReason}
                onChange={(event) => setEditReason(event.target.value)}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Button type="button" onClick={() => void saveEdit()}>
              Save edit
            </Button>
          </div>
        </Card>
      ) : null}
      {historyId ? (
        <Card>
          <h3 className="text-sm font-semibold">Edit history</h3>
          {history && history.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm">
              {history.map((row) => (
                <li key={row.id}>
                  {row.createdAt}: {row.reason}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No edits recorded.</EmptyState>
          )}
        </Card>
      ) : null}
    </section>
  );
}
