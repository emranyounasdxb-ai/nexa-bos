import { expect, test } from "@playwright/test";
import { setVisualTheme } from "./helpers/viewport-capture";

const api = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;

test("sidebar labels dismiss cleanly without changing navigation or keyboard focus", async ({ page, request }) => {
  test.setTimeout(90_000);
  const status = await request.get(`${api}/api/v1/auth/bootstrap-status`);
  expect(status.ok()).toBeTruthy();
  if ((await status.json()).available) {
    const created = await request.post(`${api}/api/v1/auth/bootstrap`, { data: {
      secret: process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret",
      full_name: "Platform Owner", employee_code: "EMP-OWNER", email: "owner@example.com",
      mobile: "+971500000000", joining_date: "2026-01-01", employment_status: "Active",
      password: "OwnerPass1!", designation_name: "Owner", designation_code: "OWN",
    } });
    expect(created.ok()).toBeTruthy();
  }
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 30_000 });

  const sidebar = page.locator('aside[aria-label="Application sidebar"]');
  const tooltip = page.locator("#application-sidebar-tooltip");
  const trigger = page.getByRole("navigation", { name: "Mobile navigation", exact: true }).getByRole("button", { name: "More navigation", exact: true });
  for (const viewport of [{ width: 1194, height: 834 }, { width: 393, height: 852 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ["light", "dark"] as const) {
      await setVisualTheme(page, theme);
      if (viewport.width < 640) await trigger.click();
      await page.mouse.move(viewport.width - 1, 0);
      const light = sidebar.getByRole("button", { name: "People & HR menu", exact: true });
      await light.focus();
      await expect(light).toBeFocused();
      await expect(tooltip).toHaveText("People & HR");
      await expect(light).toHaveAttribute("aria-describedby", "application-sidebar-tooltip");
      await expect(tooltip).toBeInViewport({ ratio: 1 });
      await page.keyboard.press("Escape");
      await expect(tooltip).toHaveCount(0);
      await expect(sidebar.locator('[aria-label="People & HR menu"][aria-describedby="application-sidebar-tooltip"]')).toHaveCount(0);
      if (viewport.width < 640) {
        await expect(trigger).toBeFocused();
        await expect(sidebar).toHaveJSProperty("inert", true);
        await trigger.click();
      } else {
        await expect(light).toBeFocused();
      }
      const people = sidebar.getByRole("button", { name: "People & HR menu", exact: true });
      await page.mouse.move(viewport.width - 1, 0);
      if (viewport.width < 640) {
        const close = sidebar.getByRole("button", { name: "Close navigation", exact: true });
        await expect(close).toBeFocused();
        await people.hover();
        await expect(tooltip).toHaveText("Close navigation");
        await expect(close).toHaveAttribute("aria-describedby", "application-sidebar-tooltip");
        await people.focus();
      }
      await people.hover();
      await expect(tooltip).toHaveText("People & HR");
      await expect(people).toHaveAttribute("aria-describedby", "application-sidebar-tooltip");
      await expect(tooltip).toBeInViewport({ ratio: 1 });
      await people.click();
      const popup = page.getByRole("dialog", { name: "People & HR", exact: true });
      await expect(popup).toBeVisible();
      await expect(tooltip).toHaveCount(0);
      await expect(popup.getByRole("link", { name: "Users", exact: true })).toHaveAttribute("href", "/users");
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
      await expect(people).toBeFocused();
      if (viewport.width < 640) {
        await page.keyboard.press("Escape");
        await expect(sidebar).toHaveJSProperty("inert", true);
        await expect(tooltip).toHaveCount(0);
      }
    }
  }
  await page.setViewportSize({ width: 1194, height: 834 });
  await sidebar.getByRole("button", { name: "People & HR menu", exact: true }).focus();
  await expect(tooltip).toBeVisible();
  await page.setViewportSize({ width: 393, height: 852 });
  await expect(sidebar).toHaveJSProperty("inert", true);
  await expect(tooltip).toHaveCount(0);
});
