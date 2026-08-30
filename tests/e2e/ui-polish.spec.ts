import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

async function ensureOwner(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  const body = (await status.json()) as { available: boolean };
  if (!body.available) {
    return;
  }
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

async function signIn(page: Page, request: APIRequestContext) {
  await ensureOwner(request);
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 30_000,
  });
}

test("dashboard correction keeps content readable, bounded, and route-consistent", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);
  await expect(page).toHaveURL(/\/reports(?:\?|$)/);
  await expect(page.getByRole("link", { name: "Submitted KPI" })).toBeVisible({ timeout: 30_000 });

  const shellHeader = page.locator("header").first();
  await expect(shellHeader.getByText("Workspace", { exact: true })).toBeVisible();
  await expect(shellHeader.getByText("Dashboard", { exact: true })).toBeVisible();

  const actionButtons = await page.getByTestId("dashboard-actions").getByRole("button").all();
  expect(actionButtons).toHaveLength(5);
  for (const button of actionButtons) {
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
  }

  await expect(page.getByTestId("stage-breakdown-panel")).toBeVisible();
  const stageScroll = page.getByTestId("stage-breakdown-scroll");
  if ((await stageScroll.count()) > 0) {
    const bounds = await stageScroll.evaluate((element) => ({
      clientHeight: element.clientHeight,
      maxHeight: window.getComputedStyle(element).maxHeight,
      overflowY: window.getComputedStyle(element).overflowY,
    }));
    expect(bounds.clientHeight).toBeLessThanOrEqual(288);
    expect(bounds.maxHeight).toBe("288px");
    expect(["auto", "scroll"]).toContain(bounds.overflowY);
  }

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("task16-dashboard-desktop.png"),
    fullPage: true,
  });
});

test("shared shell supports dashboard landing, collapse, user menu, and mobile navigation", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);

  const sidebar = page.getByRole("complementary", { name: "Application sidebar" });
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByLabel(/Notifications, \d+ unread/)).toBeVisible();

  const expandedWidth = await sidebar.evaluate((element) => element.getBoundingClientRect().width);
  expect(expandedWidth).toBeGreaterThanOrEqual(280);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveCSS("width", "80px");
  const collapsedWidth = await sidebar.evaluate((element) => element.getBoundingClientRect().width);
  expect(collapsedWidth).toBeLessThanOrEqual(82);

  await page.getByLabel("Open user menu").click();
  await expect(page.getByRole("link", { name: "My profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.getByLabel("Open user menu").click();

  await page.getByRole("link", { name: "Users", exact: true }).click();
  await expect(page.getByRole("heading", { name: "User directory" })).toBeVisible();
  await expect(page.getByLabel("Search users")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Users", exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("task16-users-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close navigation" }).last().click();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
});
