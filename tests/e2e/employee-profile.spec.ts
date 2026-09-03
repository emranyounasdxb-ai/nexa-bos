import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { selectBrandedOption } from "./helpers/select";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

type Ref = { id: string; code: string; name: string };
type SeededProfile = {
  assetCode: string;
  fullName: string;
  returnedAssetCode: string;
  userCode: string;
  userId: string;
  userType: Ref;
};

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
  const createdUser = await expectOk(await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: fullName,
      employee_code: `EMP-${tag}`,
      email: `profile-${tag.toLowerCase()}@example.com`,
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
    fullName,
    returnedAssetCode: returnedAsset.assetCode,
    userCode: user.userCode,
    userId: user.id,
    userType,
  };
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBeTruthy();
}

test("employee profile organizes identity, access, assets, and filtered audit history", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const seeded = await seedProfile(request);
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
  const overviewTab = tabs.getByRole("tab", { name: "Overview" });
  await overviewTab.focus();
  await page.keyboard.press("ArrowRight");
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
