import { expect as baseExpect, test, type APIRequestContext, type Page } from "@playwright/test";
import { captureViewportThemes } from "./helpers/viewport-capture";

// Each route can compile on first navigation in the repository's development server.
const expect = baseExpect.configure({ timeout: 30_000 });

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
  await expect(page.getByRole("heading", { name: "Welcome Back" })).toBeVisible();
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function openGroup(page: Page, label: string) {
  const parent = page.getByRole("button", { name: `${label} menu` });
  if ((await parent.getAttribute("aria-expanded")) !== "true") {
    await parent.click();
  }
  await expect(parent).toHaveAttribute("aria-expanded", "true");
}

async function expectCompactShell(page: Page, title: string) {
  const content = page.getByTestId("authenticated-content");
  const header = content.getByTestId("page-header");
  const main = content.locator(":scope > main");
  const breadcrumb = header.getByRole("navigation", { name: "Breadcrumb" });
  await expect(header.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(title);
  await expect(breadcrumb.locator('a[href="#"], a:not([href])')).toHaveCount(0);
  await expect(header.getByRole("link", { name: /Notifications, \d+ unread/ })).toHaveCount(0);
  await expect(header.getByLabel("Open user menu")).toHaveCount(0);
  const [headerBox, mainBox, firstContentBox] = await Promise.all([
    header.boundingBox(), main.boundingBox(), main.locator(":scope > *").first().boundingBox(),
  ]);
  expect(headerBox).not.toBeNull();
  expect(mainBox).not.toBeNull();
  expect(firstContentBox).not.toBeNull();
  const largeDesktopHeader = page.viewportSize()!.width >= 1280 && ["Asset Register", "Asset Categories"].includes(title);
  if (largeDesktopHeader) expect(headerBox!.height).toBe(128); // Approved asset-frame header.
  else expect(headerBox!.height).toBeLessThanOrEqual(page.viewportSize()!.width < 640 ? 90 : 100);
  expect(mainBox!.y - (headerBox!.y + headerBox!.height)).toBeGreaterThanOrEqual(-1);
  expect(firstContentBox!.y - (headerBox!.y + headerBox!.height)).toBeLessThanOrEqual(largeDesktopHeader ? 20 : 16);
  expect(firstContentBox!.y - (headerBox!.y + headerBox!.height)).toBeGreaterThanOrEqual(0);
  const trigger = page.getByRole("navigation", { name: "Mobile navigation", exact: true }).getByRole("button", { name: "More navigation" });
  if (page.viewportSize()!.width < 640) {
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(Math.abs(triggerBox!.width - (page.viewportSize()!.width - 24) / 5)).toBeLessThanOrEqual(1);
    expect(Math.abs(triggerBox!.height - 44)).toBeLessThanOrEqual(1);
  } else {
    await expect(trigger).toBeHidden();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

test("mobile sidebar Escape and close button restore focus and exclude closed controls", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, request);
  const sidebar = page.locator('aside[aria-label="Application sidebar"]');
  const trigger = page.getByRole("navigation", { name: "Mobile navigation", exact: true }).getByRole("button", { name: "More navigation" });
  const close = sidebar.getByRole("button", { name: "Close navigation" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const expectClosed = async () => {
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar).toHaveJSProperty("inert", true);
    await expect(trigger).toBeFocused();
    // Even explicit focus attempts must not reach off-screen controls.
    const focusStayedOutside = await sidebar.evaluate((element) => {
      for (const control of element.querySelectorAll<HTMLElement>("a, button, [tabindex]")) {
        control.focus();
        if (element.contains(document.activeElement)) return false;
      }
      return true;
    });
    expect(focusStayedOutside).toBe(true);
    await page.keyboard.press("Tab");
    expect(await sidebar.evaluate((element) => element.contains(document.activeElement))).toBe(false);
    await expect(sidebar.getByRole("link", { name: /Notifications, \d+ unread/ })).toHaveCount(0);
    await expect(sidebar.getByLabel("Open user menu")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  };

  await expect(sidebar).toHaveJSProperty("inert", true);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar).toHaveJSProperty("inert", false);
    await expect(close).toBeFocused();
    const operations = sidebar.getByRole("button", { name: "Cases menu" });
    await operations.focus();
    await expect(operations).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(operations).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("dialog", { name: "Cases", exact: true }).getByRole("link", { name: "Applications", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(operations).toBeFocused();
    await page.keyboard.press("Escape");
    await expectClosed();

    await trigger.click();
    await expect(close).toBeFocused();
    await close.click();
    await expectClosed();
    await expect(sidebar.getByRole("button", { name: "Cases menu", includeHidden: true })).toHaveAttribute("aria-expanded", "false");
  }

  await trigger.click();
  await sidebar.getByRole("button", { name: "Cases menu" }).click();
  const applications = page.getByRole("dialog", { name: "Cases", exact: true }).getByRole("link", { name: "Applications", exact: true });
  await applications.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/applications$/);
  await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
  await expectClosed();
  expect(errors).toEqual([]);
});

test("navigation keyboard focus remains usable across desktop, tablet and mobile", async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1120 });
  await signIn(page, request);
  const sidebar = page.getByLabel("Application sidebar", { exact: true });
  const primary = page.getByRole("navigation", { name: "Primary", exact: true });
  const tablet = page.getByRole("navigation", { name: "Tablet navigation", exact: true });
  const trigger = page.getByRole("navigation", { name: "Mobile navigation", exact: true }).getByRole("button", { name: "More navigation", exact: true });
  await expect(sidebar).toBeHidden();
  await primary.getByRole("link", { name: "Dashboard", exact: true }).focus();
  await page.setViewportSize({ width: 1194, height: 834 });
  await expect(tablet).toBeVisible();
  await expect(tablet).toHaveCSS("width", "96px");
  await expect.poll(() => tablet.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await expect(trigger).toBeHidden();
  await page.setViewportSize({ width: 393, height: 852 });
  await expect(sidebar).toHaveJSProperty("inert", true);
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(sidebar.getByRole("button", { name: "Close navigation" })).toBeFocused();
  await expect(sidebar).toHaveCSS("width", "340px");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1120 });
  await expect.poll(() => primary.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await primary.getByRole("link", { name: "Dashboard", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(primary.getByRole("button", { name: "Cases menu", exact: true })).toBeFocused();
  const appearance = page.getByRole("banner").getByRole("group", { name: "Appearance", exact: true });
  if (await page.locator("html").getAttribute("data-theme") === "dark") {
    await appearance.getByRole("button", { name: "Light theme", exact: true }).click();
  }
  await appearance.getByRole("button", { name: "Dark theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await appearance.getByRole("button", { name: "Light theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("compact shared header and permitted breadcrumbs align existing workspaces on desktop and mobile", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page, request);
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const workspace of [
      { path: "/applications", title: "Applications" },
      { path: "/organization", title: "Organization masters" },
      { path: "/targets", title: "Targets" },
      { path: "/assets", title: "Asset Register" },
      { path: "/account", title: "My profile" },
    ]) {
      await page.goto(workspace.path);
      await expectCompactShell(page, workspace.title);
      await expect(breadcrumb.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute("href", "/reports");
      await expect(breadcrumb.getByRole("link", { name: workspace.title, exact: true })).toHaveCount(0);
    }
    for (const workspace of [
      { path: "/organization/hierarchy", title: "Organization hierarchy", parent: "Organization", parentPath: "/organization", parentTitle: "Organization masters" },
      { path: "/targets/kpi", title: "KPI scorecards", parent: "Targets", parentPath: "/targets", parentTitle: "Targets" },
      { path: "/assets/categories", title: "Asset Categories", parent: "Assets", parentPath: "/assets", parentTitle: "Asset Register" },
    ]) {
      await page.goto(workspace.path);
      await expectCompactShell(page, workspace.title);
      const parent = breadcrumb.getByRole("link", { name: workspace.parent, exact: true });
      await expect(parent).toHaveAttribute("href", workspace.parentPath);
      await parent.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(url => url.pathname === workspace.parentPath);
      if (workspace.parentPath === "/organization") await expect(page).toHaveURL(/tab=offices/);
      await expectCompactShell(page, workspace.parentTitle);
    }
    if (viewport.width < 640) await page.getByRole("navigation", { name: "Mobile navigation", exact: true }).getByRole("link", { name: "Home", exact: true }).click();
    else await breadcrumb.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expectCompactShell(page, "Dashboard");
    await expect(breadcrumb.getByRole("link")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`shared-compact-shell-${viewport.width}.png`), animations: "disabled" });
  }
});

