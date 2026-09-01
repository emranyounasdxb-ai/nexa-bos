"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import {
  PaginatedResponse,
  Pagination,
  SERVER_PAGE_SIZE_OPTIONS,
  ServerPageSize,
} from "@/components/pagination";
import {
  EmptyState,
  ErrorText,
  PageHeader,
  TableHead,
  TableShell,
  Td,
  Th,
} from "@/components/ui";
import { apiGet, ApiClientError } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";
import { formatAed, queryFromSearch } from "@/lib/reports";

type DrilldownItem = {
  id: string;
  applicationCode: string;
  customerName: string;
  bankCode: string;
  productCode: string;
  currentStage: string;
  terminalOutcome: string | null;
  fundedAmount: string | null;
  requestedAmount: string | null;
  activeDelayType: string | null;
};

type Drilldown = PaginatedResponse<DrilldownItem> & {
  metric: string;
  total: number;
  reportingScope: string | null;
  period: { label: string; from: string; to: string };
};

function DrillDownInner() {
  const searchParams = useSearchParams();
  const api = getBrowserApiUrl();
  const queryString = searchParams.toString();
  const [data, setData] = useState<Drilldown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (page: number, pageSize: ServerPageSize) => {
    const query = queryFromSearch(queryString);
    const sourceParams = new URLSearchParams(queryString);
    const metric = sourceParams.get("metric") ?? "submitted";
    const params = new URLSearchParams();
    params.set("metric", metric);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    for (const [key, value] of Object.entries(query)) {
      if (value) {
        params.set(key, value);
      }
    }
    setLoading(true);
    setError("");
    try {
      setData(await apiGet<Drilldown>(`/api/v1/reports/applications?${params}`, api));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to load drill-down");
    } finally {
      setLoading(false);
    }
  }, [api, queryString]);

  useEffect(() => {
    setData(null);
    void load(1, 10);
  }, [load]);

  return (
    <section className="space-y-4">
      <PageHeader
        title="Report drill-down"
        description={
          data
            ? `${data.metric} · ${data.period.label} · ${data.reportingScope ?? "No reporting scope"} · ${data.total} rows`
            : "Filtered application results"
        }
      />
      <ErrorText>{error}</ErrorText>
      {!data && !error ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {data && data.items.length === 0 ? (
        <EmptyState>No applications match this metric, period, and reporting scope.</EmptyState>
      ) : null}
      {data && data.items.length > 0 ? (
        <div className={loading ? "opacity-60" : undefined} aria-busy={loading}>
        <TableShell>
          <TableHead>
            <tr>
              <Th>Application</Th>
              <Th>Customer</Th>
              <Th>Bank / Product</Th>
              <Th>Stage</Th>
              <Th>Amount</Th>
            </tr>
          </TableHead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.id}>
                <Td>
                  <Link className="underline" href={`/applications/${item.id}`}>
                    {item.applicationCode}
                  </Link>
                </Td>
                <Td>{item.customerName}</Td>
                <Td>
                  {item.bankCode} / {item.productCode}
                </Td>
                <Td>{item.terminalOutcome ?? item.currentStage}</Td>
                <Td>{formatAed(item.fundedAmount ?? item.requestedAmount)}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
        </div>
      ) : null}
      {data ? (
        <Pagination
          page={data.pagination.page}
          pageSize={data.pagination.pageSize as ServerPageSize}
          pageSizeOptions={SERVER_PAGE_SIZE_OPTIONS}
          total={data.pagination.total}
          totalPages={data.pagination.totalPages}
          onPageChange={(page) =>
            void load(page, data.pagination.pageSize as ServerPageSize)
          }
          onPageSizeChange={(pageSize) => void load(1, pageSize as ServerPageSize)}
        />
      ) : null}
    </section>
  );
}

export default function DrillDownPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <DrillDownInner />
    </Suspense>
  );
}
