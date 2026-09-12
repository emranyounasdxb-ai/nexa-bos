import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { selectBrandedOption } from "./helpers/select";
import { captureViewport, captureViewportPair, captureViewportThemes, setVisualTheme } from "./helpers/viewport-capture";

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

test("complete breadcrumb labels remain reachable without moving the mobile page", async ({ page, request }, testInfo) => {
  await signIn(page, request);
  await page.goto("/");
  await expect(page).toHaveURL(/\/reports(?:\?|$)/);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/customers/new");
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    const current = breadcrumb.locator('[aria-current="page"]');
    await expect(current).toHaveText("Create customer");
    await expect(current).toBeVisible();
    await expect(current).toHaveCSS("text-overflow", "clip");
    await expect.poll(() => current.evaluate(element => {
      const label = element.getBoundingClientRect();
      const strip = element.closest("nav")!.getBoundingClientRect();
      return label.left >= strip.left - 1 && label.right <= strip.right + 1;
    })).toBe(true);
    await captureViewport(page, testInfo.outputPath(`breadcrumb-current-${viewport.width}.png`));
    const mainTop = (await page.locator("main").boundingBox())!.y;
    const dashboard = breadcrumb.getByRole("link", { name: "Dashboard", exact: true });
    await dashboard.focus();
    await expect(dashboard).toBeFocused();
    await expect(dashboard).toHaveCSS("outline-width", "2px");
    await expect.poll(() => dashboard.evaluate(element => {
      const label = element.getBoundingClientRect();
      const strip = element.closest("nav")!.getBoundingClientRect();
      return label.left >= strip.left - 1 && label.right <= strip.right + 1;
    })).toBe(true);
    await page.keyboard.press("Tab");
    await expect(breadcrumb.getByRole("link", { name: "Customers", exact: true })).toBeFocused();
    expect((await page.locator("main").boundingBox())!.y).toBe(mainTop);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
});

