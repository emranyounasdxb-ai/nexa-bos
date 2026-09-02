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
  await expect(page.getByRole("heading", { name: "Sign in to AMAFH CORE" })).toBeVisible();
  await expect(page.getByText("Authenticator challenge is required only when MFA is enabled")).toBeVisible();
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
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

test("owner can log in, navigate major screens, sign out, and log in again", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  await signIn(page, request);
  await openGroup(page, "People");
  await page.getByRole("link", { name: "Users", exact: true }).click();
  await expect(page.getByRole("link", { name: "USR-000001" })).toBeVisible();
  await expect(page.getByLabel("Authenticator code")).toHaveCount(0);

  await openGroup(page, "Operations");
  await page.getByRole("link", { name: "Customers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();

  await openGroup(page, "Operations");
  await page.getByRole("link", { name: "Applications", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Applications" })).toBeVisible();

  await openGroup(page, "Operations");
  await page.getByRole("link", { name: "Workflows" }).click();
  await expect(page.getByRole("heading", { name: "Workflows" })).toBeVisible();

  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await openGroup(page, "Performance");
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Comparisons" })).toBeVisible();

  await openGroup(page, "People");
  await page.getByRole("link", { name: "Attendance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();

  await openGroup(page, "Performance");
  await page.getByRole("link", { name: "Targets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Targets" })).toBeVisible();

  await openGroup(page, "Finance");
  await page.getByRole("link", { name: "Finance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();

  await openGroup(page, "Administration");
  await page.getByRole("link", { name: "Notifications", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();

  await openGroup(page, "Assets");
  await page.getByRole("link", { name: "Assets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Asset Register" })).toBeVisible();

  await openGroup(page, "Administration");
  await page.getByRole("link", { name: "User types" }).click();
  await expect(page.getByRole("heading", { name: "User types" })).toBeVisible();

  await openGroup(page, "People");
  await page.getByRole("link", { name: "Organization" }).click();
  await expect(page.getByRole("heading", { name: "Organization masters" })).toBeVisible();

  await openGroup(page, "People");
  await page.getByRole("link", { name: "Hierarchy", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Organization hierarchy" })).toBeVisible();

  await openGroup(page, "Administration");
  await page.getByRole("link", { name: "Banks & products" }).click();
  await expect(page.getByRole("heading", { name: "Banks and products" })).toBeVisible();

  await openGroup(page, "Administration");
  await page.getByRole("link", { name: "Security" }).click();
  await expect(page).toHaveURL(/\/security/);
  await expect(page.getByRole("heading", { name: "Security settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Open user menu").click();
  await page.getByRole("link", { name: "My profile" }).click();
  await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();

  await page.getByLabel("Open user menu").click();
  const signOut = page.locator("header").getByRole("button", { name: "Sign out" });
  await signOut.waitFor({ state: "visible" });
  await signOut.evaluate((button: HTMLButtonElement) => button.click());
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Sign in to AMAFH CORE" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();

  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByLabel("Authenticator code")).toHaveCount(0);
});

test("approved AMAFH CORE branding is used across public and responsive authenticated shells", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await ensureOwner(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");

  await expect(page).toHaveTitle("AMAFH CORE");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "AMAFH CORE business operations workspace",
  );
  await expect(page.getByRole("img", { name: "AMAFH CORE" })).toHaveAttribute(
    "src",
    "/brand/amafh-core-full-logo-exact.svg",
  );
  await expect(page.getByRole("heading", { name: "Sign in to AMAFH CORE" })).toBeVisible();
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
    "/brand/amafh-core-mark-exact.svg",
    ...iconHrefs,
    appleHref!,
  ]) {
    const response = await page.request.get(assetUrl);
    expect(response.ok()).toBeTruthy();
  }

  await signIn(page, request);
  const sidebar = page.getByLabel("Application sidebar");
  const home = page.getByRole("link", { name: "AMAFH CORE home" });
  await expect(sidebar).toHaveAttribute("data-expanded", "false");
  await expect(home.locator('img[src="/brand/amafh-core-mark-exact.svg"]')).toBeVisible();
  await expect(page.getByText(/NEXA BOS/i)).toHaveCount(0);

  await sidebar.hover();
  await expect(sidebar).toHaveAttribute("data-expanded", "true");
  await expect(home.locator('img[src="/brand/amafh-core-full-logo-exact.svg"]').last()).toBeVisible();

  await page.mouse.move(1200, 700);
  await expect(sidebar).toHaveAttribute("data-expanded", "false");
  await expect(home.locator('img[src="/brand/amafh-core-mark-exact.svg"]')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(sidebar).toBeVisible();
  await expect(home.locator('img[src="/brand/amafh-core-full-logo-exact.svg"]').first()).toBeVisible();
  await expect(page.getByText(/NEXA BOS/i)).toHaveCount(0);
});

test("AMAFH CORE semantic colors drive primary actions, focus, navigation, and surfaces", async ({
  page,
  request,
}) => {
  await ensureOwner(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");

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
      ].map((name) => [name, styles.getPropertyValue(name).trim()]),
    );
  });
  expect(tokens).toEqual({
    "--amafh-primary": "#6f0d83",
    "--amafh-primary-hover": "#570a68",
    "--amafh-primary-pressed": "#430750",
    "--amafh-link": "#4c56d7",
    "--amafh-brand-soft": "#f7ecf8",
    "--amafh-background": "#f6f7fa",
    "--amafh-surface": "#fff",
    "--amafh-border": "#ddd8e5",
    "--amafh-text": "#1e1e1e",
    "--amafh-text-secondary": "#5f5b6b",
    "--amafh-success": "#15805d",
    "--amafh-warning": "#9a5a00",
    "--amafh-danger": "#c93646",
    "--amafh-info": "#3d5bd9",
  });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 247, 250)");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCSS(
    "background-color",
    "rgb(111, 13, 131)",
  );

  const email = page.getByLabel("Email");
  await email.focus();
  await expect(email).toHaveCSS("outline-color", "rgb(111, 13, 131)");
  await expect(email).toHaveCSS("outline-width", "2px");

  await signIn(page, request);
  const dashboardLink = page
    .getByLabel("Application sidebar")
    .getByRole("link", { name: "Dashboard", exact: true });
  await expect(dashboardLink).toHaveCSS("background-color", "rgb(247, 236, 248)");
  await expect(dashboardLink).toHaveCSS("color", "rgb(111, 13, 131)");

  const refresh = page.getByTestId("dashboard-actions").getByRole("button", { name: "Refresh" });
  await expect(refresh).toHaveCSS("background-color", "rgb(111, 13, 131)");
  await expect(refresh).toHaveCSS("color", "rgb(255, 255, 255)");

  const compare = page.getByTestId("dashboard-actions").getByRole("button", { name: "Compare" });
  await expect(compare).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(compare).toHaveCSS("border-color", "rgb(111, 13, 131)");
  await expect(compare).toHaveCSS("color", "rgb(111, 13, 131)");
});
