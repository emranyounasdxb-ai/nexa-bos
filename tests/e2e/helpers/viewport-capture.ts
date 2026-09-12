import { expect, type Page } from "@playwright/test";

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
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await page.screenshot({ path, fullPage: false });
}
