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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
  for (const label of ["Submitted KPI", "Approved KPI", "Funded KPI", "Pending KPI"]) {
    await expect(kpiGrid.getByRole("link", { name: label, exact: true }).locator("svg").first()).toBeVisible();
  }
  await expect(kpiGrid.getByText(/vs Previous Month/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("dashboard-trend-insufficient")).toBeVisible();
  await expect(page.getByText("Executive overview", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("dashboard-analysis-grid")).toBeVisible();
  const dashboardFilters = page.getByTestId("dashboard-filters");
  await expect(dashboardFilters.getByTestId("dashboard-refine-panel")).toHaveCount(0);
  await expect(dashboardFilters.getByLabel("Reporting period", { exact: true })).toBeHidden();

  const shellHeader = page.locator("header").first();
  const breadcrumb = shellHeader.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb.getByText("Workspace", { exact: true })).toBeVisible();
  await expect(breadcrumb.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(breadcrumb).toHaveCSS("flex-wrap", "nowrap");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toHaveCount(1);
  const shellBackgrounds = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>('[aria-label="Application sidebar"]');
    const header = document.querySelector<HTMLElement>("header");
    return {
      body: window.getComputedStyle(document.body).backgroundColor,
      sidebar: sidebar ? window.getComputedStyle(sidebar).backgroundColor : null,
      header: header ? window.getComputedStyle(header).backgroundColor : null,
      sidebarDivider: sidebar ? window.getComputedStyle(sidebar).borderRightWidth : null,
      headerDivider: header ? window.getComputedStyle(header).borderBottomWidth : null,
    };
  });
  expect(shellBackgrounds.sidebar).toBe(shellBackgrounds.body);
  expect(shellBackgrounds.header).toBe(shellBackgrounds.body);
  expect(shellBackgrounds.sidebarDivider).toBe("0px");
  expect(shellBackgrounds.headerDivider).toBe("0px");

  const actionButtons = await page.getByTestId("dashboard-actions").getByRole("button").all();
  expect(actionButtons).toHaveLength(3);
  for (const button of actionButtons) {
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(32);
    expect(box?.height ?? 100).toBeLessThanOrEqual(36);
  }
  await expect(page.getByTestId("dashboard-actions").getByRole("button")).toHaveText([
    "Refresh",
    "Compare",
    "Refine",
  ]);
  const actionYPositions = await Promise.all(actionButtons.map(async (button) => (await button.boundingBox())?.y));
  expect(Math.max(...actionYPositions.map((value) => value ?? 0)) - Math.min(...actionYPositions.map((value) => value ?? 0))).toBeLessThan(2);
  expect(await page.getByTestId("dashboard-actions").evaluate((element) => element.closest('[data-testid="dashboard-filters"]') !== null)).toBeTruthy();
  await expect(page.getByLabel(/Notifications, \d+ unread/).locator("svg")).toBeVisible();
  await expect(page.getByLabel("Open user menu").locator("svg")).toBeVisible();

  await expect(page.getByTestId("stage-breakdown-panel")).toBeVisible();
  const stageScroll = page.getByTestId("stage-breakdown-scroll");
  if ((await stageScroll.count()) > 0) {
    const bounds = await stageScroll.evaluate((element) => ({
      clientHeight: element.clientHeight,
      maxHeight: window.getComputedStyle(element).maxHeight,
      overflowY: window.getComputedStyle(element).overflowY,
    }));
    expect(bounds.clientHeight).toBeLessThanOrEqual(192);
    expect(bounds.maxHeight).toBe("192px");
    expect(["auto", "scroll"]).toContain(bounds.overflowY);
  }

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("task16-2-tabler-dashboard-desktop.png"),
    fullPage: true,
  });
  await shellHeader.evaluate((element) => {
    element.style.visibility = "hidden";
  });
  await page
    .getByTestId("dashboard-kpi-charts")
    .screenshot({ path: testInfo.outputPath("task16-2-tabler-kpi-cards.png") });
  await shellHeader.evaluate((element) => {
    element.style.visibility = "";
  });
  await page.mouse.move(1200, 300);
  await expect(page.getByRole("complementary", { name: "Application sidebar" })).toHaveCSS("width", "80px");
  await page.screenshot({
    path: testInfo.outputPath("task16-2-tabler-sidebar-collapsed.png"),
    fullPage: true,
  });
});

