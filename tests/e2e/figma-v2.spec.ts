import { expect, test } from "@playwright/test";
import { captureViewport, setVisualTheme } from "./helpers/viewport-capture";

const api = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const staticRoutes = [
  "/reports", "/applications", "/applications/new", "/customers", "/customers/new",
  "/users", "/users/new", "/user-types", "/organization", "/organization/hierarchy",
  "/catalog", "/workflows", "/attendance", "/attendance/holidays", "/attendance/reports",
  "/attendance/schedules", "/hr", "/pro", "/leave", "/contracts", "/transfers", "/exits",
  "/approvals", "/case-operations", "/assets", "/assets/categories", "/assets/reports",
  "/organization?tab=departments", "/organization?tab=business-units", "/organization?tab=teams",
  "/leave?tab=settings", "/leave?tab=approvals", "/leave?tab=calendar",
  "/catalog?tab=products", "/catalog?tab=variants", "/catalog?tab=rules", "/catalog?tab=mappings",
  "/finance", "/targets", "/targets/kpi", "/reports/compare", "/reports/drill-down",
  "/notifications", "/notifications/manage", "/security", "/account",
];
const referenceHeights: Record<string, number> = { "/reports": 1340, "/hr": 1370, "/pro": 1331, "/assets": 1049, "/assets/categories": 970, "/assets/reports": 1046 };
// A targeted rerun refreshes the changed tablet presentation; default remains the complete gallery.
const tabletRefresh = process.env.PLAYWRIGHT_FIGMA_TABLET_REFRESH === "1";
const galleryViewports = tabletRefresh ? [{ width: 1194, height: 834 }] : [{ width: 1440, height: 1120 }, { width: 1194, height: 834 }, { width: 393, height: 852 }];
const publicViewports = tabletRefresh ? [{ width: 1194, height: 834 }, { width: 393, height: 852 }] : galleryViewports;
const targetedWidth = Number(process.env.PLAYWRIGHT_FIGMA_WIDTH ?? 0);
if (targetedWidth && ![1440, 1194, 393].includes(targetedWidth)) throw new Error("Unsupported Figma review viewport");
const routeStart = Number(process.env.PLAYWRIGHT_FIGMA_ROUTE_START ?? 0);
const routeEnd = Number(process.env.PLAYWRIGHT_FIGMA_ROUTE_END ?? 0);

