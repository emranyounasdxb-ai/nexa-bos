"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ComposeOption, EChartsType } from "echarts/core";
import type { BarSeriesOption, LineSeriesOption, PieSeriesOption } from "echarts/charts";
import type {
  AriaComponentOption,
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
} from "echarts/components";

import { EmptyState, LoadingState, cx } from "@/components/ui";

type EChartsRuntime = typeof import("./echarts-runtime");

let runtimePromise: Promise<EChartsRuntime> | null = null;

function loadEChartsRuntime() {
  if (!runtimePromise) {
    runtimePromise = import("./echarts-runtime").catch((error: unknown) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

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
  const optionRef = useRef(option);
  const descriptionRef = useRef(accessibleDescription);
  const [runtimeStatus, setRuntimeStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (loading || empty || !containerRef.current) {
      setRuntimeStatus("idle");
      return;
    }

    let active = true;
    let chart: EChartsType | null = null;
    let observer: ResizeObserver | null = null;
    let resizeFrame = 0;
    setRuntimeStatus("loading");

    void loadEChartsRuntime()
      .then(({ echarts }) => {
        if (!active || !containerRef.current) return;

        const container = containerRef.current;
        chart = echarts.getInstanceByDom(container) ??
          echarts.init(container, null, { renderer: "svg" });
        chartRef.current = chart;
        chart.setOption(
          {
            ...optionRef.current,
            aria: {
              show: true,
              description: descriptionRef.current,
            },
          },
          { notMerge: true, lazyUpdate: true },
        );

        observer = new ResizeObserver(() => {
          cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(() => chart?.resize());
        });
        observer.observe(container);
        setRuntimeStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        if (chart && !chart.isDisposed()) chart.dispose();
        if (chartRef.current === chart) chartRef.current = null;
        setRuntimeStatus("error");
      });

    return () => {
      active = false;
      observer?.disconnect();
      cancelAnimationFrame(resizeFrame);
      if (chart && !chart.isDisposed()) chart.dispose();
      if (chartRef.current === chart) chartRef.current = null;
    };
  }, [empty, loading]);

  useEffect(() => {
    optionRef.current = option;
    descriptionRef.current = accessibleDescription;
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

  if (runtimeStatus === "error") {
    return (
      <div className={className} data-testid={testId}>
        <EmptyState>Unable to load this chart.</EmptyState>
      </div>
    );
  }

  const style: CSSProperties = { height };
  return (
    <div
      className={cx("relative min-w-0 overflow-hidden", className)}
      data-testid={testId}
      aria-busy={runtimeStatus !== "ready"}
    >
      <div
        ref={containerRef}
        className={cx("w-full min-w-0", runtimeStatus !== "ready" && "opacity-0")}
        style={style}
        role={runtimeStatus === "ready" ? "img" : undefined}
        aria-label={runtimeStatus === "ready" ? accessibleDescription : undefined}
      />
      {runtimeStatus !== "ready" ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <LoadingState>{loadingMessage}</LoadingState>
        </div>
      ) : null}
    </div>
  );
}