test("list search and page actions share compact desktop rows", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);

  for (const item of [
    { path: "/customers", heading: "Customers", search: "Search customers", action: "Create customer" },
    { path: "/users", heading: "User directory", search: "Search users", action: "Create user" },
    { path: "/applications", heading: "Applications", search: "Search applications", action: "Create application" },
  ]) {
    await page.goto(item.path);
    await expect(page.getByRole("heading", { name: item.heading, exact: true })).toBeVisible();
    const bar = page.getByTestId("search-action-bar");
    const search = bar.getByLabel(item.search, { exact: true });
    const action = bar.getByRole("link", { name: item.action, exact: true });
    await expect(search).toBeVisible();
    await expect(action).toBeVisible();
    const searchBox = await search.boundingBox();
    const actionBox = await action.boundingBox();
    expect(searchBox && actionBox).toBeTruthy();
    expect(searchBox!.x).toBeLessThan(actionBox!.x);
    expect(searchBox!.width).toBeGreaterThan(actionBox!.width);
    expect(searchBox!.height).toBe(32);
    expect(Math.abs(searchBox!.y + searchBox!.height - actionBox!.y - actionBox!.height)).toBeLessThan(2);
    expect(actionBox!.height).toBe(32);
    await search.fill("layout verification");
    await expect(search).toHaveValue("layout verification");
    await search.fill("");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  }

  await page.goto("/assets");
  await expect(page.getByRole("heading", { name: "Asset Register", exact: true })).toBeVisible();
  const assetSearch = page.getByLabel("Search Assets", { exact: true });
  const assetAction = page.getByRole("button", { name: "Apply filters", exact: true });
  const assetSearchBox = await assetSearch.boundingBox();
  const assetActionBox = await assetAction.boundingBox();
  expect(assetSearchBox && assetActionBox).toBeTruthy();
  expect(assetSearchBox!.x).toBeLessThan(assetActionBox!.x);
  expect(assetSearchBox!.width).toBeGreaterThan(assetActionBox!.width);
  expect(assetSearchBox!.height).toBe(32);
  expect(Math.abs(assetSearchBox!.y + assetSearchBox!.height - assetActionBox!.y - assetActionBox!.height)).toBeLessThan(2);
  expect(assetActionBox!.height).toBe(32);
  await assetSearch.fill("AST-");
  await expect(assetSearch).toHaveValue("AST-");

  await page.goto("/finance");
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();
  for (const label of ["Refresh", "Excel", "PDF", "Print"]) {
    const button = page.getByRole("button", { name: label, exact: true }).first();
    await expect(button).toBeVisible();
    expect((await button.boundingBox())?.height).toBe(32);
  }

  await page.goto("/users/new");
  await expect(page.getByRole("heading", { name: "Create user", exact: true })).toBeVisible();
  for (const control of [
    page.getByLabel("Full name", { exact: true }),
    page.locator("label").filter({ hasText: "Designation" }).locator("select"),
    page.getByLabel("Joining date", { exact: true }),
    page.getByRole("button", { name: "Open calendar", exact: true }),
  ]) {
    await expect(control).toBeVisible();
    expect((await control.boundingBox())?.height).toBe(32);
  }

  for (const path of ["/customers", "/users", "/applications", "/assets", "/finance"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  }
});

