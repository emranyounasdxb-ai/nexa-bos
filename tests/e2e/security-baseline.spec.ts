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

async function ownerHeaders(request: APIRequestContext) {
  await ensureOwner(request);
  const login = await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: "owner@example.com", password: "OwnerPass1!" },
  });
  expect(login.ok()).toBeTruthy();
  const body = (await login.json()) as { csrfToken: string };
  return { "X-CSRF-Token": body.csrfToken };
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 30_000,
  });
}

test("stored XSS payload is rendered as text, not executed", async ({ page, request }) => {
  const headers = await ownerHeaders(request);
  const tag = Date.now().toString(36);
  const payload = `<img src=x onerror=alert(1)>XSS-${tag}`;
  const created = await request.post(`${apiOrigin}/api/v1/customers`, {
    headers,
    data: {
      customer_type: "individual",
      full_name: `${payload} ${tag}`,
      mobile: `+97150${tag.slice(-8)}`,
    },
  });
  expect(created.ok()).toBeTruthy();
  await signIn(page);
  await page.getByRole("link", { name: "Customers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
  await page.getByLabel("Search customers").fill(`XSS-${tag}`);
  await expect(page.getByText(`XSS-${tag}`)).toBeVisible();
  await expect(page.locator("img[onerror]")).toHaveCount(0);
});
