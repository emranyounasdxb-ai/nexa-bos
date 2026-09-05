"use client";

import { useMemo } from "react";

import { BosChart, type BosChartOption } from "./bos-chart";
import {
  chartAnimation,
  chartFontFamily,
  chartLegend,
  chartPalette,
  chartTooltip,
  formatCount,
} from "./chart-theme";

export type DonutDatum = {
  name: string;
  value: number;
};

export function DonutChart({
  rows,
  accessibleDescription,
  testId = "donut-chart",
  emptyMessage = "No active delays are currently in scope.",
  centerLabel = "Active",
}: {
  rows: DonutDatum[];
  accessibleDescription: string;
  testId?: string;
  emptyMessage?: string;
  centerLabel?: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const option = useMemo<BosChartOption>(
    () => ({
      ...chartAnimation,
      color: [chartPalette.violet, chartPalette.amber, chartPalette.blue, chartPalette.slate500],
      textStyle: { fontFamily: chartFontFamily },
      legend: {
        ...chartLegend,
        left: "center",
        bottom: 0,
        data: rows.map((row) => row.name),
      },
      tooltip: {
        ...chartTooltip,
        trigger: "item",
        renderMode: "richText",
        formatter: "{b}: {c} ({d}%)",
      },
      series: [
        {
          name: "Active delays",
          type: "pie",
          radius: ["57%", "76%"],
          center: ["50%", "43%"],
          avoidLabelOverlap: true,
          itemStyle: {
            borderColor: chartPalette.white,
            borderWidth: 3,
            borderRadius: 4,
          },
          label: { show: false },
          labelLine: { show: false },
          emphasis: { scaleSize: 5, label: { show: false } },
          data: rows.map((row) => ({ name: row.name, value: row.value })),
        },
      ],
    }),
    [rows],
  );

  return (
    <div className="relative mt-2 min-w-0 max-w-full overflow-hidden">
      <BosChart
        option={option}
        accessibleDescription={accessibleDescription}
        empty={total === 0}
        emptyMessage={emptyMessage}
        testId={total === 0 ? `${testId}-empty` : testId}
        height={196}
      />
      {total > 0 ? (
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 text-center">
          <strong className="block text-2xl font-semibold tabular-nums text-slate-950">{formatCount(total)}</strong>
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{centerLabel}</span>
        </div>
      ) : null}
      {total > 0 ? (
        <dl className="sr-only">
          {rows.map((row) => (
            <div key={row.name}><dt>{row.name}</dt><dd>{row.value}</dd></div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
