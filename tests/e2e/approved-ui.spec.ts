import { expect, test } from "@playwright/test";

const api = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;

test("approved themes persist and popup navigation retains keyboard access", async ({ page, request }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(30_000);
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
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await page.getByLabel("Dark theme", { exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Open user menu", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const sidebar = page.getByLabel("Application sidebar", { exact: true });
  const trigger = page.getByLabel("Open navigation", { exact: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ["light", "dark"]) {
      if (viewport.width < 1024) await trigger.click();
      await page.getByLabel(`${theme === "light" ? "Light" : "Dark"} theme`, { exact: true }).click();
      const contrasts = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        const context = document.createElement("canvas").getContext("2d")!;
        const luminance = (token: string) => {
          const color = style.getPropertyValue(`--amafh-${token}`).trim();
          if (!CSS.supports("color", color)) throw new Error(`Missing or invalid colour token: ${token}`);
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const channels = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(value => value / 255)
            .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        return [["text", "surface"], ["text-secondary", "subtle"], ["link", "surface"],
          ["action-text", "action"], ["success", "success-soft"], ["danger", "danger-soft"],
          ["warning", "warning-soft"], ["info", "info-soft"], ["control-border", "surface"],
          ["control-border", "subtle"]].map(([foreground, background]) => {
          const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
          return { foreground, background, ratio: (values[0] + 0.05) / (values[1] + 0.05) };
        });
      });
      for (const pair of contrasts) expect(pair.ratio, `${theme}: ${pair.foreground} on ${pair.background}`).toBeGreaterThanOrEqual(pair.foreground === "control-border" ? 3 : 4.5);
      const people = sidebar.getByRole("button", { name: "People menu", exact: true });
      await people.click();
      const popup = page.getByRole("dialog", { name: "People", exact: true });
      await expect(popup).toBeVisible();
      await expect(people).toHaveAttribute("aria-expanded", "true");
      await expect(popup.getByRole("link", { name: "Users", exact: true })).toHaveAttribute("href", "/users");
      await expect(popup.getByRole("link", { name: "Attendance", exact: true })).toHaveAttribute("href", "/attendance");
      const links = popup.getByRole("link");
      await links.last().focus();
      await page.keyboard.press("Tab");
      await expect(popup.getByRole("button", { name: "Close submenu" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
      await expect(people).toBeFocused();
      if (viewport.width < 1024) {
        await page.keyboard.press("Escape");
        await expect(sidebar).toHaveJSProperty("inert", true);
        await expect(trigger).toBeFocused();
        expect(await sidebar.evaluate(element => {
          for (const control of element.querySelectorAll<HTMLElement>("a,button")) {
            control.focus();
            if (element.contains(document.activeElement)) return false;
          }
          return true;
        })).toBeTruthy();
      }
      await page.goto("/applications");
      await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("navigation", { name: "Workspace pages" }).getByRole("link", { name: "Applications", exact: true })).toHaveAttribute("aria-current", "page");
      const account = page.getByLabel("Open user menu", { exact: true });
      await account.focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("menuitem", { name: "My profile", exact: true })).toBeFocused();
      await page.keyboard.press("End");
      await expect(page.getByRole("menuitem", { name: "Sign out", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(account).toBeFocused();
      await account.click();
      await page.getByRole("heading", { name: "Applications", exact: true }).click({ position: { x: 4, y: 4 } });
      await expect(page.getByRole("menu", { name: "User account" })).toHaveCount(0);
      await expect(account).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await sidebar.getByRole("button", { name: "Operations menu", exact: true }).click();
  await page.getByRole("dialog", { name: "Operations", exact: true }).getByRole("link", { name: "Applications", exact: true }).click();
  await expect(sidebar).toHaveJSProperty("inert", true);
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await trigger.click();
    await expect(sidebar).toHaveJSProperty("inert", false);
    const dashboard = sidebar.getByRole("link", { name: "Dashboard", exact: true });
    await expect(dashboard).toBeVisible();
    await dashboard.click();
    await expect(page).toHaveURL(/\/reports(?:\?|$)/);
    await expect(sidebar).toHaveJSProperty("inert", true);
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  }
  expect(errors).toEqual([]);
});
