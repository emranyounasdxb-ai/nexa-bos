"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

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

type Drilldown = {
  metric: string;
  total: number;
  reportingScope: string | null;
  period: { label: string; from: string; to: string };
  items: {
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
  }[];
};

function DrillDownInner() {
  const searchParams = useSearchParams();
  const api = getBrowserApiUrl();
  const [data, setData] = useState<Drilldown | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const query = queryFromSearch(searchParams.toString());
    const metric = searchParams.get("metric") ?? "submitted";
    const params = new URLSearchParams();
    params.set("metric", metric);
    for (const [key, value] of Object.entries(query)) {
      if (value) {
        params.set(key, value);
      }
    }
    void apiGet<Drilldown>(`/api/v1/reports/applications?${params}`, api)
      .then(setData)
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err.message : "Unable to load drill-down");
      });
  }, [api, searchParams]);

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
