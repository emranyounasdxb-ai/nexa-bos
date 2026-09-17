import { expect, test, type Page } from "@playwright/test";
import { setVisualTheme, waitForSettledCharts } from "./helpers/viewport-capture";

async function openOwnerDashboard(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("banner").getByLabel("Open user menu", { exact: true })).toBeVisible();
  await page.goto("/reports");
  await expect(page.getByTestId("dashboard-business-overview")).toBeVisible();
  await expect(page.getByTestId("dashboard-loading-skeleton")).toBeHidden();
}

test("OWNER columns flow independently and personal controls survive collapse across themes and widths", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await openOwnerDashboard(page);
  const workspace = page.getByTestId("my-workspace");
  await expect(workspace).not.toHaveAttribute("open");
  await expect(workspace.getByText("My Performance", { exact: true })).toBeHidden();
  await workspace.locator("summary").first().click();
  await expect(workspace.getByText("My Performance", { exact: true })).toBeVisible();
  await expect(workspace.getByText("My Attendance", { exact: true })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Refresh HR summary" })).toBeVisible();
  await workspace.locator("summary").first().click();
  await expect(workspace.getByRole("button", { name: "Refresh HR summary", includeHidden: true })).toHaveCount(1);

  for (const width of [1920, 1440, 1280, 1194, 960, 768, 640, 393, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1340 : width === 1194 ? 834 : width === 393 ? 852 : 900 });
    for (const theme of ["light", "dark"] as const) {
      await setVisualTheme(page, theme);
      await page.evaluate(() => document.fonts.ready);
      await waitForSettledCharts(page);
      const geometry = await page.getByTestId("dashboard-overview").evaluate(root => {
        const bounds = (element: Element) => {
          const r = element.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
        };
        const columns = root.querySelector('[data-testid="dashboard-business-overview"]')!;
        const primary = columns.querySelector('section[aria-label="Business overview"]')!;
        const secondary = columns.querySelector('aside[aria-label="Business performance"]')!;
        const left = Array.from(primary.children).map(bounds);
        const right = Array.from(secondary.children).map(bounds);
        const rankings = primary.querySelector('[data-dashboard-section="Performance rankings"]')!.parentElement!;
        return {
          left, right, rankings: bounds(rankings), columns: bounds(columns),
          sidebarTitles: Array.from(secondary.querySelectorAll("h2")).map(h => h.textContent),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          emptyDelay: primary.querySelector('[data-empty-delay="true"]') ? bounds(primary.children[0]).height : null,
        };
      });
      expect(geometry.overflow, `${width} ${theme}: page overflow`).toBe(0);
      expect(geometry.sidebarTitles).toEqual(["Pipeline snapshot", "Conversion summary", "Target performance"]);
      for (const column of [geometry.left, geometry.right]) {
        for (let i = 1; i < column.length; i++) expect(column[i].top - column[i - 1].bottom).toBeCloseTo(18, 0);
      }
      expect(geometry.rankings.top - geometry.left[2].bottom).toBeCloseTo(18, 0);
      expect(geometry.left).toHaveLength(5);
      if (width >= 960) expect(geometry.left[0].top).toBeCloseTo(geometry.right[0].top, 0);
      else expect(geometry.right[0].top - geometry.left.at(-1)!.bottom).toBeCloseTo(20, 0);
      if (width === 1194 || width === 1440) {
        expect(geometry.right[0].right - geometry.right[0].left).toBeCloseTo(376, 0);
        expect(geometry.left[0].right - geometry.left[0].left).toBeCloseTo(width === 1194 ? 650 : 984, 0);
        expect(geometry.right[0].left - geometry.left[0].right).toBeCloseTo(24, 0);
      }
      if (geometry.emptyDelay !== null) expect(geometry.emptyDelay).toBeLessThan(width >= 1280 ? 170 : 260);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`owner-${width}-${theme}.png`), fullPage: true, animations: "disabled" });
      if ([1440, 1194, 393].includes(width)) await page.screenshot({ path: testInfo.outputPath(`owner-native-${width}-${theme}.png`), fullPage: false, animations: "disabled" });
      if ([1440, 1194, 393].includes(width)) {
        const sections = page.locator('[data-dashboard-section]');
        for (let i = 0; i < await sections.count(); i++) {
          const section = sections.nth(i);
          const before = await section.evaluate(element => {
            const inner = element.closest('[data-amafh-card]')!;
            const card = inner.parentElement?.matches('[data-testid="dashboard-charts-grid"]') ? inner.parentElement : inner;
            return { height: card.getBoundingClientRect().height, next: card.nextElementSibling ? card.nextElementSibling.getBoundingClientRect().top + window.scrollY : undefined,
              sidebar: document.querySelector('aside[aria-label="Business performance"]')!.getBoundingClientRect().top + window.scrollY };
          });
          await section.locator(':scope > summary').focus();
          await page.keyboard.press('Enter');
          await expect(section).not.toHaveAttribute('open');
          if (await section.getAttribute('data-dashboard-section') === 'Stage distribution') await expect(section.getByText(/\d+ pending · \d+ stages/)).toBeVisible();
          const after = await section.evaluate(element => {
            const inner = element.closest('[data-amafh-card]')!;
            const card = inner.parentElement?.matches('[data-testid="dashboard-charts-grid"]') ? inner.parentElement : inner;
            return { height: card.getBoundingClientRect().height, next: card.nextElementSibling ? card.nextElementSibling.getBoundingClientRect().top + window.scrollY : undefined,
              sidebar: document.querySelector('aside[aria-label="Business performance"]')!.getBoundingClientRect().top + window.scrollY };
          });
          expect(after.height).toBeLessThan(before.height);
          if (before.next !== undefined) expect(before.next - after.next!).toBeCloseTo(before.height - after.height, 0);
          if (width >= 960) expect(after.sidebar).toBeCloseTo(before.sidebar, 0);
          await expect(page.getByTestId('dashboard-kpi-grid')).toBeVisible();
          await page.keyboard.press('Space');
          await expect(section).toHaveAttribute('open', '');
        }
        for (let i = 0; i < await sections.count(); i++) await sections.nth(i).locator(':scope > summary').click();
        await page.evaluate(() => window.scrollTo(0, 0));
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
        await page.screenshot({ path: testInfo.outputPath(`owner-folded-${width}-${theme}.png`), fullPage: true });
        for (let i = 0; i < await sections.count(); i++) await sections.nth(i).locator(':scope > summary').click();
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: /^Refine/ }).click();
  await expect(page.getByTestId("dashboard-filters")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("owner-refine-expanded.png"), fullPage: true });
  await page.getByRole("button", { name: /^Refine/ }).click();
  await workspace.locator("summary").first().click();
  await expect(workspace.getByRole("button", { name: "Refresh HR summary" })).toBeVisible();
  for (const width of [1440, 1194, 393]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1340 : width === 1194 ? 834 : 852 });
    for (const theme of ["light", "dark"] as const) {
      await setVisualTheme(page, theme);
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      const attendanceColumns = await workspace.locator('[aria-label="Today\'s attendance"] > dl').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
      expect(attendanceColumns).toBe(width === 1194 ? 4 : 2);
      await page.screenshot({ path: testInfo.outputPath(`owner-workspace-expanded-${width}-${theme}.png`), fullPage: true });
    }
  }
});

