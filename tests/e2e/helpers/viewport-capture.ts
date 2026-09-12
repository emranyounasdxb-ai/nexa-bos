import { expect, type Page, type TestInfo } from "@playwright/test";

/** Capture a settled, exact viewport without changing navigation state. */
export async function captureViewport(page: Page, path: string) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const sidebar = page.locator('aside[aria-label="Application sidebar"]');
  if (await sidebar.count()) {
    await expect.poll(() => sidebar.evaluate((element, mobile) => {
      const box = element.getBoundingClientRect();
      return mobile ? box.right <= 0 : Math.abs(box.width - (element.getAttribute("data-expanded") === "true" ? 224 : 80)) < 0.1;
    }, viewport!.width < 768)).toBe(true);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
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
  await page.screenshot({ path, fullPage: false });
}

/** Capture the same real state at both review sizes, then restore the test size. */
export async function captureViewportPair(page: Page, testInfo: TestInfo, name: string) {
  const original = page.viewportSize();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await captureViewport(page, testInfo.outputPath(`${name}-${viewport.width}.png`));
  }
  if (original) await page.setViewportSize(original);
}
