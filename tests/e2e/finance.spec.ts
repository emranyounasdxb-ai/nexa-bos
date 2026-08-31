import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

async function ensureOwner(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  const body = (await status.json()) as { available: boolean };
  if (!body.available) return;
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

async function signIn(page: Page, request: APIRequestContext) {
  await ensureOwner(request);
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 30_000,
  });
}

test("Finance exposes only the approved Task 11 workflows and calculation modes", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await signIn(page, request);
  await page.getByRole("link", { name: "Finance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();
  await expect(page.getByLabel("Finance payout month")).toBeVisible();
  await expect(page.getByRole("button", { name: "Excel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "PDF" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
  await expect(page.getByText("CSV", { exact: true })).toHaveCount(0);

  const ruleCard = page.locator("div.rounded-xl").filter({
    has: page.getByRole("heading", { name: "New commission rule version" }),
  });
  await expect(ruleCard).toBeVisible();
  const sharedCalculation = ruleCard.getByLabel("Calculation").first();
  await expect(sharedCalculation.locator("option")).toHaveText([
    "Fixed",
    "Percentage",
    "Single applicable slab",
    "Flat + Percentage",
  ]);
  await sharedCalculation.selectOption("slab");
  await ruleCard.getByRole("button", { name: "Add slab" }).click();
  await expect(ruleCard.getByLabel("Minimum eligible value")).toBeVisible();
  await expect(ruleCard.getByLabel("Maximum eligible value (optional)")).toBeVisible();

  await ruleCard.getByLabel("Payout mode").selectOption("independent_role_rate");
  const roleCalculation = ruleCard.getByLabel("Calculation").first();
  await roleCalculation.selectOption("flat_percentage");
  await expect(ruleCard.getByLabel("Flat amount")).toBeVisible();
  await expect(ruleCard.getByLabel("Rate %")).toBeVisible();
  await expect(ruleCard.getByLabel("Authoritative source")).toHaveValue("case_owner");
  await expect(ruleCard.getByText("Team Leader", { exact: true })).toHaveCount(0);
  await expect(ruleCard.getByText("Designation", { exact: true })).toHaveCount(0);

  const incentiveCard = page.locator("div.rounded-xl").filter({
    has: page.getByRole("heading", { name: "New monthly incentive plan version" }),
  });
  await expect(incentiveCard).toContainText("not progressive");
  await incentiveCard.getByRole("button", { name: "Add slab" }).click();
  await expect(incentiveCard.getByLabel("Minimum production").first()).toBeVisible();
  await expect(incentiveCard.getByRole("button", { name: "Create draft plan version" })).toBeVisible();
});

test("Finance view-only user cannot access privileged Finance controls", async ({ page, request }) => {
  test.setTimeout(120_000);
  const headers = await ownerHeaders(request);
  const suffix = Date.now().toString().slice(-6);
  const createdType = await request.post(`${apiOrigin}/api/v1/user-types`, {
    headers,
    data: { name: `Finance Viewer ${suffix}`, code: `FV${suffix}` },
  });
  expect(createdType.ok()).toBeTruthy();
  const typeBody = (await createdType.json()) as { id: string };
  expect(
    (await request.post(`${apiOrigin}/api/v1/user-types/${typeBody.id}/activate`, { headers })).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.put(`${apiOrigin}/api/v1/user-types/${typeBody.id}/permissions`, {
        headers,
        data: { permissions: ["Finance.View"] },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.put(`${apiOrigin}/api/v1/user-types/${typeBody.id}/reporting-scope`, {
        headers,
        data: { reporting_visibility_scope: "own" },
      })
    ).ok(),
  ).toBeTruthy();
  const offices = (
    (await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as {
      items: { id: string }[];
    }
  ).items;
  const designations = (
    (await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as {
      items: { id: string }[];
    }
  ).items;
  const email = `finance-view-${suffix}@example.com`;
  const createdUser = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Finance Viewer ${suffix}`,
      employee_code: `EMP-FV${suffix}`,
      email,
      mobile: `+97157${suffix}`,
      designation_id: designations[0].id,
      employment_status: "Active",
      joining_date: "2026-02-01",
      office_id: offices[0].id,
    },
  });
  expect(createdUser.ok()).toBeTruthy();
  const userBody = (await createdUser.json()) as { id: string };
  expect(
    (
      await request.post(`${apiOrigin}/api/v1/users/${userBody.id}/assign-type`, {
        headers,
        data: { user_type_id: typeBody.id },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (await request.post(`${apiOrigin}/api/v1/users/${userBody.id}/activate`, { headers })).ok(),
  ).toBeTruthy();
  const setup = await request.post(`${apiOrigin}/api/v1/auth/users/${userBody.id}/setup-link`, {
    headers,
  });
  expect(setup.ok()).toBeTruthy();
  const token = ((await setup.json()) as { token: string }).token;
  expect(
    (
      await request.post(`${apiOrigin}/api/v1/auth/setup`, {
        data: { token, password: "UserPass1!" },
      })
    ).ok(),
  ).toBeTruthy();

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("UserPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Finance", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "Finance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Excel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "PDF" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Generate payout/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Review|Finalize|Reopen/i })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "New commission rule version" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /adjustment|clawback/i })).toHaveCount(0);
});
