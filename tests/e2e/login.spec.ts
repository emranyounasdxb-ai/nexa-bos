import { expect, test, type APIRequestContext } from "@playwright/test";

const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8010";
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

test("owner can sign in and open the user directory", async ({ page, request }) => {
  await ensureOwner(request);
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "User directory" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("link", { name: "USR-000001" })).toBeVisible();
  await page.goto("/users/new");
  await expect(page.getByLabel("Reporting manager")).toBeVisible();
  await page.goto("/organization");
  await expect(page.getByRole("heading", { name: "Teams" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Team leader" })).toBeVisible();
});
