"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Button,
  EmptyState,
  ErrorText,
  Field,
  FilterBar,
  PageHeader,
  Select,
  TableHead,
  TableShell,
  Td,
  Th,
} from "@/components/ui";
import { apiDownload, apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { AssetOptions } from "@/lib/types";

type ReportPayload = {
  report: string;
  title: string;
  reportingScope: string;
  filters: Record<string, string | null>;
  items: Record<string, unknown>[];
  total: number;
};

export default function AssetReportsPage() {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [options, setOptions] = useState<AssetOptions | null>(null);
  const [report, setReport] = useState("asset_register");
  const [officeId, setOfficeId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const availableReports = useMemo(
    () =>
      (options?.reports ?? []).filter(
        (item) => item.key !== "asset_history" || can("Assets.ViewAudit"),
      ),
    [can, options],
  );

  const query = useCallback(() => {
    const params = new URLSearchParams();
    if (officeId) params.set("officeId", officeId);
    if (employeeId) params.set("employeeId", employeeId);
    if (categoryId) params.set("categoryId", categoryId);
    const suffix = params.size ? `?${params.toString()}` : "";
    return suffix;
  }, [categoryId, employeeId, officeId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiGet<ReportPayload>(
        `/api/v1/assets/reports/${report}${query()}`,
        api,
      );
      setData(payload);
    } catch (reason) {
      setData(null);
      setError(reason instanceof Error ? reason.message : "Unable to load Asset report");
    } finally {
      setLoading(false);
    }
  }, [api, query, report]);

  useEffect(() => {
    if (!can("Assets.View")) return;
    void apiGet<AssetOptions>("/api/v1/assets/options", api)
      .then((payload) => setOptions(payload))
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Unable to load report filters"),
      );
  }, [api, can]);

  useEffect(() => {
    if (!can("Assets.View")) return;
    void load();
  }, [can, load]);

  async function exportReport(format: "xlsx" | "pdf" | "print") {
    setError("");
    try {
      const result = await apiDownload("/api/v1/assets/reports/export", api, {
        method: "POST",
        body: JSON.stringify({
          report,
          format,
          office_id: officeId || null,
          employee_id: employeeId || null,
          category_id: categoryId || null,
        }),
      });
      if (format === "print") {
        const popup = window.open("", "_blank", "noopener,noreferrer");
        if (!popup) throw new Error("Allow pop-ups to open the print view");
        popup.document.write(await result.blob.text());
        popup.document.close();
        return;
      }
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename ?? `nexa-bos-${report}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Asset report export failed");
    }
  }

  if (!can("Assets.View")) {
    return <EmptyState>You do not have permission to view Asset reports.</EmptyState>;
  }

  const columns = data?.items.length ? Object.keys(data.items[0]) : [];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Asset Reports"
        description={
          data
            ? `${data.title} · ${data.reportingScope} scope · ${data.total} row${data.total === 1 ? "" : "s"}`
            : "Office-wise, employee-wise, custody, condition, and offboarding views."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void exportReport("xlsx")}>
              Excel
            </Button>
            <Button type="button" variant="secondary" onClick={() => void exportReport("pdf")}>
              PDF
            </Button>
            <Button type="button" variant="secondary" onClick={() => void exportReport("print")}>
              Print
            </Button>
          </div>
        }
      />

      <FilterBar>
        <Field label="Report">
          <Select aria-label="Asset report" value={report} onChange={(event) => setReport(event.target.value)}>
            {availableReports.map((item) => <option key={item.key} value={item.key}>{item.title}</option>)}
          </Select>
        </Field>
        <Field label="Office">
          <Select aria-label="Report Office" value={officeId} onChange={(event) => setOfficeId(event.target.value)}>
            <option value="">All authorized Offices</option>
            {options?.offices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        </Field>
        <Field label="Employee">
          <Select aria-label="Report Employee" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
            <option value="">All authorized employees</option>
            {options?.employees.map((item) => <option key={item.id} value={item.id}>{item.userCode} — {item.fullName}</option>)}
          </Select>
        </Field>
        <Field label="Category">
          <Select aria-label="Report Category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">All categories</option>
            {options?.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        </Field>
        <div className="flex items-end">
          <Button type="button" onClick={() => void load()}>Run report</Button>
        </div>
      </FilterBar>

      {error ? <ErrorText>{error}</ErrorText> : null}
      {loading ? <p className="text-sm text-slate-500">Loading report…</p> : null}
      {!loading && data && data.items.length === 0 ? <EmptyState>No rows match the authorized filters.</EmptyState> : null}
      {!loading && data && data.items.length ? (
        <TableShell>
          <TableHead><tr>{columns.map((column) => <Th key={column}>{column}</Th>)}</tr></TableHead>
          <tbody>
            {data.items.map((row, index) => (
              <tr key={`${report}-${index}`} className="border-t border-slate-100">
                {columns.map((column) => <Td key={column}>{String(row[column] ?? "—")}</Td>)}
              </tr>
            ))}
          </tbody>
        </TableShell>
      ) : null}
    </section>
  );
}