test("OWNER historical empty cards retain compact geometry and KPI routing", async ({ page }, testInfo) => {
  // An independent browser context avoids re-signing into an active session.
  // A genuine historical cutoff exercises empty charts without changing records.
  test.setTimeout(60_000);
  await openOwnerDashboard(page);
  await page.goto("/reports?period=custom&date_from=2020-01-01&date_to=2020-01-31");
  await expect(page.getByTestId("dashboard-business-overview")).toBeVisible();
  await expect(page.getByTestId("dashboard-loading-skeleton")).toBeHidden();
  await expect(page.getByText("No pending applications at the reporting cutoff.")).toBeVisible();
  await expect(page.getByText("Insights will appear when activity begins")).toBeVisible();
  for (const width of [1440, 1194, 393]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1340 : width === 1194 ? 834 : 852 });
    for (const theme of ["light", "dark"] as const) {
      await setVisualTheme(page, theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await page.screenshot({ path: testInfo.outputPath(`owner-empty-${width}-${theme}.png`), fullPage: true });
    }
  }
  await page.getByRole("link", { name: "Submitted KPI", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Report drill-down", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/date_from=2020-01-01.*metric=submitted/);
});

test("populated dashboard chart geometry retains space and drilldown actions", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  // Browser-only response fixture verifies populated presentation. No DB writes,
  // app fallback data, or changes to the owner's actual preview records.
  await page.route("**/api/v1/reports/dashboard?*", async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.activeDelays = { Bank: 2, Customer: 1, Internal: 1, Other: 0, total: 4 };
    data.trend = [
      { month: "2026-07-01", submitted: 3, funded: 1, fundedValue: "1000.00" },
      { month: "2026-08-01", submitted: 4, funded: 2, fundedValue: "2000.00" },
    ];
    await route.fulfill({ response, json: data });
  });
  await openOwnerDashboard(page);
  await expect(page.getByTestId("dashboard-delay-chart")).toBeVisible();
  await expect(page.getByRole("link", { name: "Bank delays", exact: true })).toHaveAttribute("href", /metric=delay_bank/);
  for (const width of [1440, 1194, 393]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"] as const) {
      await setVisualTheme(page, theme);
      const trend = page.locator('[data-dashboard-section="Application performance trend"]');
      await trend.locator(':scope > summary').click();
      await trend.locator(':scope > summary').click();
      await expect(page.getByTestId('dashboard-charts-grid').locator('svg').first()).toBeVisible();
      await waitForSettledCharts(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`owner-populated-fixture-${width}-${theme}.png`), fullPage: true });
    }
  }
});
