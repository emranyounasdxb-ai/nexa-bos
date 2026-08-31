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

async function signIn(page: Page, email = "owner@example.com", password = "OwnerPass1!") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Dashboard|User directory/ })).toBeVisible({
    timeout: 30_000,
  });
}

async function openDashboardFilters(page: Page) {
  const filters = page.getByTestId("dashboard-filters");
  if (!(await filters.getByLabel("Reporting period").isVisible())) {
    await filters.locator("summary").click();
  }
  return filters;
}

test("owner dashboard periods, drill-down, profile, ranking, comparison, delay, refresh, and exports", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const headers = await ownerHeaders(request);
  const types = (
    (await (await request.get(`${apiOrigin}/api/v1/user-types`)).json()) as {
      items: { id: string; code: string; canBeCaseOwner: boolean }[];
    }
  ).items;
  const ownerType = types.find((item) => item.code === "OWNER");
  if (ownerType && !ownerType.canBeCaseOwner) {
    const enabled = await request.put(`${apiOrigin}/api/v1/user-types/${ownerType.id}/case-owner`, {
      headers,
      data: { can_be_case_owner: true },
    });
    expect(enabled.ok()).toBeTruthy();
  }
  const me = (await (await request.get(`${apiOrigin}/api/v1/auth/me`)).json()) as { id: string };
  const banks = (
    (await (await request.get(`${apiOrigin}/api/v1/banks`)).json()) as { items: { id: string; code: string }[] }
  ).items;
  const products = (
    (await (await request.get(`${apiOrigin}/api/v1/products`)).json()) as { items: { id: string; code: string }[] }
  ).items;
  const dib = banks.find((item) => item.code === "DIB");
  const pf = products.find((item) => item.code === "PF");
  expect(dib && pf).toBeTruthy();
  const workflows = (
    (await (
      await request.get(`${apiOrigin}/api/v1/workflows?bank_id=${dib!.id}&product_id=${pf!.id}`)
    ).json()) as { items: { id: string; status: string; stages?: { systemKey?: string }[] }[] }
  ).items;
  let workflow = workflows.find((item) => item.status === "active");
  if (!workflow) {
    const createdWorkflow = await request.post(`${apiOrigin}/api/v1/workflows`, {
      headers,
      data: { bank_id: dib!.id, product_id: pf!.id },
    });
    expect(createdWorkflow.ok()).toBeTruthy();
    workflow = (await createdWorkflow.json()) as { id: string; stages?: { systemKey?: string }[] };
  }
  const suffix = Date.now().toString().slice(-8);
  const customer = await request.post(`${apiOrigin}/api/v1/customers`, {
    headers,
    data: {
      customer_type: "individual",
      full_name: `Dash Customer ${suffix}`,
      mobile: `+97156${suffix}`,
    },
  });
  expect(customer.ok()).toBeTruthy();
  const customerBody = (await customer.json()) as { id: string };
  const application = await request.post(`${apiOrigin}/api/v1/applications`, {
    headers,
    data: {
      customer_id: customerBody.id,
      bank_id: dib!.id,
      product_id: pf!.id,
      case_owner_id: me.id,
      requested_amount: "18000",
    },
  });
  expect(application.ok()).toBeTruthy();
  const appBody = (await application.json()) as { id: string; workflowId: string };
  await request.post(`${apiOrigin}/api/v1/applications/${appBody.id}/delays`, {
    headers,
    data: { delay_type: "Customer", reason: "Waiting on salary certificate" },
  });
  await signIn(page);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/MTD ·/)).toBeVisible({ timeout: 30_000 });
  let filters = await openDashboardFilters(page);
  await filters.getByLabel("Reporting period").selectOption("ytd");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/YTD ·/)).toBeVisible({ timeout: 30_000 });
  filters = await openDashboardFilters(page);
  await filters.getByLabel("Reporting period").selectOption("custom");
  await filters.getByLabel("Custom period start").fill("2026-01-01");
  await filters.getByLabel("Custom period end").fill("2026-12-31");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("link", { name: "Submitted KPI" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "Submitted KPI" }).click();
  await expect(page.getByRole("heading", { name: "Report drill-down" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/reports");
  await expect(page.getByRole("link", { name: "Customer delays" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "Customer delays" }).click();
  await expect(page.getByRole("heading", { name: "Report drill-down" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto(`/reports/employees/${me.id}`);
  await expect(page.getByRole("heading", { name: "Platform Owner" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel("Reporting period").selectOption("since_joining");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByLabel("Reporting period")).toHaveValue("since_joining");
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Top employees" })).toBeVisible({
    timeout: 30_000,
  });
  filters = await openDashboardFilters(page);
  await filters.getByLabel("Ranking metric").selectOption("case_count");
  const rankingLink = page
    .getByRole("heading", { name: "Top employees" })
    .locator("..")
    .getByRole("link")
    .first();
  if ((await rankingLink.count()) > 0) {
    await rankingLink.click();
    await expect(page.getByText("Employment status")).toBeVisible({ timeout: 30_000 });
  }
  await page.goto("/reports");
  await page.getByRole("button", { name: "Compare" }).click();
  await expect(page.getByRole("heading", { name: "Comparisons" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Compare" }).click();
  await expect(page.getByText("Percentage change")).toBeVisible({ timeout: 20_000 });
  await page.goto("/reports");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Company-wide/)).toBeVisible({ timeout: 30_000 });
  const [excel] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Excel" }).click(),
  ]);
  expect(excel.suggestedFilename()).toContain("xlsx");
  const [pdf] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "PDF" }).click(),
  ]);
  expect(pdf.suggestedFilename()).toContain("pdf");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Print" }).click();
  const popup = await popupPromise;
  await expect(popup.getByText("NEXA BOS")).toBeVisible();
});

