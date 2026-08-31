"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import * as echarts from "echarts/core";
import type { ComposeOption, EChartsType } from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import type { BarSeriesOption, LineSeriesOption, PieSeriesOption } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import type {
  AriaComponentOption,
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

import { EmptyState, LoadingState, cx } from "@/components/ui";

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
  SVGRenderer,
]);

export type BosChartOption = ComposeOption<
  | LineSeriesOption
  | BarSeriesOption
  | PieSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | AriaComponentOption
>;

type BosChartProps = {
  option: BosChartOption;
  accessibleDescription: string;
  className?: string;
  height?: number;
  loading?: boolean;
  loadingMessage?: ReactNode;
  empty?: boolean;
  emptyMessage?: ReactNode;
  testId?: string;
};

export function BosChart({
  option,
  accessibleDescription,
  className,
  height = 280,
  loading = false,
  loadingMessage = "Loading chart…",
  empty = false,
  emptyMessage = "No chart data is available.",
  testId,
}: BosChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    if (loading || empty || !containerRef.current) return;

    const container = containerRef.current;
    const chart = echarts.getInstanceByDom(container) ??
      echarts.init(container, null, { renderer: "svg" });
    chartRef.current = chart;

    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => chart.resize());
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(resizeFrame);
      if (!chart.isDisposed()) chart.dispose();
      if (chartRef.current === chart) chartRef.current = null;
    };
  }, [empty, loading]);

  useEffect(() => {
    if (loading || empty || !chartRef.current) return;
    chartRef.current.setOption(
      {
        ...option,
        aria: {
          show: true,
          description: accessibleDescription,
        },
      },
      { notMerge: true, lazyUpdate: true },
    );
  }, [accessibleDescription, empty, loading, option]);

  if (loading) {
    return (
      <div className={className} data-testid={testId}>
        <LoadingState>{loadingMessage}</LoadingState>
      </div>
    );
  }

  if (empty) {
    return (
      <div className={className} data-testid={testId}>
        <EmptyState>{emptyMessage}</EmptyState>
      </div>
    );
  }

  const style: CSSProperties = { height };
  return (
    <div className={cx("min-w-0 overflow-hidden", className)} data-testid={testId}>
      <div
        ref={containerRef}
        className="w-full min-w-0"
        style={style}
        role="img"
        aria-label={accessibleDescription}
      />
    </div>
  );
}
