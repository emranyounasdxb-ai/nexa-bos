import type { LegendComponentOption, TooltipComponentOption } from "echarts/components";

export const chartPalette = {
  navy: "#6f0d83",
  blue: "#a4259d",
  blueSoft: "rgba(164, 37, 157, 0.10)",
  emerald: "#15805d",
  emeraldSoft: "rgba(21, 128, 93, 0.08)",
  violet: "#e026aa",
  amber: "#9a5a00",
  red: "#c93646",
  slate900: "#27242d",
  slate700: "#6e6976",
  slate500: "#8b8197",
  slate300: "#ece9ef",
  slate200: "#f5f5f5",
  white: "#ffffff",
} as const;

const darkColors = new Map<string, string>([
  [chartPalette.navy, "#e4b5fa"], [chartPalette.blue, "#e9a6e4"],
  [chartPalette.blueSoft, "rgba(233, 166, 228, 0.10)"],
  [chartPalette.emerald, "#98d1b3"], [chartPalette.emeraldSoft, "rgba(152, 209, 179, 0.08)"],
  [chartPalette.violet, "#ee8fce"], [chartPalette.amber, "#ebc78e"], [chartPalette.red, "#f5a6b2"],
  [chartPalette.slate900, "#f3eff7"], [chartPalette.slate700, "#b9b0c4"],
  [chartPalette.slate500, "#a99bb8"], [chartPalette.slate300, "#51485c"],
  [chartPalette.slate200, "#403a49"], [chartPalette.white, "#25222a"],
]);

// ECharts needs resolved color values. Only presentation color fields are
// adapted; series data, names, formatters and all other options stay intact.
export function withChartTheme<T>(option: T, theme: "light" | "dark"): T {
  if (theme === "light") return option;
  function visit(value: unknown, key = ""): unknown {
    if (typeof value === "string") return /color$/i.test(key) ? darkColors.get(value) ?? value : value;
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
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

export function formatMonthLabel(value: string): string {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) return value;
  return `${new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(Date.UTC(2000, month - 1, 1)))} ${String(year).slice(-2)}`;
}
