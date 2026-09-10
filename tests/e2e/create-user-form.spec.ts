import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { brandedOptionValues, selectBrandedOption } from "./helpers/select";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

type Ref = { id: string; code: string; name: string };

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
  expect(created.ok(), await created.text()).toBeTruthy();
}

async function ownerHeaders(request: APIRequestContext) {
  await ensureOwner(request);
  const login = await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: "owner@example.com", password: "OwnerPass1!" },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
}

async function seedOrganization(request: APIRequestContext) {
  const headers = await ownerHeaders(request);
  const tag = Date.now().toString(16).slice(-7).toUpperCase();
  const offices = ((await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as { items: Ref[] }).items;
  const designations = ((await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as { items: Ref[] }).items;
  const office = offices[0];
  const designation = designations[0];
  if (!office || !designation) throw new Error("Disposable organization masters were not available.");

  const departmentResponse = await request.post(`${apiOrigin}/api/v1/departments`, {
    headers,
    data: { office_id: office.id, code: `CU-D-${tag}`, name: `Create User Department ${tag}` },
  });
  expect(departmentResponse.ok(), await departmentResponse.text()).toBeTruthy();
  const department = (await departmentResponse.json()) as Ref;
  const teamResponse = await request.post(`${apiOrigin}/api/v1/teams`, {
    headers,
    data: {
      office_id: office.id,
      department_id: department.id,
      code: `CU-T-${tag}`,
      name: `Create User Team ${tag}`,
    },
  });
  expect(teamResponse.ok(), await teamResponse.text()).toBeTruthy();
  return { designation, office, department, team: (await teamResponse.json()) as Ref, tag };
}

async function expectNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
}

test("OWNER creates Basic user details from the compact responsive form", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await seedOrganization(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/users/new");

  await expect(page.getByRole("heading", { name: "Create user", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "HR Profile" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "PRO & Documents" })).toHaveCount(0);
  for (const section of ["Personal & Contact Information", "Employment & Organization", "Account Access"]) {
    await expect(page.getByText(section, { exact: true })).toBeVisible();
  }

  const firstName = page.getByLabel(/^First Name/);
  const middleName = page.getByLabel("Middle Name", { exact: true });
  const firstBox = await firstName.boundingBox();
  const middleBox = await middleName.boundingBox();
  expect(firstBox && middleBox).toBeTruthy();
  expect(firstBox!.x).toBeLessThan(middleBox!.x);
  expect(Math.abs(firstBox!.y - middleBox!.y)).toBeLessThan(2);
  expect(firstBox!.height).toBe(32);
  expect(middleBox!.height).toBe(32);

  await page.getByRole("button", { name: "Create User", exact: true }).click();
  await expect(firstName).toBeFocused();
  await expect(page.getByText("Enter the employee’s first name.")).toBeVisible();
  await expect(page.getByText("Select a designation.")).toBeVisible();
  await expect(page.getByText("Enter the joining date.")).toBeVisible();
  await expect(firstName).toHaveAttribute("aria-describedby", "first-name-error");

  const department = page.getByRole("combobox", { name: "Department" });
  const team = page.getByRole("combobox", { name: "Team" });
  await expect(department).toBeDisabled();
  await expect(team).toBeDisabled();
  await selectBrandedOption(page.getByRole("combobox", { name: "Office" }), fixture.office.id);
  await expect(department).toBeEnabled();
  await expect(team).toBeDisabled();
  await selectBrandedOption(department, fixture.department.id);
  await expect(team).toBeEnabled();
  await selectBrandedOption(team, fixture.team.id);

  await firstName.fill("Nexa");
  await middleName.fill("Review");
  await page.getByLabel(/^Last Name/).fill("Employee");
  await expect(page.getByLabel("Full Name", { exact: true })).toHaveValue("Nexa Review Employee");
  await expect(page.getByLabel("Full Name", { exact: true })).toHaveAttribute("readonly", "");
  await page.getByLabel(/^Employee Code/).fill(`EMP-CU-${fixture.tag}`);
  await page.getByLabel(/^Work Email/).fill(`create-${fixture.tag.toLowerCase()}@example.test`);
  await page.getByLabel(/^Work Mobile/).fill("+971500004444");
  await page.getByLabel("Personal Email", { exact: true }).fill(`personal-${fixture.tag.toLowerCase()}@example.test`);
  await page.getByLabel("Personal Mobile", { exact: true }).fill("+971500005555");
  await selectBrandedOption(page.getByRole("combobox", { name: "Designation" }), fixture.designation.id);
  await page.getByLabel("Joining Date").fill("2026-09-10");
  const manager = page.getByRole("combobox", { name: "Reporting Manager" });
  expect((await brandedOptionValues(manager)).length).toBeGreaterThan(1);
  await expectNoPageOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("create-user-desktop.png"), fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Application sidebar")).toHaveClass(/-translate-x-full/);
  await expect(page.getByLabel("Close navigation")).not.toBeInViewport();
  const firstMobile = await firstName.boundingBox();
  const middleMobile = await middleName.boundingBox();
  expect(firstMobile && middleMobile).toBeTruthy();
  expect(Math.abs(firstMobile!.x - middleMobile!.x)).toBeLessThan(2);
  expect(middleMobile!.y).toBeGreaterThan(firstMobile!.y + firstMobile!.height);
  await expectNoPageOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("create-user-mobile.png"), fullPage: false });

  await page.getByRole("button", { name: "Create User", exact: true }).click();
  await expect(page).toHaveURL(/\/users\/[0-9a-f-]+\?tab=overview$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Nexa Review Employee", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "HR Profile" }).click();
  await expect(page.getByRole("heading", { name: "HR profile" })).toBeVisible();
  await page.getByRole("tab", { name: "PRO & Documents" }).click();
  await expect(page.getByRole("heading", { name: "PRO compliance records" })).toBeVisible();
  await expectNoPageOverflow(page);
});

test("unauthenticated users cannot use the Create User route or API", async ({ page, request }) => {
  await page.goto("/users/new");
  await expect(page).toHaveURL(/\/login$/);
  const response = await request.post(`${apiOrigin}/api/v1/users`, { data: {} });
  expect(response.status()).toBe(401);
});