test("public account entry surfaces retain exact responsive viewports", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await ensureOwner(request);
  for (const [path, heading] of [["/login", "Sign in to AMAFH CORE"], ["/bootstrap", "First-time OWNER setup"], ["/setup", "Set your password"], ["/reset", "Reset your password"], ["/status", "Foundation smoke page"]]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await captureViewportPair(page, testInfo, `public-${path.slice(1)}-unsubmitted`);
  }
});

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

  const shellHeader = page.getByTestId("page-header");
  const breadcrumb = shellHeader.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb.getByRole("link")).toHaveCount(0);
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText("Dashboard");
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
  expect(shellBackgrounds.sidebar).toBe("rgba(0, 0, 0, 0)");
  expect(shellBackgrounds.header).toBe("rgba(0, 0, 0, 0)");
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
  const accountAvatar = page.getByTestId("account-actions").getByRole("button", { name: "Open user menu" }).locator('span[aria-hidden="true"]');
  await expect(accountAvatar).toBeVisible();
  await expect(accountAvatar).toHaveCSS("width", "30px");
  await expect(accountAvatar).toHaveCSS("height", "30px");

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
    fullPage: false,
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
  await expect(page.getByRole("complementary", { name: "Application sidebar" })).toHaveCSS("width", "44px");
  await page.screenshot({
    path: testInfo.outputPath("task16-2-tabler-sidebar-collapsed.png"),
    fullPage: false,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileCards = await kpiGrid.getByRole("link").evaluateAll((cards) => cards.map((card) => {
    const box = card.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }));
  expect(mobileCards).toHaveLength(4);
  expect(Math.abs(mobileCards[0].y - mobileCards[1].y)).toBeLessThanOrEqual(1);
  expect(Math.abs(mobileCards[2].y - mobileCards[3].y)).toBeLessThanOrEqual(1);
  expect(mobileCards[2].y).toBeGreaterThan(mobileCards[0].y + mobileCards[0].height);
  expect(Math.abs(mobileCards[0].x - mobileCards[2].x)).toBeLessThanOrEqual(1);
  expect(Math.abs(mobileCards[1].x - mobileCards[3].x)).toBeLessThanOrEqual(1);
  expect(Math.max(...mobileCards.map((card) => card.width)) - Math.min(...mobileCards.map((card) => card.width))).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("list search and page actions share compact desktop rows", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);

  await page.goto("/customers");
  await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
  const customerSearch = page.getByLabel("Search customers", { exact: true });
  const customerAction = page.getByRole("link", { name: "Create customer", exact: true });
  await expect(customerSearch).toBeVisible();
  await expect(customerAction).toBeVisible();
  expect((await customerSearch.boundingBox())?.height).toBe(32);
  expect((await customerAction.boundingBox())?.height).toBe(32);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  const userSearch = page.getByLabel("Search users", { exact: true });
  const userAction = page.getByRole("link", { name: "Create user", exact: true });
  await expect(userSearch).toBeVisible();
  await expect(userAction).toBeVisible();
  expect((await userSearch.boundingBox())?.height).toBe(32);
  expect((await userAction.boundingBox())?.height).toBe(32);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

  for (const item of [
    { path: "/applications", heading: "Applications", search: "Search applications", action: "Create application", actionRole: "button" },
  ]) {
    await page.goto(item.path);
    await expect(page.getByRole("heading", { name: item.heading, exact: true })).toBeVisible();
    const bar = page.getByTestId("search-action-bar");
    const search = bar.getByLabel(item.search, { exact: true });
    const action = bar.getByRole(item.actionRole as "button" | "link", { name: item.action, exact: true });
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
  for (const label of ["Refresh", "Export"]) {
    const button = page.getByRole("button", { name: label, exact: true }).first();
    await expect(button).toBeVisible();
    expect((await button.boundingBox())?.height).toBe(32);
  }

  await page.goto("/users/new");
  await expect(page.getByRole("heading", { name: "Create user", exact: true })).toBeVisible();
  for (const control of [
    page.getByRole("textbox", { name: "Full Name (required)", exact: true }),
    page.getByRole("textbox", { name: "Personal Email (required)", exact: true }),
    page.getByRole("textbox", { name: "Personal Mobile (required)", exact: true }),
    page.getByLabel("User Code", { exact: true }),
    page.getByRole("button", { name: "Create User", exact: true }),
  ]) {
    await expect(control).toBeVisible();
    expect((await control.boundingBox())?.height).toBe(32);
  }
  await expect(page.getByRole("button", { name: "Open calendar", exact: true })).toHaveCount(0);

  await page.goto("/attendance/schedules");
  await expect(page.getByRole("heading", { name: "Attendance schedules", exact: true })).toBeVisible();
  for (const control of [
    page.getByLabel("Start time", { exact: true }),
    page.getByLabel("End time", { exact: true }),
    page.getByLabel("Grace minutes", { exact: true }),
    page.getByRole("button", { name: "Save schedule", exact: true }),
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
    ["/users", "Users"],
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
}, testInfo) => {
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
  const initialDashboard = deferred();
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
      await initialDashboard.promise;
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
  // This deliberately held response is loading-state evidence, never a settled page.
  // Do not use the settled helper: networkidle cannot occur until the gate is released.
  const loadingViewport = page.viewportSize();
  const loadingTheme = await page.locator("html").getAttribute("data-theme");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ["light", "dark"] as const) {
      await setVisualTheme(page, theme);
      await expect(page.getByTestId("dashboard-loading-skeleton")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await page.screenshot({ path: testInfo.outputPath(`STATE-ONLY-dashboard-controlled-loading-${theme}-${viewport.width}.png`), fullPage: false, animations: "disabled" });
    }
  }
  if (loadingViewport) await page.setViewportSize(loadingViewport);
  await setVisualTheme(page, loadingTheme === "dark" ? "dark" : "light");
  initialDashboard.resolve();
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
  await selectBrandedOption(page.getByLabel("Reporting period", { exact: true }), "ytd");
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
  await captureViewportPair(page, testInfo, "dashboard-simulated-error-retained-data", page.getByText("Temporary dashboard failure", { exact: true }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("Temporary dashboard failure", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("dashboard-simulated-error-mobile-panel.png"), fullPage: false });

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
  await expect(sidebar).toHaveCSS("width", "44px");
  const collapsedWidth = (await page.getByTestId("dashboard-trend-chart").boundingBox())?.width ?? 0;
  await sidebar.hover();
  await expect(sidebar).toHaveCSS("width", "44px");
  await expect.poll(async () => (await page.getByTestId("dashboard-trend-chart").boundingBox())?.width ?? 0)
    .toBeCloseTo(collapsedWidth, 0);

  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.getByTestId("dashboard-trend-chart")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("stage-distribution-chart")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  await page.unrouteAll({ behavior: "wait" });
});

test("sidebar popup remains usable while dashboard data loads", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const requested = deferred();
  const release = deferred();
  await page.route(`${apiOrigin}/api/v1/reports/dashboard**`, async route => {
    const response = await route.fetch();
    requested.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await signIn(page, request);
    await requested.promise;
    const sidebar = page.locator('aside[aria-label="Application sidebar"]');
    const skeleton = page.getByTestId("dashboard-loading-skeleton");
    await expect(skeleton).toBeVisible();
    await expect(page.getByTestId("dashboard-kpi-grid")).toHaveCount(0);
    // Deliberately held real response: loading-state evidence is separately
    // labelled and must never be counted as a completed dashboard capture.
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const theme of ["light", "dark"] as const) {
        await setVisualTheme(page, theme);
        await expect(skeleton).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
        await page.screenshot({ path: testInfo.outputPath(`loading-state-only-dashboard-${theme}-${viewport.width}.png`), fullPage: false, animations: "disabled" });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await setVisualTheme(page, "light");
    await expect(sidebar).toHaveJSProperty("inert", false);
    await sidebar.getByRole("button", { name: "People menu", exact: true }).click();
    const popup = page.getByRole("dialog", { name: "People", exact: true });
    await expect(popup.getByRole("link", { name: "Users", exact: true })).toBeVisible();
    await expect(sidebar).toHaveCSS("width", "44px");
    release.resolve();
    await expect(skeleton).toHaveCount(0);
    await expect(page.getByTestId("dashboard-kpi-grid")).toBeVisible();
    await expect(popup).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sidebar.getByRole("button", { name: "People menu", exact: true })).toBeFocused();
    await page.mouse.move(1200, 300);
    await expect(sidebar).toHaveCSS("width", "44px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("sidebar groups open permission-backed popup cards on desktop and mobile", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);
  const sidebar = page.locator('aside[aria-label="Application sidebar"]');
  const groups = [
    { label: "Operations", firstItem: "Customers" },
    { label: "People", firstItem: "Users" },
    { label: "Performance", firstItem: "Targets" },
    { label: "Assets", firstItem: "Assets" },
    { label: "Administration", firstItem: "Banks & products" },
  ];
  const dashboard = sidebar.getByRole("link", { name: "Dashboard", exact: true });
  await expect(dashboard).toHaveAttribute("aria-current", "page");
  await expect(sidebar.getByRole("link", { name: "Finance", exact: true })).toHaveAttribute("href", "/finance");
  await expect(sidebar.getByRole("navigation", { name: "Primary" }).locator(":scope > a, :scope > button")).toHaveCount(7);
  const geometry = await dashboard.boundingBox();
  for (let cycle = 0; cycle < 5; cycle++) {
    await sidebar.hover();
    await expect(sidebar).toHaveCSS("width", "44px");
    expect(await dashboard.boundingBox()).toEqual(geometry);
    await page.mouse.move(1200, 300);
    await expect(sidebar).toHaveCSS("width", "44px");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    if (viewport.width < 1024) await page.getByLabel("Open navigation", { exact: true }).click();
    await expect(sidebar).toHaveCSS("width", viewport.width < 1024 ? "56px" : "44px");
    for (const group of groups) {
      const parent = sidebar.getByRole("button", { name: `${group.label} menu`, exact: true });
      await expect(parent).toHaveAttribute("aria-expanded", "false");
      await parent.focus();
      await parent.press("Enter");
      const popup = page.getByRole("dialog", { name: group.label, exact: true });
      await expect(parent).toHaveAttribute("aria-expanded", "true");
      await expect(popup.getByRole("link", { name: group.firstItem, exact: true })).toBeVisible();
      await expect(popup).toBeInViewport({ ratio: 1 });
      await expect(popup.locator('a:not([href]), a[href="#"]')).toHaveCount(0);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(popup).toHaveCSS("animation-name", "none");
      for (const theme of ["light", "dark"] as const) {
        await setVisualTheme(page, theme);
        await captureViewport(page, testInfo.outputPath(`approved-${group.label.toLowerCase()}-popup-${theme}-${viewport.width}.png`));
      }
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
      await expect(parent).toBeFocused();
      await expect(parent).toHaveAttribute("aria-expanded", "false");
    }
    if (viewport.width < 1024) {
      await page.keyboard.press("Escape");
      await expect(sidebar).toHaveJSProperty("inert", true);
      await expect(page.getByLabel("Open navigation", { exact: true })).toBeFocused();
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const people = sidebar.getByRole("button", { name: "People menu", exact: true });
  await people.click();
  await page.getByRole("dialog", { name: "People", exact: true }).getByRole("link", { name: "Users", exact: true }).click();
  await expect(page).toHaveURL(/\/users(?:\?|$)/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(people).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("navigation", { name: "Workspace pages" }).getByRole("link", { name: "Users", exact: true })).toHaveAttribute("aria-current", "page");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Open navigation", { exact: true }).click();
  await expect(sidebar).toHaveAttribute("aria-modal", "true");
  await sidebar.getByRole("button", { name: "Operations menu", exact: true }).click();
  await page.getByRole("dialog", { name: "Operations", exact: true }).getByRole("link", { name: "Customers", exact: true }).click();
  await expect(page).toHaveURL(/\/customers(?:\?|$)/);
  await expect(sidebar).toHaveJSProperty("inert", true);
});

test("shared shell keeps stable geometry, breadcrumbs, account and mobile popup navigation", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);
  const sidebar = page.locator('aside[aria-label="Application sidebar"]');
  const content = page.getByTestId("authenticated-content");
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(sidebar).toHaveCSS("width", "44px");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByLabel(/Notifications, \d+ unread/)).toBeVisible();
  await expect(breadcrumb.getByRole("link")).toHaveCount(0);
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText("Dashboard");
  await expect(content.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  const [railBox, contentBox, headerBox, mainBox] = await Promise.all([
    sidebar.boundingBox(), content.boundingBox(), content.getByTestId("page-header").boundingBox(), content.locator(":scope > main").boundingBox(),
  ]);
  expect(contentBox!.x - (railBox!.x + railBox!.width)).toBeCloseTo(26, 0);
  expect(headerBox!.x).toBeCloseTo(contentBox!.x, 0);
  expect(mainBox!.x).toBeCloseTo(contentBox!.x, 0);
  expect(mainBox!.width).toBeCloseTo(contentBox!.width, 0);
  await sidebar.hover();
  await expect(sidebar).toHaveCSS("width", "44px");
  expect((await content.boundingBox())!.x).toBe(contentBox!.x);
  expect((await content.boundingBox())!.width).toBe(contentBox!.width);
  await page.getByLabel("Open user menu").click();
  const accountMenu = page.getByRole("menu", { name: "User account" });
  await expect(accountMenu.getByRole("menuitem", { name: "My profile" })).toBeVisible();
  await expect(accountMenu.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await expect(accountMenu).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  for (const route of [
    { group: "Operations", item: "Applications", title: "Applications", href: "/applications" },
    { group: "People", item: "Organization", title: "Organization masters", href: "/organization" },
  ]) {
    const trigger = sidebar.getByRole("button", { name: `${route.group} menu`, exact: true });
    await trigger.click();
    await page.getByRole("dialog", { name: route.group, exact: true }).getByRole("link", { name: route.item, exact: true }).click();
    await expect(page).toHaveURL(url => url.pathname === route.href);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toHaveAttribute("data-active", "true");
    await expect(breadcrumb.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute("href", "/reports");
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(route.title);
    await expect(page.getByRole("heading", { name: route.title, exact: true })).toHaveCount(1);
  }
  await page.goto("/users/new");
  await expect(breadcrumb.getByRole("link", { name: "Users", exact: true })).toHaveAttribute("href", "/users");
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText("Create user");
  await expect(page.getByRole("dialog", { name: "Create User" })).toBeVisible();
  await page.getByRole("button", { name: "Close Create User" }).click();
  await expect(page).toHaveURL(/\/users(?:\?|$)/);
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText("Users");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(sidebar).toHaveCSS("width", "56px");
  await expect(sidebar).toHaveAttribute("role", "dialog");
  await expect(sidebar).toHaveAttribute("aria-modal", "true");
  await sidebar.getByRole("button", { name: "People menu" }).click();
  await expect(page.getByRole("dialog", { name: "People", exact: true }).getByRole("link", { name: "Organization", exact: true })).toBeVisible();
  await captureViewport(page, testInfo.outputPath("approved-organization-mobile-popup.png"));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(sidebar).toHaveJSProperty("inert", true);
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test("shared application layout stays compact, aligned, and overflow-free across core routes", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(480_000);
  await signIn(page, request);

  const routes = [
    "/reports",
    "/customers",
    "/customers/new",
    "/applications",
    "/applications/new",
    "/attendance",
    "/attendance/holidays",
    "/attendance/reports",
    "/attendance/schedules",
    "/users",
    "/users/new",
    "/organization",
    "/organization/hierarchy",
    "/targets",
    "/targets/kpi",
    "/reports/compare",
    "/reports/drill-down",
    "/finance",
    "/assets",
    "/assets/categories",
    "/assets/reports",
    "/catalog",
    "/user-types",
    "/notifications",
    "/notifications/manage",
    "/workflows",
    "/security",
    "/account",
    "/hr",
    "/pro",
    "/leave",
    "/contracts",
    "/transfers",
    "/exits",
    "/approvals",
  ];

  const screenshotRoutes = new Set(routes);

  for (const viewport of [
    { width: 1440, height: 900, expectedHeaderPaddingTop: "0px", label: "desktop" },
    { width: 390, height: 844, expectedHeaderPaddingTop: "0px", label: "mobile" },
  ]) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByTestId("authenticated-content")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("page-header").locator("h1")).toHaveCount(1);
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 245, 248)");
      await expect(page.getByTestId("page-header")).toHaveCSS("padding-top", viewport.expectedHeaderPaddingTop);
      await expect(page.getByTestId("page-main")).toHaveCSS("font-size", "15px");

      // Query and measure in one browser task: loading/empty icons can be
      // replaced between locator resolution and a separate handle evaluation.
      const iconPresentation = await page.evaluate(() => Array.from(document.querySelectorAll('[data-amafh-ui-icon]'))
        .filter((icon) => {
          const box = icon.getBoundingClientRect();
          const visibility = getComputedStyle(icon).visibility;
          return box.width > 0 && box.height > 0 && visibility !== "hidden" && visibility !== "collapse";
        })
        .map((icon) => ({
          filter: getComputedStyle(icon).filter,
          disabled: Boolean(icon.closest('button:disabled, [aria-disabled="true"]')),
          label: icon.closest("button, a, [role=button]")?.getAttribute("aria-label") ?? icon.parentElement?.textContent?.trim().slice(0, 48) ?? icon.tagName,
        })));
      expect(iconPresentation.length, `${route} should expose shared UI icons`).toBeGreaterThan(0);
      const incorrectIcons = iconPresentation.filter((icon) => icon.filter !== "none");
      expect(incorrectIcons, `${route} should use flat icons in the approved design`).toEqual([]);
      await expect(page.locator('img[src*="/brand/"][data-amafh-ui-icon]')).toHaveCount(0);

      const layout = await page.evaluate(() => {
        const main = document.querySelector<HTMLElement>("main");
        return {
          documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          mainOverflow: main ? main.scrollWidth - main.clientWidth : null,
        };
      });
      expect(layout.documentOverflow, `${route} should not overflow the viewport`).toBeLessThanOrEqual(1);
      expect(layout.mainOverflow, `${route} main content should not overflow`).toBeLessThanOrEqual(1);

      if (route === "/reports") {
        await expect(page.getByLabel("Loading dashboard metrics")).toHaveCount(0, { timeout: 10_000 });
      }
      if (route === "/organization") {
        await expect(page.getByText("Loading organization masters…")).toHaveCount(0, { timeout: 10_000 });
      }

      const card = page.locator("main [data-amafh-card]:visible").first();
      if (await card.count()) {
        const integratedFilter = await card.evaluate(element => element.parentElement?.className.includes("listFilters"));
        await expect(card).toHaveCSS("background-color", integratedFilter ? "rgba(0, 0, 0, 0)" : "rgb(255, 255, 255)");
        // Borderless nested cards use background grouping; visible edges use the theme border.
        const borderWidth = await card.evaluate(element => parseFloat(getComputedStyle(element).borderTopWidth));
        if (borderWidth > 0) await expect(card).toHaveCSS("border-color", "rgb(236, 233, 239)");
        else await expect(card).toHaveCSS("border-top-width", "0px");
        await expect(card).toHaveCSS("border-radius", /^(20|14)px$/);
      }
      for (const tableShell of await page.locator("main [data-amafh-table-shell]").all()) {
        await expect(tableShell).toHaveCSS("position", "relative");
      }

      const sectionHeading = page.locator("main [data-amafh-section-header] h2:visible").first();
      if (await sectionHeading.count()) {
        await expect(sectionHeading).toHaveCSS("font-size", "17px");
      }

      const tablist = page.locator('main [role="tablist"]:visible').first();
      if (await tablist.count()) {
        const tabs = tablist.getByRole("tab");
        const selected = tablist.locator('[role="tab"][aria-selected="true"]');
        const geometry = await tablist.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            gap: style.gap,
            height: element.getBoundingClientRect().height,
            overflowX: style.overflowX,
          };
        });
        expect(geometry.gap).toBe("4px");
        expect(geometry.height).toBe(32);
        expect(geometry.overflowX).toBe("auto");
        for (const tab of await tabs.all()) {
          expect((await tab.boundingBox())?.height).toBe(32);
        }
        if (await selected.count()) {
          await expect(selected.first()).toHaveCSS("color", "rgb(255, 255, 255)");
          await expect(selected.first()).toHaveCSS("border-bottom-width", "0px");
        }
      }

      const controls = page.locator(
        'main input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]), main [role="combobox"]',
      );
      for (const control of await controls.all()) {
        if (!(await control.isVisible())) continue;
        const box = await control.boundingBox();
        expect(box?.height, `${route} single-line controls should remain 32px`).toBe(32);
      }

      if (screenshotRoutes.has(route)) {
        await expect(page.locator('main').getByText(/^Loading(?:\b|…)/)).toHaveCount(0);
        if (route === "/reports/compare") {
          await page.getByRole("button", { name: "Compare", exact: true }).click();
          await expect(page.locator("dt").getByText("Current", { exact: true })).toBeVisible();
        }
        await captureViewport(page, testInfo.outputPath(`app-wide-${viewport.label}-${route.slice(1).replaceAll("/", "-")}.png`));
      }
    }

    await page.goto("/status");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 245, 248)");
    const publicSurface = page.locator("[data-amafh-public-surface]").first();
    await expect(publicSurface).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(publicSurface).toHaveCSS("border-top-width", "0px");
    await expect(publicSurface).toHaveCSS("border-radius", "20px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});

test("empty table messages remain readable inside mobile horizontal scrollers", async ({ page, request }, testInfo) => {
  await signIn(page, request);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/attendance/reports");
    // This is the existing initial report placeholder, not a submitted empty report.
    const message = page.getByText("No attendance rows for the selected filters.", { exact: true });
    const shell = page.locator("[data-amafh-table-shell]").filter({ has: message });
    await expect(message).toBeVisible();
    await message.scrollIntoViewIfNeeded();
    await shell.evaluate(element => { element.scrollLeft = 0; });
    await captureViewportThemes(page, testInfo.outputPath(`empty-table-${viewport.width}-initial.png`), message);
    const isContained = () => message.evaluate(element => {
      const content = element.getBoundingClientRect();
      const container = element.closest("[data-amafh-table-shell]")!.getBoundingClientRect();
      return content.left >= container.left - 1 && content.right <= container.right + 1;
    });
    await expect.poll(isContained, { message: "Complete empty message must fit the visible table scroller" }).toBe(true);
    if (viewport.width === 390) {
      const maximumScroll = await shell.evaluate(element => element.scrollWidth - element.clientWidth);
      await shell.evaluate(element => { element.scrollLeft = element.scrollWidth; });
      // Labelled mobile records fit without horizontal scrolling. If another
      // table remains scrollable, still exercise and verify its far edge.
      await expect.poll(() => shell.evaluate(element => element.scrollLeft)).toBe(maximumScroll);
      await expect.poll(isContained).toBe(true);
      await captureViewportThemes(page, testInfo.outputPath("empty-table-390-scrolled.png"), message);
    } else {
      await expect(message).toHaveCSS("position", "static");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
});
