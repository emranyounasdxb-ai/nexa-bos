import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

async function ownerHeaders(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  if (((await status.json()) as { available: boolean }).available) {
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
  const login = await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: "owner@example.com", password: "OwnerPass1!" },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function signIn(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^(Dashboard|Users)$/ })).toBeVisible({ timeout: 30_000 });
}

async function createViewer(request: APIRequestContext, headers: Record<string, string>) {
  const tag = Date.now().toString().slice(-8);
  const designations = await request.get(`${apiOrigin}/api/v1/designations`);
  const designation = ((await designations.json()) as { items: { id: string }[] }).items[0]!;
  const created = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Bulk Upload Viewer ${tag}`,
      employee_code: `EMP-BUV-${tag}`,
      email: `bulk-viewer-${tag}@example.com`,
      mobile: "+971500000090",
      designation_id: designation.id,
      employment_status: "Active",
      joining_date: "2026-09-01",
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const user = (await created.json()) as { id: string; email: string };
  const types = await request.get(`${apiOrigin}/api/v1/user-types`);
  const viewerType = ((await types.json()) as { items: { id: string; code: string }[] }).items.find(
    (item) => item.code === "SE",
  )!;
  expect(
    (await request.post(`${apiOrigin}/api/v1/users/${user.id}/assign-type`, { headers, data: { user_type_id: viewerType.id } })).ok(),
  ).toBeTruthy();
  expect((await request.post(`${apiOrigin}/api/v1/users/${user.id}/activate`, { headers })).ok()).toBeTruthy();
  const setup = await request.post(`${apiOrigin}/api/v1/auth/users/${user.id}/setup-link`, { headers });
  const token = ((await setup.json()) as { token: string }).token;
  expect(
    (await request.post(`${apiOrigin}/api/v1/auth/setup`, { data: { token, password: "UserPass1!" } })).ok(),
  ).toBeTruthy();
  return user;
}

test("OWNER bulk upload UI validates and imports on desktop/mobile while non-OWNER stays blocked", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(30_000);
  const headers = await ownerHeaders(request);
  const viewer = await createViewer(request, headers);

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "owner@example.com", "OwnerPass1!");
  await page.goto("/users");
  const trigger = page.getByRole("button", { name: "Bulk Upload" });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Bulk Upload Staff" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("full_name", { exact: true })).toBeVisible();
  await expect(dialog.getByText("personal_email", { exact: true })).toBeVisible();
  await expect(dialog.getByText("mobile", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download Sample CSV" }).click();
  expect((await download).suggestedFilename()).toBe("nexa-bos-staff-bulk-upload-sample.csv");

  const email = `bulk-ui-${Date.now()}@example.com`;
  await dialog.getByLabel("CSV file").setInputFiles({
    name: "staff.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`full_name,personal_email,mobile,emirates_id_number\r\nUI Staff,${email},001234567,\r\n`),
  });
  await dialog.getByRole("button", { name: "Validate CSV" }).click();
  await expect(dialog.getByText("1 rows ready to import")).toBeVisible();
  await dialog.getByRole("button", { name: "Import 1 Staff" }).click();
  await expect(dialog.getByText("Successfully imported 1 staff record.")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByLabel("Dark theme", { exact: true }).click();
  await page.keyboard.press("Escape");
  await trigger.click();
  await expect(dialog).toBeVisible();
  await dialog.getByText(/^Optional fields/).click();
  await expect(dialog.getByText("emirates_id_number", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  await dialog.getByRole("button", { name: "Close Bulk Upload" }).click();

  await signIn(page, viewer.email, "UserPass1!");
  await page.goto("/users");
  await expect(page.getByRole("button", { name: "Bulk Upload" })).toHaveCount(0);
});
