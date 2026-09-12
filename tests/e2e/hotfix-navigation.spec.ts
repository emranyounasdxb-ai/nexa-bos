import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { captureViewportThemes } from "./helpers/viewport-capture";

const api = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;

async function owner(request: APIRequestContext) {
  const status = await request.get(`${api}/api/v1/auth/bootstrap-status`);
  expect(status.ok()).toBeTruthy();
  if (((await status.json()) as { available: boolean }).available) {
    const created = await request.post(`${api}/api/v1/auth/bootstrap`, { data: {
      secret: process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret",
      full_name: "Platform Owner", employee_code: "EMP-OWNER", email: "owner@example.com",
      mobile: "+971500000000", joining_date: "2026-01-01", employment_status: "Active",
      password: "OwnerPass1!", designation_name: "Owner", designation_code: "OWN",
    } });
    expect(created.ok(), await created.text()).toBeTruthy();
  }
  const login = await request.post(`${api}/api/v1/auth/login`, { data: { email: "owner@example.com", password: "OwnerPass1!" } });
  expect(login.ok(), await login.text()).toBeTruthy();
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function createUser(request: APIRequestContext, headers: Record<string, string>, name: string) {
  const options = await request.get(`${api}/api/v1/designations`);
  expect(options.ok()).toBeTruthy();
  const designation = ((await options.json()) as { items: { id: string }[] }).items[0];
  expect(designation).toBeTruthy();
  const id = randomUUID();
  const response = await request.post(`${api}/api/v1/users`, { headers, data: {
    full_name: name, employee_code: `HF-${id}`, email: `hotfix-${id}@example.com`,
    mobile: "+971500000001", designation_id: designation.id,
    employment_status: "Active", joining_date: "2026-02-01",
  } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as { id: string; email: string; userCode: string; fullName: string };
}

async function signIn(page: Page, email = "owner@example.com", password = "OwnerPass1!") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
}

test("Application dialog retains Bank focus when the background list finishes loading", async ({ page, request }) => {
  await owner(request);
  await signIn(page);
  let release!: () => void;
  let arrived!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const fetched = new Promise<void>(resolve => { arrived = resolve; });
  await page.route(`${api}/api/v1/applications?*`, async route => {
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    arrived();
    await held;
    await route.fulfill({ response }); // Unmodified real response, only its timing is controlled.
  });
  try {
    await page.goto("/applications");
    await fetched;
    await expect(page.getByText("Loading applications…", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Create application", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create application", exact: true });
    const bank = dialog.getByRole("combobox", { name: "Bank", exact: true });
    await expect(bank).toBeEnabled();
    await bank.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    release();
    await expect(page.getByText("Loading applications…", { exact: true })).toBeHidden();
    await expect(listbox).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).not.toBeFocused();
    await page.keyboard.press("Escape");
    await expect(bank).toBeFocused();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Create application", exact: true })).toBeFocused();
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

for (const permissions of [[], ["Finance.View"], ["Finance.ViewCommissionRules"], ["Finance.View", "Finance.ViewCommissionRules"]]) {
  test(`Finance shortcut honors either permission: ${permissions.join(" + ") || "neither"}`, async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    const headers = await owner(request);
    const id = randomUUID().slice(0, 8);
    const createdType = await request.post(`${api}/api/v1/user-types`, { headers, data: { name: `Hotfix Finance ${id}`, code: `HF${id}` } });
    expect(createdType.ok(), await createdType.text()).toBeTruthy();
    const type = await createdType.json() as { id: string };
    for (const [path, data] of [
      ["permissions", { permissions: ["Dashboard.View", ...permissions] }],
      ["reporting-scope", { reporting_visibility_scope: "own" }],
    ] as const) {
      const updated = await request.put(`${api}/api/v1/user-types/${type.id}/${path}`, { headers, data });
      expect(updated.ok(), await updated.text()).toBeTruthy();
    }
    expect((await request.post(`${api}/api/v1/user-types/${type.id}/activate`, { headers })).ok()).toBeTruthy();
    const user = await createUser(request, headers, `Hotfix Finance ${id}`);
    expect((await request.post(`${api}/api/v1/users/${user.id}/assign-type`, { headers, data: { user_type_id: type.id } })).ok()).toBeTruthy();
    expect((await request.post(`${api}/api/v1/users/${user.id}/activate`, { headers })).ok()).toBeTruthy();
    const setup = await request.post(`${api}/api/v1/auth/users/${user.id}/setup-link`, { headers });
    expect(setup.ok()).toBeTruthy();
    const { token } = await setup.json() as { token: string };
    expect((await request.post(`${api}/api/v1/auth/setup`, { data: { token, password: "UserPass1!" } })).ok()).toBeTruthy();
    await signIn(page, user.email, "UserPass1!");

    // Check real direct-route/API authorization before the shortcut assertion.
    await page.goto("/finance");
    if (permissions.length) {
      await expect(page.getByRole("tab", { name: permissions.includes("Finance.View") ? "Payouts" : "Commission Rules", exact: true })).toBeVisible();
    } else {
      await expect(page.getByText("You do not have permission to access Finance.")).toBeVisible();
    }
    const rules = await page.request.get(`${api}/api/v1/finance/commission-rules`);
    expect(rules.status()).toBe(permissions.includes("Finance.ViewCommissionRules") ? 200 : 403);
    const periods = await page.request.get(`${api}/api/v1/finance/periods`);
    expect(periods.status()).toBe(permissions.includes("Finance.View") ? 200 : 403);
    await expect(page.getByRole("button", { name: "Create commission rule", exact: true })).toHaveCount(0);
    await page.goto("/reports");
    await expect(page.getByTestId("dashboard-loading-skeleton")).toBeHidden();
    const shortcut = page.getByTestId("role-workspace").getByRole("link", { name: "Finance", exact: true });
    if (permissions.length) {
      await page.getByTestId("role-workspace").getByText("Work areas", { exact: true }).click();
    }
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      if (permissions.length) {
        await expect(shortcut).toBeVisible();
        await expect(shortcut).toHaveAttribute("href", "/finance");
        await shortcut.focus();
        await expect(shortcut).toBeFocused();
      } else await expect(shortcut).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
      await captureViewportThemes(page, testInfo.outputPath(`finance-${viewport.width}.png`));
    }
    if (permissions.length) {
      await shortcut.press("Enter");
      await expect(page).toHaveURL(/\/finance$/);
      await expect(page.getByRole("tab", { name: permissions.includes("Finance.View") ? "Payouts" : "Commission Rules", exact: true })).toBeVisible();
    }
  });
}

for (const action of ["Next", "Page 2"]) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`Pending Users search resets ${action} to page 1 at ${viewport.width}`, async ({ page, request }, testInfo) => {
      test.setTimeout(180_000);
      const headers = await owner(request);
      const group = `HotfixDirectory${randomUUID().slice(0, 8)}`;
      const target = await createUser(request, headers, `${group} UniqueMatch`);
      for (let index = 0; index < 25; index += 1) await createUser(request, headers, `${group} Other ${index}`);
      await page.setViewportSize(viewport);
      // Install before the app creates timers; pause only after real data renders.
      await page.clock.install();
      await signIn(page);
      await page.goto(`/users?q=${group}&pageSize=25`);
      const pagination = page.getByRole("navigation", { name: "List pagination" });
      await expect(pagination).toContainText("Showing 1–25 of 26");
      const button = pagination.getByRole("button", { name: action, exact: true });
      await expect(button).toBeEnabled();
      await page.clock.pauseAt(new Date(Date.now() + 60_000));
      const requests: string[] = [];
      page.on("request", response => {
        const url = new URL(response.url());
        if (url.pathname === "/api/v1/users" && url.searchParams.get("q") === target.fullName) requests.push(response.url());
      });
      await page.getByLabel("Search users").fill(target.fullName);
      expect(new URL(page.url()).searchParams.get("q")).toBe(group);
      expect(requests).toHaveLength(0); // The debounce is still pending at the click.
      await button.click();
      await page.clock.runFor(301); // Cross the real debounce boundary without sleeping.
      await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(target.fullName);
      await expect.poll(() => new URL(page.url()).searchParams.get("page") ?? "1").toBe("1");
      expect(new URL(page.url()).searchParams.get("pageSize")).toBe("25");
      await expect(page.getByRole("link", { name: target.userCode, exact: true })).toBeVisible();
      await expect(pagination).toContainText("Showing 1–1 of 1");
      await expect(page.getByLabel("Rows per page")).toHaveAttribute("value", "25");
      await expect(page.getByText(new RegExp(`${group} Other`))).toHaveCount(0);
      expect(requests.length).toBeGreaterThan(0);
      for (const value of requests) {
        const params = new URL(value).searchParams;
        expect(params.get("page")).toBe("1");
        expect(params.get("page_size")).toBe("25");
      }
      await page.clock.runFor(300);
      expect(new URL(page.url()).searchParams.get("page") ?? "1").toBe("1");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
      await page.screenshot({ path: testInfo.outputPath(`users-${viewport.width}.png`), fullPage: false });
      await page.clock.resume();
      await page.reload();
      await expect(pagination).toContainText("Showing 1–1 of 1");
      await expect(page.getByLabel("Search users")).toHaveValue(target.fullName);
    });
  }
}
