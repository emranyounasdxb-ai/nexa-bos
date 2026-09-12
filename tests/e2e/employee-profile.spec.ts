import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { selectBrandedOption } from "./helpers/select";
import { profileCountries } from "../../apps/web/lib/profile-countries";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

type Ref = { id: string; code: string; name: string };
type SeededProfile = {
  assetCode: string;
  email: string;
  fullName: string;
  password: string;
  returnedAssetCode: string;
  userCode: string;
  userId: string;
  userType: Ref;
};
type Operator = { email: string; password: string };

async function ensureOwner(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  if (!((await status.json()) as { available: boolean }).available) return;
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
  await expect(page.getByRole("heading", { name: /^(Dashboard|Users)$/ })).toBeVisible({
    timeout: 30_000,
  });
}

async function expectOk(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response;
}

async function seedProfile(request: APIRequestContext): Promise<SeededProfile> {
  const headers = await ownerHeaders(request);
  const tag = Date.now().toString(16).slice(-7).toUpperCase();
  const offices = (await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as { items: Ref[] };
  const designations = (await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as { items: Ref[] };
  const office = offices.items[0];
  const designation = designations.items[0];
  if (!office || !designation) throw new Error("Disposable organization masters were not available.");

  const createdType = await expectOk(await request.post(`${apiOrigin}/api/v1/user-types`, {
    headers,
    data: { name: `Profile Employee ${tag}`, code: `EP${tag}` },
  }));
  const userType = (await createdType.json()) as Ref;
  await expectOk(await request.post(`${apiOrigin}/api/v1/user-types/${userType.id}/activate`, { headers }));

  const fullName = `Profile Employee ${tag}`;
  const email = `profile-${tag.toLowerCase()}@example.com`;
  const password = "ProfileEmployee1!";
  const createdUser = await expectOk(await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: fullName,
      employee_code: `EMP-${tag}`,
      email,
      mobile: `+9715${Date.now().toString().slice(-8)}`,
      designation_id: designation.id,
      employment_status: "Active",
      joining_date: "2026-01-01",
      office_id: office.id,
    },
  }));
  const user = (await createdUser.json()) as { id: string; userCode: string };
  await expectOk(await request.post(`${apiOrigin}/api/v1/users/${user.id}/assign-type`, {
    headers,
    data: { user_type_id: userType.id },
  }));
  await expectOk(await request.post(`${apiOrigin}/api/v1/users/${user.id}/activate`, { headers }));
  const setup = await expectOk(await request.post(`${apiOrigin}/api/v1/auth/users/${user.id}/setup-link`, { headers }));
  const setupToken = ((await setup.json()) as { token: string }).token;
  await expectOk(await request.post(`${apiOrigin}/api/v1/auth/setup`, {
    data: { token: setupToken, password },
  }));

  const categories = (await (await request.get(`${apiOrigin}/api/v1/assets/categories`)).json()) as {
    items: Ref[];
  };
  const category = categories.items.find((item) => item.code === "PC");
  if (!category) throw new Error("Disposable PC asset category was not available.");

  async function createAsset(serial: string) {
    const created = await expectOk(await request.post(`${apiOrigin}/api/v1/assets`, {
      headers,
      data: {
        category_id: category.id,
        office_id: office.id,
        condition: "Good",
        brand: "Nexa QA",
        model: "Profile Fixture",
        serial_number: serial,
        attributes: {},
      },
    }));
    const asset = (await created.json()) as { id: string; assetCode: string };
    await expectOk(await request.post(`${apiOrigin}/api/v1/assets/${asset.id}/allocate`, {
      headers,
      data: { employee_id: user.id, issue_date: "2026-09-01", condition_at_issue: "Good" },
    }));
    return asset;
  }

  const currentAsset = await createAsset(`CURRENT-${tag}`);
  const returnedAsset = await createAsset(`RETURNED-${tag}`);
  await expectOk(await request.post(`${apiOrigin}/api/v1/assets/${returnedAsset.id}/return`, {
    headers,
    data: { return_date: "2026-09-02", return_condition: "Fair" },
  }));

  for (let index = 0; index < 6; index += 1) {
    await expectOk(await request.post(`${apiOrigin}/api/v1/users/${user.id}/deactivate`, { headers }));
    await expectOk(await request.post(`${apiOrigin}/api/v1/users/${user.id}/activate`, { headers }));
  }

  return {
    assetCode: currentAsset.assetCode,
    email,
    fullName,
    password,
    returnedAssetCode: returnedAsset.assetCode,
    userCode: user.userCode,
    userId: user.id,
    userType,
  };
}

