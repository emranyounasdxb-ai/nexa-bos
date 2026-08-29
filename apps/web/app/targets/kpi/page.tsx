"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorText,
  Field,
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

type MetricDef = { code: string; label: string; defaultDirection: string };
type MetricRow = {
  id?: string;
  metricCode: string;
  weightPercent: string;
  direction: string;
  baseline?: string | null;
  sortOrder: number;
};
type Scorecard = {
  id: string;
  name: string;
  status: string;
  weightTotal: string;
  weightValid: boolean;
  metrics: MetricRow[];
};

export default function KpiScorecardsPage() {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [items, setItems] = useState<Scorecard[]>([]);
  const [catalog, setCatalog] = useState<MetricDef[]>([]);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<MetricRow[]>([
    {
      metricCode: "target_achievement",
      weightPercent: "100",
      direction: "higher_is_better",
      baseline: "100",
      sortOrder: 0,
    },
  ]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const total = useMemo(
    () => rows.reduce((sum, row) => sum + (Number(row.weightPercent) || 0), 0),
    [rows],
  );

  const load = useCallback(async () => {
    try {
      setError("");
      const data = await apiGet<{ items: Scorecard[]; metrics: MetricDef[] }>("/api/v1/targets/kpi", api);
      setItems(data.items);
      setCatalog(data.metrics);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to load KPI scorecards");
    }
  }, [api]);

  useEffect(() => {
    if (can("Targets.View")) void load();
  }, [can, load]);

  function addRow() {
    const next = catalog.find((item) => !rows.some((row) => row.metricCode === item.code));
    if (!next) return;
    setRows([
      ...rows,
      {
        metricCode: next.code,
        weightPercent: "0",
        direction: next.defaultDirection,
        baseline: "",
        sortOrder: rows.length,
      },
    ]);
  }

  async function saveCard() {
    setError("");
    setMessage("");
    const payload = {
      name,
      metrics: rows.map((row, index) => ({
        metric_code: row.metricCode,
        weight_percent: row.weightPercent,
        direction: row.direction,
        baseline: row.baseline ? row.baseline : null,
        sort_order: index,
      })),
    };
    try {
      if (editingId) {
        await apiRequest(`/api/v1/targets/kpi/${editingId}`, api, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setMessage("KPI scorecard updated.");
      } else {
        await apiRequest("/api/v1/targets/kpi", api, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setMessage("KPI scorecard saved.");
      }
      setName("");
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Save failed");
    }
  }

  async function activate(id: string) {
    setError("");
    try {
      await apiRequest(`/api/v1/targets/kpi/${id}/activate`, api, { method: "POST" });
      setMessage("KPI scorecard activated.");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Activation failed");
    }
  }

  async function deactivate(id: string) {
    setError("");
    try {
      await apiRequest(`/api/v1/targets/kpi/${id}/deactivate`, api, { method: "POST" });
      setMessage("KPI scorecard deactivated.");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Deactivation failed");
    }
  }

  if (!can("Targets.View")) {
    return (
      <section>
        <PageHeader title="KPI scorecards" />
        <EmptyState>You do not have permission to view KPI scorecards.</EmptyState>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="KPI scorecards"
        description="Configurable metrics with weights totaling 100% before activation."
        actions={
          <ButtonLink href="/targets" variant="secondary">
            Targets
          </ButtonLink>
        }
      />
      {can("Targets.Create") || can("Targets.Edit") ? (
        <Card>
          <h3 className="text-sm font-semibold">{editingId ? "Edit scorecard" : "New scorecard"}</h3>
          <div className="mt-3 max-w-md">
            <Field label="Name">
              <TextInput aria-label="Scorecard name" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
          </div>
          <p className={`mt-3 text-sm ${Math.abs(total - 100) < 0.001 ? "text-slate-700" : "text-red-700"}`}>
            Total weight: {total.toFixed(2)}% {Math.abs(total - 100) < 0.001 ? "(valid)" : "(must be 100% to activate)"}
          </p>
          <div className="mt-3 space-y-3">
            {rows.map((row, index) => (
              <div key={`${row.metricCode}-${index}`} className="grid gap-3 md:grid-cols-4">
                <Field label="Metric">
                  <Select
                    aria-label={`Metric ${index + 1}`}
                    value={row.metricCode}
                    onChange={(event) => {
                      const next = [...rows];
                      next[index] = { ...row, metricCode: event.target.value };
                      setRows(next);
                    }}
                  >
                    {catalog.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Weight %">
                  <TextInput
                    aria-label={`Weight ${index + 1}`}
                    value={row.weightPercent}
                    onChange={(event) => {
                      const next = [...rows];
                      next[index] = { ...row, weightPercent: event.target.value };
                      setRows(next);
                    }}
                  />
                </Field>
                <Field label="Baseline / target">
                  <TextInput
                    aria-label={`Baseline ${index + 1}`}
                    value={row.baseline ?? ""}
                    onChange={(event) => {
                      const next = [...rows];
                      next[index] = { ...row, baseline: event.target.value };
                      setRows(next);
                    }}
                  />
                </Field>
                <Field label="Direction">
                  <Select
                    aria-label={`Direction ${index + 1}`}
                    value={row.direction}
                    onChange={(event) => {
                      const next = [...rows];
                      next[index] = { ...row, direction: event.target.value };
                      setRows(next);
                    }}
                  >
                    <option value="higher_is_better">Higher is better</option>
                    <option value="lower_is_better">Lower is better</option>
                  </Select>
                </Field>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={addRow}>
              Add metric
            </Button>
            <Button type="button" onClick={() => void saveCard()}>
              Save scorecard
            </Button>
          </div>
        </Card>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
      {items.length === 0 ? (
        <EmptyState>No KPI scorecards configured.</EmptyState>
      ) : (
        <TableShell>
          <TableHead>
            <tr>
              <Th>Name</Th>
              <Th>Status</Th>
              <Th>Weight total</Th>
              <Th>Metrics</Th>
              <Th>Actions</Th>
            </tr>
          </TableHead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <Td>{item.name}</Td>
                <Td>{item.status}</Td>
                <Td>
                  {item.weightTotal}% {item.weightValid ? "" : "(incomplete)"}
                </Td>
                <Td>
                  {item.metrics.map((metric) => `${metric.metricCode} ${metric.weightPercent}%`).join(", ")}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    {can("Targets.Edit") ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setEditingId(item.id);
                          setName(item.name);
                          setRows(item.metrics);
                        }}
                      >
                        Edit
                      </Button>
                    ) : null}
                    {can("Targets.Activate") && item.status !== "active" ? (
                      <Button type="button" onClick={() => void activate(item.id)}>
                        Activate
                      </Button>
                    ) : null}
                    {can("Targets.Deactivate") && item.status === "active" ? (
                      <Button type="button" variant="secondary" onClick={() => void deactivate(item.id)}>
                        Deactivate
                      </Button>
                    ) : null}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </section>
  );
}
