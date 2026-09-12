import { expect, test, type Page } from "@playwright/test";
import { captureViewportThemes } from "./helpers/viewport-capture";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
}

for (const width of [1440, 390]) {
  test(`OWNER four-field route-backed creation and profile access at ${width}`, async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
    if ((await status.json()).available) {
      const bootstrap = await request.post(`${apiOrigin}/api/v1/auth/bootstrap`, { data: {
        secret: process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret",
        full_name: "Platform Owner", employee_code: "EMP-OWNER", email: "owner@example.com",
        mobile: "+971500000000", joining_date: "2026-01-01", employment_status: "Active",
        password: "OwnerPass1!", designation_name: "Owner", designation_code: "OWN",
      } });
      expect(bootstrap.ok(), await bootstrap.text()).toBeTruthy();
    }
    await page.goto("/login");
    await page.getByLabel("Email").fill("owner@example.com");
    await page.getByLabel("Password").fill("OwnerPass1!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
    await page.goto("/users");
    const trigger = page.getByRole("link", { name: "Create user", exact: true });
    const dialog = page.getByRole("dialog", { name: "Create User" });
    const name = page.getByLabel(/^Full Name/);
    const submit = page.getByRole("button", { name: "Create User", exact: true });
    await trigger.click();
    await expect(page).toHaveURL(/\/users\/new$/);
    await expect(dialog).toBeVisible();
    await expect(name).toBeFocused();
    await expect(page.getByLabel("User Code", { exact: true })).toHaveValue(/^USR-\d+$/);
    await expect(page.getByLabel("User Code", { exact: true })).toHaveAttribute("readonly", "");
    await page.goBack();
    await expect(page).toHaveURL(/\/users$/);
    await expect(dialog).toHaveCount(0);
    await page.goForward();
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Close Create User" }).click();
    await expect(page).toHaveURL(/\/users$/);
    await expect(trigger).toBeFocused();
    for (const close of ["escape", "backdrop", "cancel"]) {
      await trigger.click();
      await expect(dialog).toBeVisible();
      if (close === "escape") await page.keyboard.press("Escape");
      if (close === "backdrop") await page.getByTestId("create-user-modal-backdrop").click({ position: { x: 4, y: 4 } });
      if (close === "cancel") await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page).toHaveURL(/\/users$/);
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    await page.goto("/users/new");
    await expect(dialog).toBeVisible();
    await page.reload();
    await expect(dialog).toBeVisible();
    await expect(submit).toBeEnabled();
    await expect(dialog.locator("input")).toHaveCount(4);
    await expect(dialog.getByRole("combobox")).toHaveCount(0);
    for (const excluded of ["First Name", "Last Name", "Employee Code", "Work Email", "Office", "User Type"]) {
      await expect(dialog.getByLabel(excluded, { exact: true })).toHaveCount(0);
    }
    await name.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Close Create User" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(submit).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close Create User" })).toBeFocused();
    await submit.click();
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute("aria-describedby", "full-name-error");
    await expect(page.getByText("Enter a full name.")).toBeVisible();
    await expect(page.getByText("Enter a valid personal email address.")).toBeVisible();
    await expect(dialog).toBeVisible();
    const email = page.getByLabel(/^Personal Email/);
    const tag = `${width}-${Date.now()}`;
    await name.fill(`Basic Employee ${tag}`);
    await email.fill(`basic-${tag}@example.test`);
    await page.getByLabel(/^Personal Mobile/).fill("+971500004444");
    const nameBox = await name.boundingBox();
    const emailBox = await email.boundingBox();
    expect(nameBox?.height).toBe(32);
    expect(emailBox?.height).toBe(32);
    if (width === 1440) {
      expect(Math.abs(nameBox!.y - emailBox!.y)).toBeLessThan(2);
      expect(emailBox!.x).toBeGreaterThan(nameBox!.x);
    } else {
      expect(Math.abs(nameBox!.x - emailBox!.x)).toBeLessThan(2);
      expect(emailBox!.y).toBeGreaterThan(nameBox!.y + nameBox!.height);
    }
    await noOverflow(page);
    await expect(submit).toBeInViewport();
    await expect(page.getByRole("button", { name: "Close Create User" })).toBeInViewport();
    await captureViewportThemes(page, testInfo.outputPath(`create-user-${width}.png`));
    const creation = page.waitForResponse(response => response.url().endsWith("/api/v1/users") && response.request().method() === "POST");
    await submit.click();
    const response = await creation;
    expect(response.status()).toBe(200);
    const user = await response.json();
    expect(user.accountStatus).toBe("pending");
    expect(user.userType).toBeNull();
    expect(user.employeeCode).toBeNull();
    await expect(page).toHaveURL(/\/users\/[0-9a-f-]+\?tab=overview$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: `Basic Employee ${tag}`, exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "HR Profile" }).click();
    await expect(page.getByRole("heading", { name: "HR profile" })).toBeVisible();
    await page.getByRole("tab", { name: "PRO & Documents" }).click();
    await expect(page.getByRole("heading", { name: "PRO compliance records" })).toBeVisible();
    await noOverflow(page);
  });
}

test("unauthenticated users cannot use the Create User route or API", async ({ page, request }) => {
  await page.goto("/users/new");
  await expect(page).toHaveURL(/\/login$/);
  expect((await request.post(`${apiOrigin}/api/v1/users`, { data: {} })).status()).toBe(401);
  expect((await request.post(`${apiOrigin}/api/v1/users/code-reservations`)).status()).toBe(401);
});
