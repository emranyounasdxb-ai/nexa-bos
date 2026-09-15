import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { setVisualTheme } from "./helpers/viewport-capture";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

async function signInOwner(page: Page, request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  if (((await status.json()) as { available: boolean }).available) {
    const created = await request.post(`${apiOrigin}/api/v1/auth/bootstrap`, {
      data: {
        secret,
        full_name: "Platform Owner",
        employee_code: "EMP-OWNER",
        email: "owner@example.com",
        mobile: "+971500000000",
        joining_date: "2026-01-01",
        employment_status: "Active",
        password: "OwnerPass1!",
        designation_name: "Owner",
        designation_code: "OWN",
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
  }
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
}

test("Case Operations exposes the authorized responsive control surfaces", async ({ page, request }) => {
  await signInOwner(page, request);
  for (const theme of ["light", "dark"] as const) {
    await setVisualTheme(page, theme);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/case-operations");
      await expect(page.getByRole("heading", { name: "Case Operations", exact: true })).toBeVisible();
      await expect(page.getByText("Loading Case Operations…", { exact: true })).toBeHidden({ timeout: 30_000 });
      for (const name of ["Rules", "Routing", "Clawbacks", "Stage CSV", "Reports"]) {
        await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
    }
  }

  await page.getByRole("tab", { name: "Clawbacks", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Case", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Stage CSV", exact: true }).click();
  await expect(page.getByRole("button", { name: "Blank Template", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Import 0/ })).toBeDisabled();
});
