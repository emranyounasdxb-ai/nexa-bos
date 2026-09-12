import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { themeStorageKey } from "../../../apps/web/lib/theme-bootstrap";

/** Exercise the real cross-tab preference path without dismissing an open modal. */
export async function setVisualTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }));
  }, { key: themeStorageKey, value: theme });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/** Wait for JavaScript-driven chart geometry, not just CSS transitions. */
export async function waitForSettledCharts(page: Page) {
  let previous = "";
  let stableSamples = 0;
  await expect.poll(async () => {
    const current = await page.locator('[role="img"] svg').evaluateAll(charts => charts
      .filter(chart => chart.getClientRects().length)
      .map(chart => chart.outerHTML).join("\n"));
    if (!current) return true;
    stableSamples = current === previous ? stableSamples + 1 : 0;
    previous = current;
    return stableSamples >= 2;
  }, { timeout: 10_000, intervals: [100, 100, 200, 200], message: "Chart SVG geometry must settle before visual evidence" }).toBe(true);
}

export async function captureViewport(page: Page, path: string, anchor?: Locator) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/^Loading(?:[ .…]|$)/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(?:Saving|Submitting|Processing)(?:\.{3}|…)?$/i })).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  const sidebar = page.locator('aside[aria-label="Application sidebar"]');
  if (await sidebar.count()) {
    await expect.poll(() => sidebar.evaluate((element, mobile) => {
      const box = element.getBoundingClientRect();
      return mobile
        ? element.getAttribute("data-mobile-open") === "true" ? Math.abs(box.width - 56) < 0.1 : (element as HTMLElement).inert && getComputedStyle(element).display === "none"
        : Math.abs(box.width - 44) < 0.1;
    }, viewport!.width < 1024)).toBe(true);
  }
  if (anchor) {
    await anchor.scrollIntoViewIfNeeded();
    await anchor.evaluate(element => element.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" }));
    await expect(anchor).toBeInViewport();
  } else {
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  }
  const overflow = await page.evaluate(() => ({
    pixels: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overflowing: Array.from(document.querySelectorAll("main *")).filter(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.right > document.documentElement.clientWidth + 1;
    }).slice(0, 20).map(element => ({ tag: element.tagName, className: element.className, text: element.textContent?.slice(0, 80) })),
  }));
  expect(overflow.pixels, `${page.url()} overflow: ${JSON.stringify(overflow.overflowing)}`).toBe(0);
  await expect.poll(() => page.locator('[role="tablist"]').evaluateAll(lists => lists.flatMap(list => {
    if (!list.clientWidth || !["auto", "scroll"].includes(getComputedStyle(list).overflowX)) return [];
    const selected = list.querySelector('[role="tab"][aria-selected="true"]');
    if (!selected || selected.closest('[role="tablist"]') !== list) return [];
    const strip = list.getBoundingClientRect();
    const tab = selected.getBoundingClientRect();
    return tab.left < strip.left - 1 || tab.right > strip.right + 1 ? [selected.textContent] : [];
  })), { message: "Selected tabs must remain visible within their own horizontal strip" }).toEqual([]);
  await waitForSettledCharts(page);
  await page.screenshot({ path, fullPage: false, animations: "disabled" });
}

/** Preserve an open workflow state and viewport while inspecting both themes. */
export async function captureViewportThemes(page: Page, path: string, anchor?: Locator) {
  const originalTheme = await page.locator("html").getAttribute("data-theme");
  try {
    for (const theme of ["light", "dark"] as const) {
      await setVisualTheme(page, theme);
      await captureViewport(page, path.replace(/\.png$/, `-${theme}.png`), anchor);
    }
  } finally {
    await setVisualTheme(page, originalTheme === "dark" ? "dark" : "light");
  }
}

/** Capture the same real state at both review sizes, then restore the test size. */
export async function captureViewportPair(page: Page, testInfo: TestInfo, name: string, anchor?: Locator) {
  const original = page.viewportSize();
  const originalTheme = await page.locator("html").getAttribute("data-theme");
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const theme of ["light", "dark"] as const) {
        await setVisualTheme(page, theme);
        await captureViewport(page, testInfo.outputPath(`${name}-${theme}-${viewport.width}.png`), anchor);
      }
    }
  } finally {
    if (original) await page.setViewportSize(original);
    await setVisualTheme(page, originalTheme === "dark" ? "dark" : "light");
  }
}
