import type { LegendComponentOption, TooltipComponentOption } from "echarts/components";

export const chartPalette = {
  navy: "#983795",
  blue: "#3979d4",
  blueSoft: "rgba(57, 121, 212, 0.10)",
  emerald: "#147c5a",
  emeraldSoft: "rgba(20, 124, 90, 0.08)",
  violet: "#6956b3",
  amber: "#a85300",
  red: "#e94b63",
  slate900: "#192340",
  slate700: "#617089",
  slate500: "#78849c",
  slate300: "#e1e6f0",
  slate200: "#f3f4fa",
  white: "#ffffff",
} as const;

const darkColors = new Map<string, string>([
  [chartPalette.navy, "#ffd3fb"], [chartPalette.blue, "#c8e0ff"],
  [chartPalette.blueSoft, "rgba(200, 224, 255, 0.10)"],
  [chartPalette.emerald, "#a8ffe0"], [chartPalette.emeraldSoft, "rgba(168, 255, 224, 0.08)"],
  [chartPalette.violet, "#e498df"], [chartPalette.amber, "#ffe0ab"], [chartPalette.red, "#ffd0d9"],
  [chartPalette.slate900, "#f7faff"], [chartPalette.slate700, "#d1dcee"],
  [chartPalette.slate500, "#adbfd9"], [chartPalette.slate300, "#334159"],
  [chartPalette.slate200, "#202b40"], [chartPalette.white, "#161f30"],
]);

// ECharts needs resolved color values. Only presentation color fields are
// adapted; series data, names, formatters and all other options stay intact.
export function withChartTheme<T>(option: T, theme: "light" | "dark"): T {
  const font = typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue("--font-manrope").trim();
  if (theme === "light" && !font) return option;
  function visit(value: unknown, key = ""): unknown {
    if (typeof value === "string") return key === "fontFamily" && font ? `${font}, ui-sans-serif, sans-serif` : theme === "dark" && /color$/i.test(key) ? darkColors.get(value) ?? value : value;
    if (Array.isArray(value)) return value.map(item => visit(item, key));
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, visit(item, name)]));
    }
    return value;
  }
  return visit(option) as T;
}

export const chartFontFamily =
  'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';

export const chartAxisText = {
  color: chartPalette.slate700,
  fontFamily: chartFontFamily,
  fontSize: 13,
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
    fontSize: 14,
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
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

export function formatMonthLabel(value: string): string {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) return value;
  return `${new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(Date.UTC(2000, month - 1, 1)))} ${String(year).slice(-2)}`;
}