test("holiday reminders are absent and dashboard action panels remain accessible", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);
  await expect(page.getByRole("complementary", { name: "Holiday reminders" })).toHaveCount(0);
  await expect(page.getByLabel(/Notifications, \d+ unread/)).toBeVisible();

  const actions = page.getByTestId("dashboard-actions");
  await expect(actions.getByRole("button")).toHaveText(["Refresh", "Compare", "Refine"]);
  const refineButton = actions.getByRole("button", { name: "Refine", exact: true });
  const compareButton = actions.getByRole("button", { name: "Compare", exact: true });
  const refinePanel = page.getByTestId("dashboard-refine-panel");
  const comparePanel = page.getByTestId("dashboard-compare-panel");
  await expect(actions.getByRole("button", { name: "Export dashboard" })).toHaveCount(0);
  await expect(page.getByTestId("dashboard-export-panel")).toHaveCount(0);

  await refineButton.click();
  await expect(refinePanel).toBeVisible();
  await expect(comparePanel).toHaveCount(0);
  await compareButton.click();
  await expect(refinePanel).toHaveCount(0);
  await expect(comparePanel).toBeVisible();
  await expect(page).toHaveURL(/\/reports(?:\?|$)/);
  await comparePanel.getByRole("button", { name: "Run comparison", exact: true }).click();
  await expect(page.getByTestId("dashboard-comparison-result")).toBeVisible();
  await compareButton.click();
  await expect(comparePanel).toHaveCount(0);
  await refineButton.click();
  await expect(refinePanel).toBeVisible();
  await refineButton.click();
  await expect(refinePanel).toHaveCount(0);

  for (const [path, title] of [
    ["/applications", "Applications"],
    ["/users", "User directory"],
    ["/organization", "Organization masters"],
    ["/finance", "Finance"],
    ["/assets", "Asset Register"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Holiday reminders" })).toHaveCount(0);
  }

  await page.goto("/reports");
  await expect(page.getByRole("complementary", { name: "Holiday reminders" })).toHaveCount(0);
  await actions.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(actions.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();

  for (const viewport of [
    { width: 900, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(actions.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Compare", exact: true })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Refine", exact: true })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Export dashboard" })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBeTruthy();
  }
});

test("dashboard loads primary data independently and preserves it during refreshes", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page, request);
  await expect(page.getByTestId("dashboard-kpi-grid")).toBeVisible({ timeout: 30_000 });

  const [filtersResponse, dashboardResponse, comparisonResponse] = await Promise.all([
    page.request.get(`${apiOrigin}/api/v1/reports/filters`),
    page.request.get(`${apiOrigin}/api/v1/reports/dashboard?period=mtd&ranking_metric=funded_value`),
    page.request.get(`${apiOrigin}/api/v1/reports/comparisons?kind=period&period=month&metric=funded_value`),
  ]);
  expect(filtersResponse.ok()).toBeTruthy();
  expect(dashboardResponse.ok()).toBeTruthy();
  expect(comparisonResponse.ok()).toBeTruthy();
  const filtersPayload = await filtersResponse.json();
  const dashboardPayload = await dashboardResponse.json();
  const comparisonPayload = await comparisonResponse.json();

  type LoadMode = "initial" | "refresh" | "filter" | "failure";
  let mode: LoadMode = "initial";
  const initialComparison = deferred();
  let dashboardGate = deferred();
  dashboardGate.resolve();
  const starts: { endpoint: string; at: number; mode: LoadMode }[] = [];

  await page.route(`${apiOrigin}/api/v1/reports/filters`, async (route) => {
    starts.push({ endpoint: "filters", at: Date.now(), mode });
    await route.fulfill({ json: filtersPayload });
  });
  await page.route(`${apiOrigin}/api/v1/reports/dashboard**`, async (route) => {
    starts.push({ endpoint: "dashboard", at: Date.now(), mode });
    if (mode === "initial") {
      await new Promise((resolve) => setTimeout(resolve, 250));
    } else {
      await dashboardGate.promise;
    }
    if (mode === "failure") {
      await route.fulfill({
        status: 503,
        json: { error: { code: "TEMPORARY_FAILURE", message: "Temporary dashboard failure" } },
      });
      return;
    }
    await route.fulfill({ json: dashboardPayload });
  });
  await page.route(`${apiOrigin}/api/v1/reports/comparisons**`, async (route) => {
    starts.push({ endpoint: "comparison", at: Date.now(), mode });
    if (mode === "initial") await initialComparison.promise;
    await route.fulfill({ json: comparisonPayload });
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("dashboard-loading-skeleton")).toBeVisible();
  await expect.poll(() => starts.filter((entry) => entry.mode === "initial").length).toBe(3);
  const initialStarts = starts.filter((entry) => entry.mode === "initial");
  expect(Math.max(...initialStarts.map((entry) => entry.at)) - Math.min(...initialStarts.map((entry) => entry.at)))
    .toBeLessThan(150);
  await expect(page.getByTestId("dashboard-kpi-grid")).toBeVisible();
  await expect(page.getByTestId("dashboard-loading-skeleton")).toHaveCount(0);
  await expect(page.getByText("Loading dashboard metrics…", { exact: true })).toBeHidden();
  expect(starts.filter((entry) => entry.mode === "initial" && entry.endpoint === "dashboard")).toHaveLength(1);
  initialComparison.resolve();
  await expect(page.getByText(/vs Previous Month/).first()).toBeVisible();

  mode = "refresh";
  dashboardGate = deferred();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refreshing…", exact: true })).toBeVisible();
  await expect(page.getByTestId("dashboard-kpi-grid")).toBeVisible();
  await expect(page.getByTestId("dashboard-loading-skeleton")).toHaveCount(0);
  dashboardGate.resolve();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();

  mode = "filter";
  dashboardGate = deferred();
  await page.getByTestId("dashboard-actions").getByRole("button", { name: "Refine", exact: true }).click();
  const dashboardRequestsBeforeSelection = starts.filter((entry) => entry.endpoint === "dashboard").length;
  await page.getByLabel("Reporting period", { exact: true }).selectOption("ytd");
  expect(starts.filter((entry) => entry.endpoint === "dashboard")).toHaveLength(dashboardRequestsBeforeSelection);
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect.poll(() => starts.filter((entry) => entry.mode === "filter" && entry.endpoint === "dashboard").length).toBe(1);
  await expect(page.getByTestId("dashboard-kpi-grid")).toBeVisible();
  dashboardGate.resolve();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/period=ytd/);

  mode = "failure";
  dashboardGate = deferred();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refreshing…", exact: true })).toBeVisible();
  dashboardGate.resolve();
  await expect(page.getByText("Temporary dashboard failure", { exact: true })).toBeVisible();
  await expect(page.getByTestId("dashboard-kpi-grid")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();

  await page.unrouteAll({ behavior: "wait" });
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
  const sidebar = page.getByRole("complementary", { name: "Application sidebar" });
  await page.mouse.move(1200, 300);
  await expect(sidebar).toHaveCSS("width", "80px");
  const collapsedWidth = (await page.getByTestId("dashboard-trend-chart").boundingBox())?.width ?? 0;
  await page.mouse.move(40, 300);
  await expect(sidebar).toHaveCSS("width", "224px");
  await expect.poll(async () => (await page.getByTestId("dashboard-trend-chart").boundingBox())?.width ?? 0)
    .toBeLessThan(collapsedWidth);

  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.getByTestId("dashboard-trend-chart")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("stage-distribution-chart")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  await page.unrouteAll({ behavior: "wait" });
});

test("sidebar groups are folded by default and toggle across desktop and mobile", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);

  const sidebar = page.getByRole("complementary", { name: "Application sidebar" });
  await page.mouse.move(1200, 300);
  await expect(sidebar).toHaveCSS("width", "80px");
  await expect(sidebar).toHaveAttribute("data-expanded", "false");
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
  await expect(sidebar.getByTestId("sidebar-group-chevron")).toHaveCount(0);
  const dashboardIconFrame = sidebar.locator('a[href="/reports"] span[aria-hidden="true"]');
  const collapsedIconX = (await dashboardIconFrame.boundingBox())?.x ?? 0;
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

  for (let cycle = 0; cycle < 5; cycle += 1) {
    await page.mouse.move(40, 300);
    await expect(sidebar).toHaveCSS("width", "224px");
    await expect(sidebar).toHaveAttribute("data-expanded", "true");
    expect((await dashboardIconFrame.boundingBox())?.x ?? 0).toBeCloseTo(collapsedIconX, 0);
    await page.mouse.move(1200, 300);
    await expect(sidebar).toHaveCSS("width", "80px");
    await expect(sidebar).toHaveAttribute("data-expanded", "false");
    expect((await dashboardIconFrame.boundingBox())?.x ?? 0).toBeCloseTo(collapsedIconX, 0);
  }
  await expect(sidebar.getByTestId("sidebar-group-chevron")).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.move(40, 300);
  await expect(sidebar).toHaveCSS("transition-duration", "0s");
  await expect(sidebar).toHaveCSS("width", "224px");
  await page.mouse.move(1200, 300);
  await expect(sidebar).toHaveCSS("width", "80px");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await sidebar.getByRole("link", { name: "Dashboard", exact: true }).focus();
  await expect(sidebar).toHaveCSS("width", "224px");
  await page.getByLabel(/Notifications, \d+ unread/).focus();
  await expect(sidebar).toHaveCSS("width", "80px");

  for (const group of groups) {
    const parent = sidebar.getByRole("button", { name: `${group.label} menu` });
    await parent.focus();
    await parent.press("Enter");
    await expect(parent).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar).toHaveAttribute("data-expanded", "true");
    await expect(sidebar.getByRole("link", { name: group.firstItem, exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: group.firstItem, exact: true }).locator("svg")).toBeVisible();
    const clippedLabels = await sidebar.locator("nav span.truncate").evaluateAll((labels) =>
      labels
        .filter((label) => {
          const style = window.getComputedStyle(label);
          return style.display !== "none" && style.visibility !== "hidden";
        })
        .filter((label) => label.scrollWidth > label.clientWidth + 1)
        .map((label) => label.textContent?.trim()),
    );
    expect(clippedLabels).toEqual([]);
    if (group.label === "Operations") {
      await page.screenshot({
        path: testInfo.outputPath("task16-2-tabler-sidebar-expanded.png"),
      });
    }
    await parent.press(" ");
    await expect(parent).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar.getByRole("link", { name: group.firstItem, exact: true })).toBeHidden();
  }

  const peopleMenu = sidebar.getByRole("button", { name: "People menu" });
  await peopleMenu.click();
  await expect(sidebar).toHaveAttribute("data-expanded", "true");
  await sidebar.getByRole("link", { name: "Users", exact: true }).click();
  await expect(page.getByRole("heading", { name: "User directory", exact: true })).toHaveCount(1);
  await expect(sidebar).toHaveAttribute("data-expanded", "false");
  await expect(sidebar).toHaveCSS("width", "80px");
  await expect(sidebar.getByRole("link", { name: "Users", exact: true })).toBeHidden();
  await expect(peopleMenu).toHaveAttribute("aria-expanded", "false");
  await page.mouse.move(40, 300);
  await expect(sidebar).toHaveCSS("width", "224px");
  await expect(sidebar.getByRole("link", { name: "Users", exact: true })).toBeHidden();
  await expect(sidebar.locator('a[href="/users"]')).toHaveAttribute("aria-current", "page");
  await expect(peopleMenu).toHaveClass(/bg-blue-50/);
  await page.mouse.move(1200, 300);
  await page.getByLabel(/Notifications, \d+ unread/).focus();
  await expect(sidebar).toHaveCSS("width", "80px");

  await page.setViewportSize({ width: 1100, height: 800 });
  await page.mouse.move(40, 300);
  await expect(sidebar).toHaveCSS("width", "224px");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBeTruthy();
  await page.mouse.move(900, 300);
  await expect(sidebar).toHaveCSS("width", "80px");

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
  await mobileOperations.click();
  await sidebar.getByRole("link", { name: "Customers", exact: true }).click();
  await expect(page).toHaveURL(/\/customers(?:\?|$)/);
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
});