async function seedProfileOperator(request: APIRequestContext, roleCode: "HR" | "PRO"): Promise<Operator> {
  const headers = await ownerHeaders(request);
  const tag = Date.now().toString(16).slice(-7).toUpperCase();
  const types = (await (await request.get(`${apiOrigin}/api/v1/user-types`)).json()) as { items: (Ref & { permissions: string[] })[] };
  const role = types.items.find((item) => item.code === roleCode);
  if (!role) throw new Error(`${roleCode} User Type was not available.`);
  await expectOk(await request.put(`${apiOrigin}/api/v1/user-types/${role.id}/scope`, { headers, data: { visibility_scope: "company" } }));
  const designations = (await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as { items: Ref[] };
  const designation = designations.items[0];
  if (!designation) throw new Error("Disposable designation was not available.");
  const email = `${roleCode.toLowerCase()}-${tag.toLowerCase()}@example.test`;
  const password = `${roleCode}Profile1!`;
  const created = await expectOk(await request.post(`${apiOrigin}/api/v1/users`, { headers, data: {
    full_name: `${roleCode} Profile Operator ${tag}`, employee_code: `${roleCode}-${tag}`,
    email, mobile: "+971500003333", designation_id: designation.id,
    employment_status: "Active", joining_date: "2026-01-01", user_type_id: role.id,
  } }));
  const user = (await created.json()) as { id: string };
  await expectOk(await request.post(`${apiOrigin}/api/v1/users/${user.id}/activate`, { headers }));
  const setup = await expectOk(await request.post(`${apiOrigin}/api/v1/auth/users/${user.id}/setup-link`, { headers }));
  const setupToken = ((await setup.json()) as { token: string }).token;
  await expectOk(await request.post(`${apiOrigin}/api/v1/auth/setup`, {
    data: { token: setupToken, password },
  }));
  return { email, password };
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBeTruthy();
}

test("employee profile organizes identity, access, assets, and filtered audit history", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const seeded = await seedProfile(request);
  const hrOperator = await seedProfileOperator(request, "HR");
  const proOperator = await seedProfileOperator(request, "PRO");
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto(`/users/${seeded.userId}`);

  await expect(page).toHaveURL(new RegExp(`/users/${seeded.userId}\\?tab=overview$`));
  await expect(page.getByRole("heading", { name: seeded.fullName, exact: true })).toBeVisible();
  await expect(page.getByText(seeded.userCode, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit profile" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Performance profile" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contact details" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Organization assignment" })).toHaveCount(0);

  const tabs = page.getByRole("tablist", { name: "Employee profile" });
  const hrLogin = await request.post(`${apiOrigin}/api/v1/auth/login`, { data: hrOperator });
  expect(hrLogin.ok(), await hrLogin.text()).toBeTruthy();
  const hrCsrf = ((await hrLogin.json()) as { csrfToken: string }).csrfToken;
  const hrUpdate = await request.put(`${apiOrigin}/api/v1/employee-profiles/${seeded.userId}/hr`, {
    headers: { "X-CSRF-Token": hrCsrf },
    data: { job_title: "Review Employee", business_unit: "Operations", location: "Dubai" },
  });
  expect(hrUpdate.ok(), await hrUpdate.text()).toBeTruthy();
  const overviewTab = tabs.getByRole("tab", { name: "Overview" });
  await overviewTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "HR Profile" })).toBeFocused();
  await expect(page).toHaveURL(/tab=hr$/);
  await expect(page.getByRole("heading", { name: "HR profile" })).toBeVisible();
  await expect(page.getByLabel("Job title")).toHaveValue("Review Employee");
  await tabs.getByRole("tab", { name: "PRO & Documents" }).click();
  await expect(page).toHaveURL(/tab=pro$/);
  await expect(page.getByRole("heading", { name: "PRO & Documents" })).toBeVisible();
  const proLogin = await request.post(`${apiOrigin}/api/v1/auth/login`, { data: proOperator });
  expect(proLogin.ok(), await proLogin.text()).toBeTruthy();
  const proCsrf = ((await proLogin.json()) as { csrfToken: string }).csrfToken;
  const document = await request.post(`${apiOrigin}/api/v1/employee-profiles/${seeded.userId}/documents`, {
    headers: { "X-CSRF-Token": proCsrf },
    data: { kind: "passport", document_number: `PASS-${Date.now()}`, expiry_date: "2027-12-31" },
  });
  expect(document.ok(), await document.text()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Passport" })).toBeVisible({ timeout: 20_000 });
  await tabs.getByRole("tab", { name: "Organization & Access" }).click();
  await expect(tabs.getByRole("tab", { name: "Organization & Access" })).toBeFocused();
  await expect(page).toHaveURL(/tab=organization$/);
  await expect(page.getByRole("heading", { name: "Account & Security" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deactivate", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Unlock", exact: true })).toHaveCount(0);

  const deactivate = page.getByRole("button", { name: "Deactivate", exact: true });
  await deactivate.click();
  await expect(page.getByRole("dialog", { name: "Deactivate account?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Deactivate account?" })).toHaveCount(0);
  await expect(deactivate).toBeFocused();

  const resetLink = page.getByRole("button", { name: "Generate reset link" });
  await resetLink.click();
  const resetDialog = page.getByRole("dialog", { name: "Generate reset link?" });
  await expect(resetDialog).toBeVisible();
  await resetDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(resetLink).toBeFocused();

  const assignType = page.getByRole("combobox", { name: "Assign user type" });
  await selectBrandedOption(assignType, seeded.userType.id);
  const typeDialog = page.getByRole("dialog", { name: "Assign user type?" });
  await expect(typeDialog).toBeVisible();
  await typeDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(assignType).toBeFocused();

  await tabs.getByRole("tab", { name: "Assets" }).click();
  await expect(page).toHaveURL(/tab=assets$/);
  await expect(page.getByRole("heading", { name: "Current Assets" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: seeded.assetCode })).toContainText("Good");
  await expect(page.getByRole("heading", { name: "Returned Assets" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: seeded.returnedAssetCode })).toContainText("Fair");

  await tabs.getByRole("tab", { name: "History & Audit" }).click();
  await expect(page).toHaveURL(/tab=history$/);
  await expect(page.getByRole("heading", { name: "Audit events" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "List pagination" })).toBeVisible();
  await selectBrandedOption(page.getByLabel("Audit action filter"), "user.activate");
  await expect(page.getByText("User activate", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Search audit events").fill("no-such-audit-event");
  await expect(page.getByText("No audit events match the current filters.")).toBeVisible();
  await page.getByLabel("Search audit events").fill("");
  await page.goBack();
  await expect(page).toHaveURL(/tab=assets$/);
  await expect(page.getByRole("heading", { name: "Current Assets" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const employeeContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const employeePage = await employeeContext.newPage();
  try {
    await employeePage.goto("/login");
    await employeePage.getByLabel("Email").fill(seeded.email);
    await employeePage.getByLabel("Password").fill(seeded.password);
    await employeePage.getByRole("button", { name: "Sign in" }).click();
    await expect(employeePage).toHaveURL(/\/(users|account)$/, { timeout: 30_000 });
    await employeePage.goto(`/users/${seeded.userId}?tab=hr`);
    await expect(employeePage.getByRole("heading", { name: "HR profile" })).toBeVisible();
    await expect(employeePage.getByLabel("Job title")).toHaveValue("Review Employee");
    await expect(employeePage.getByLabel("Job title")).toHaveAttribute("readonly", "");
    for (const name of ["Gender", "Nationality", "Marital status", "Date of birth", "Joining date", "Probation end"]) {
      await expect(employeePage.getByRole("combobox", { name, exact: true })).toBeDisabled();
    }
    await expect(employeePage.getByRole("button", { name: "Save HR profile", exact: true })).toHaveCount(0);
    await employeePage.getByRole("tab", { name: "PRO & Documents" }).click();
    await expect(employeePage.getByRole("heading", { name: "Passport" })).toBeVisible();
    await expect(
      employeePage.getByRole("button", { name: /upload|replace|remove|purge/i }),
    ).toHaveCount(0);
    await expectNoHorizontalOverflow(employeePage);
  } finally {
    await employeeContext.close();
  }
});

test("employee profile uses compact mobile cards without overflow", async ({ page, request }) => {
  test.setTimeout(120_000);
  const seeded = await seedProfile(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  await page.goto(`/users/${seeded.userId}?tab=assets`);
  await expect(page.getByTestId("current-asset-cards")).toContainText(seeded.assetCode);
  await expect(page.getByTestId("returned-asset-cards")).toContainText(seeded.returnedAssetCode);
  await expect(page.locator("table:visible")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("tab", { name: "Organization & Access" }).click();
  const deactivate = page.getByRole("button", { name: "Deactivate", exact: true });
  await deactivate.click();
  await expect(page.getByRole("dialog", { name: "Deactivate account?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(deactivate).toBeFocused();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("tab", { name: "History & Audit" }).click();
  await expect(page.getByTestId("audit-event-cards")).toBeVisible();
  await expect(page.locator("table:visible")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

for (const width of [1440, 390]) {
  test(`HR and PRO compact fields preserve values and calendars at ${width}`, async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    const seeded = await seedProfile(request);
    const headers = await ownerHeaders(request);
    await expectOk(await request.put(`${apiOrigin}/api/v1/employee-profiles/${seeded.userId}/hr`, {
      headers, data: { gender: "Existing gender", marital_status: "Existing status", nationality: "Existing nationality", date_of_birth: "1990-01-10" },
    }));
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await signIn(page);
    await page.goto(`/users/${seeded.userId}?tab=hr`);
    await expect(page.getByLabel("Gender", { exact: true })).toContainText("Existing gender");
    await expect(page.getByLabel("Marital status", { exact: true })).toContainText("Existing status");
    await expect(page.getByLabel("Nationality", { exact: true })).toHaveValue("Existing nationality");
    await page.getByRole("button", { name: "Save HR profile", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("HR profile saved.");
    await page.reload();
    await expect(page.getByLabel("Nationality", { exact: true })).toHaveValue("Existing nationality");

    for (const label of ["Date of birth", "Joining date", "Probation end"]) {
      const field = page.getByRole("combobox", { name: label, exact: true });
      await field.click();
      await expect(page.getByRole("dialog", { name: "Choose date" })).toBeVisible();
      await page.keyboard.press("Escape");
      await field.focus();
      await field.press("ArrowDown");
      await expect(page.getByRole("dialog", { name: "Choose date" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(field).toBeFocused();
      await page.getByRole("button", { name: `Open ${label} calendar` }).click();
      await expect(page.getByRole("dialog", { name: "Choose date" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press("Escape");
    }
    await selectBrandedOption(page.getByLabel("Gender", { exact: true }), "Female");
    await selectBrandedOption(page.getByLabel("Marital status", { exact: true }), "Single");
    const nationality = page.getByRole("combobox", { name: "Nationality", exact: true });
    await nationality.click();
    expect(profileCountries).toHaveLength(249);
    expect(new Set(profileCountries.map((country) => country.code)).size).toBe(249);
    await expect(page.getByRole("option")).toHaveCount(251);
    // Every ISO entry is rendered with its flag and searchable readable name.
    for (const country of profileCountries) {
      await expect(page.locator(`[data-country-code="${country.code}"]`)).toHaveText(`${country.flag} ${country.name}`);
    }
    await nationality.fill("United Arab");
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("option")).toContainText("🇦🇪 United Arab Emirates");
    await nationality.press("Enter");
    await expect(nationality).toHaveValue("🇦🇪 United Arab Emirates");
    expect(await page.evaluate(async () => {
      await document.fonts.load('14px "Profile Country Flags"', "🇦🇪");
      return document.fonts.check('14px "Profile Country Flags"', "🇦🇪");
    })).toBe(true);
    await nationality.press("ArrowDown");
    await nationality.fill("zzzz no country");
    await expect(page.getByText("No matching countries")).toBeVisible();
    await nationality.press("Escape");
    await expect(nationality).toHaveValue("🇦🇪 United Arab Emirates");

    const birth = page.getByRole("combobox", { name: "Date of birth", exact: true });
    await birth.click();
    await page.getByRole("dialog", { name: "Choose date" }).getByRole("button", { name: "1990-01-15", exact: true }).click();
    await expect(birth).toHaveValue("1990-01-15");
    await expect(birth).toBeFocused();
    await birth.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(birth).toHaveValue("1990-01-16");
    await expect(birth).toBeFocused();
    await page.getByRole("button", { name: "Save HR profile", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("HR profile saved.");
    await page.reload();
    await expect(birth).toHaveValue("1990-01-16");
    await expect(nationality).toHaveValue("🇦🇪 United Arab Emirates");
    await expect(page.getByLabel("Gender", { exact: true })).toContainText("Female");
    await expect(page.getByLabel("Marital status", { exact: true })).toContainText("Single");
    const columns = await page.getByTestId("hr-field-grid").first().evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(width === 1440 ? 5 : 1);
    await expectNoHorizontalOverflow(page);
    await page.getByTestId("employee-lifecycle-profile").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`hr-${width}.png`), fullPage: false });

    await page.getByRole("tab", { name: "PRO & Documents" }).click();
    await page.getByLabel("Number", { exact: true }).fill(`COMPACT-${width}`);
    const expiry = page.getByRole("combobox", { name: "Expiry", exact: true });
    await expiry.fill("2028-06-10");
    await expiry.press("Tab");
    await expiry.click();
    await expect(page.getByRole("dialog", { name: "Choose date" })).toBeVisible();
    await expiry.press("Escape");
    await expiry.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(expiry).toHaveValue("2028-06-11");
    await expect(expiry).toBeFocused();
    await page.getByRole("button", { name: "Open Expiry calendar" }).click();
    await expect(page.getByRole("dialog", { name: "Choose date" })).toBeVisible();
    await page.getByRole("dialog", { name: "Choose date" }).getByRole("button", { name: "2028-06-15", exact: true }).click();
    await expect(expiry).toHaveValue("2028-06-15");
    await page.getByLabel("Attachment", { exact: true }).setInputFiles({ name: "compact-test.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF") });
    await page.getByRole("button", { name: "Add record", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("PRO document record added.");
    await page.reload();
    // Metadata creation is version 1; the existing audited upload creates version 2.
    await expect(page.getByText(`Version 2 · COMPACT-${width}`)).toBeVisible();
    await expect(page.getByText("2028-06-15", { exact: true })).toBeVisible();
    await expect(page.getByText("compact-test.pdf", { exact: true })).toBeVisible();
    expect(await page.getByTestId("pro-field-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(width === 1440 ? 5 : 1);
    await expectNoHorizontalOverflow(page);
    await page.getByTestId("employee-lifecycle-profile").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`pro-${width}.png`), fullPage: false });
  });
}

test("HR and PRO dashboards expose only implemented profile work", async ({ browser, page, request }, testInfo) => {
  test.setTimeout(120_000);
  const hrOperator = await seedProfileOperator(request, "HR");
  const proOperator = await seedProfileOperator(request, "PRO");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await page.getByLabel("Email").fill(hrOperator.email);
  await page.getByLabel("Password").fill(hrOperator.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 30_000 });
  await page.goto("/hr");
  await expect(page.getByRole("heading", { name: "HR Dashboard" })).toBeVisible();
  // Phase 2 adds the authorized operational summary, not a personal leave panel.
  await expect(page.getByRole("heading", { name: "HR workflows" })).toBeVisible();
  await expect(page.getByText("On leave today", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Approval Centre", exact: true })).toHaveAttribute("href", "/approvals");
  await expectNoHorizontalOverflow(page);

  const proContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const proPage = await proContext.newPage();
  try {
    await proPage.setViewportSize({ width: 390, height: 844 });
    await proPage.goto("/login");
    await proPage.getByLabel("Email").fill(proOperator.email);
    await proPage.getByLabel("Password").fill(proOperator.password);
    await proPage.getByRole("button", { name: "Sign in" }).click();
    await expect(proPage).not.toHaveURL(/\/login$/, { timeout: 30_000 });
    await proPage.goto("/pro");
    await expect(proPage.getByRole("heading", { name: "PRO Dashboard" })).toBeVisible();
    await expect(proPage.getByText("Pending Documents")).toBeVisible();
    await expectNoHorizontalOverflow(proPage);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      for (const [mode, target] of [["hr", page], ["pro", proPage]] as const) {
        await target.setViewportSize(viewport);
        await expectNoHorizontalOverflow(target);
        if (viewport.width === 390) {
          await expect(target.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "false");
          await expect.poll(() => target.getByLabel("Application sidebar").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
        }
        await target.evaluate(() => window.scrollTo(0, 0));
        await target.screenshot({ path: testInfo.outputPath(`${mode}-dashboard-${viewport.width}.png`), fullPage: false });
      }
    }
  } finally {
    await proContext.close();
  }
});
