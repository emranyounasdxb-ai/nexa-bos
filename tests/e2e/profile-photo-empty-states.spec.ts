import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { resolve } from "node:path";

import { captureViewportThemes, setVisualTheme } from "./helpers/viewport-capture";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";
const firstPhoto = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/2c2pWQAAAABJRU5ErkJggg==",
  "base64",
);
const replacementPhoto = resolve(process.cwd(), "public", "brand", "amafh-dubai-banking-login.webp");

async function ensureOwner(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  const body = (await status.json()) as { available: boolean };
  if (!body.available) return;
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
  expect(created.ok(), await created.text()).toBeTruthy();
}

async function signIn(page: Page, request: APIRequestContext) {
  await ensureOwner(request);
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 30_000 });
}

function accountAvatar(page: Page) {
  return page.getByRole("button", { name: "Open user menu" }).locator("[data-profile-photo]");
}

test("saved profile photo replaces immediately and survives refresh, navigation, and re-login", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);
  await page.goto("/account");

  const profileEmail = page.getByText("owner@example.com", { exact: true });
  await expect(profileEmail).toBeVisible();
  expect(await profileEmail.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ["light", "dark"] as const) {
      await setVisualTheme(page, theme);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(profileEmail).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`profile-email-${viewport.width}-${theme}.png`), animations: "disabled" });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await setVisualTheme(page, "light");

  const picker = page.locator('[data-file-picker]').filter({ has: page.getByLabel("Profile photo", { exact: true }) });
  const identityPhoto = page.getByLabel("Profile photo for Platform Owner");
  await page.getByLabel("Profile photo", { exact: true }).setInputFiles({ name: "owner-photo.png", mimeType: "image/png", buffer: firstPhoto });
  await page.getByRole("button", { name: "Upload photo", exact: true }).click();
  await expect(page.getByText("Photo updated", { exact: true })).toBeVisible();
  await expect(identityPhoto.locator("img")).toBeVisible();
  await expect(accountAvatar(page).locator("img")).toBeVisible();
  const firstSource = await identityPhoto.locator("img").getAttribute("src");
  const firstAccountSource = await accountAvatar(page).locator("img").getAttribute("src");
  expect(firstSource).toMatch(/^blob:/);

  await page.getByLabel("Profile photo", { exact: true }).setInputFiles(replacementPhoto);
  await page.getByRole("button", { name: "Upload photo", exact: true }).click();
  await expect(page.getByText("Photo updated", { exact: true })).toBeVisible();
  await expect(identityPhoto.locator("img")).toBeVisible();
  await expect(identityPhoto.locator("img")).not.toHaveAttribute("src", firstSource!);
  await expect(accountAvatar(page).locator("img")).not.toHaveAttribute("src", firstAccountSource!);

  await page.reload();
  await expect(identityPhoto.locator("img")).toBeVisible();
  await expect(accountAvatar(page).locator("img")).toBeVisible();
  await page.goto("/reports");
  await expect(accountAvatar(page).locator("img")).toBeVisible();

  await page.goto("/users");
  const ownerEntry = page.getByRole("row").filter({ hasText: "Platform Owner" });
  await expect(ownerEntry.locator("[data-profile-photo] img")).toBeVisible();

  await page.getByRole("button", { name: "Open user menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await signIn(page, request);
  await expect(accountAvatar(page).locator("img")).toBeVisible();

  await page.goto("/account");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await captureViewportThemes(page, testInfo.outputPath(`saved-profile-photo-${viewport.width}.png`), picker);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});

test("an unavailable saved photo falls back to initials without rendering a broken image", async ({ page, request }) => {
  await page.route("**/api/v1/users/*/photo?*", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "PHOTO_NOT_FOUND", message: "No profile photo" } }) });
  });
  await signIn(page, request);
  await page.goto("/account");
  const identityPhoto = page.getByLabel("Profile photo for Platform Owner");
  await expect(identityPhoto.locator("img")).toHaveCount(0);
  await expect(identityPhoto).toContainText("PO");
  await expect(accountAvatar(page).locator("img")).toHaveCount(0);
  await expect(accountAvatar(page)).toContainText("PO");
  await expect(page.locator('#application-sidebar a[aria-label="My profile"]')).toHaveCount(0);
});

test("My Profile distinguishes unassigned leave from a genuine zero balance and uses compact empty sections", async ({
  page,
  request,
}, testInfo) => {
  await page.route("**/api/v1/approvals/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        balances: [
          { leaveType: { name: "Annual leave" }, entitled: 0, adjustments: 0, used: 0, available: 0, pending: 0 },
          { leaveType: { name: "Sick leave" }, entitled: 10, adjustments: 0, used: 10, available: 0, pending: 0 },
        ],
        requests: [],
        contract: null,
        transfers: [],
        exits: [],
      }),
    });
  });
  await signIn(page, request);
  await page.goto("/account");

  const annual = page.getByRole("listitem").filter({ hasText: "Annual leave" });
  const sick = page.getByRole("listitem").filter({ hasText: "Sick leave" });
  await expect(annual.getByText("Days available", { exact: false })).toBeVisible();
  await expect(annual.getByText("—", { exact: true })).toBeVisible();
  await expect(annual.getByText("Not assigned", { exact: true })).toBeVisible();
  await expect(sick.getByText("0", { exact: true })).toBeVisible();
  await expect(sick).toContainText("None pending");
  await expect(sick).not.toContainText("Not assigned");

  for (const [label, empty] of [
    ["My leave requests", "No requests yet"],
    ["My transfers", "No transfers yet"],
    ["My exits", "No exit records"],
  ] as const) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByText(new RegExp(`^${label} \\(0\\)$`))).toHaveCount(0);
    await page.getByText(label, { exact: true }).click();
    await expect(page.getByText(empty, { exact: true })).toBeVisible();
  }

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await captureViewportThemes(page, testInfo.outputPath(`profile-hr-empty-${viewport.width}.png`), page.getByRole("heading", { name: "My HR requests & contract" }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});
