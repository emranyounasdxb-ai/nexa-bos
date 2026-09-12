import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { captureViewportPair } from "./helpers/viewport-capture";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

async function ownerHeaders(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  const body = (await status.json()) as { available: boolean };
  if (body.available) {
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
  const login = await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: "owner@example.com", password: "OwnerPass1!" },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function prepareLeave(request: APIRequestContext) {
  const headers = await ownerHeaders(request);
  const working = await request.put(`${apiOrigin}/api/v1/attendance/working-days`, {
    headers,
    data: { weekdays: [0, 1, 2, 3, 4] },
  });
  expect(working.ok(), await working.text()).toBeTruthy();
  const types = await request.get(`${apiOrigin}/api/v1/leave/types`);
  expect(types.ok(), await types.text()).toBeTruthy();
  const annual = ((await types.json()) as { items: Array<{ id: string; code: string }> }).items
    .find((item) => item.code === "ANNUAL");
  expect(annual).toBeTruthy();
  const configured = await request.patch(`${apiOrigin}/api/v1/leave/types/${annual!.id}`, {
    headers,
    data: { yearly_entitlement: 20, half_day_allowed: true },
  });
  expect(configured.ok(), await configured.text()).toBeTruthy();
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 30_000 });
}

test("leave workspace supports keyboard-safe request, balances and URL tabs", async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  await prepareLeave(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/leave");
  await expect(page.getByRole("heading", { name: "Leave management" })).toBeVisible();
  await expect(page.getByText("Annual", { exact: true })).toBeVisible();
  await expect(page.getByText("20", { exact: true })).toBeVisible();
  await captureViewportPair(page, testInfo, "leave-balances");

  const trigger = page.getByRole("button", { name: "Request leave" });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Request leave" })).toBeVisible();
  await expect(page.getByLabel("Employee")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByLabel("Start date").fill("2027-04-05");
  await page.getByLabel("End date").fill("2027-04-06");
  await page.getByLabel("Reason", { exact: true }).fill("Synthetic browser leave request");
  await captureViewportPair(page, testInfo, "leave-request-filled");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText("Leave request submitted for approval.")).toBeVisible();
  await expect(page.getByText("2027-04-05 – 2027-04-06")).toBeVisible();
  await captureViewportPair(page, testInfo, "leave-submitted");
  await captureViewportPair(page, testInfo, "leave-submitted-record", page.getByRole("heading", { name: "My requests", exact: true }));

  const cancelTrigger = page.getByRole("button", { name: "Cancel", exact: true });
  await cancelTrigger.click();
  const cancelDialog = page.getByRole("dialog", { name: "Cancel leave request" });
  await expect(cancelDialog).toBeVisible();
  await expect(page.getByLabel("Cancellation reason")).toBeFocused();
  await captureViewportPair(page, testInfo, "leave-cancellation");
  await page.getByRole("button", { name: "Request cancellation" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close dialog" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Request cancellation" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(cancelTrigger).toBeFocused();

  await page.getByRole("tab", { name: "Team calendar" }).click();
  await expect(page).toHaveURL(/tab=calendar/);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Team calendar" })).toHaveAttribute("aria-selected", "true");
  await captureViewportPair(page, testInfo, "leave-calendar");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("leave workspace is readable without page overflow on mobile", async ({ page, request }) => {
  await prepareLeave(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/leave?tab=settings");
  await expect(page.getByRole("tab", { name: "Leave settings" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Request leave" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
