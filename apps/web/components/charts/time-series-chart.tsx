"use client";

import { useMemo } from "react";

import type { DashboardPayload } from "@/lib/reports";

import { BosChart, type BosChartOption } from "./bos-chart";
import {
  chartAnimation,
  chartAreaOpacity,
  chartAxisText,
  chartFontFamily,
  chartLegend,
  chartLineWidth,
  chartPalette,
  chartSplitLine,
  chartTooltip,
  formatCount,
  formatMonthLabel,
} from "./chart-theme";

export function TimeSeriesChart({ rows }: { rows: DashboardPayload["trend"] }) {
  const option = useMemo<BosChartOption>(
    () => ({
      ...chartAnimation,
      color: [chartPalette.blue, chartPalette.emerald],
      textStyle: { fontFamily: chartFontFamily },
      grid: { left: 8, right: 14, top: 52, bottom: 8, containLabel: true },
      legend: { ...chartLegend, top: 4, right: 4, data: ["Submitted", "Funded"] },
      tooltip: {
        ...chartTooltip,
        trigger: "axis",
        renderMode: "richText",
        axisPointer: { type: "line", lineStyle: { color: chartPalette.slate300 } },
        valueFormatter: (value) => formatCount(typeof value === "number" ? value : String(value)),
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: rows.map((row) => formatMonthLabel(row.month)),
        axisLine: { lineStyle: { color: chartPalette.slate300 } },
        axisTick: { show: false },
        axisLabel: { ...chartAxisText, hideOverlap: true, margin: 12 },
      },
      yAxis: {
        type: "value",
        min: 0,
        minInterval: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...chartAxisText, formatter: (value: number) => formatCount(value) },
        splitLine: chartSplitLine,
      },
      series: [
        {
          name: "Submitted",
          type: "line",
          data: rows.map((row) => row.submitted),
          smooth: 0.28,
          symbol: "circle",
          symbolSize: 7,
          showSymbol: true,
          lineStyle: { width: chartLineWidth, color: chartPalette.blue },
          itemStyle: { color: chartPalette.white, borderColor: chartPalette.blue, borderWidth: 2 },
          areaStyle: { color: chartPalette.blue, opacity: chartAreaOpacity },
          emphasis: { focus: "series" },
        },
        {
          name: "Funded",
          type: "line",
          data: rows.map((row) => row.funded),
          smooth: 0.28,
          symbol: "circle",
          symbolSize: 7,
          showSymbol: true,
          lineStyle: { width: chartLineWidth, color: chartPalette.emerald },
          itemStyle: { color: chartPalette.white, borderColor: chartPalette.emerald, borderWidth: 2 },
          areaStyle: { color: chartPalette.emerald, opacity: chartAreaOpacity },
          emphasis: { focus: "series" },
        },
      ],
    }),
    [rows],
  );

  const description = `Submitted and funded application counts across ${rows.length} authoritative monthly reporting points.`;
  return (
    <div className="mt-4" data-testid="dashboard-trend-panel">
      <BosChart
        option={option}
        accessibleDescription={description}
        empty={rows.length < 2}
        emptyMessage="At least two authoritative monthly points are required to show a trend."
        testId={rows.length < 2 ? "dashboard-trend-insufficient" : "dashboard-trend-chart"}
        height={276}
      />
      {rows.length >= 2 ? (
        <table className="sr-only">
          <caption>Application performance trend values</caption>
          <thead><tr><th>Month</th><th>Submitted</th><th>Funded</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.month}><th>{row.month}</th><td>{row.submitted}</td><td>{row.funded}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
