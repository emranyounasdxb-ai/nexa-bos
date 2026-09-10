import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

async function ownerHeaders(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  const body = (await status.json()) as { available: boolean };
  if (body.available) {
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
  const login = await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: "owner@example.com", password: "OwnerPass1!" },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 30_000 });
}

test("contract register has URL tabs and a keyboard-safe preparation dialog", async ({ page, request }) => {
  const headers = await ownerHeaders(request);
  const existing = await request.get(`${apiOrigin}/api/v1/contracts/types?include_inactive=true`);
  expect(existing.ok(), await existing.text()).toBeTruthy();
  const hasFixed = ((await existing.json()) as { items: Array<{ code: string }> }).items
    .some((item) => item.code === "FIXED");
  if (!hasFixed) {
    const created = await request.post(`${apiOrigin}/api/v1/contracts/types`, {
      headers,
      data: { code: "FIXED", name: "Fixed term", description: "Synthetic browser fixture" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/contracts?tab=settings");
  await expect(page.getByRole("heading", { name: "Employment contracts" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Contract types" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Fixed term", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: "Contract types" })).toHaveAttribute("aria-selected", "true");

  const trigger = page.getByRole("button", { name: "Prepare contract" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Prepare employment contract" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Employee")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Save draft" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close dialog" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("contract register remains usable without page overflow on mobile", async ({ page, request }) => {
  await ownerHeaders(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/contracts?tab=register");
  await expect(page.getByRole("tab", { name: "Contract register" })).toHaveAttribute("aria-selected", "true");
  const trigger = page.getByRole("button", { name: "Prepare contract" });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Prepare employment contract" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});
