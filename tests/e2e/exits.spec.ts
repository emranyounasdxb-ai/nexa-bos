import { captureViewportThemes } from "./helpers/viewport-capture";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { preserveBuiltInRoleConfiguration } from "./helpers/role-configuration";

preserveBuiltInRoleConfiguration();
import { selectBrandedOption } from "./helpers/select";

const api = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const password = "SyntheticExit1!";
async function login(request: APIRequestContext, email: string, value: string) {
  const response = await request.post(`${api}/api/v1/auth/login`, { data: { email, password: value } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return { "X-CSRF-Token": (await response.json()).csrfToken as string };
}
async function signIn(page: Page, email: string, value: string) {
  await page.goto("/login"); await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(value); await page.getByRole("button", { name: "Sign in" }).click(); await expect(page).not.toHaveURL(/\/login$/, { timeout: 30000 });
}
async function signOut(page: Page, width: number) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (width < 1024) await expect(page.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Open user menu" }).focus(); await expect(page.getByRole("button", { name: "Open user menu" })).toBeFocused(); await page.keyboard.press("Enter"); await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible(); await page.getByRole("menuitem", { name: "Sign out" }).click(); await expect(page).toHaveURL(/\/login/);
}
async function closeDetails(page: Page, restoredAction = "Prepare exit") {
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The existing dialog restores focus on the next animation frame. Assert its
  // actual destination before another keyboard action can race that restoration.
  await expect(page.getByRole("button", { name: restoredAction, exact: true })).toBeFocused();
}
async function setup(request: APIRequestContext) {
  if ((await (await request.get(`${api}/api/v1/auth/bootstrap-status`)).json()).available) {
    const response = await request.post(`${api}/api/v1/auth/bootstrap`, { data: { secret: process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret", full_name: "Platform Owner", employee_code: "EMP-OWNER", email: "owner@example.com", mobile: "+971500000000", joining_date: "2026-01-01", employment_status: "Active", password: "OwnerPass1!", designation_name: "Owner", designation_code: "OWN" } }); expect(response.ok(), await response.text()).toBeTruthy();
  }
  const headers = await login(request, "owner@example.com", "OwnerPass1!");
  const ownerId = (await (await request.get(`${api}/api/v1/auth/me`)).json()).id as string;
  const types = (await (await request.get(`${api}/api/v1/user-types`)).json()).items as { id: string; code: string }[];
  const scoped = await request.put(`${api}/api/v1/user-types/${types.find(t => t.code === "HR")!.id}/scope`, { headers, data: { visibility_scope: "company" } }); expect(scoped.ok()).toBeTruthy();
  const designation = (await (await request.get(`${api}/api/v1/designations`)).json()).items[0];
  const tag = crypto.randomUUID().slice(0, 8); const users: { id: string; email: string; fullName: string; employeeCode: string }[] = [];
  for (const [index, code] of ["SE", "HR", "HR"].entries()) {
    const response = await request.post(`${api}/api/v1/users`, { headers, data: { full_name: `Exit ${tag} ${index}`, employee_code: `EX${tag}${index}`, email: `exit-${tag}-${index}@example.com`, mobile: "+971500000090", designation_id: designation.id, employment_status: "Active", joining_date: "2026-01-01" } }); expect(response.ok(), await response.text()).toBeTruthy(); const user = await response.json(); users.push(user);
    const assigned = await request.post(`${api}/api/v1/users/${user.id}/assign-type`, { headers, data: { user_type_id: types.find(t => t.code === code)!.id } }); expect(assigned.ok()).toBeTruthy();
    const active = await request.post(`${api}/api/v1/users/${user.id}/activate`, { headers }); expect(active.ok()).toBeTruthy();
    const link = await request.post(`${api}/api/v1/auth/users/${user.id}/setup-link`, { headers }); expect(link.ok()).toBeTruthy();
    const setup = await request.post(`${api}/api/v1/auth/setup`, { data: { token: (await link.json()).token, password } }); expect(setup.ok()).toBeTruthy();
  }
  return { users, ownerId };
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`exit request, assigned clearance and completion at ${viewport.width}`, async ({ page, request }, testInfo) => {
    test.setTimeout(120000);
    const { users: [employee, hr, reviewer], ownerId } = await setup(request);
    await page.setViewportSize(viewport); await signIn(page, employee.email, password); await page.goto("/exits?status=Draft");
    await expect(page.getByText("No exits in this scope.", { exact: true })).toBeVisible();
    await captureViewportThemes(page, testInfo.outputPath(`exit-empty-${viewport.width}.png`));
    const trigger = page.getByRole("button", { name: "Request resignation", exact: true }); await trigger.click();
    await expect(page.getByRole("button", { name: "Close dialog" })).toBeFocused();
    await page.getByRole("button", { name: "Save exit" }).focus(); await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Close dialog" })).toBeFocused();
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused(); await trigger.click();
    await expect(page.getByLabel("Exit type *", { exact: true })).toHaveCount(0);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
    await page.getByLabel("Notice date *").fill(date); await page.getByLabel("Last working date *").fill(date); await page.getByLabel("Reason *", { exact: true }).fill("Synthetic browser resignation");
    await captureViewportThemes(page, testInfo.outputPath(`exit-form-${viewport.width}.png`));
    const response = page.waitForResponse(r => r.url().endsWith("/api/v1/exits") && r.request().method() === "POST"); await page.getByRole("button", { name: "Save exit" }).click(); const saved = await (await response).json();
    await page.getByRole("button", { name: "Submit exit", exact: true }).click(); await page.getByLabel("Reason / comment *").fill("Request reviewed by employee"); await page.getByRole("button", { name: "Confirm decision" }).click(); await expect(page.getByRole("dialog").getByText("Submitted", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete exit", exact: true })).toHaveCount(0);
    await closeDetails(page, "Request resignation"); await signOut(page, viewport.width);
    await signIn(page, hr.email, password); await page.goto("/exits?status=Submitted"); await page.getByRole("row").filter({ hasText: employee.employeeCode }).getByRole("button", { name: "View exit" }).click();
    for (const name of ["Confirm notice period", "Start clearance"]) { await page.getByRole("button", { name, exact: true }).click(); await page.getByLabel("Reason / comment *").fill("Independent HR processing"); await page.getByRole("button", { name: "Confirm decision" }).click(); }
    await expect(page.getByRole("dialog").getByText("Clearance in Progress", { exact: true })).toBeVisible();
    // Assign through real OWNER API; the independent HR browser session stays valid.
    let headers = await login(request, "owner@example.com", "OwnerPass1!");
    let row = await (await request.get(`${api}/api/v1/exits/${saved.id}`)).json();
    for (const key of ["manager", "assets", "it", "finance", "hr", "approval"]) {
      const changed = await request.patch(`${api}/api/v1/exits/${saved.id}/checklist/${key}`, { headers, data: { lock_version: row.lockVersion, assignee_id: key === "approval" ? ownerId : key === "assets" ? hr.id : reviewer.id, note: "Assigned synthetic clearance" } }); expect(changed.ok(), await changed.text()).toBeTruthy(); row = await changed.json();
    }
    await closeDetails(page); await page.getByRole("button", { name: "Refresh", exact: true }).click(); await selectBrandedOption(page.getByLabel("Status", { exact: true }), "Clearance in Progress"); await page.getByRole("row").filter({ hasText: employee.employeeCode }).getByRole("button", { name: "View exit" }).click();
    await page.getByRole("button", { name: "Update Company assets", exact: true }).click(); await page.getByLabel("Reason / comment *").fill("No outstanding synthetic assets"); await page.getByRole("button", { name: "Confirm decision" }).click(); await expect(page.getByRole("dialog").getByText("Cleared", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByRole("dialog", { name: "Exit details", exact: true })).toBeVisible();
    await captureViewportThemes(page, testInfo.outputPath(`exit-clearance-${viewport.width}.png`));
    await captureViewportThemes(page, testInfo.outputPath(`exit-settlement-${viewport.width}.png`), page.getByRole("heading", { name: "Settlement reference", exact: true }));
    headers = await login(request, reviewer.email, password); row = await (await request.get(`${api}/api/v1/exits/${saved.id}`)).json();
    for (const key of ["manager", "it", "finance", "hr"]) { const changed = await request.patch(`${api}/api/v1/exits/${saved.id}/checklist/${key}`, { headers, data: { lock_version: row.lockVersion, status: key === "manager" ? "Not applicable" : "Cleared", note: "Synthetic clearance; no manager assigned" } }); expect(changed.ok(), await changed.text()).toBeTruthy(); row = await changed.json(); }
    headers = await login(request, "owner@example.com", "OwnerPass1!");
    const approved = await request.patch(`${api}/api/v1/exits/${saved.id}/checklist/approval`, { headers, data: { lock_version: row.lockVersion, status: "Cleared", note: "Independent OWNER approval" } }); expect(approved.ok(), await approved.text()).toBeTruthy(); row = await approved.json();
    const ready = await request.post(`${api}/api/v1/exits/${saved.id}/action`, { headers, data: { action: "ready", lock_version: row.lockVersion, comment: "Clearance reviewed" } }); expect(ready.ok(), await ready.text()).toBeTruthy();
    await closeDetails(page); await signOut(page, viewport.width); await signIn(page, "owner@example.com", "OwnerPass1!"); await page.goto("/exits?status=Ready+to+Close"); await page.getByRole("row").filter({ hasText: employee.employeeCode }).getByRole("button", { name: "View exit" }).click();
    await page.getByRole("button", { name: "Complete exit", exact: true }).click(); await expect(page.getByText(/Completion deactivates this employee/)).toBeVisible(); await page.getByLabel("Reason / comment *").fill("Final completion after clearance"); await captureViewportThemes(page, testInfo.outputPath(`exit-completion-confirmation-${viewport.width}.png`)); await page.getByRole("button", { name: "Confirm decision" }).click(); await expect(page.getByRole("dialog").getByText("Completed", { exact: true })).toBeVisible();
    await closeDetails(page); await selectBrandedOption(page.getByLabel("Status", { exact: true }), "Completed"); await expect(page).toHaveURL(/status=Completed/); await expect(page.getByRole("row").filter({ hasText: employee.employeeCode })).toBeVisible(); await page.reload(); await expect(page).toHaveURL(/status=Completed/); await expect(page.getByRole("row").filter({ hasText: employee.employeeCode })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await captureViewportThemes(page, testInfo.outputPath(`exit-completed-${viewport.width}.png`));
  });
}
