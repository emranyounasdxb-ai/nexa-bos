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
  const login = await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: ownerEmail, password: ownerPassword },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function configureType(
  request: APIRequestContext,
  headers: Record<string, string>,
  code: string,
  permissions: string[],
  applicationScope: string | null,
  reportingScope: string | null,
) {
  const types = (await (await request.get(`${apiOrigin}/api/v1/user-types`)).json()) as {
    items: Array<{ id: string; code: string }>;
  };
  const type = types.items.find((item) => item.code === code)!;
  expect((await request.put(`${apiOrigin}/api/v1/user-types/${type.id}/permissions`, { headers, data: { permissions } })).ok()).toBeTruthy();
  expect((await request.put(`${apiOrigin}/api/v1/user-types/${type.id}/application-scope`, { headers, data: { application_visibility_scope: applicationScope } })).ok()).toBeTruthy();
  expect((await request.put(`${apiOrigin}/api/v1/user-types/${type.id}/reporting-scope`, { headers, data: { reporting_visibility_scope: reportingScope } })).ok()).toBeTruthy();
  if (["COD", "SE"].includes(code)) {
    expect((await request.put(`${apiOrigin}/api/v1/user-types/${type.id}/case-owner`, { headers, data: { can_be_case_owner: true } })).ok()).toBeTruthy();
  }
  return type;
}

