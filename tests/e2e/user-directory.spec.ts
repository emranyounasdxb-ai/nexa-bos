import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { selectBrandedOption } from "./helpers/select";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

type Ref = { id: string; code: string; name: string };
type UserType = Ref;

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
  expect(login.ok(), await login.text()).toBeTruthy();
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function signIn(page: Page, email = "owner@example.com", password = "OwnerPass1!") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^(Dashboard|Users)$/ })).toBeVisible({ timeout: 30_000 });
}

async function directoryOptions(request: APIRequestContext) {
  const offices = ((await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as { items: Ref[] }).items;
  const designations = ((await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as { items: Ref[] }).items;
  const userTypes = ((await (await request.get(`${apiOrigin}/api/v1/user-types`)).json()) as { items: UserType[] }).items;
  return { offices, designations, userTypes };
}

async function createUser(
  request: APIRequestContext,
  headers: Record<string, string>,
  designationId: string,
  tag: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Directory User ${tag}`,
      employee_code: `EMP-DIR-${tag}`,
      email: `directory-${tag.toLowerCase()}@example.com`,
      mobile: `+9715${tag.replace(/\D/g, "").padStart(8, "0").slice(-8)}`,
      designation_id: designationId,
      employment_status: "Active",
      joining_date: "2026-02-01",
      ...overrides,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as { id: string; userCode: string; fullName: string; email: string };
}

test("User Directory filters and pagination persist in the URL across refresh and back", async ({ page, request }) => {
  test.setTimeout(180_000);
  const headers = await ownerHeaders(request);
  const { offices, designations, userTypes } = await directoryOptions(request);
  const dxb = offices.find((item) => item.code === "DXB");
  const auh = offices.find((item) => item.code === "AUH");
  const se = userTypes.find((item) => item.code === "SE");
  expect(dxb && auh && se && designations[0]).toBeTruthy();
  const suffix = Date.now().toString().slice(-7);
  const departmentResponse = await request.post(`${apiOrigin}/api/v1/departments`, {
    headers,
    data: { office_id: dxb!.id, name: `Directory Sales ${suffix}`, code: `DS${suffix}` },
  });
  expect(departmentResponse.ok(), await departmentResponse.text()).toBeTruthy();
  const department = (await departmentResponse.json()) as Ref;
  const target = await createUser(request, headers, designations[0]!.id, `FOCUS${suffix}`, {
    full_name: `Directory Focus ${suffix}`,
    employment_status: "Probation",
    office_id: dxb!.id,
    department_id: department.id,
  });
  const assign = await request.post(`${apiOrigin}/api/v1/users/${target.id}/assign-type`, {
    headers,
    data: { user_type_id: se!.id },
  });
  expect(assign.ok(), await assign.text()).toBeTruthy();
  const other = await createUser(request, headers, designations[0]!.id, `OTHER${suffix}`, {
    full_name: `Directory Other ${suffix}`,
    office_id: auh!.id,
  });
  for (let index = 0; index < 9; index += 1) {
    await createUser(request, headers, designations[0]!.id, `${suffix}${index}`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create user" })).toBeVisible();

  const employment = page.getByRole("combobox", { name: "Employment status" });
  await employment.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "Employment status" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(employment).toBeFocused();

  await selectBrandedOption(employment, "Probation");
  await expect.poll(() => new URL(page.url()).searchParams.get("employmentStatus")).toBe("Probation");
  await selectBrandedOption(page.getByRole("combobox", { name: "Account status" }), "pending");
  await expect.poll(() => new URL(page.url()).searchParams.get("accountStatus")).toBe("pending");
  await selectBrandedOption(page.getByRole("combobox", { name: "Office" }), dxb!.id);
  await expect.poll(() => new URL(page.url()).searchParams.get("officeId")).toBe(dxb!.id);
  await selectBrandedOption(page.getByRole("combobox", { name: "Department" }), department.id);
  await expect.poll(() => new URL(page.url()).searchParams.get("departmentId")).toBe(department.id);
  await selectBrandedOption(page.getByRole("combobox", { name: "User Type" }), se!.id);
  await expect.poll(() => new URL(page.url()).searchParams.get("userTypeId")).toBe(se!.id);
  await page.getByLabel("Search users").fill(target.fullName);
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(target.fullName);
  await expect(page.getByRole("link", { name: target.userCode })).toBeVisible();
  await expect(page.getByText(other.fullName, { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByLabel("Search users")).toHaveValue(target.fullName);
  await expect(employment).toHaveAttribute("value", "Probation");
  await expect(page.getByRole("combobox", { name: "Account status" })).toHaveAttribute("value", "pending");
  await expect(page.getByRole("combobox", { name: "Office" })).toHaveAttribute("value", dxb!.id);
  await expect(page.getByRole("combobox", { name: "Department" })).toHaveAttribute("value", department.id);
  await expect(page.getByRole("combobox", { name: "User Type" })).toHaveAttribute("value", se!.id);

  await selectBrandedOption(page.getByRole("combobox", { name: "Account status" }), "active");
  await expect(page.getByText("No Users match the current filters.")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("link", { name: target.userCode })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Account status" })).toHaveAttribute("value", "pending");

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/users$/);
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

test("Users.View-only access keeps privileged directory controls unavailable on mobile", async ({ page, request }) => {
  test.setTimeout(150_000);
  const headers = await ownerHeaders(request);
  const { offices, designations } = await directoryOptions(request);
  const suffix = Date.now().toString().slice(-7);
  const typeResponse = await request.post(`${apiOrigin}/api/v1/user-types`, {
    headers,
    data: { name: `Directory Viewer ${suffix}`, code: `DV${suffix}` },
  });
  expect(typeResponse.ok(), await typeResponse.text()).toBeTruthy();
  const userType = (await typeResponse.json()) as { id: string };
  expect((await request.post(`${apiOrigin}/api/v1/user-types/${userType.id}/activate`, { headers })).ok()).toBeTruthy();
  expect((await request.put(`${apiOrigin}/api/v1/user-types/${userType.id}/permissions`, { headers, data: { permissions: ["Users.View"] } })).ok()).toBeTruthy();
  expect((await request.put(`${apiOrigin}/api/v1/user-types/${userType.id}/scope`, { headers, data: { visibility_scope: "company" } })).ok()).toBeTruthy();
  const viewer = await createUser(request, headers, designations[0]!.id, `VIEW${suffix}`, { office_id: offices[0]!.id });
  expect((await request.post(`${apiOrigin}/api/v1/users/${viewer.id}/assign-type`, { headers, data: { user_type_id: userType.id } })).ok()).toBeTruthy();
  expect((await request.post(`${apiOrigin}/api/v1/users/${viewer.id}/activate`, { headers })).ok()).toBeTruthy();
  const setup = await request.post(`${apiOrigin}/api/v1/auth/users/${viewer.id}/setup-link`, { headers });
  expect(setup.ok(), await setup.text()).toBeTruthy();
  const token = ((await setup.json()) as { token: string }).token;
  expect((await request.post(`${apiOrigin}/api/v1/auth/setup`, { data: { token, password: "UserPass1!" } })).ok()).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, viewer.email, "UserPass1!");
  await expect(page).toHaveURL(/\/users/);
  await expect(page.getByRole("link", { name: "Create user" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "User Type" })).toBeDisabled();
  await selectBrandedOption(page.getByRole("combobox", { name: "Employment status" }), "Active");
  await page.getByLabel("Search users").fill(viewer.userCode);
  await expect(page.getByRole("link", { name: viewer.userCode })).toBeVisible();
  const deniedTypes = await page.request.get(`${apiOrigin}/api/v1/user-types`);
  expect(deniedTypes.status()).toBe(403);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
});
