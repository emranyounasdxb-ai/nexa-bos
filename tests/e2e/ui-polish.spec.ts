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

test("dashboard presents a compact executive summary with bounded detail", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);
  await expect(page).toHaveURL(/\/reports(?:\?|$)/);
  const kpiGrid = page.getByTestId("dashboard-kpi-grid");
  await expect(kpiGrid.getByRole("link", { name: "Submitted KPI", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(kpiGrid.getByRole("link", { name: "Approved KPI", exact: true })).toBeVisible();
  await expect(kpiGrid.getByRole("link", { name: "Funded KPI", exact: true })).toBeVisible();
  await expect(kpiGrid.getByRole("link", { name: "Pending KPI", exact: true })).toBeVisible();
  await expect(kpiGrid.getByRole("link")).toHaveCount(4);
  await expect(kpiGrid.getByText(/vs Previous Month/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("dashboard-trend-insufficient")).toBeVisible();
  const dashboardFilters = page.getByTestId("dashboard-filters");
  await expect(dashboardFilters).not.toHaveAttribute("open", "");
  await expect(dashboardFilters.getByLabel("Reporting period", { exact: true })).toBeHidden();

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
    expect(bounds.clientHeight).toBeLessThanOrEqual(256);
    expect(bounds.maxHeight).toBe("256px");
    expect(["auto", "scroll"]).toContain(bounds.overflowY);
  }

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("task16-1-dashboard-desktop.png"),
    fullPage: true,
  });
  await shellHeader.evaluate((element) => {
    element.style.visibility = "hidden";
  });
  await page
    .getByTestId("dashboard-kpi-charts")
    .screenshot({ path: testInfo.outputPath("task16-1-dashboard-kpi-primary-charts.png") });
  await shellHeader.evaluate((element) => {
    element.style.visibility = "";
  });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("complementary", { name: "Application sidebar" })).toHaveCSS("width", "80px");
  await page.screenshot({
    path: testInfo.outputPath("task16-1-dashboard-collapsed-sidebar.png"),
    fullPage: true,
  });
});

test("dashboard charts render contract data responsively and preserve drill-down navigation", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);
  await page.route(`${apiOrigin}/api/v1/reports/dashboard**`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      trend: { month: string; submitted: number; funded: number; fundedValue: string }[];
      stageBreakdown: { stageId: string | null; name: string; count: number }[];
      activeDelays: { Bank: number; Customer: number; Internal: number; Other: number; total: number };
    };
    body.trend = [
      { month: "2026-06-01", submitted: 8, funded: 3, fundedValue: "3000.00" },
      { month: "2026-07-01", submitted: 11, funded: 6, fundedValue: "6000.00" },
      { month: "2026-08-01", submitted: 9, funded: 7, fundedValue: "7000.00" },
    ];
    body.stageBreakdown = [
      { stageId: null, name: "Initial Application Review", count: 12 },
      { stageId: null, name: "Bank Documentation Verification", count: 9 },
      { stageId: null, name: "Customer Requirement Pending", count: 7 },
      { stageId: null, name: "Internal Compliance Review", count: 5 },
      { stageId: null, name: "Final Credit Assessment", count: 4 },
      { stageId: null, name: "Funding Confirmation", count: 3 },
      { stageId: null, name: "Completion", count: 1 },
    ];
    body.activeDelays = { Bank: 4, Customer: 3, Internal: 2, Other: 1, total: 10 };
    await route.fulfill({ response, json: body });
  });

  await page.goto("/reports?period=ytd");
  const trend = page.getByTestId("dashboard-trend-chart");
  const stages = page.getByTestId("stage-distribution-chart");
  const delays = page.getByTestId("dashboard-delay-chart");
  await expect(trend.locator("svg")).toBeVisible({ timeout: 30_000 });
  await expect(stages.locator("svg")).toBeVisible();
  await expect(delays.locator("svg")).toBeVisible();

  await page.getByTestId("stage-breakdown-panel").locator("summary").click();
  await expect(page.getByRole("link", { name: /Initial Application Review/ })).toBeVisible();
  await page.getByRole("link", { name: "Bank delays", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Report drill-down" })).toBeVisible({ timeout: 30_000 });

  await page.goto("/reports?period=ytd");
  const expandedWidth = (await page.getByTestId("dashboard-trend-chart").boundingBox())?.width ?? 0;
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect.poll(async () => (await page.getByTestId("dashboard-trend-chart").boundingBox())?.width ?? 0)
    .toBeGreaterThan(expandedWidth);

  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.getByTestId("dashboard-trend-chart")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("stage-distribution-chart")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
});

test("sidebar groups are folded by default and toggle across desktop and mobile", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);

  const sidebar = page.getByRole("complementary", { name: "Application sidebar" });
  const groups = [
    { label: "Operations", firstItem: "Customers" },
    { label: "People", firstItem: "Users" },
    { label: "Performance", firstItem: "Targets" },
    { label: "Finance", firstItem: "Finance" },
    { label: "Assets", firstItem: "Assets" },
    { label: "Administration", firstItem: "Banks & products" },
  ];

  await expect(sidebar.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(sidebar.getByTestId("sidebar-main-icon")).toHaveCount(7);
  for (const group of groups) {
    await expect(sidebar.getByRole("button", { name: `${group.label} menu` })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(sidebar.getByRole("link", { name: group.firstItem, exact: true })).toBeHidden();
  }

  await page.screenshot({
    path: testInfo.outputPath("task16-sidebar-folded.png"),
  });

  for (const group of groups) {
    const parent = sidebar.getByRole("button", { name: `${group.label} menu` });
    await parent.focus();
    await parent.press("Enter");
    await expect(parent).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar.getByRole("link", { name: group.firstItem, exact: true })).toBeVisible();
    if (group.label === "Operations") {
      await page.screenshot({
        path: testInfo.outputPath("task16-sidebar-expanded.png"),
      });
    }
    await parent.press(" ");
    await expect(parent).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar.getByRole("link", { name: group.firstItem, exact: true })).toBeHidden();
  }

  const peopleMenu = sidebar.getByRole("button", { name: "People menu" });
  await peopleMenu.click();
  await sidebar.getByRole("link", { name: "Users", exact: true }).click();
  await expect(page.getByRole("heading", { name: "User directory" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Users", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(peopleMenu).toHaveClass(/bg-blue-50/);

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveCSS("width", "80px");
  await expect(peopleMenu).toHaveAttribute("aria-expanded", "true");
  await peopleMenu.click();
  await expect(peopleMenu).toHaveAttribute("aria-expanded", "false");
  await peopleMenu.click();
  await expect(sidebar.getByRole("link", { name: "Users", exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "User directory" })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  for (const group of groups) {
    await expect(sidebar.getByRole("button", { name: `${group.label} menu` })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  }
  const mobileOperations = sidebar.getByRole("button", { name: "Operations menu" });
  await mobileOperations.click();
  await expect(sidebar.getByRole("link", { name: "Customers", exact: true })).toBeVisible();
  await mobileOperations.click();
  await expect(sidebar.getByRole("link", { name: "Customers", exact: true })).toBeHidden();
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

  await page.getByRole("button", { name: "People menu" }).click();
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
  const mobilePeopleMenu = page.getByRole("button", { name: "People menu" });
  if ((await mobilePeopleMenu.getAttribute("aria-expanded")) !== "true") {
    await mobilePeopleMenu.click();
  }
  await expect(page.getByRole("link", { name: "Users", exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("task16-users-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close navigation" }).last().click();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
});
