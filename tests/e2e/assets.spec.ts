import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { selectBrandedOption } from "./helpers/select";

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
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function signIn(
  page: Page,
  request: APIRequestContext,
  email = "owner@example.com",
  password = "OwnerPass1!",
) {
  await ensureOwner(request);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await ensureAssetsMenuOpen(page);
}

async function ensureAssetsMenuOpen(page: Page) {
  const assetsLink = page.getByRole("link", { name: "Assets", exact: true });
  if (!(await assetsLink.isVisible())) {
    await expect(page.getByRole("button", { name: "Assets menu" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Assets menu" }).click();
  }
  await expect(page.getByRole("link", { name: "Assets", exact: true })).toBeVisible({
    timeout: 5_000,
  });
}

async function masterData(request: APIRequestContext) {
  const headers = await ownerHeaders(request);
  const offices = (
    (await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as {
      items: { id: string; code: string }[];
    }
  ).items;
  const designations = (
    (await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as {
      items: { id: string }[];
    }
  ).items;
  return { headers, office: offices[0], designation: designations[0] };
}

async function createEmployee(
  request: APIRequestContext,
  headers: Record<string, string>,
  officeId: string,
  designationId: string,
  label: string,
) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-8);
  const emailPrefix = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const response = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `${label} ${suffix}`,
      employee_code: `EMP-${label.slice(0, 2).toUpperCase()}-${suffix}`,
      email: `${emailPrefix}-${suffix}@example.com`,
      mobile: `+9715${suffix}`,
      designation_id: designationId,
      employment_status: "Active",
      joining_date: "2026-01-01",
      office_id: officeId,
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { id: string; fullName: string; email: string };
}

test("owner completes tracked Asset creation, custody, profile, offboarding, return, and reports", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const { headers, office, designation } = await masterData(request);
  const firstEmployee = await createEmployee(
    request,
    headers,
    office.id,
    designation.id,
    "Asset Alice",
  );
  const secondEmployee = await createEmployee(
    request,
    headers,
    office.id,
    designation.id,
    "Asset Bob",
  );
  const suffix = `${Date.now()}`.slice(-8);

  await signIn(page, request);
  await page.getByRole("link", { name: "Assets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Asset Register" })).toBeVisible();

  await selectBrandedOption(page.getByLabel("Asset category", { exact: true }), { label: "PC / Computer" });
  await expect(page.getByLabel("Serial Number / Service Tag")).toBeVisible();
  await page.getByLabel("Brand").fill("Dell");
  await page.getByLabel("Model").fill("Latitude 7450");
  const serial = `E2E-PC-${suffix}`;
  await page.getByLabel("Serial Number / Service Tag").fill(serial);
  await page.getByRole("button", { name: "Create Asset" }).click();
  await expect(page.getByText(/AST-\d{6} created/)).toBeVisible();
  const pcRow = page.getByRole("row").filter({ hasText: serial });
  await expect(pcRow).toBeVisible();
  const assetCode = (await pcRow.getByRole("link").textContent()) ?? "";
  expect(assetCode).toMatch(/^AST-\d{6}$/);

  await selectBrandedOption(page.getByLabel("Asset category", { exact: true }), { label: "Mobile Phone" });
  await expect(page.getByLabel("IMEI")).toBeVisible();
  await page.getByLabel("Brand").fill("Apple");
  await page.getByLabel("Model").fill("iPhone 17");
  const imei = `3598765${suffix}`.slice(0, 15);
  await page.getByLabel("IMEI").fill(imei);
  await page.getByRole("button", { name: "Create Asset" }).click();
  await expect(page.getByRole("row").filter({ hasText: imei })).toBeVisible();

  await selectBrandedOption(page.getByLabel("Asset category", { exact: true }), { label: "SIM Card" });
  await expect(page.getByLabel("ICCID / SIM Identifier")).toBeVisible();
  const mobile = `+97150${suffix}`;
  const iccid = `89971123${suffix}123456`.slice(0, 20);
  await page.getByLabel("Mobile Number").fill(mobile);
  await page.getByLabel("ICCID / SIM Identifier").fill(iccid);
  await page.getByLabel("Operator / Provider").fill("du");
  await page.getByRole("button", { name: "Create Asset" }).click();
  await expect(page.getByRole("row").filter({ hasText: iccid })).toBeVisible();

  await pcRow.getByRole("link", { name: assetCode }).click();
  await expect(page.getByRole("heading", { name: "Asset identity and custody" })).toBeVisible();
  await selectBrandedOption(page.getByLabel("Allocation employee"), firstEmployee.id);
  await selectBrandedOption(page.getByLabel("Condition at Issue"), "Good");
  await page.getByRole("button", { name: "Allocate Asset" }).click();
  await expect(page.getByText("Asset allocated", { exact: true })).toBeVisible();

  await page.goto(`/users/${firstEmployee.id}`);
  await page.getByRole("tab", { name: "Assets" }).click();
  await expect(page.getByRole("heading", { name: "Current Assets" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: assetCode })).toContainText("Good");

  await page.getByRole("link", { name: assetCode }).click();
  await selectBrandedOption(page.getByLabel("Transfer employee"), secondEmployee.id);
  await page.getByRole("button", { name: "Transfer Employee" }).click();
  await expect(page.getByText("Employee custody transferred atomically")).toBeVisible();
  await expect(page.getByText(secondEmployee.fullName, { exact: true }).first()).toBeVisible();

  await page.goto(`/users/${secondEmployee.id}/edit`);
  await selectBrandedOption(page.getByLabel("Employment status"), "Resigned");
  await page.getByLabel("Last working date").fill("2026-08-30");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: secondEmployee.fullName })).toBeVisible();
  await page.getByRole("tab", { name: "Assets" }).click();
  await page.getByRole("link", { name: assetCode }).click();
  await expect(page.getByText(/Outstanding Asset/)).toBeVisible();

  await ensureAssetsMenuOpen(page);
  await page.getByRole("link", { name: "Asset reports" }).click();
  await selectBrandedOption(page.getByRole("combobox", { name: "Asset report" }), "outstanding_assets");
  await page.getByRole("button", { name: "Run report" }).click();
  await expect(page.getByRole("row").filter({ hasText: assetCode })).toContainText("Yes");
  await expect(page.getByRole("button", { name: "Excel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "PDF" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
  await expect(page.getByText("CSV", { exact: true })).toHaveCount(0);

  await ensureAssetsMenuOpen(page);
  await page.getByRole("link", { name: "Assets", exact: true }).click();
  await page.getByRole("row").filter({ hasText: assetCode }).getByRole("link").click();
  await selectBrandedOption(page.getByLabel("Return Condition"), "Fair");
  await page.getByRole("button", { name: "Process Return" }).click();
  await expect(page.getByText("Asset returned; allocation history preserved")).toBeVisible();
  const allocationHistory = page.getByRole("heading", { name: "Asset History" }).locator("..");
  await expect(allocationHistory.getByRole("row").filter({ hasText: firstEmployee.fullName })).toBeVisible();
  await expect(allocationHistory.getByRole("row").filter({ hasText: secondEmployee.fullName })).toContainText("Fair");
});

test("Assets.View-only user sees own custody without privileged controls or mutation authority", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const { headers, office, designation } = await masterData(request);
  const suffix = `${Date.now()}`.slice(-7);
  const typeResponse = await request.post(`${apiOrigin}/api/v1/user-types`, {
    headers,
    data: { name: `Asset Viewer ${suffix}`, code: `AV${suffix}` },
  });
  expect(typeResponse.ok()).toBeTruthy();
  const userType = (await typeResponse.json()) as { id: string };
  expect(
    (await request.post(`${apiOrigin}/api/v1/user-types/${userType.id}/activate`, { headers })).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.put(`${apiOrigin}/api/v1/user-types/${userType.id}/permissions`, {
        headers,
        data: { permissions: ["Assets.View"] },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.put(`${apiOrigin}/api/v1/user-types/${userType.id}/scope`, {
        headers,
        data: { visibility_scope: "own" },
      })
    ).ok(),
  ).toBeTruthy();

  const viewer = await createEmployee(
    request,
    headers,
    office.id,
    designation.id,
    "Asset Viewer",
  );
  expect(
    (
      await request.post(`${apiOrigin}/api/v1/users/${viewer.id}/assign-type`, {
        headers,
        data: { user_type_id: userType.id },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (await request.post(`${apiOrigin}/api/v1/users/${viewer.id}/activate`, { headers })).ok(),
  ).toBeTruthy();
  const setup = await request.post(`${apiOrigin}/api/v1/auth/users/${viewer.id}/setup-link`, {
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

  const categories = (await (await request.get(`${apiOrigin}/api/v1/assets/categories`)).json()) as {
    items: { id: string; code: string }[];
  };
  const createdAsset = await request.post(`${apiOrigin}/api/v1/assets`, {
    headers,
    data: {
      category_id: categories.items.find((item) => item.code === "PC")?.id,
      office_id: office.id,
      condition: "Good",
      brand: "Lenovo",
      model: "ThinkPad",
      serial_number: `VIEW-${suffix}`,
      attributes: {},
    },
  });
  expect(createdAsset.ok()).toBeTruthy();
  const asset = (await createdAsset.json()) as { id: string; assetCode: string };
  expect(
    (
      await request.post(`${apiOrigin}/api/v1/assets/${asset.id}/allocate`, {
        headers,
        data: {
          employee_id: viewer.id,
          issue_date: "2026-08-30",
          condition_at_issue: "Good",
        },
      })
    ).ok(),
  ).toBeTruthy();

  await signIn(page, request, viewer.email, "UserPass1!");
  await expect(page.getByRole("link", { name: "Asset categories" })).toHaveCount(0);
  await page.getByRole("link", { name: "Assets", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: asset.assetCode })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create Asset" })).toHaveCount(0);
  await page.getByRole("link", { name: asset.assetCode }).click();
  await expect(page.getByRole("heading", { name: "Asset identity and custody" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit Asset master" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Return Asset" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Employee transfer" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Status management" })).toHaveCount(0);

  const login = await page.request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: viewer.email, password: "UserPass1!" },
  });
  expect(login.ok()).toBeTruthy();
  const csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
  const denied = await page.request.post(`${apiOrigin}/api/v1/assets/${asset.id}/status`, {
    headers: { "X-CSRF-Token": csrf },
    data: { status: "Lost", reason: "Unauthorized probe" },
  });
  expect(denied.status()).toBe(403);
});