async function createUser(
  request: APIRequestContext,
  headers: Record<string, string>,
  typeId: string,
  officeId: string,
  role: string,
  suffix: string,
  managerId?: string,
) {
  const designations = (await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as { items: Array<{ id: string }> };
  const created = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Dashboard ${role} ${suffix}`,
      employee_code: `EMP-${role}-${suffix}`,
      email: `dashboard-${role.toLowerCase()}-${suffix}@example.com`,
      mobile: `+9715${suffix.padStart(8, "0").slice(-8)}`,
      designation_id: designations.items[0].id,
      employment_status: "Active",
      joining_date: "2026-01-01",
      office_id: officeId,
      reporting_manager_id: managerId,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const user = (await created.json()) as { id: string; email: string; fullName: string };
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
    const body = (await workflow.json()) as { id: string; stages: Array<{ id: string; systemKey: string | null }> };
    const submittedResponse = await request.post(`${apiOrigin}/api/v1/workflows/${body.id}/stages`, { headers, data: { name: "Submitted", code: "SUBMITTED", sort_order: 20 } });
    expect(submittedResponse.ok(), await submittedResponse.text()).toBeTruthy();
    const submitted = (await submittedResponse.json()) as { id: string };
    const entry = body.stages.find((stage) => stage.systemKey === "application_created")!;
    expect((await request.put(`${apiOrigin}/api/v1/workflows/${body.id}/transitions`, { headers, data: { items: [{ from_stage_id: entry.id, to_stage_id: submitted.id }] } })).ok()).toBeTruthy();
  }
  const mappings = (await (await request.get(`${apiOrigin}/api/v1/bank-products?bankId=${bank.id}&productId=${product.id}`)).json()) as { items: Array<{ id: string }> };
  const variants = (await (await request.get(`${apiOrigin}/api/v1/product-variants?bankProductId=${mappings.items[0].id}`)).json()) as { items: Array<{ id: string; status: string }> };
  let variant = variants.items.find((item) => item.status === "active");
  if (!variant) {
    const created = await request.post(`${apiOrigin}/api/v1/product-variants`, { headers, data: { bank_product_id: mappings.items[0].id, name: "COD Dashboard Variant", code: `COD-DASH-${Date.now()}` } });
    expect(created.ok(), await created.text()).toBeTruthy();
    variant = (await created.json()) as { id: string; status: string };
  }
  return { bank, product, variant: variant! };
}

async function loginApi(request: APIRequestContext, email: string) {
  const login = await request.post(`${apiOrigin}/api/v1/auth/login`, { data: { email, password: userPassword } });
  expect(login.ok(), await login.text()).toBeTruthy();
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function createApplication(request: APIRequestContext, headers: Record<string, string>, label: string, catalog: Awaited<ReturnType<typeof ensureVariant>>) {
  const response = await request.post(`${apiOrigin}/api/v1/applications`, {
    headers,
    data: {
      customer: { customer_type: "individual", full_name: `COD Dashboard Customer ${label}`, mobile: `+97155${Date.now().toString().slice(-7)}` },
      bank_id: catalog.bank.id,
      product_id: catalog.product.id,
      product_variant_id: catalog.variant.id,
      requested_amount: "12500",
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as { id: string; applicationCode: string };
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(userPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Operations Dashboard" })).toBeVisible({ timeout: 30_000 });
}

async function signOut(page: Page) {
  const navigationBackdrop = page.locator('button.fixed[aria-label="Close navigation"]');
  if (await navigationBackdrop.isVisible()) await navigationBackdrop.click();
  await page.getByLabel("Open user menu").click();
  await page.locator("header").getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
}

test("COD Operations Dashboard is office-scoped, actionable, keyboard accessible and responsive", async ({ page, request }) => {
  test.setTimeout(240_000);
  let headers = await ownerLogin(request);
  const codType = await configureType(request, headers, "COD", ["Dashboard.View", "Applications.View", "Applications.Submit", "Applications.UpdateStage", "Applications.MarkDelay"], "office", "office");
  const smType = await configureType(request, headers, "SM", [], null, null);
  const tlType = await configureType(request, headers, "TL", [], null, null);
  const seType = await configureType(request, headers, "SE", ["Dashboard.View", "Applications.View", "Applications.Create"], "own", "own");
  const offices = (await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as { items: Array<{ id: string; code: string; name: string }> };
  const dxb = offices.items.find((item) => item.code === "DXB")!;
  const auh = offices.items.find((item) => item.code === "AUH")!;
  const stamp = Date.now().toString().slice(-7);
  const dxbSm = await createUser(request, headers, smType.id, dxb.id, "SM", `1${stamp.slice(1)}`);
  const dxbCod = await createUser(request, headers, codType.id, dxb.id, "COD", `2${stamp.slice(1)}`, dxbSm.id);
  const dxbTl = await createUser(request, headers, tlType.id, dxb.id, "TL", `3${stamp.slice(1)}`, dxbCod.id);
  const dxbSe = await createUser(request, headers, seType.id, dxb.id, "SE", `4${stamp.slice(1)}`, dxbTl.id);
  const auhSm = await createUser(request, headers, smType.id, auh.id, "SM", `5${stamp.slice(1)}`);
  const auhCod = await createUser(request, headers, codType.id, auh.id, "COD", `6${stamp.slice(1)}`, auhSm.id);
  const auhTl = await createUser(request, headers, tlType.id, auh.id, "TL", `7${stamp.slice(1)}`, auhCod.id);
  const auhSe = await createUser(request, headers, seType.id, auh.id, "SE", `8${stamp.slice(1)}`, auhTl.id);
  const catalog = await ensureVariant(request, headers);
  const dxbWaiting = await createApplication(request, await loginApi(request, dxbSe.email), "DXB waiting", catalog);
  const dxbProcessing = await createApplication(request, await loginApi(request, dxbSe.email), "DXB processing", catalog);
  const auhWaiting = await createApplication(request, await loginApi(request, auhSe.email), "AUH waiting", catalog);
  const dxbHeaders = await loginApi(request, dxbCod.email);
  expect((await request.post(`${apiOrigin}/api/v1/applications/${dxbProcessing.id}/case-number`, { headers: dxbHeaders, data: { bank_case_number: `COD-${stamp}` } })).ok()).toBeTruthy();
  expect((await request.post(`${apiOrigin}/api/v1/applications/${dxbProcessing.id}/delays`, { headers: dxbHeaders, data: { delay_type: "Customer", reason: "Disposable COD dashboard delay" } })).ok()).toBeTruthy();
  headers = await ownerLogin(request);
  const target = await request.post(`${apiOrigin}/api/v1/targets`, { headers, data: { level: "employee", entity_id: dxbCod.id, period_month: new Date().toISOString().slice(0, 7) + "-01", product_id: catalog.product.id, milestone: "submitted", measurement: "count", target_value: "3" } });
  expect(target.ok(), await target.text()).toBeTruthy();
  expect((await request.post(`${apiOrigin}/api/v1/targets/${((await target.json()) as { id: string }).id}/activate`, { headers })).ok()).toBeTruthy();
  expect((await request.put(`${apiOrigin}/api/v1/attendance/records`, { headers, data: { attendance_date: new Date().toISOString().slice(0, 10), entries: [{ employee_id: dxbCod.id, status: "Present", time_in: "09:00", time_out: "17:00" }] } })).ok()).toBeTruthy();

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, dxbCod.email);
  await expect(page.getByText(`${dxb.name} · Office operations`)).toBeVisible();
  for (const label of ["New Cases", "Awaiting Submission", "Missing Bank Number", "Submitted", "Requirements Pending", "Delayed", "Approved", "Completed / Funded"]) {
    await expect(page.getByTestId("cod-summary-cards").getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByTestId("cod-pipeline-chart")).toBeVisible();
  await expect(page.getByTestId("cod-created-submitted-chart")).toBeVisible();
  await expect(page.getByTestId("cod-outcomes-chart")).toBeVisible();
  await expect(page.getByTestId("cod-workload-chart")).toBeVisible();
  await expect(page.getByTestId("cod-tat-chart")).toBeVisible();
  await expect(page.getByTestId("cod-requirement-chart")).toBeVisible();
  await expect(page.getByTestId("cod-staff-workload")).toContainText(dxbTl.fullName);
  await expect(page.getByTestId("cod-staff-workload")).toContainText(dxbSe.fullName);
  await expect(page.getByTestId("cod-staff-workload")).not.toContainText(auhTl.fullName);
  await expect(page.getByTestId("my-performance")).toContainText("Assigned target");
  await expect(page.getByTestId("my-attendance")).toContainText("Present");
  await expect(page.getByTestId("cod-personal-activity")).toContainText("Cases reviewed");
  await expect(page.getByText("Top offices")).toHaveCount(0);
  await expect(page.getByText("Company-wide")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add Bank Number & Submit" }).first()).toBeVisible();

  const firstTab = page.getByRole("tab", { name: /Awaiting review/ });
  await firstTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /Bank submission/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /Recent updates/ }).click();
  await expect(page.getByText(dxbWaiting.applicationCode).first()).toBeVisible();
  await expect(page.getByText(auhWaiting.applicationCode)).toHaveCount(0);
  expect((await page.request.get(`${apiOrigin}/api/v1/applications/${auhWaiting.id}`)).status()).toBe(404);

  await page.getByRole("link", { name: "Missing Bank Number queue" }).click();
  await expect(page).toHaveURL(/dashboard_metric=missing_bank_number/);
  await expect(page.getByText("Dashboard filter: Missing Bank Number")).toBeVisible();
  await expect(page.getByText(dxbWaiting.applicationCode)).toBeVisible();
  await expect(page.getByText(auhWaiting.applicationCode)).toHaveCount(0);
  await page.goBack();
  await selectBrandedOption(page.getByLabel("Operations period"), "today");
  await expect(page).toHaveURL(/period=today/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/reports?period=mtd");
  await expect(page.getByRole("heading", { name: "Operations Dashboard" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByText(/Monthly attendance view/).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("my-attendance")).toContainText(new Date().toISOString().slice(0, 10));
  await signOut(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, auhCod.email);
  await expect(page.getByText(`${auh.name} · Office operations`)).toBeVisible();
  await page.getByRole("tab", { name: /Recent updates/ }).click();
  await expect(page.getByText(auhWaiting.applicationCode).first()).toBeVisible();
  await expect(page.getByText(dxbWaiting.applicationCode)).toHaveCount(0);
  expect((await page.request.get(`${apiOrigin}/api/v1/applications/${dxbWaiting.id}`)).status()).toBe(404);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await signOut(page);
});
