import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

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

async function signIn(page: Page, request: APIRequestContext) {
  await ensureOwner(request);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to NEXA BOS" })).toBeVisible();
  await expect(page.getByText("Authenticator challenge is required only when MFA is enabled")).toBeVisible();
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 30_000,
  });
}

test("owner can log in, navigate major screens, sign out, and log in again", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  await signIn(page, request);
  await page.getByRole("link", { name: "Users", exact: true }).click();
  await expect(page.getByRole("link", { name: "USR-000001" })).toBeVisible();
  await expect(page.getByLabel("Authenticator code")).toHaveCount(0);

  await page.getByRole("link", { name: "Customers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();

  await page.getByRole("link", { name: "Applications", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Applications" })).toBeVisible();

  await page.getByRole("link", { name: "Workflows" }).click();
  await expect(page.getByRole("heading", { name: "Workflows" })).toBeVisible();

  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Comparisons" })).toBeVisible();

  await page.getByRole("link", { name: "Attendance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();

  await page.getByRole("link", { name: "Targets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Targets" })).toBeVisible();

  await page.getByRole("link", { name: "Finance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Notifications", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Notification center" })).toBeVisible();

  await page.getByRole("link", { name: "Assets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Asset Register" })).toBeVisible();

  await page.getByRole("link", { name: "User types" }).click();
  await expect(page.getByRole("heading", { name: "User types" })).toBeVisible();

  await page.getByRole("link", { name: "Organization" }).click();
  await expect(page.getByRole("heading", { name: "Organization masters" })).toBeVisible();

  await page.getByRole("link", { name: "Hierarchy", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Organization hierarchy" })).toBeVisible();

  await page.getByRole("link", { name: "Banks & products" }).click();
  await expect(page.getByRole("heading", { name: "Banks and products" })).toBeVisible();

  await page.getByRole("link", { name: "Security" }).click();
  await expect(page).toHaveURL(/\/security/);
  await expect(page.getByRole("heading", { name: "Security settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Open user menu").click();
  await page.getByRole("link", { name: "My profile" }).click();
  await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();

  await page.getByLabel("Open user menu").click();
  const signOut = page.locator("header").getByRole("button", { name: "Sign out" });
  await signOut.waitFor({ state: "visible" });
  await signOut.evaluate((button: HTMLButtonElement) => button.click());
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Sign in to NEXA BOS" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();

  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByLabel("Authenticator code")).toHaveCount(0);
});
