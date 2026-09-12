import { captureViewportThemes } from "./helpers/viewport-capture";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { preserveBuiltInRoleConfiguration } from "./helpers/role-configuration";

preserveBuiltInRoleConfiguration();
import { selectBrandedOption } from "./helpers/select";

const api = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const password = "SyntheticTransfer1!";
async function loginApi(request: APIRequestContext, email: string, value: string) {
  const response = await request.post(`${api}/api/v1/auth/login`, { data: { email, password: value } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return { "X-CSRF-Token": (await response.json()).csrfToken as string };
}
async function signIn(page: Page, email: string, value: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(value);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 30000 });
}
async function setup(request: APIRequestContext) {
  const status = await request.get(`${api}/api/v1/auth/bootstrap-status`);
  if ((await status.json()).available) {
    const response = await request.post(`${api}/api/v1/auth/bootstrap`, { data: { secret: process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret", full_name: "Platform Owner", employee_code: "EMP-OWNER", email: "owner@example.com", mobile: "+971500000000", joining_date: "2026-01-01", employment_status: "Active", password: "OwnerPass1!", designation_name: "Owner", designation_code: "OWN" } });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  const headers = await loginApi(request, "owner@example.com", "OwnerPass1!");
  const types = (await (await request.get(`${api}/api/v1/user-types`)).json()).items as { id: string; code: string }[];
  const scope = await request.put(`${api}/api/v1/user-types/${types.find(t => t.code === "HR")!.id}/scope`, { headers, data: { visibility_scope: "company" } });
  expect(scope.ok(), await scope.text()).toBeTruthy();
  const designation = (await (await request.get(`${api}/api/v1/designations`)).json()).items[0];
  const tag = crypto.randomUUID().slice(0, 8);
  const users: { id: string; email: string; fullName: string; employeeCode: string }[] = [];
  for (const [index, code] of ["HR", "HR", "SE"].entries()) {
    const email = `transfer-${tag}-${index}@example.com`;
    const response = await request.post(`${api}/api/v1/users`, { headers, data: { full_name: `Transfer ${tag} ${index}`, employee_code: `TR${tag}${index}`, email, mobile: "+971500000099", designation_id: designation.id, employment_status: "Active", joining_date: "2026-01-01" } });
    expect(response.ok(), await response.text()).toBeTruthy();
    const user = await response.json(); users.push(user);
    const assigned = await request.post(`${api}/api/v1/users/${user.id}/assign-type`, { headers, data: { user_type_id: types.find(t => t.code === code)!.id } });
    expect(assigned.ok(), await assigned.text()).toBeTruthy();
    const active = await request.post(`${api}/api/v1/users/${user.id}/activate`, { headers }); expect(active.ok()).toBeTruthy();
    const link = await request.post(`${api}/api/v1/auth/users/${user.id}/setup-link`, { headers }); expect(link.ok()).toBeTruthy();
    const setup = await request.post(`${api}/api/v1/auth/setup`, { data: { token: (await link.json()).token, password } }); expect(setup.ok()).toBeTruthy();
  }
  const created = await request.post(`${api}/api/v1/designations`, { headers, data: { code: `TD${tag}`, name: `Transfer destination ${tag}` } }); expect(created.ok()).toBeTruthy();
  return { users, designation: await created.json() as { id: string; name: string } };
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`transfer preparation, review and approval at ${viewport.width}`, async ({ page, request }, testInfo) => {
    test.setTimeout(120000);
    const { users: [hr, reviewer, employee], designation } = await setup(request);
    await page.setViewportSize(viewport);
    await signIn(page, hr.email, password);
    await page.goto("/transfers?status=Draft");
    await expect(page.getByRole("heading", { name: "Employee transfers" })).toBeVisible();
    const trigger = page.getByRole("button", { name: "Prepare transfer", exact: true });
    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Close dialog" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Save transfer", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Save transfer", exact: true }).focus();
    await expect(page.getByRole("button", { name: "Save transfer", exact: true })).toBeFocused();
    await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Close dialog" })).toBeFocused();
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
    await trigger.click();
    await selectBrandedOption(page.getByLabel("Employee *", { exact: true }), employee.id);
    await expect(page.getByLabel("Department", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Team", { exact: true })).toBeDisabled();
    await selectBrandedOption(page.getByLabel("Designation *", { exact: true }), designation.id);
    await page.getByLabel("Effective date *", { exact: true }).fill(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date()));
    await page.getByLabel("Reason *", { exact: true }).fill("Synthetic reviewed transfer");
    await captureViewportThemes(page, testInfo.outputPath(`transfer-form-${viewport.width}.png`));
    await captureViewportThemes(page, testInfo.outputPath(`transfer-form-actions-${viewport.width}.png`), page.getByRole("button", { name: "Save transfer", exact: true }));
    const savedResponse = page.waitForResponse(r => r.url().endsWith("/api/v1/transfers") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Save transfer", exact: true }).click();
    const saved = await (await savedResponse).json();
    await expect(page.getByRole("dialog", { name: "Transfer details" })).toBeVisible();
    await captureViewportThemes(page, testInfo.outputPath(`transfer-proposed-${viewport.width}.png`));
    await page.getByRole("button", { name: "Submit for HR review" }).click();
    await page.getByLabel("Reason / comment *").fill("Ready for HR review");
    await page.getByRole("button", { name: "Confirm decision" }).click();
    await expect(page.getByRole("dialog").getByText("Submitted", { exact: true })).toBeVisible();
    const headers = await loginApi(request, reviewer.email, password);
    const current = await (await request.get(`${api}/api/v1/transfers/${saved.id}`)).json();
    const reviewed = await request.post(`${api}/api/v1/transfers/${saved.id}/action`, { headers, data: { action: "review", lock_version: current.lockVersion, comment: "Independent HR review" } }); expect(reviewed.ok(), await reviewed.text()).toBeTruthy();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    if (viewport.width < 1024) await expect(page.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "false");
    // Account actions are in the header and remain reachable with the rail closed.
    await page.getByRole("button", { name: "Open user menu" }).focus();
    await expect(page.getByRole("button", { name: "Open user menu" })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await signIn(page, "owner@example.com", "OwnerPass1!");
    await page.goto("/transfers?status=Reviewed");
    await page.getByRole("row").filter({ hasText: employee.employeeCode }).getByRole("button", { name: "View transfer" }).click();
    await page.getByRole("button", { name: "Approve transfer", exact: true }).click();
    await page.getByLabel("Reason / comment *").fill("OWNER approval");
    await captureViewportThemes(page, testInfo.outputPath(`transfer-decision-${viewport.width}.png`));
    await page.getByRole("button", { name: "Confirm decision" }).click();
    await expect(page.getByRole("dialog").getByText("Applied", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByText(designation.name, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await captureViewportThemes(page, testInfo.outputPath(`transfer-applied-${viewport.width}.png`));
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page).toHaveURL(/status=Reviewed/);
    await selectBrandedOption(page.getByLabel("Status", { exact: true }), "Applied");
    await expect(page.getByRole("row").filter({ hasText: employee.employeeCode })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await captureViewportThemes(page, testInfo.outputPath(`transfer-register-${viewport.width}.png`));
  });
}