test("scoped reporter cannot see unauthorized data or export without permission", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const headers = await ownerHeaders(request);
  const suffix = Date.now().toString().slice(-6);
  const createdType = await request.post(`${apiOrigin}/api/v1/user-types`, {
    headers,
    data: { name: `Dash ${suffix}`, code: `D${suffix}` },
  });
  expect(createdType.ok()).toBeTruthy();
  const typeBody = (await createdType.json()) as { id: string; code: string };
  await request.post(`${apiOrigin}/api/v1/user-types/${typeBody.id}/activate`, { headers });
  await request.put(`${apiOrigin}/api/v1/user-types/${typeBody.id}/permissions`, {
    headers,
    data: { permissions: ["Dashboard.View", "Reports.View"] },
  });
  await request.put(`${apiOrigin}/api/v1/user-types/${typeBody.id}/reporting-scope`, {
    headers,
    data: { reporting_visibility_scope: "own" },
  });
  const offices = (
    (await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as { items: { id: string; code: string }[] }
  ).items;
  const designations = (
    (await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as { items: { id: string }[] }
  ).items;
  const createdUser = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Scoped Reporter ${suffix}`,
      employee_code: `EMP-R${suffix}`,
      email: `scoped-r-${suffix}@example.com`,
      mobile: "+971500000088",
      designation_id: designations[0].id,
      employment_status: "Active",
      joining_date: "2026-02-01",
      office_id: offices[0].id,
    },
  });
  expect(createdUser.ok()).toBeTruthy();
  const userBody = (await createdUser.json()) as { id: string; email: string };
  await request.post(`${apiOrigin}/api/v1/users/${userBody.id}/assign-type`, {
    headers,
    data: { user_type_id: typeBody.id },
  });
  await request.post(`${apiOrigin}/api/v1/users/${userBody.id}/activate`, { headers });
  const setup = await request.post(`${apiOrigin}/api/v1/auth/users/${userBody.id}/setup-link`, {
    headers,
  });
  const token = ((await setup.json()) as { token: string }).token;
  await request.post(`${apiOrigin}/api/v1/auth/setup`, {
    data: { token, password: "UserPass1!" },
  });
  await signIn(page, userBody.email, "UserPass1!");
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Excel" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "PDF" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Open targets/ })).toHaveCount(0);
  const me = await page.request.get(`${apiOrigin}/api/v1/auth/me`);
  const csrf = ((await me.json()) as { csrfToken?: string }).csrfToken;
  const denied = await page.request.post(`${apiOrigin}/api/v1/reports/export`, {
    headers: csrf ? { "X-CSRF-Token": csrf } : undefined,
    data: { format: "xlsx", report: "dashboard", period: "mtd" },
  });
  expect(denied.status()).toBe(403);
});
