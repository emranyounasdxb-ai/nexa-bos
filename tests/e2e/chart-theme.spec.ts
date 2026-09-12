import { expect, test } from "@playwright/test";
import { chartPalette, withChartTheme } from "../../apps/web/components/charts/chart-theme";

test("chart themes change presentation colors without changing data or formatters", () => {
  const formatter = (value: unknown) => String(value);
  const dates = new Date("2026-01-01T00:00:00Z");
  const option = {
    color: [chartPalette.navy, chartPalette.emerald],
    tooltip: { backgroundColor: chartPalette.slate900, formatter },
    xAxis: { data: ["Jan", "Feb"], axisLabel: { color: chartPalette.slate700 } },
    series: [{ name: chartPalette.navy, type: "line", data: [0, null, 12000], itemStyle: { color: chartPalette.navy } }],
    dataset: { source: [["label", "value"], [chartPalette.navy, "12000.00"]] },
    customDate: dates,
  };
  const original = JSON.stringify(option);
  expect(withChartTheme(option, "light")).toBe(option);
  const dark = withChartTheme(option, "dark");
  expect(dark.color).toEqual(["#e4b5fa", "#98d1b3"]);
  expect(dark.xAxis.axisLabel.color).toBe("#b9b0c4");
  expect(dark.series[0].itemStyle.color).toBe("#e4b5fa");
  expect(dark.series[0].data).toEqual(option.series[0].data);
  expect(dark.series[0].name).toBe(option.series[0].name);
  expect(dark.dataset).toEqual(option.dataset);
  expect(dark.tooltip.formatter).toBe(formatter);
  expect(dark.customDate).toBe(dates);
  expect(JSON.stringify(option)).toBe(original);
});