test("Figma V2 asset report native geometry follows the inspected frame values", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Open user menu", { exact: true })).toBeVisible();
  for (const viewport of [{ width: 1440, height: 1046 }, { width: 1194, height: 834 }, { width: 393, height: 852 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/assets/reports");
    await expect(page.getByRole("combobox", { name: "Asset report", exact: true })).toContainText("Asset Register");
    for (const theme of ["light", "dark"] as const) {
      await setVisualTheme(page, theme);
      await captureViewport(page, testInfo.outputPath(`final-assets-reports-${theme}-${viewport.width}.png`));
      const panel = page.locator("[data-amafh-filter-bar]");
      const bounds = (await panel.boundingBox())!;
      // Native frame top positions, excluding Figma's 24px simulated device status bar.
      expect(bounds.y).toBe(viewport.width === 1440 ? 300 : viewport.width === 1194 ? 76 : 88);
      expect(await panel.evaluate(e => getComputedStyle(e).borderRadius)).toBe(viewport.width === 1440 ? "14px" : "20px");
      const label = panel.locator("label").first();
      expect(await label.evaluate(e => { const style = getComputedStyle(e.firstElementChild!); return [style.fontSize, style.lineHeight, style.fontWeight]; })).toEqual(["12px", "17px", viewport.width === 1440 ? "500" : "400"]);
      if (viewport.width === 1194) {
        const summary = (await page.locator("[data-amafh-list-summary]").boundingBox())!;
        const results = (await page.locator("[data-amafh-list-body]").boundingBox())!;
        expect(summary.y).toBe(bounds.y);
        expect(results.width).toBe(bounds.width);
        expect(bounds.width).toBe(650);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    }
  }
});

test("Figma V2 route gallery preserves responsive access and bounded layouts in both themes", async ({ page }, testInfo) => {
  test.setTimeout(1_200_000);
  page.setDefaultTimeout(60_000);
  const errors: string[] = [];
  const authenticationFailures: { url: string; status: number; failure?: string }[] = [];
  page.on("response", response => {
    if (response.url().endsWith("/api/v1/auth/me") && response.status() !== 200) authenticationFailures.push({ url: response.url(), status: response.status() });
  });
  page.on("requestfailed", request => {
    if (request.url().endsWith("/api/v1/auth/me")) authenticationFailures.push({ url: request.url(), status: 0, failure: request.failure()?.errorText });
  });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Open user menu", { exact: true })).toBeVisible({ timeout: 60_000 });
  const inventory = [...staticRoutes];
  const sources = [
    ["/api/v1/applications", "/applications/:id"],
    ["/api/v1/customers", "/customers/:id"],
    ["/api/v1/assets", "/assets/:id"],
    ["/api/v1/users", "/users/:id", "/users/:id/edit", "/reports/employees/:id"],
    ["/api/v1/user-types", "/user-types/:id"],
  ];
  for (const [endpoint, ...patterns] of sources) {
    const response = await page.request.get(api + endpoint);
    expect(response.ok(), endpoint).toBe(true);
    const body = await response.json() as { items: { id: string; code?: string }[] };
    expect(body.items.length, `Run workflow fixtures before the gallery: ${endpoint}`).toBeGreaterThan(0);
    const record = endpoint.endsWith("user-types") ? body.items.find(item => item.code !== "OWNER")! : body.items[0];
    inventory.push(...patterns.map(pattern => pattern.replace(":id", record.id)));
    if (endpoint.endsWith("users")) inventory.push(...["hr", "pro", "organization", "assets", "history"].map(tab => `/users/${record.id}?tab=${tab}`));
  }
  await page.goto("/");
  await expect(page).toHaveURL(/\/reports(?:\?|$)/);
  await testInfo.attach("screen-inventory", { body: JSON.stringify(inventory, null, 2), contentType: "application/json" });
  const reviewedRoutes = inventory.slice(routeStart, routeEnd || undefined);
  expect(reviewedRoutes.length).toBeGreaterThan(0);
  for (const viewport of galleryViewports.filter(viewport => !targetedWidth || viewport.width === targetedWidth)) {
    for (const route of reviewedRoutes) {
      await page.setViewportSize({ ...viewport, height: viewport.width === 1440 ? referenceHeights[route] ?? 1120 : viewport.height });
      await page.goto(route);
      await expect(page.getByTestId("authenticated-content"), `${route}: ${JSON.stringify(authenticationFailures)}`).toBeVisible({ timeout: 60_000 });
      if (route === "/applications/new") await expect(page).toHaveURL(/\/applications$/);
      await expect(page.getByTestId("page-header").locator("h1")).toHaveCount(1);
      const name = route.slice(1).replaceAll("/", "-").replaceAll("?", "-").replaceAll("=", "-");
      for (const theme of ["light", "dark"] as const) {
        await setVisualTheme(page, theme);
        await captureViewport(page, testInfo.outputPath(`${name}-${theme}-${viewport.width}.png`));
        if (viewport.width < 1280 && ["/catalog", "/catalog?tab=products"].includes(route)) {
          const tabs = await page.getByLabel("Catalogue task tabs", { exact: true }).boundingBox();
          const firstRecord = await page.locator('[data-amafh-card]:visible').filter({ has: page.locator(':scope > details') }).first().boundingBox();
          expect(tabs).not.toBeNull();
          if (firstRecord) expect(tabs!.y + tabs!.height, `${route}: task tabs must precede records`).toBeLessThanOrEqual(firstRecord.y);
        }
        const nav = viewport.width < 640 ? page.getByRole("navigation", { name: "Mobile navigation", exact: true })
          : viewport.width < 1280 ? page.getByRole("navigation", { name: "Tablet navigation", exact: true })
          : page.getByRole("navigation", { name: "Primary", exact: true });
        await expect(nav).toBeVisible();
        const overflow = await page.getByTestId("page-main").evaluate(element => element.scrollWidth - element.clientWidth);
        expect(overflow, `${route} ${theme} ${viewport.width}`).toBeLessThanOrEqual(1);
        if (viewport.width < 640) {
          const box = (await nav.boundingBox())!;
          expect(box.y + box.height).toBe(viewport.height);
        }
      }
    }
  }
  for (const width of targetedWidth ? [] : tabletRefresh ? [640, 768, 959, 960, 1279] : [320, 639, 640, 768, 959, 960, 1279, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/reports", "/applications", "/catalog", "/organization", "/user-types", "/leave", "/hr"]) {
      await page.goto(route);
      for (const theme of ["light", "dark"] as const) {
        await setVisualTheme(page, theme);
        await captureViewport(page, testInfo.outputPath(`intermediate-${route.slice(1)}-${theme}-${width}.png`));
      }
    }
  }
  await page.getByLabel("Open user menu", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await testInfo.attach("authentication-failures", { body: JSON.stringify(authenticationFailures, null, 2), contentType: "application/json" });
  for (const route of targetedWidth ? [] : ["/login", "/bootstrap", "/setup", "/reset", "/status"]) {
    await page.goto(route);
    for (const viewport of publicViewports) {
      await page.setViewportSize(viewport);
      for (const theme of ["light", "dark"] as const) {
        await setVisualTheme(page, theme);
        await captureViewport(page, testInfo.outputPath(`public-${route.slice(1)}-${theme}-${viewport.width}.png`));
      }
    }
  }
  expect(errors).toEqual([]);
});

test("Figma V2 existing responsive edit surfaces preserve their original forms without submission", async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Open user menu", { exact: true })).toBeVisible();
  const users = await page.request.get(`${api}/api/v1/users`);
  expect(users.ok()).toBe(true);
  const userId = ((await users.json()) as { items: { id: string }[] }).items[0].id;
  const mutations: string[] = [];
  page.on("request", request => {
    if (request.url().startsWith(`${api}/api/v1/`) && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  const surfaces = [
    { name: "asset-add", route: "/assets", open: async () => {
      await page.getByRole("button", { name: "Add asset", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Add asset", exact: true })).toBeVisible();
    } },
    { name: "organization-edit", route: "/organization", open: async () => {
      await page.getByRole("button", { name: /^Edit(?: |$)/ }).first().click();
      await expect(page.getByRole("dialog", { name: "Edit office", exact: true })).toBeVisible();
    } },
    { name: "leave-request", route: "/leave", open: async () => {
      await page.getByRole("button", { name: "Request leave", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Request leave", exact: true })).toBeVisible();
    } },
    { name: "user-create-modal", route: "/users", open: async () => {
      await page.getByRole("link", { name: "Create user", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Create User", exact: true })).toBeVisible();
    } },
    { name: "category-create-inline", route: "/assets/categories", anchor: () => page.getByRole("heading", { name: "New category", exact: true }), open: async () => {
      await page.getByRole("heading", { name: "New category", exact: true }).scrollIntoViewIfNeeded();
    } },
    { name: "designation-create-inline", route: "/user-types", anchor: () => page.getByRole("textbox", { name: "Name", exact: true }).locator("xpath=ancestor::form"), open: async () => {
      await page.getByRole("textbox", { name: "Name", exact: true }).scrollIntoViewIfNeeded();
    } },
    { name: "leave-policy-inline", route: "/leave?tab=settings", anchor: () => page.getByRole("heading", { name: "Annual", exact: true }), open: async () => {
      await page.getByRole("button", { name: "Save Annual", exact: true }).scrollIntoViewIfNeeded();
    } },
    { name: "employee-document-inline", route: `/users/${userId}?tab=pro`, anchor: () => page.getByRole("heading", { name: "Add document record", exact: true }), open: async () => {
      await page.getByRole("heading", { name: "Add document record", exact: true }).scrollIntoViewIfNeeded();
    } },
  ];
  for (const viewport of [{ width: 1440, height: 1120 }, { width: 1194, height: 834 }, { width: 393, height: 852 }]) {
    await page.setViewportSize(viewport);
    for (const surface of surfaces) {
      await page.goto(surface.route);
      await expect(page.getByTestId("authenticated-content")).toBeVisible();
      await surface.open();
      for (const theme of ["light", "dark"] as const) {
        await setVisualTheme(page, theme);
        const anchor = "anchor" in surface ? surface.anchor() : undefined;
        await captureViewport(page, testInfo.outputPath(`${surface.name}-${theme}-${viewport.width}.png`), anchor, viewport.width < 1280 ? 90 : 0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
        if (viewport.width === 393) {
          const panel = page.locator('[data-amafh-dialog-panel]:visible, [data-amafh-editor-panel]:visible, [data-amafh-create-application]:visible');
          if (await panel.count()) expect(await panel.first().evaluate(element => getComputedStyle(element).borderTopLeftRadius)).toBe("0px");
        }
      }
      await page.keyboard.press("Escape");
    }
  }
  expect(mutations).toEqual([]);
});

test("Figma V2 public entry surfaces retain their actual unauthenticated screens", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  for (const route of ["/login", "/bootstrap", "/setup", "/reset", "/status"]) {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await expect(page.getByTestId("authenticated-content")).toHaveCount(0);
    for (const viewport of [{ width: 1440, height: 1120 }, { width: 1194, height: 834 }, { width: 393, height: 852 }]) {
      await page.setViewportSize(viewport);
      for (const theme of ["light", "dark"] as const) {
        await setVisualTheme(page, theme);
        await captureViewport(page, testInfo.outputPath(`entry-${route.slice(1)}-${theme}-${viewport.width}.png`));
        if (route === "/login") {
          const logo = (await page.locator(".amafh-full-logo img:visible").boundingBox())!;
          const appearance = (await page.getByRole("group", { name: "Appearance", exact: true }).boundingBox())!;
          expect(logo.x + logo.width <= appearance.x || appearance.x + appearance.width <= logo.x || logo.y + logo.height <= appearance.y || appearance.y + appearance.height <= logo.y).toBe(true);
        }
      }
    }
  }
});

test("Figma V2 existing editors and genuine loading, empty, error and validation states", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Open user menu", { exact: true })).toBeVisible({ timeout: 60_000 });
  const designations = await page.request.get(`${api}/api/v1/user-types`);
  expect(designations.ok()).toBe(true);
  const permissionsId = ((await designations.json()) as { items: { id: string; code: string }[] }).items.find(item => item.code !== "OWNER")!.id;
  const finalRoutes = ["/reports", "/hr", "/pro", "/user-types", `/user-types/${permissionsId}`, "/organization", "/organization?tab=departments", "/organization?tab=business-units", "/organization?tab=teams", "/assets", "/assets/categories", "/assets/reports", "/attendance/reports", "/organization/hierarchy", "/targets"];
  for (const viewport of [{ width: 1440, height: 1120 }, { width: 1194, height: 834 }, { width: 393, height: 852 }]) {
    await page.setViewportSize(viewport);
    for (const route of finalRoutes) {
      await page.setViewportSize({ ...viewport, height: viewport.width === 1440 ? referenceHeights[route] ?? 1120 : viewport.height });
      await page.goto(route);
      if (route === "/applications/new") await expect(page).toHaveURL(/\/applications$/);
      if (route === "/attendance/reports") {
        await page.getByRole("button", { name: "Run report", exact: true }).click();
        const reportSummary = page.locator("[data-amafh-report-summary]");
        await expect(reportSummary).toBeVisible();
        if (viewport.width === 1194) {
          const form = (await page.getByLabel("Report date", { exact: true }).boundingBox())!;
          const summary = (await reportSummary.boundingBox())!;
          expect(summary.x).toBeGreaterThan(form.x + form.width);
        }
      }
      if (route === "/assets/reports" && viewport.width === 1194) {
        const filters = (await page.locator("[data-amafh-list-filters]").boundingBox())!;
        const results = (await page.locator("[data-amafh-list-body]").boundingBox())!;
        expect(results.x).toBeCloseTo(filters.x, 0);
        expect(results.width).toBeCloseTo(filters.width, 0);
      }
      for (const theme of ["light", "dark"] as const) {
        await setVisualTheme(page, theme);
        await captureViewport(page, testInfo.outputPath(`final-${route.slice(1).replaceAll("/", "-").replaceAll("?", "-").replaceAll("=", "-")}-${theme}-${viewport.width}.png`));
      }
      if (route === "/reports" && viewport.width < 640) {
        const shortcuts = page.getByRole("navigation", { name: "Dashboard shortcuts", exact: true });
        const allApps = shortcuts.getByRole("button", { name: "All apps", exact: true });
        await allApps.click();
        await expect(page.getByLabel("Application sidebar", { exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(allApps).toBeFocused();
        await shortcuts.getByRole("link", { name: "New case", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "Create application", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
      }
    }
    await page.setViewportSize(viewport);
    await page.goto("/applications");
    await page.getByRole("button", { name: "Create application", exact: true }).click();
    const application = page.getByRole("dialog", { name: "Create application", exact: true });
    for (const kind of ["Individual", "Company / Business"]) {
      await application.getByText(kind, { exact: true }).click();
      for (const theme of ["light", "dark"] as const) {
        await setVisualTheme(page, theme);
        await captureViewport(page, testInfo.outputPath(`application-editor-${kind === "Individual" ? "individual" : "company"}-${theme}-${viewport.width}.png`));
      }
    }
    // Existing native required fields reject submission without a POST.
    let submitted = false;
    const watchSubmission = (request: import("@playwright/test").Request) => {
      if (request.method() === "POST" && request.url() === `${api}/api/v1/applications`) submitted = true;
    };
    page.on("request", watchSubmission);
    await application.getByRole("button", { name: "Create application", exact: true }).click();
    await expect.poll(() => application.locator("input:invalid").count()).toBeGreaterThan(0);
    expect(submitted).toBe(false);
    page.off("request", watchSubmission);
    await captureViewport(page, testInfo.outputPath(`application-required-validation-${viewport.width}.png`));
    await page.keyboard.press("Escape");
    await expect(application).toHaveCount(0);
    await page.getByLabel("Search applications", { exact: true }).fill("FIGMA-V2-NO-MATCH-20260917");
    const emptyRegion = viewport.width < 1280 ? page.getByLabel("Application cards", { exact: true }) : page.getByTestId("applications-table-scroll-region");
    await expect(emptyRegion.getByText("No records match the selected filters", { exact: true })).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      await setVisualTheme(page, theme);
      await captureViewport(page, testInfo.outputPath(`applications-real-empty-${theme}-${viewport.width}.png`));
    }
    await page.route(`${api}/api/v1/reports/dashboard**`, route => route.abort("failed"));
    await page.goto("/reports");
    await expect(page.locator('main [role="alert"]').first()).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      await setVisualTheme(page, theme);
      await captureViewport(page, testInfo.outputPath(`dashboard-network-error-${theme}-${viewport.width}.png`));
    }
    await page.unrouteAll({ behavior: "wait" });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(`${api}/api/v1/reports/dashboard**`, async route => {
      const response = await route.fetch();
      await held;
      await route.fulfill({ response });
    });
    try {
      await page.goto("/reports");
      await expect(page.getByTestId("dashboard-loading-skeleton")).toBeVisible();
      for (const theme of ["light", "dark"] as const) {
        await setVisualTheme(page, theme);
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
        await page.screenshot({ path: testInfo.outputPath(`dashboard-held-real-loading-${theme}-${viewport.width}.png`), animations: "disabled" });
      }
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
    await expect(page.getByTestId("dashboard-kpi-grid")).toBeVisible();
  }
});