test("shared shell supports breadcrumbs, auto expansion, user menu, and mobile navigation", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);

  const sidebar = page.getByRole("complementary", { name: "Application sidebar" });
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByLabel(/Notifications, \d+ unread/)).toBeVisible();
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb.getByText("Workspace", { exact: true })).toBeVisible();
  await expect(breadcrumb.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.locator("main h1")).toHaveCount(0);

  await page.mouse.move(1200, 300);
  await expect(sidebar).toHaveCSS("width", "80px");
  const authenticatedContent = page.getByTestId("authenticated-content");
  const shellHeader = page.locator("header").first();
  const shellMain = page.locator("main");
  const collapsedGeometry = await Promise.all([
    authenticatedContent.boundingBox(),
    shellHeader.boundingBox(),
    shellMain.boundingBox(),
    breadcrumb.boundingBox(),
  ]);
  for (const box of collapsedGeometry.slice(0, 3)) {
    expect(box?.x).toBeCloseTo(80, 0);
    expect(box?.width).toBeCloseTo(1360, 0);
  }
  expect(collapsedGeometry[3]?.x).toBeCloseTo(112, 0);
  await expect(shellMain).toHaveCSS("max-width", "none");
  await page.mouse.move(40, 300);
  await expect(sidebar).toHaveCSS("width", "224px");
  const expandedGeometry = await Promise.all([
    authenticatedContent.boundingBox(),
    shellHeader.boundingBox(),
    shellMain.boundingBox(),
    breadcrumb.boundingBox(),
  ]);
  for (const box of expandedGeometry.slice(0, 3)) {
    expect(box?.x).toBeCloseTo(224, 0);
    expect(box?.width).toBeCloseTo(1216, 0);
  }
  expect(expandedGeometry[3]?.x).toBeCloseTo(256, 0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBeTruthy();
  await page.mouse.move(1200, 300);
  await expect(sidebar).toHaveCSS("width", "80px");

  await page.getByLabel("Open user menu").click();
  await expect(page.getByRole("link", { name: "My profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.getByLabel("Open user menu").click();

  const operationsMenu = page.getByRole("button", { name: "Operations menu" });
  await operationsMenu.click();
  await expect(operationsMenu).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar).toHaveAttribute("data-expanded", "true");
  await page.getByRole("link", { name: "Applications", exact: true }).click();
  await expect(sidebar).toHaveAttribute("data-expanded", "false");
  await expect(sidebar).toHaveCSS("width", "80px");
  await expect(breadcrumb.getByText("Operations", { exact: true })).toBeVisible();
  await expect(breadcrumb.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
  await expect(page.locator("main h1")).toHaveCount(0);
  await expect(sidebar.locator('a[href="/applications"]')).toHaveAttribute("aria-current", "page");

  const peopleMenu = page.getByRole("button", { name: "People menu" });
  await peopleMenu.click();
  await expect(peopleMenu).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar).toHaveAttribute("data-expanded", "true");
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await expect(sidebar).toHaveAttribute("data-expanded", "false");
  await expect(sidebar).toHaveCSS("width", "80px");
  await expect(breadcrumb.getByText("People", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Organization masters", exact: true })).toHaveCount(1);
  await expect(page.locator("main h1")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Offices", exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(sidebar).toHaveCSS("width", "288px");
  const mobilePeopleMenu = page.getByRole("button", { name: "People menu" });
  if ((await mobilePeopleMenu.getAttribute("aria-expanded")) !== "true") {
    await mobilePeopleMenu.click();
  }
  await expect(page.getByRole("link", { name: "Organization", exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("task16-organization-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close navigation" }).last().click();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
});
