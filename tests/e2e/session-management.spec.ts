import { expect, test } from "@playwright/test";

const api = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`confirmed reason-required session termination at ${viewport.width}`, async ({ page, request, playwright }, info) => {
    test.setTimeout(90000);
    if ((await (await request.get(`${api}/api/v1/auth/bootstrap-status`)).json()).available) {
      const bootstrap = await request.post(`${api}/api/v1/auth/bootstrap`, { data: { secret: process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret", full_name: "Platform Owner", employee_code: "EMP-OWNER", email: "owner@example.com", mobile: "+971500000000", joining_date: "2026-01-01", employment_status: "Active", password: "OwnerPass1!", designation_name: "Owner", designation_code: "OWN" } });
      expect(bootstrap.ok()).toBeTruthy();
    }
    const login = await request.post(`${api}/api/v1/auth/login`, { data: { email: "owner@example.com", password: "OwnerPass1!" } });
    expect(login.ok()).toBeTruthy();
    const headers = { "X-CSRF-Token": (await login.json()).csrfToken as string };
    const designation = (await (await request.get(`${api}/api/v1/designations`)).json()).items[0];
    const roles = (await (await request.get(`${api}/api/v1/user-types`)).json()).items as { id: string; code: string }[];
    const tag = `${viewport.width}-${Date.now()}`;
    const created = await request.post(`${api}/api/v1/users`, { headers, data: { full_name: `Session test ${tag}`, employee_code: `ST-${tag}`, email: `session-${tag}@example.com`, mobile: "+971500000099", designation_id: designation.id, employment_status: "Active", joining_date: "2026-01-01" } });
    expect(created.ok(), await created.text()).toBeTruthy();
    const user = await created.json();
    for (const [path, data] of [["assign-type", { user_type_id: roles.find(role => role.code === "SE")!.id }], ["activate", {}]] as const) {
      expect((await request.post(`${api}/api/v1/users/${user.id}/${path}`, { headers, data })).ok()).toBeTruthy();
    }
    const setup = await request.post(`${api}/api/v1/auth/users/${user.id}/setup-link`, { headers });
    expect(setup.ok()).toBeTruthy();
    expect((await request.post(`${api}/api/v1/auth/setup`, { data: { token: (await setup.json()).token, password: "SyntheticSession1!" } })).ok()).toBeTruthy();
    const victim = await playwright.request.newContext();
    try {
      expect((await victim.post(`${api}/api/v1/auth/login`, { data: { email: user.email, password: "SyntheticSession1!" } })).ok()).toBeTruthy();
      await page.setViewportSize(viewport);
      await page.goto("/login"); await page.getByLabel("Email").fill("owner@example.com"); await page.getByLabel("Password").fill("OwnerPass1!"); await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).not.toHaveURL(/\/login$/, { timeout: 30000 });
      await page.goto(`/users/${user.id}?tab=organization`);
      const trigger = page.getByRole("button", { name: "Terminate sessions", exact: true });
      await trigger.click(); await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
      expect((await victim.get(`${api}/api/v1/auth/me`)).status()).toBe(200);
      await trigger.click(); const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Terminate sessions", exact: true }).click();
      const reason = page.getByLabel("Reason", { exact: false }); await expect(reason).toBeFocused();
      await expect(dialog.getByText("Enter a reason for terminating sessions.")).toBeVisible();
      await reason.fill("Reviewed disposable session revocation");
      await page.screenshot({ path: info.outputPath(`session-confirmation-${viewport.width}.png`), fullPage: false });
      const response = page.waitForResponse(result => result.url().endsWith(`/users/${user.id}/terminate-sessions`) && result.request().method() === "POST");
      await dialog.getByRole("button", { name: "Terminate sessions", exact: true }).click();
      expect((await response).status()).toBe(200);
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText("All existing sessions terminated. Account details are unchanged.")).toBeVisible();
      await expect(trigger).toBeFocused();
      expect((await victim.get(`${api}/api/v1/auth/me`)).status()).toBe(401);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    } finally { await victim.dispose(); }
  });
}
