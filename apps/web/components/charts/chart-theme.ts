import type { LegendComponentOption, TooltipComponentOption } from "echarts/components";

export const chartPalette = {
  navy: "#6f0d83",
  blue: "#4c56d7",
  blueSoft: "rgba(76, 86, 215, 0.10)",
  emerald: "#15805d",
  emeraldSoft: "rgba(21, 128, 93, 0.08)",
  violet: "#e026aa",
  amber: "#9a5a00",
  red: "#c93646",
  slate900: "#1e1e1e",
  slate700: "#5f5b6b",
  slate500: "#8b8495",
  slate300: "#ddd8e5",
  slate200: "#f9f7fa",
  white: "#ffffff",
} as const;

export const chartFontFamily =
  'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';

export const chartAxisText = {
  color: chartPalette.slate500,
  fontFamily: chartFontFamily,
  fontSize: 12,
} as const;

export const chartSplitLine = {
  show: true,
  lineStyle: {
    color: chartPalette.slate200,
    width: 1,
  },
} as const;

export const chartTooltip: TooltipComponentOption = {
  backgroundColor: chartPalette.slate900,
  borderColor: chartPalette.slate900,
  borderWidth: 1,
  padding: [9, 11],
  textStyle: {
    color: chartPalette.white,
    fontFamily: chartFontFamily,
    fontSize: 12,
  },
  extraCssText: "border-radius: 8px; box-shadow: 0 10px 24px rgba(15,23,42,0.18);",
};

export const chartLegend: LegendComponentOption = {
  textStyle: chartAxisText,
  itemWidth: 10,
  itemHeight: 10,
  itemGap: 18,
  icon: "circle",
};

export const chartLineWidth = 2.5;
export const chartAreaOpacity = 0.1;
export const chartBarRadius = 5;
export const chartAnimation = {
  animationDuration: 450,
  animationDurationUpdate: 300,
  animationEasing: "cubicOut",
  animationEasingUpdate: "cubicOut",
} as const;

export function formatCount(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—";
}

export function formatAed(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const text = String(value);
  const match = text.match(/^(-?)(\d+)(\.\d+)?$/);
  if (!match) return `AED ${text}`;
  const [, sign, integer, fraction = ""] = match;
  return `AED ${sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction}`;
}

export function formatPercentage(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

export function formatMonthLabel(value: string): string {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) return value;
  return `${new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(Date.UTC(2000, month - 1, 1)))} ${String(year).slice(-2)}`;
}
