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

async function openFinance(page: Page) {
  await page.getByRole("button", { name: "Finance menu" }).click();
  await page.getByRole("link", { name: "Finance", exact: true }).click();
}

test("Finance exposes only the approved Task 11 workflows and calculation modes", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await signIn(page, request);
  await openFinance(page);
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Payouts" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Finance payout month")).toBeVisible();
  const generate = page.getByRole("button", { name: "Generate payout" });
  await generate.click();
  const generateDialog = page.getByRole("dialog", { name: "Generate payout period?" });
  await expect(generateDialog).toContainText(new Date().toISOString().slice(0, 7));
  await generateDialog.getByRole("button", { name: "Generate payout" }).click();
  await expect(page.getByText("Payout period generated in Draft.")).toBeVisible();
  await page.getByRole("button", { name: "Export" }).click();
  const exportMenu = page.getByRole("menu");
  await expect(exportMenu.getByRole("menuitem")).toHaveText(["Excel", "PDF", "Print"]);
  await expect(page.getByText("CSV", { exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "Commission Rules" }).click();
  await expect(page).toHaveURL(/tab=commission-rules/);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Commission Rules" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Create commission rule" }).click();
  const ruleDrawer = page.getByRole("dialog", { name: "Create commission rule" });
  await expect(ruleDrawer).toBeVisible();
  await expect(ruleDrawer.getByText("1. Bank & Product")).toBeVisible();
  await expect(ruleDrawer.getByText("2. Eligibility & Effective Period")).toBeVisible();
  await expect(ruleDrawer.getByText("3. Calculation Method")).toBeVisible();
  await expect(ruleDrawer.getByText("4. Recipient Split")).toBeVisible();
  await expect(ruleDrawer.getByText("Total split 100% / 100%")).toBeVisible();
  const sharedCalculation = ruleDrawer.getByLabel(/^Calculation/).first();
  await expect(sharedCalculation.locator("option")).toHaveText([
    "Fixed",
    "Percentage",
    "Single applicable slab",
    "Flat + Percentage",
  ]);
  await expect(ruleDrawer.getByLabel(/^Fixed amount/)).toBeVisible();
  await sharedCalculation.selectOption("slab");
  await expect(ruleDrawer.getByLabel(/^Fixed amount/)).toHaveCount(0);
  await ruleDrawer.getByRole("button", { name: "Add slab" }).click();
  await expect(ruleDrawer.getByLabel(/^Minimum eligible value/)).toBeVisible();
  await expect(ruleDrawer.getByLabel(/^Maximum eligible value \(optional\)/)).toBeVisible();

  await ruleDrawer.getByLabel("Payout mode").selectOption("independent_role_rate");
  const roleCalculation = ruleDrawer.getByLabel(/^Calculation/).first();
  await roleCalculation.selectOption("flat_percentage");
  await expect(ruleDrawer.getByLabel(/^Flat amount/)).toBeVisible();
  await expect(ruleDrawer.getByLabel(/^Rate %/)).toBeVisible();
  await expect(ruleDrawer.getByLabel(/^Authoritative Source/)).toHaveValue("case_owner");
  await expect(ruleDrawer.getByText("Team Leader", { exact: true })).toHaveCount(0);
  await expect(ruleDrawer.getByText("Designation", { exact: true })).toHaveCount(0);
  await ruleDrawer.getByRole("button", { name: "Close drawer" }).click();
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();

  await page.getByRole("tab", { name: "Incentive Plans" }).click();
  await page.getByRole("button", { name: "Create incentive plan" }).click();
  const incentiveDrawer = page.getByRole("dialog", { name: "Create incentive plan" });
  await expect(incentiveDrawer).toContainText("not progressive");
  await expect(incentiveDrawer.getByText("Plan Details")).toBeVisible();
  await expect(incentiveDrawer.getByText("Production Slabs")).toBeVisible();
  await incentiveDrawer.getByRole("button", { name: "Add slab" }).click();
  await expect(incentiveDrawer.getByLabel(/^Minimum production/).first()).toBeVisible();
  await expect(incentiveDrawer.getByRole("button", { name: "Create Draft" })).toBeDisabled();

  await page.setViewportSize({ width: 390, height: 844 });
  const drawerBox = await incentiveDrawer.boundingBox();
  expect(drawerBox?.width).toBeGreaterThanOrEqual(389);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBeTruthy();
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
  await openFinance(page);
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Payouts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Commission Rules" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Incentive Plans" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Generate payout/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Review|Finalize|Reopen/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create commission rule" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /adjustment|clawback/i })).toHaveCount(0);

  await page.goto("/finance?tab=commission-rules");
  await expect(page.getByRole("tab", { name: "Payouts" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Create commission rule" })).toHaveCount(0);
});
