import { expect, test, type APIRequestContext } from "@playwright/test";
import { captureViewportPair, setVisualTheme } from "./helpers/viewport-capture";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

async function ensureOwner(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  const body = (await status.json()) as { available: boolean };
  if (!body.available) {
    return;
  }
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
  expect(created.ok()).toBeTruthy();
}

test("login uses the responsive split layout in both themes", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  await ensureOwner(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");

  const brand = page.getByTestId("login-brand-panel");
  const formPanel = page.getByTestId("login-form-panel");
  await expect(brand).toBeVisible();
  await expect(formPanel).toBeVisible();
  const desktopWidths = await Promise.all([brand, formPanel].map(async panel => (await panel.boundingBox())!.width));
  expect(desktopWidths[0] / (desktopWidths[0] + desktopWidths[1])).toBeGreaterThan(0.52);
  expect(desktopWidths[0] / (desktopWidths[0] + desktopWidths[1])).toBeLessThan(0.58);
  await expect(page.getByRole("heading", { name: "Sign in to AMAFH CORE", exact: true })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

  for (const theme of ["light", "dark"] as const) {
    await setVisualTheme(page, theme);
    await expect(formPanel).toHaveCSS("background-color", theme === "dark" ? "rgb(27, 25, 31)" : "rgb(255, 255, 255)");
    await expect(page.locator(`[data-logo-theme="${theme}"]`).first()).toBeVisible();
    await expect(page.locator(`[data-logo-theme="${theme === "light" ? "dark" : "light"}"]`).first()).toBeHidden();
  }

  await captureViewportPair(page, testInfo, "login-redesign");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(brand).toBeHidden();
  await expect(formPanel).toBeVisible();
  await expect(page.getByRole("img", { name: "AMAFH CORE" }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("owner lands on the dashboard and can open the user directory", async ({ page, request }) => {
  test.setTimeout(60_000);
  await ensureOwner(request);
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 30_000,
  });
  const peopleMenu = page.getByRole("button", { name: "People menu" });
  await peopleMenu.click();
  await expect(peopleMenu).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("dialog", { name: "People", exact: true }).getByRole("link", { name: "Users", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Platform Owner" })).toBeVisible();
  await expect(page.getByTestId("authenticated-content")).not.toContainText("USR-000001");
  await page.goto("/users/new");
  const dialog = page.getByRole("dialog", { name: "Create User" });
  await expect(dialog).toBeVisible();
  for (const label of ["Full Name", "Personal Email", "Personal Mobile"]) {
    await expect(dialog.getByLabel(new RegExp(`^${label}`))).toBeVisible();
  }
  await expect(dialog.getByLabel("User Code", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Reporting manager")).toHaveCount(0);
  await page.goto("/organization");
  await page.getByRole("tab", { name: "Teams" }).click();
  await expect(page).toHaveURL(/\/organization\?tab=teams$/);
  await expect(page.getByRole("heading", { name: "Organization masters", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Teams", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Add team" })).toBeVisible();
});