test("owner can log in, navigate major screens, sign out, and log in again", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  await signIn(page, request);
  await openGroup(page, "People & HR");
  await page.locator("#workspace-submenu, nav[aria-label=Primary]").getByRole("link", { name: "Users", exact: true }).click();
  await expect(page.getByRole("link", { name: "Platform Owner", exact: true })).toBeVisible();
  await expect(page.getByLabel("Authenticator code")).toHaveCount(0);

  await openGroup(page, "Cases");
  await page.locator("#workspace-submenu, nav[aria-label=Primary]").getByRole("link", { name: "Customers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();

  await openGroup(page, "Cases");
  await page.locator("#workspace-submenu, nav[aria-label=Primary]").getByRole("link", { name: "Applications", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Applications" })).toBeVisible();

  await openGroup(page, "Operations");
  await page.locator("#workspace-submenu, nav[aria-label=Primary]").getByRole("link", { name: "Workflows" }).click();
  await expect(page.getByRole("heading", { name: "Workflow Designer" })).toBeVisible();

  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

  await openGroup(page, "Reports");
  await page.locator("#workspace-submenu, nav[aria-label=Primary]").getByRole("link", { name: "Comparison Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Comparisons" })).toBeVisible();

  await openGroup(page, "People & HR");
  await page.locator("#workspace-submenu, nav[aria-label=Primary]").getByRole("link", { name: "Attendance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();

  await openGroup(page, "Performance");
  await page.locator("#workspace-submenu, nav[aria-label=Primary]").getByRole("link", { name: "Targets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Targets" })).toBeVisible();

  await openGroup(page, "Finance");
  await page.locator("#workspace-submenu, nav[aria-label=Primary]").getByRole("link", { name: "Finance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible({ timeout: 30_000 });

  await expect(page.getByRole("link", { name: "Notifications", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: /Notifications, \d+ unread/ }).click();
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace pages" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Banks & products", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Designations", exact: true })).toHaveCount(0);

  await openGroup(page, "Operations");
  await page.locator("#workspace-submenu, nav[aria-label=Primary]").getByRole("link", { name: "Asset Register", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Asset Register" })).toBeVisible();

  await openGroup(page, "Administration");
  await page.locator("#workspace-submenu, nav[aria-label=Primary]").getByRole("link", { name: "Designations" }).click();
  await expect(page.getByRole("heading", { name: "Designations", exact: true })).toBeVisible();

  await openGroup(page, "People & HR");
  await page.locator("#workspace-submenu, nav[aria-label=Primary]").getByRole("link", { name: "Organization" }).click();
  await expect(page.getByRole("heading", { name: "Organization masters" })).toBeVisible();

  await openGroup(page, "People & HR");
  await page.locator("#workspace-submenu, nav[aria-label=Primary]").getByRole("link", { name: "Hierarchy", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Organization hierarchy" })).toBeVisible();

  await openGroup(page, "Administration");
  await page.locator("#workspace-submenu, nav[aria-label=Primary]").getByRole("link", { name: "Banks & products" }).click();
  await expect(page.getByRole("heading", { name: "Banks and products" })).toBeVisible();

  await openGroup(page, "Administration");
  await page.locator("#workspace-submenu, nav[aria-label=Primary]").getByRole("link", { name: "Security" }).click();
  await expect(page).toHaveURL(/\/security/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Security settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Open user menu").click();
  await page.getByRole("menu", { name: "User account" }).getByRole("menuitem", { name: "My profile" }).click();
  await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();

  await page.getByLabel("Open user menu").click();
  const signOut = page.getByRole("menu", { name: "User account" }).getByRole("menuitem", { name: "Sign out" });
  await signOut.waitFor({ state: "visible" });
  await signOut.click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Welcome Back" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();

  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByLabel("Authenticator code")).toHaveCount(0);
});

test("profile photo uses the accessible shared image picker without uploading on selection", async ({
  page,
  request,
}, testInfo) => {
  await signIn(page, request);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "My profile", exact: true })).toBeVisible();
  const photoInput = page.getByLabel("Profile photo", { exact: true });
  const photoPicker = page.locator('[data-file-picker]').filter({ has: photoInput });
  await expect(photoPicker.getByRole("button", { name: "Choose image", exact: true })).toBeVisible();
  await expect(photoPicker.getByText("PNG, JPEG, or WebP. Maximum 2 MB.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload photo", exact: true })).toBeDisabled();
  await photoInput.setInputFiles({
    name: "profile-preview.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M/wHwAEAQH/cetH5QAAAABJRU5ErkJggg==", "base64"),
  });
  await expect(photoPicker.getByText("profile-preview.png", { exact: true })).toBeVisible();
  await expect(photoPicker.getByRole("img", { name: "Selected preview for profile-preview.png" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload photo", exact: true })).toBeEnabled();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await captureViewportThemes(page, testInfo.outputPath(`profile-photo-picker-${viewport.width}.png`), photoPicker);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
  await photoPicker.getByRole("button", { name: "Clear selected file for Profile photo" }).click();
  await expect(photoPicker.getByText("No file selected", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload photo", exact: true })).toBeDisabled();
});

test("approved AMAFH CORE branding is used across public and responsive authenticated shells", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  await ensureOwner(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await page.getByRole("button", { name: "Light theme", exact: true }).click();

  await expect(page).toHaveTitle("AMAFH CORE");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "AMAFH CORE business operations workspace",
  );
  await expect(page.getByRole("img", { name: "AMAFH CORE" })).toHaveAttribute(
    "src",
    "/brand/amafh-core-full-logo-exact.svg",
  );
  await expect(page.getByRole("heading", { name: "Welcome Back", exact: true })).toBeVisible();
  await expect(page.getByText(/NEXA BOS/i)).toHaveCount(0);

  const iconHrefs = await page.locator('link[rel="icon"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute("href") ?? ""),
  );
  const appleHref = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  for (const expectedIcon of ["/favicon.ico", "/icon.svg", "/icon1.png", "/icon2.png"]) {
    expect(iconHrefs.some((href) => href.includes(expectedIcon))).toBeTruthy();
  }
  expect(appleHref).toContain("/apple-icon.png");
  for (const assetUrl of [
    "/brand/amafh-core-full-logo-exact.svg",
    ...iconHrefs,
    appleHref!,
  ]) {
    const response = await page.request.get(assetUrl);
    expect(response.ok()).toBeTruthy();
  }


  async function verifyLogoThemes(surface: string) {
    if (surface === "workspace") await expect(page.getByTestId("dashboard-overview")).toBeVisible();
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const theme of ["light", "dark"] as const) {
        const accountAppearance = surface === "workspace" && viewport.width < 1280;
        if (accountAppearance) await page.getByLabel("Open user menu", { exact: true }).click();
        if (surface !== "workspace" || accountAppearance || await page.locator("html").getAttribute("data-theme") !== theme) await (accountAppearance ? page.getByRole("menu", { name: "User account" }) : page).getByRole("button", { name: `${theme === "light" ? "Light" : "Dark"} theme`, exact: true }).click();
        if (accountAppearance) await page.keyboard.press("Escape");
        if (surface === "workspace" && viewport.width < 640) {
          await expect(page.getByRole("link", { name: "Back to workspace", exact: true })).toBeVisible();
          await expect(page.getByRole("link", { name: "AMAFH CORE home", exact: true })).toBeHidden();
          await page.screenshot({ path: testInfo.outputPath(`brand-${surface}-${theme}-${viewport.width}.png`), animations: "disabled" });
          continue;
        }
        const logo = page.locator('.amafh-full-logo img:visible');
        await expect(logo).toHaveAttribute("src", `/brand/amafh-core-full-logo-${surface === "workspace" || theme === "dark" ? "dark" : "exact"}.svg`);
        await expect(logo).toBeVisible();
        await expect(logo).toHaveJSProperty("complete", true);
        expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
        const box = await logo.boundingBox();
        expect(box).not.toBeNull();
        if (surface === "public") expect(box!.width / box!.height).toBeCloseTo(1551 / 479, 1);
        else {
          const brandArea = (await page.getByRole("link", { name: "AMAFH CORE home", exact: true }).boundingBox())!;
          // The centered header uses the official logo's measured native width.
          expect(brandArea.width).toBeCloseTo(103.609375, 1); expect(brandArea.height).toBe(32);
          expect(box!.height).toBe(32);
          expect(box!.width / box!.height).toBeCloseTo(1551 / 479, 1);
        }
        if (surface === "workspace") {
          if (viewport.width === 390) await page.getByRole("navigation", { name: "Mobile navigation", exact: true }).getByRole("button", { name: "More navigation" }).click();
          await expect(page.getByLabel("Application sidebar").locator("img")).toHaveAttribute("src", "/brand/amafh-core-mark-exact.svg");
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
        await page.screenshot({ path: testInfo.outputPath(`brand-${surface}-${theme}-${viewport.width}.png`), animations: "disabled" });
        if (surface === "workspace" && viewport.width === 390) {
          await page.keyboard.press("Escape");
          await page.screenshot({ path: testInfo.outputPath(`brand-workspace-closed-${theme}-390.png`), animations: "disabled" });
        }
      }
      if (surface === "workspace" && viewport.width === 390) await page.keyboard.press("Escape");
    }
  }
  await verifyLogoThemes("public");
  await page.setViewportSize({ width: 1440, height: 900 });

  await signIn(page, request);
  const sidebar = page.getByLabel("Application sidebar");
  if (await page.locator("html").getAttribute("data-theme") !== "light") await page.getByRole("button", { name: "Light theme", exact: true }).click();
  const home = page.getByRole("link", { name: "AMAFH CORE home" });
  await expect(sidebar).toBeHidden();
  await expect(sidebar.locator("img")).toHaveAttribute("src", "/brand/amafh-core-mark-exact.svg");
  await expect(home).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(home.locator("img:visible")).toHaveCount(1);
  await expect(home.locator('img:visible')).toBeVisible();

  await home.hover();
  await expect(sidebar).toBeHidden();
  await expect(home).toHaveAccessibleName("AMAFH CORE home");

  await page.mouse.move(1200, 700);
  await expect(sidebar).toBeHidden();
  await expect(sidebar.locator("img")).toHaveAttribute("src", "/brand/amafh-core-mark-exact.svg");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("navigation", { name: "Mobile navigation", exact: true }).getByRole("button", { name: "More navigation" }).click();
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveCSS("width", "340px");
  await expect(sidebar.locator("img")).toHaveAttribute("src", "/brand/amafh-core-mark-exact.svg");
  await expect(home).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Back to workspace", exact: true })).toBeVisible();
  await verifyLogoThemes("workspace");
});

test("AMAFH CORE semantic colors drive primary actions, focus, navigation, and surfaces", async ({
  page,
  request,
}) => {
  await ensureOwner(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

  const tokens = await page.evaluate(() => {
    const styles = window.getComputedStyle(document.documentElement);
    return Object.fromEntries(
      [
        "--amafh-primary",
        "--amafh-primary-hover",
        "--amafh-primary-pressed",
        "--amafh-link",
        "--amafh-brand-soft",
        "--amafh-background",
        "--amafh-surface",
        "--amafh-border",
        "--amafh-text",
        "--amafh-text-secondary",
        "--amafh-success",
        "--amafh-warning",
        "--amafh-danger",
        "--amafh-info",
      ].map((name) => [name, styles.getPropertyValue(name).trim().replace(/^#([\da-f])([\da-f])([\da-f])$/i, (_match, r: string, g: string, b: string) => `#${r}${r}${g}${g}${b}${b}`)]),
    );
  });
  expect(tokens).toEqual({
    "--amafh-primary": "#983795",
    "--amafh-primary-hover": "#802d7d",
    "--amafh-primary-pressed": "#692466",
    "--amafh-link": "#983795",
    "--amafh-brand-soft": "#f7edf7",
    "--amafh-background": "#f7f8fb",
    "--amafh-surface": "#ffffff",
    "--amafh-border": "#e1e6f0",
    "--amafh-text": "#192340",
    "--amafh-text-secondary": "#617089",
    "--amafh-success": "#147c5a",
    "--amafh-warning": "#a85300",
    "--amafh-danger": "#b9233b",
    "--amafh-info": "#2c61af",
  });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(247, 248, 251)");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCSS(
    "background-image",
    "none",
  );

  const email = page.getByLabel("Email");
  await email.focus();
  await expect(email).toHaveCSS("outline-color", "rgb(152, 55, 149)");
  await expect(email).toHaveCSS("outline-width", "2px");

  await signIn(page, request);
  const dashboardLink = page
    .getByRole("navigation", { name: "Primary", exact: true })
    .getByRole("link", { name: "Dashboard", exact: true });
  await expect(dashboardLink).toHaveCSS("background-color", "rgb(155, 57, 143)");
  await expect(dashboardLink).toHaveCSS("color", "rgb(255, 255, 255)");

  const refresh = page.getByTestId("dashboard-actions").getByRole("button", { name: "Refresh" });
  await expect(refresh).toHaveCSS("background-color", "rgb(152, 55, 149)");
  await expect(refresh).toHaveCSS("color", "rgb(255, 255, 255)");

  const compare = page.getByTestId("dashboard-actions").getByRole("button", { name: "Compare" });
  await expect(compare).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(compare).toHaveCSS("border-color", "rgb(225, 230, 240)");
  await expect(compare).toHaveCSS("color", "rgb(25, 35, 64)");
});
