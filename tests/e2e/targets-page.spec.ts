import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

type TargetOption = { id: string; defaultMeasurement?: string; fullName?: string };

async function expectOk(response: APIResponse) {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response;
}

async function ensureOwner(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  if (!((await status.json()) as { available: boolean }).available) return;
  await expectOk(await request.post(`${apiOrigin}/api/v1/auth/bootstrap`, {
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
  }));
}

async function ownerHeaders(request: APIRequestContext) {
  await ensureOwner(request);
  const login = await expectOk(await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: "owner@example.com", password: "OwnerPass1!" },
  }));
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Dashboard|User directory/ })).toBeVisible({
    timeout: 30_000,
  });
}

async function seedTarget(request: APIRequestContext, month: string) {
  const headers = await ownerHeaders(request);
  const optionsResponse = await expectOk(await request.get(`${apiOrigin}/api/v1/targets/options`));
  const options = (await optionsResponse.json()) as {
    employees: TargetOption[];
    products: TargetOption[];
  };
  const employee = options.employees.find((item) => item.fullName === "Platform Owner") ?? options.employees[0];
  const product = options.products[0];
  if (!employee || !product) throw new Error("Disposable target options were not available.");
  await expectOk(await request.post(`${apiOrigin}/api/v1/targets`, {
    headers,
    data: {
      level: "employee",
      entity_id: employee.id,
      period_month: month,
      product_id: product.id,
      bank_id: null,
      milestone: "submitted",
      measurement: product.defaultMeasurement ?? "amount",
      target_value: "25000",
      prorate: false,
    },
  }));
  return { employee, product };
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBeTruthy();
}

test("Targets workspace keeps URL tabs, compact filters, results, and drawer focus", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const month = "2042-04-01";
  const seeded = await seedTarget(request, month);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/targets");

  await expect(page).toHaveURL(/\/targets\?tab=targets$/);
  await expect(page.getByRole("heading", { name: "Targets", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "KPI scorecards" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create target", exact: true })).toHaveCount(1);
  const tabs = page.getByRole("tablist", { name: "Target workspaces" });
  const targetsTab = tabs.getByRole("tab", { name: "Targets", exact: true });
  await expect(targetsTab).toHaveAttribute("aria-selected", "true");

  const toolbar = page.getByTestId("target-filter-toolbar");
  const level = toolbar.getByLabel("Filter level");
  const resultPeriod = toolbar.getByLabel("Result period");
  const targetMonth = toolbar.getByLabel("Target month filter");
  const refresh = toolbar.getByRole("button", { name: "Refresh results" });
  for (const control of [level, resultPeriod, targetMonth, refresh]) {
    expect((await control.boundingBox())?.height).toBe(32);
  }
  const controlTops = await Promise.all([level, resultPeriod, targetMonth, refresh].map(async (control) => Math.round((await control.boundingBox())?.y ?? -1)));
  expect(new Set(controlTops).size).toBe(1);

  await expect(page.getByText("No targets are in scope for the selected filters.")).toBeVisible();
  await targetMonth.fill(month);
  await targetMonth.press("Enter");
  await expect(page.getByRole("row").filter({ hasText: seeded.employee.fullName ?? "Platform Owner" })).toBeVisible();
  await expect(toolbar.getByText("1 in scope", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Gap / Run-rate" })).toBeVisible();
  const clear = toolbar.getByRole("button", { name: "Clear", exact: true });
  await expect(clear).toBeVisible();
  expect(Math.round((await clear.boundingBox())?.y ?? -1)).toBe(Math.round((await targetMonth.boundingBox())?.y ?? -2));
  await clear.click();
  await expect(targetMonth).toHaveValue("");

  await targetsTab.focus();
  await page.keyboard.press("ArrowRight");
  const periodsTab = tabs.getByRole("tab", { name: "Period Management" });
  await expect(periodsTab).toBeFocused();
  await expect(periodsTab).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\/targets\?tab=periods$/);
  await page.reload();
  await expect(periodsTab).toHaveAttribute("aria-selected", "true");
  await targetsTab.click();
  await expect(page).toHaveURL(/\/targets\?tab=targets$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/targets\?tab=periods$/);
  await expect(periodsTab).toHaveAttribute("aria-selected", "true");

  await targetsTab.click();
  const createTarget = page.getByRole("button", { name: "Create target", exact: true });
  await createTarget.click();
  await expect(page.getByRole("dialog", { name: "Create target" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Create target" })).toHaveCount(0);
  await expect(createTarget).toBeFocused();
  await expectNoHorizontalOverflow(page);
});

test("Period Management uses existing audited lock and reopen lifecycle", async ({ page, request }) => {
  test.setTimeout(120_000);
  const month = "2043-05-01";
  await ownerHeaders(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/targets?tab=periods");

  const toolbar = page.getByTestId("period-control-toolbar");
  const targetMonth = toolbar.getByLabel("Target month");
  await targetMonth.fill(month);
  await targetMonth.press("Enter");
  await expect(toolbar.getByText("Open", { exact: true })).toBeVisible();
  const lock = toolbar.getByRole("button", { name: "Lock month" });
  await lock.click();
  await expect(page.getByRole("dialog", { name: "Confirm period lock" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Confirm period lock" })).toHaveCount(0);
  await expect(lock).toBeFocused();

  await lock.click();
  await page.getByRole("dialog", { name: "Confirm period lock" }).getByRole("button", { name: "Lock month" }).click();
  await expect(page.getByText("Target period locked.")).toBeVisible();
  await expect(toolbar.getByText("Locked", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: month })).toContainText("Locked");

  const listReopen = page.locator(`#reopen-${month}-desktop`);
  await listReopen.click();
  let reopenDialog = page.getByRole("dialog", { name: "Reopen target period" });
  await expect(reopenDialog.getByRole("button", { name: "Reopen month" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(reopenDialog).toHaveCount(0);
  await expect(listReopen).toBeFocused();

  await toolbar.getByRole("button", { name: "Reopen month" }).click();
  reopenDialog = page.getByRole("dialog", { name: "Reopen target period" });
  await reopenDialog.getByLabel("Reopen reason").fill("Disposable UI lifecycle verification");
  await expect(reopenDialog.getByRole("button", { name: "Reopen month" })).toBeEnabled();
  await reopenDialog.getByRole("button", { name: "Reopen month" }).click();
  await expect(page.getByText("Target period reopened.")).toBeVisible();
  await expect(toolbar.getByText("Open", { exact: true })).toBeVisible();
  await expect(page.getByText("No target months are currently locked.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("Targets and Period Management remain readable without mobile overflow", async ({ page, request }) => {
  test.setTimeout(120_000);
  const month = "2044-06-01";
  await seedTarget(request, month);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/targets");

  await page.getByLabel("Target month filter").fill(month);
  await page.getByLabel("Target month filter").press("Enter");
  await expect(page.getByRole("list", { name: "Target results" })).toBeVisible();
  await expect(page.getByTestId("target-results").locator("table")).toBeHidden();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("tab", { name: "Period Management" }).click();
  await expect(page).toHaveURL(/tab=periods/);
  await expect(page.getByTestId("period-control-toolbar")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
