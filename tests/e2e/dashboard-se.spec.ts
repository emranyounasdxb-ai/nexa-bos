import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { selectBrandedOption } from "./helpers/select";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";
const ownerEmail = "owner@example.com";
const ownerPassword = "OwnerPass1!";
const userPassword = "UserPass1!";

async function ownerLogin(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  if (((await status.json()) as { available: boolean }).available) {
    const created = await request.post(`${apiOrigin}/api/v1/auth/bootstrap`, {
      data: {
        secret,
        full_name: "Platform Owner",
        employee_code: "EMP-OWNER",
        email: ownerEmail,
        mobile: "+971500000000",
        joining_date: "2026-01-01",
        employment_status: "Active",
        password: ownerPassword,
        designation_name: "Owner",
        designation_code: "OWN",
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
  }
  const login = await request.post(`${apiOrigin}/api/v1/auth/login`, { data: { email: ownerEmail, password: ownerPassword } });
  expect(login.ok(), await login.text()).toBeTruthy();
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function createUser(request: APIRequestContext, headers: Record<string, string>, typeId: string, officeId: string, suffix: string) {
  const designations = (await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as { items: Array<{ id: string }> };
  const created = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Dashboard SE ${suffix}`,
      employee_code: `EMP-DASH-${suffix}`,
      email: `dashboard-se-${suffix}@example.com`,
      mobile: `+97150${suffix.padStart(7, "0")}`,
      designation_id: designations.items[0].id,
      employment_status: "Active",
      joining_date: "2026-01-01",
      office_id: officeId,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const user = (await created.json()) as { id: string; email: string };
  expect((await request.post(`${apiOrigin}/api/v1/users/${user.id}/assign-type`, { headers, data: { user_type_id: typeId } })).ok()).toBeTruthy();
  expect((await request.post(`${apiOrigin}/api/v1/users/${user.id}/activate`, { headers })).ok()).toBeTruthy();
  const setup = await request.post(`${apiOrigin}/api/v1/auth/users/${user.id}/setup-link`, { headers });
  expect(setup.ok()).toBeTruthy();
  expect((await request.post(`${apiOrigin}/api/v1/auth/setup`, { data: { token: ((await setup.json()) as { token: string }).token, password: userPassword } })).ok()).toBeTruthy();
  return user;
}

async function ensureVariant(request: APIRequestContext, headers: Record<string, string>) {
  const banks = (await (await request.get(`${apiOrigin}/api/v1/banks`)).json()) as { items: Array<{ id: string; code: string }> };
  const products = (await (await request.get(`${apiOrigin}/api/v1/products`)).json()) as { items: Array<{ id: string; code: string }> };
  const bank = banks.items.find((item) => item.code === "DIB")!;
  const product = products.items.find((item) => item.code === "PF")!;
  const workflows = (await (await request.get(`${apiOrigin}/api/v1/workflows?bank_id=${bank.id}&product_id=${product.id}`)).json()) as { items: Array<{ id: string; status: string }> };
  if (!workflows.items.some((item) => item.status === "active")) {
    const workflow = await request.post(`${apiOrigin}/api/v1/workflows`, { headers, data: { bank_id: bank.id, product_id: product.id } });
    expect(workflow.ok(), await workflow.text()).toBeTruthy();
    const workflowBody = (await workflow.json()) as { id: string; stages: Array<{ id: string; systemKey: string | null }> };
    const submittedResponse = await request.post(`${apiOrigin}/api/v1/workflows/${workflowBody.id}/stages`, {
      headers,
      data: { name: "Submitted", code: "SUBMITTED", sort_order: 20 },
    });
    expect(submittedResponse.ok(), await submittedResponse.text()).toBeTruthy();
    const submitted = (await submittedResponse.json()) as { id: string };
    const entry = workflowBody.stages.find((stage) => stage.systemKey === "application_created");
    expect(entry).toBeTruthy();
    const transitions = await request.put(`${apiOrigin}/api/v1/workflows/${workflowBody.id}/transitions`, {
      headers,
      data: { items: [{ from_stage_id: entry!.id, to_stage_id: submitted.id }] },
    });
    expect(transitions.ok(), await transitions.text()).toBeTruthy();
  }
  const mappings = (await (await request.get(`${apiOrigin}/api/v1/bank-products?bankId=${bank.id}&productId=${product.id}`)).json()) as { items: Array<{ id: string }> };
  const variants = (await (await request.get(`${apiOrigin}/api/v1/product-variants?bankProductId=${mappings.items[0].id}`)).json()) as { items: Array<{ id: string; status: string }> };
  let variant = variants.items.find((item) => item.status === "active");
  if (!variant) {
    const created = await request.post(`${apiOrigin}/api/v1/product-variants`, {
      headers,
      data: { bank_product_id: mappings.items[0].id, name: "Dashboard Review Variant", code: `DASH-${Date.now()}` },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    variant = (await created.json()) as { id: string; status: string };
  }
  return { bank, product, variant };
}

async function loginApi(request: APIRequestContext, email: string) {
  const login = await request.post(`${apiOrigin}/api/v1/auth/login`, { data: { email, password: userPassword } });
  expect(login.ok(), await login.text()).toBeTruthy();
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function createOwnApplication(request: APIRequestContext, headers: Record<string, string>, emailLabel: string, catalog: Awaited<ReturnType<typeof ensureVariant>>) {
  const created = await request.post(`${apiOrigin}/api/v1/applications`, {
    headers,
    data: {
      customer: { customer_type: "individual", full_name: `Dashboard Customer ${emailLabel}`, mobile: `+97155${Date.now().toString().slice(-7)}` },
      bank_id: catalog.bank.id,
      product_id: catalog.product.id,
      product_variant_id: catalog.variant.id,
      requested_amount: "12000",
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return (await created.json()) as { id: string; applicationCode: string };
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(userPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "My Dashboard" })).toBeVisible({ timeout: 30_000 });
}

test("SE dashboard is own-scoped, actionable, accessible and responsive", async ({ page, request }) => {
  test.setTimeout(180_000);
  let headers = await ownerLogin(request);
  const userTypes = (await (await request.get(`${apiOrigin}/api/v1/user-types`)).json()) as { items: Array<{ id: string; code: string }> };
  const seType = userTypes.items.find((item) => item.code === "SE")!;
  expect((await request.put(`${apiOrigin}/api/v1/user-types/${seType.id}/permissions`, { headers, data: { permissions: ["Dashboard.View", "Applications.View", "Applications.Create"] } })).ok()).toBeTruthy();
  expect((await request.put(`${apiOrigin}/api/v1/user-types/${seType.id}/application-scope`, { headers, data: { application_visibility_scope: "own" } })).ok()).toBeTruthy();
  expect((await request.put(`${apiOrigin}/api/v1/user-types/${seType.id}/reporting-scope`, { headers, data: { reporting_visibility_scope: "company" } })).ok()).toBeTruthy();
  expect((await request.put(`${apiOrigin}/api/v1/user-types/${seType.id}/case-owner`, { headers, data: { can_be_case_owner: true } })).ok()).toBeTruthy();
  const offices = (await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as { items: Array<{ id: string; code: string }> };
  const dxb = offices.items.find((item) => item.code === "DXB")!;
  const suffix = Date.now().toString().slice(-7);
  const first = await createUser(request, headers, seType.id, dxb.id, suffix);
  const second = await createUser(request, headers, seType.id, dxb.id, `${Number(suffix) + 1}`);
  const catalog = await ensureVariant(request, headers);
  const own = await createOwnApplication(request, await loginApi(request, first.email), "Own", catalog);
  const other = await createOwnApplication(request, await loginApi(request, second.email), "Other", catalog);
  headers = await ownerLogin(request);
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const target = await request.post(`${apiOrigin}/api/v1/targets`, { headers, data: { level: "employee", entity_id: first.id, period_month: month, product_id: catalog.product.id, milestone: "submitted", measurement: "count", target_value: "5" } });
  expect(target.ok(), await target.text()).toBeTruthy();
  expect((await request.post(`${apiOrigin}/api/v1/targets/${((await target.json()) as { id: string }).id}/activate`, { headers })).ok()).toBeTruthy();
  expect((await request.put(`${apiOrigin}/api/v1/attendance/records`, { headers, data: { attendance_date: new Date().toISOString().slice(0, 10), entries: [{ employee_id: first.id, status: "Present", time_in: "09:00", time_out: "17:00" }] } })).ok()).toBeTruthy();

  await signIn(page, first.email);
  await expect(page.getByText("My records only")).toBeVisible();
  await expect(page.getByRole("link", { name: "Create Application" })).toBeVisible();
  await expect(page.getByTestId("se-summary-cards").getByText("My Applications")).toBeVisible();
  await expect(page.getByText(own.applicationCode).first()).toBeVisible();
  await expect(page.getByText(other.applicationCode)).toHaveCount(0);
  await expect(page.getByTestId("se-application-trend")).toBeVisible();
  await expect(page.getByTestId("se-stage-chart")).toBeVisible();
  await expect(page.getByTestId("se-product-chart")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Action Required" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent Applications" })).toBeVisible();
  await expect(page.getByTestId("my-performance")).toContainText("Assigned target");
  await expect(page.getByTestId("my-attendance")).toContainText("Present");
  await expect(page.getByText("Top employees")).toHaveCount(0);
  await expect(page.getByText("All permitted records")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Export|Print/ })).toHaveCount(0);

  await selectBrandedOption(page.getByLabel("Dashboard period"), "previous_month");
  await expect(page).toHaveURL(/period=previous_month/);
  await selectBrandedOption(page.getByLabel("Dashboard period"), "mtd");
  await page.getByRole("link", { name: "My Applications summary" }).click();
  await expect(page).toHaveURL(/dashboard_metric=applications/);
  await expect(page.getByText("Dashboard filter: My Applications")).toBeVisible();
  await expect(page.getByText(own.applicationCode)).toBeVisible();
  await expect(page.getByText(other.applicationCode)).toHaveCount(0);
  await page.goBack();
  await page.getByRole("link", { name: "Create Application" }).click();
  await expect(page.getByRole("dialog", { name: "Create Application" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/reports?period=mtd");
  await expect(page.getByRole("heading", { name: "My Dashboard" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const attendanceDetails = page.getByText(/Monthly attendance view/);
  await attendanceDetails.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("my-attendance")).toContainText(new Date().toISOString().slice(0, 10));
});

test("non-application user receives honest personal empty states without sales figures", async ({ page, request }) => {
  test.setTimeout(90_000);
  const headers = await ownerLogin(request);
  const suffix = Date.now().toString().slice(-7);
  const createdType = await request.post(`${apiOrigin}/api/v1/user-types`, {
    headers,
    data: { name: `Dashboard Read Only ${suffix}`, code: `DRO${suffix}` },
  });
  expect(createdType.ok(), await createdType.text()).toBeTruthy();
  const type = (await createdType.json()) as { id: string };
  expect((await request.post(`${apiOrigin}/api/v1/user-types/${type.id}/activate`, { headers })).ok()).toBeTruthy();
  expect((await request.put(`${apiOrigin}/api/v1/user-types/${type.id}/permissions`, { headers, data: { permissions: ["Dashboard.View"] } })).ok()).toBeTruthy();
  expect((await request.put(`${apiOrigin}/api/v1/user-types/${type.id}/reporting-scope`, { headers, data: { reporting_visibility_scope: null } })).ok()).toBeTruthy();
  const offices = (await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as { items: Array<{ id: string; code: string }> };
  const dxb = offices.items.find((item) => item.code === "DXB")!;
  const user = await createUser(request, headers, type.id, dxb.id, `9${suffix.slice(1)}`);
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(userPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("my-performance")).toContainText("No target or KPI scorecard is assigned");
  await expect(page.getByTestId("my-performance")).toContainText("Sales figures are not shown");
  await expect(page.getByTestId("my-attendance")).toContainText("No attendance records are available");
  await expect(page.getByText("My application performance")).toHaveCount(0);
});
