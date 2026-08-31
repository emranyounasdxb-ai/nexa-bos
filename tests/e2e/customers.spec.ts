import { expect, test, type APIRequestContext } from "@playwright/test";

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

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 30_000,
  });
}

test("owner can create a customer and view bank product catalog", async ({ page, request }) => {
  await ensureOwner(request);
  await signIn(page);
  const suffix = Date.now().toString().slice(-8);
  await page.goto("/customers/new");
  await page.getByLabel("Full name").fill(`Playwright Customer ${suffix}`);
  await page.getByLabel("Mobile").fill(`+97150${suffix}`);
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByRole("heading", { name: /CUS-/ })).toBeVisible({ timeout: 30_000 });
  await page.goto("/catalog");
  await expect(page.getByRole("heading", { name: "Banks and products" })).toBeVisible();
  await expect(page.getByText("DIB", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("PF", { exact: true }).first()).toBeVisible();
});
