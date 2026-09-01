"use client";

import { useCallback, useEffect, useState } from "react";

import { DateRangePicker } from "@/components/date-picker";
import {
  Button,
  Card,
  ErrorText,
  FilterBar,
  PageHeader,
  Select,
} from "@/components/ui";
import { apiGet, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import { formatAed, formatPct, type FilterOptions } from "@/lib/reports";

type Comparison = {
  metric: string;
  current: string | number;
  previous: string | number;
  absoluteDifference: string | number;
  percentageChange: number | null;
  reportingScope: string | null;
  kind: string;
  currentPeriod?: { label: string };
  previousPeriod?: { label: string };
};

export default function ComparePage() {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [filters, setFilters] = useState<FilterOptions | null>(null);
  const [kind, setKind] = useState("period");
  const [period, setPeriod] = useState("month");
  const [metric, setMetric] = useState("funded_value");
  const [dimension, setDimension] = useState("employee");
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [compareFrom, setCompareFrom] = useState("");
  const [compareTo, setCompareTo] = useState("");
  const [result, setResult] = useState<Comparison | null>(null);
  const [error, setError] = useState("");

  const loadFilters = useCallback(async () => {
    try {
      setFilters(await apiGet<FilterOptions>("/api/v1/reports/filters", api));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to load filters");
    }
  }, [api]);

  useEffect(() => {
    void loadFilters();
  }, [loadFilters]);

  async function run() {
    setError("");
    const params = new URLSearchParams({ kind, metric });
    if (kind === "period") {
      params.set("period", period);
      if (period === "custom") {
        params.set("date_from", dateFrom);
        params.set("date_to", dateTo);
        params.set("compare_from", compareFrom);
        params.set("compare_to", compareTo);
      }
    } else {
      params.set("dimension", dimension);
      params.set("left_id", leftId);
      params.set("right_id", rightId);
      params.set("period", "mtd");
    }
    try {
      setResult(await apiGet<Comparison>(`/api/v1/reports/comparisons?${params}`, api));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Comparison failed");
    }
  }

  const entities =
    dimension === "employee"
      ? filters?.employees.map((item) => ({ id: item.id, name: item.name }))
      : dimension === "team"
        ? filters?.teams
        : dimension === "office"
          ? filters?.offices
          : dimension === "bank"
            ? filters?.banks
            : filters?.products;

  if (!can("Reports.View") && !can("Dashboard.View")) {
    return <ErrorText>Reports permission is required.</ErrorText>;
  }

  return (
    <section className="space-y-6">
      <PageHeader title="Comparisons" description="Compare entities or periods within reporting scope." />
      <FilterBar>
        <label className="text-sm">
          Comparison type
          <Select aria-label="Comparison type" value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="period">Period vs period</option>
            <option value="entity">Entity vs entity</option>
          </Select>
        </label>
        <label className="text-sm">
          Metric
          <Select aria-label="Comparison metric" value={metric} onChange={(event) => setMetric(event.target.value)}>
            <option value="submitted_value">Submitted Value</option>
            <option value="booked_value">Booked Value</option>
            <option value="funded_value">Funded Value</option>
            <option value="case_count">Case Count</option>
          </Select>
        </label>
        {kind === "period" ? (
          <label className="text-sm">
            Period pair
            <Select aria-label="Period pair" value={period} onChange={(event) => setPeriod(event.target.value)}>
              <option value="month">Current Month vs Previous Month</option>
              <option value="quarter">Current Quarter vs Previous Quarter</option>
              <option value="half_year">Current Half-Year vs Previous Half-Year</option>
              <option value="year">Current Year vs Previous Year</option>
              <option value="custom">Custom Period vs Custom Period</option>
            </Select>
          </label>
        ) : (
          <label className="text-sm">
            Dimension
            <Select aria-label="Dimension" value={dimension} onChange={(event) => setDimension(event.target.value)}>
              <option value="employee">Employee</option>
              <option value="team">Team</option>
              <option value="office">Office</option>
              <option value="bank">Bank</option>
              <option value="product">Product</option>
            </Select>
          </label>
        )}
        {kind === "entity" ? (
          <>
            <label className="text-sm">
              Left entity
              <Select aria-label="Left entity" value={leftId} onChange={(event) => setLeftId(event.target.value)}>
                <option value="">Select</option>
                {entities?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-sm">
              Right entity
              <Select aria-label="Right entity" value={rightId} onChange={(event) => setRightId(event.target.value)}>
                <option value="">Select</option>
                {entities?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </label>
          </>
        ) : null}
        {kind === "period" && period === "custom" ? (
          <>
            <label className="text-sm">
              Current period
              <DateRangePicker
                aria-label="Current period"
                from={dateFrom}
                to={dateTo}
                onChange={({ from, to }) => {
                  setDateFrom(from);
                  setDateTo(to);
                }}
              />
            </label>
            <label className="text-sm">
              Comparison period
              <DateRangePicker
                aria-label="Comparison period"
                from={compareFrom}
                to={compareTo}
                onChange={({ from, to }) => {
                  setCompareFrom(from);
                  setCompareTo(to);
                }}
              />
            </label>
          </>
        ) : null}
        <div className="flex items-end">
          <Button type="button" onClick={() => void run()}>
            Compare
          </Button>
        </div>
      </FilterBar>
      <ErrorText>{error}</ErrorText>
      {result ? (
        <Card>
          <p className="text-sm text-slate-600">
            {result.kind} · {result.reportingScope ?? "No reporting scope"}
          </p>
          <dl className="mt-4 grid gap-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-slate-500">Current</dt>
              <dd className="font-semibold">
                {typeof result.current === "number" ? result.current : formatAed(result.current)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Previous</dt>
              <dd className="font-semibold">
                {typeof result.previous === "number" ? result.previous : formatAed(result.previous)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Difference</dt>
              <dd className="font-semibold">
                {typeof result.absoluteDifference === "number"
                  ? result.absoluteDifference
                  : formatAed(result.absoluteDifference)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Percentage change</dt>
              <dd className="font-semibold">{formatPct(result.percentageChange)}</dd>
            </div>
          </dl>
        </Card>
      ) : null}
    </section>
  );
}
