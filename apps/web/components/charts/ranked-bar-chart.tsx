"use client";

import { useMemo } from "react";

import { BosChart, type BosChartOption } from "./bos-chart";
import {
  chartAnimation,
  chartAxisText,
  chartBarRadius,
  chartFontFamily,
  chartPalette,
  chartSplitLine,
  chartTooltip,
  formatCount,
} from "./chart-theme";

export type RankedBarDatum = {
  id: string;
  label: string;
  value: number;
};

export function RankedBarChart({
  rows,
  accessibleDescription,
  limit = 6,
  testId = "ranked-bar-chart",
}: {
  rows: RankedBarDatum[];
  accessibleDescription: string;
  limit?: number;
  testId?: string;
}) {
  const ranked = useMemo(
    () => [...rows].sort((left, right) => right.value - left.value).slice(0, limit),
    [limit, rows],
  );
  const option = useMemo<BosChartOption>(
    () => ({
      ...chartAnimation,
      color: [chartPalette.blue],
      textStyle: { fontFamily: chartFontFamily },
      grid: { left: 4, right: 18, top: 8, bottom: 6, containLabel: true },
      tooltip: {
        ...chartTooltip,
        trigger: "item",
        renderMode: "richText",
        formatter: "{b}: {c}",
      },
      xAxis: {
        type: "value",
        min: 0,
        minInterval: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...chartAxisText, formatter: (value: number) => formatCount(value) },
        splitLine: chartSplitLine,
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: ranked.map((row) => row.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          ...chartAxisText,
          color: chartPalette.slate700,
          width: 132,
          overflow: "truncate",
          margin: 12,
        },
      },
      series: [
        {
          name: "Applications",
          type: "bar",
          data: ranked.map((row) => row.value),
          barMaxWidth: 18,
          itemStyle: {
            color: chartPalette.blue,
            borderRadius: [0, chartBarRadius, chartBarRadius, 0],
          },
          label: {
            show: true,
            position: "right",
            color: chartPalette.slate900,
            fontFamily: chartFontFamily,
            fontSize: 12,
            fontWeight: 600,
            formatter: ({ value }) => formatCount(typeof value === "number" ? value : String(value)),
          },
        },
      ],
    }),
    [ranked],
  );

  return (
    <>
      <BosChart
        option={option}
        accessibleDescription={accessibleDescription}
        empty={ranked.length === 0}
        emptyMessage="No ranked data is available."
        testId={testId}
        height={Math.max(198, ranked.length * 34)}
      />
      {ranked.length > 0 ? (
        <ol className="sr-only">
          {ranked.map((row, index) => <li key={row.id}>{index + 1}. {row.label}: {row.value}</li>)}
        </ol>
      ) : null}
    </>
  );
}
