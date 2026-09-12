import { captureViewportThemes } from "./helpers/viewport-capture";
import { expect, test } from "@playwright/test";
import { selectBrandedOption } from "./helpers/select";

const api = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`approval centre independent decisions and own summary at ${viewport.width}`, async ({ page, request }, info) => {
    test.setTimeout(120000);
    const password = "SyntheticApproval1!";
    if ((await (await request.get(`${api}/api/v1/auth/bootstrap-status`)).json()).available) {
      const response = await request.post(`${api}/api/v1/auth/bootstrap`, { data: { secret: process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret", full_name: "Platform Owner", employee_code: "EMP-OWNER", email: "owner@example.com", mobile: "+971500000000", joining_date: "2026-01-01", employment_status: "Active", password: "OwnerPass1!", designation_name: "Owner", designation_code: "OWN" } });
      expect(response.ok(), await response.text()).toBeTruthy();
    }
    const login = await request.post(`${api}/api/v1/auth/login`, { data: { email: "owner@example.com", password: "OwnerPass1!" } }); expect(login.ok()).toBeTruthy();
    const headers = { "X-CSRF-Token": (await login.json()).csrfToken as string };
    const designation = (await (await request.get(`${api}/api/v1/designations`)).json()).items[0];
    const roles = (await (await request.get(`${api}/api/v1/user-types`)).json()).items as { id: string; code: string }[];
    const tag = crypto.randomUUID().slice(0, 8);
    const created = await request.post(`${api}/api/v1/users`, { headers, data: { full_name: `Approval ${tag}`, employee_code: `AP${tag}`, email: `approval-${tag}@example.com`, mobile: "+971500000090", designation_id: designation.id, employment_status: "Active", joining_date: "2026-01-01" } }); expect(created.ok(), await created.text()).toBeTruthy(); const employee = await created.json();
    for (const [path, data] of [["assign-type", { user_type_id: roles.find(row => row.code === "SE")!.id }], ["activate", {}]] as const) { const response = await request.post(`${api}/api/v1/users/${employee.id}/${path}`, { headers, data }); expect(response.ok(), await response.text()).toBeTruthy(); }
    const link = await request.post(`${api}/api/v1/auth/users/${employee.id}/setup-link`, { headers }); expect(link.ok()).toBeTruthy();
    const setup = await request.post(`${api}/api/v1/auth/setup`, { data: { token: (await link.json()).token, password } }); expect(setup.ok()).toBeTruthy();
    const actorLogin = await request.post(`${api}/api/v1/auth/login`, { data: { email: employee.email, password } }); expect(actorLogin.ok()).toBeTruthy(); const actorHeaders = { "X-CSRF-Token": (await actorLogin.json()).csrfToken as string };
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
    const draft = await request.post(`${api}/api/v1/exits`, { headers: actorHeaders, data: { employee_id: employee.id, exit_type: "Resignation", notice_date: date, last_working_date: date, reason: "Synthetic approval browser request" } }); expect(draft.ok(), await draft.text()).toBeTruthy(); const exit = await draft.json();
    const submitted = await request.post(`${api}/api/v1/exits/${exit.id}/action`, { headers: actorHeaders, data: { action: "submit", lock_version: exit.lockVersion, comment: "Synthetic submission" } }); expect(submitted.ok()).toBeTruthy();
    await page.setViewportSize(viewport); await page.goto("/login"); await page.getByLabel("Email").fill("owner@example.com"); await page.getByLabel("Password").fill("OwnerPass1!"); await page.getByRole("button", { name: "Sign in" }).click(); await expect(page).not.toHaveURL(/\/login$/, { timeout: 30000 });
    await page.goto(`/approvals?employee=${employee.id}&module=Exit`); const row = page.getByRole("row").filter({ hasText: employee.fullName }); await expect(row).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await captureViewportThemes(page, info.outputPath(`approval-queue-${viewport.width}.png`));
    await captureViewportThemes(page, info.outputPath(`approval-queue-record-${viewport.width}.png`), row);
    const trigger = row.getByRole("button", { name: "Return for correction" }); await trigger.click(); const comment = page.getByLabel("Reason / comment *"); await expect(comment).toBeFocused();
    await page.getByRole("button", { name: "Confirm decision" }).focus(); await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Close dialog" })).toBeFocused(); await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
    await trigger.click(); await page.getByRole("button", { name: "Confirm decision" }).click(); await expect(comment).toBeFocused(); await expect(page.getByRole("dialog")).toBeVisible();
    await comment.fill("Please correct the synthetic request"); await captureViewportThemes(page, info.outputPath(`approval-decision-${viewport.width}.png`)); await page.getByRole("button", { name: "Confirm decision" }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.getByText("Decision recorded in the workflow history.")).toBeVisible(); await expect(page.getByRole("button", { name: "Refresh queue" })).toBeFocused();
    // Existing exit return-for-correction transitions back to editable Draft.
    await selectBrandedOption(page.getByLabel("Status", { exact: true }), "Draft"); await expect(page).toHaveURL(/status=Draft/); await expect(row).toBeVisible(); await page.reload(); await expect(row).toBeVisible(); await expect(page).toHaveURL(/status=Draft/);
    await selectBrandedOption(page.getByLabel("Module", { exact: true }), "Contracts"); await expect(page.getByText("No requests match these filters.")).toBeVisible(); await captureViewportThemes(page, info.outputPath(`approval-empty-${viewport.width}.png`), page.getByText("No requests match these filters.", { exact: true })); await page.goBack(); await expect(row).toBeVisible();
    await selectBrandedOption(page.getByLabel("Status", { exact: true }), ""); await expect(page).toHaveURL(/status=/); await selectBrandedOption(page.getByLabel("Module", { exact: true }), "Contracts"); await expect(page.getByLabel("Status", { exact: true })).toHaveText("All statuses"); await page.reload(); await expect(page.getByLabel("Status", { exact: true })).toHaveText("All statuses");
    if (viewport.width < 1024) await expect(page.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "false"); await page.getByRole("button", { name: "Open user menu" }).focus(); await expect(page.getByRole("button", { name: "Open user menu" })).toBeFocused(); await page.keyboard.press("Enter"); await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible(); await page.getByRole("menuitem", { name: "Sign out" }).click(); await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Email").fill(employee.email); await page.getByLabel("Password").fill(password); await page.getByRole("button", { name: "Sign in" }).click(); await expect(page).not.toHaveURL(/\/login$/, { timeout: 30000 }); await page.goto("/approvals"); await expect(page.getByText("You do not have permission to view the Approval Centre.")).toBeVisible();
    await page.goto("/account"); await expect(page.getByRole("heading", { name: "My HR requests & contract" })).toBeVisible(); await page.getByText("My exits (1)", { exact: true }).click(); await expect(page.getByText("Draft", { exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1); await captureViewportThemes(page, info.outputPath(`approval-own-${viewport.width}.png`), page.getByRole("heading", { name: "My HR requests & contract", exact: true }));
  });
}
