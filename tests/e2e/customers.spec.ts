import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { selectBrandedOption } from "./helpers/select";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

type Ref = { id: string; code: string; name: string };
type Customer = { id: string; customerCode: string; fullName: string; mobile: string; status: string };

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
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function signIn(page: Page, email = "owner@example.com", password = "OwnerPass1!") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(page.getByRole("banner")).toBeVisible();
}

function testMobile(tag: string): string {
  let hash = 2166136261;
  for (const character of tag) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `+9715${String(hash >>> 0).padStart(8, "0").slice(-8)}`;
}

async function createCustomer(
  request: APIRequestContext,
  headers: Record<string, string>,
  tag: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await request.post(`${apiOrigin}/api/v1/customers`, {
    headers,
    data: {
      customer_type: "individual",
      full_name: `Customer ${tag}`,
      mobile: testMobile(tag),
      email: `customer-${tag.toLowerCase()}@example.com`,
      ...overrides,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as Customer;
}

test("owner can create a customer and view bank product catalog", async ({ page, request }) => {
  test.setTimeout(60_000);
  await ensureOwner(request);
  await signIn(page);
  const suffix = Date.now().toString().slice(-8);
  await page.goto("/customers/new");
  await page.getByLabel("Full name").fill(`Playwright Customer ${suffix}`);
  await page.getByLabel("Mobile").fill(`+97150${suffix}`);
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]+$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: `Playwright Customer ${suffix}` })).toBeVisible();
  await page.goto("/catalog");
  await expect(page.getByRole("heading", { name: "Banks and products" })).toBeVisible();
  await expect(page.getByText("DIB", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Products", exact: true }).click();
  await expect(page.getByText("PF", { exact: true }).first()).toBeVisible();
});

test("customer directory search, status, and pagination persist in the URL", async ({ page, request }) => {
  test.setTimeout(150_000);
  const headers = await ownerHeaders(request);
  const suffix = Date.now().toString().slice(-7);
  const active = await createCustomer(request, headers, `ACTIVE${suffix}`);
  const inactive = await createCustomer(request, headers, `INACTIVE${suffix}`);
  const deactivated = await request.post(`${apiOrigin}/api/v1/customers/${inactive.id}/deactivate`, { headers });
  expect(deactivated.ok(), await deactivated.text()).toBeTruthy();
  for (let index = 0; index < 9; index += 1) {
    await createCustomer(request, headers, `${suffix}${index}`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/customers");
  await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create customer" })).toBeVisible();

  const status = page.getByRole("combobox", { name: "Customer status" });
  await status.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "Customer status" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(status).toBeFocused();

  await selectBrandedOption(status, "Inactive");
  await expect.poll(() => new URL(page.url()).searchParams.get("status")).toBe("Inactive");
  await page.getByLabel("Search customers").fill(inactive.customerCode);
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(inactive.customerCode);
  await expect(page.getByRole("link", { name: inactive.customerCode })).toBeVisible();
  await expect(page.getByRole("link", { name: active.customerCode })).toHaveCount(0);

  await page.reload();
  await expect(page.getByLabel("Search customers")).toHaveValue(inactive.customerCode);
  await expect(status).toHaveAttribute("value", "Inactive");
  await selectBrandedOption(status, "Active");
  await expect(page.getByText("No Customers match the current filters.")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("link", { name: inactive.customerCode })).toBeVisible();
  await expect(status).toHaveAttribute("value", "Inactive");

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("2");
  await page.reload();
  await expect(page.getByLabel("Rows per page")).toHaveAttribute("value", "10");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator("article").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
});

test("customer detail preserves history and confirms status and irreversible merge actions", async ({ page, request }) => {
  test.setTimeout(180_000);
  const headers = await ownerHeaders(request);
  const suffix = Date.now().toString().slice(-7);
  const source = await createCustomer(request, headers, `SOURCE${suffix}`, {
    full_name: `Source Customer ${suffix}`,
    emirates_id: `784-${suffix}-1`,
  });
  const primary = await createCustomer(request, headers, `PRIMARY${suffix}`, {
    full_name: `Primary Customer ${suffix}`,
  });
  const corrected = await request.patch(`${apiOrigin}/api/v1/customers/${source.id}`, {
    headers,
    data: { full_name: `Corrected Source ${suffix}`, emirates_id: `784-${suffix}-2` },
  });
  expect(corrected.ok(), await corrected.text()).toBeTruthy();
  const deactivated = await request.post(`${apiOrigin}/api/v1/customers/${source.id}/deactivate`, { headers });
  expect(deactivated.ok(), await deactivated.text()).toBeTruthy();

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto(`/customers/${source.id}`);
  await expect(page.getByRole("heading", { name: `Corrected Source ${suffix}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate", exact: true })).toBeVisible();

  const overviewTab = page.getByRole("tab", { name: "Overview" });
  await overviewTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Applications" })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\?tab=applications$/);
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page).toHaveURL(/\?tab=history$/);
  await expect(page.getByRole("heading", { name: "Field history" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Identifier history" })).toBeVisible();
  await expect(page.getByText("Previous", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: "Overview" }).click();
  const activate = page.getByRole("button", { name: "Activate", exact: true });
  await activate.click();
  await expect(page.getByRole("alertdialog")).toContainText("return to active use");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(activate).toBeFocused();
  await activate.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Activate customer" }).click();
  const deactivate = page.getByRole("button", { name: "Deactivate", exact: true });
  await expect(deactivate).toBeVisible();

  await deactivate.click();
  await expect(page.getByRole("alertdialog")).toContainText("blocked if an active application");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(deactivate).toBeFocused();
  await deactivate.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate customer" }).click();
  await expect(page.getByRole("button", { name: "Activate", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Merge" }).click();
  await expect(page).toHaveURL(/\?tab=merge$/);
  await selectBrandedOption(page.getByRole("combobox", { name: "Primary customer" }), primary.id);
  const reviewMerge = page.getByRole("button", { name: "Review permanent merge" });
  await reviewMerge.click();
  await expect(page.getByRole("alertdialog")).toContainText("cannot be undone");
  await page.keyboard.press("Escape");
  await expect(reviewMerge).toBeFocused();
  await reviewMerge.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Merge permanently" }).click();
  await expect(page.getByText(`Customer merged into ${primary.customerCode}`)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Overview" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Merge" })).toHaveCount(0);
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "Merge history" })).toBeVisible();
  await expect(page.getByText(`${source.customerCode} merged into primary record`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Field history" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
});

test("Customers.View-only users can inspect scoped records without mutation controls", async ({ page, request }) => {
  test.setTimeout(150_000);
  const headers = await ownerHeaders(request);
  const suffix = Date.now().toString().slice(-7);
  const customer = await createCustomer(request, headers, `VIEW${suffix}`);
  const typesResponse = await request.post(`${apiOrigin}/api/v1/user-types`, {
    headers,
    data: { name: `Customer Viewer ${suffix}`, code: `CV${suffix}` },
  });
  expect(typesResponse.ok(), await typesResponse.text()).toBeTruthy();
  const userType = (await typesResponse.json()) as { id: string };
  expect((await request.post(`${apiOrigin}/api/v1/user-types/${userType.id}/activate`, { headers })).ok()).toBeTruthy();
  expect((await request.put(`${apiOrigin}/api/v1/user-types/${userType.id}/permissions`, { headers, data: { permissions: ["Customers.View"] } })).ok()).toBeTruthy();
  expect((await request.put(`${apiOrigin}/api/v1/user-types/${userType.id}/customer-scope`, { headers, data: { customer_visibility_scope: "company" } })).ok()).toBeTruthy();
  const designations = ((await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as { items: Ref[] }).items;
  const userResponse = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Customer Viewer ${suffix}`,
      employee_code: `EMP-CV-${suffix}`,
      email: `customer-viewer-${suffix}@example.com`,
      mobile: `+97156${suffix}`,
      designation_id: designations[0]!.id,
      employment_status: "Active",
      joining_date: "2026-02-01",
    },
  });
  expect(userResponse.ok(), await userResponse.text()).toBeTruthy();
  const viewer = (await userResponse.json()) as { id: string; email: string };
  expect((await request.post(`${apiOrigin}/api/v1/users/${viewer.id}/assign-type`, { headers, data: { user_type_id: userType.id } })).ok()).toBeTruthy();
  expect((await request.post(`${apiOrigin}/api/v1/users/${viewer.id}/activate`, { headers })).ok()).toBeTruthy();
  const setup = await request.post(`${apiOrigin}/api/v1/auth/users/${viewer.id}/setup-link`, { headers });
  expect(setup.ok(), await setup.text()).toBeTruthy();
  const token = ((await setup.json()) as { token: string }).token;
  expect((await request.post(`${apiOrigin}/api/v1/auth/setup`, { data: { token, password: "UserPass1!" } })).ok()).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, viewer.email, "UserPass1!");
  await page.goto(`/customers/${customer.id}`);
  await expect(page.getByRole("heading", { name: `Customer VIEW${suffix}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save corrections" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deactivate", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Activate", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Merge" })).toHaveCount(0);
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "Field history" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
});
