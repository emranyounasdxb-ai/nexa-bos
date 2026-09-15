import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { selectBrandedOption } from "./helpers/select";
import { setVisualTheme } from "./helpers/viewport-capture";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

async function ensureOwner(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  if (!((await status.json()) as { available: boolean }).available) return;
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
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 30_000 });
}

async function expectNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
}

async function expectPlaceholderFits(input: Locator) {
  expect(await input.evaluate((element: HTMLInputElement) => {
    const style = getComputedStyle(element);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.font = style.font;
    const available = element.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
    return context.measureText(element.placeholder).width <= available;
  })).toBeTruthy();
}

test("PRO compliance renders only the filtered current page", async ({ page, request }) => {
  await signIn(page, request);
  const compliance = Array.from({ length: 26 }, (_, index) => {
    const number = index + 1;
    const documentStatus = number % 3 === 0 ? "Expired" : number % 2 === 0 ? "Missing" : "Active";
    return {
      employeeId: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
      employee: `Compliance Employee ${String(number).padStart(2, "0")}`,
      documents: {
        passport: { status: documentStatus, documentId: null, expiryDate: null },
        visa: { status: "Active", documentId: null, expiryDate: null },
      },
    };
  });
  await page.route("**/api/v1/employee-profiles/dashboards/pro?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const query = (params.get("q") ?? "").toLocaleLowerCase();
    const status = params.get("status") ?? "";
    const pageNumber = Number(params.get("page") ?? "1");
    const pageSize = Number(params.get("pageSize") ?? "10");
    const filtered = compliance.filter((row) =>
      (!query || row.employee.toLocaleLowerCase().includes(query))
      && (!status || Object.values(row.documents).some((document) => document.status === status)),
    );
    const start = (pageNumber - 1) * pageSize;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-09-14T00:00:00Z",
        cards: { totalEmployees: 26, documentsActive: 35, expiringSoon: 0, expired: 8, pendingDocuments: 9 },
        compliance: filtered.slice(start, start + pageSize),
        compliancePagination: {
          page: pageNumber,
          pageSize,
          total: filtered.length,
          totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
        },
        expiry: { within7: [], within30: [], within60: [], expired: [] },
      }),
    });
  });

  for (const theme of ["light", "dark"] as const) {
    await setVisualTheme(page, theme);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/pro");
      const list = page.getByTestId("employee-compliance-list");
      await expect(list.getByRole("article")).toHaveCount(10);
      await expect(page.getByText("26 matching employees", { exact: true })).toBeVisible();
      await expectNoPageOverflow(page);
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByTestId("employee-compliance-list").getByRole("article")).toHaveCount(10);
  await expect(page.getByRole("link", { name: "Compliance Employee 11", exact: true })).toBeVisible();
  await page.getByLabel("Search employee compliance").fill("Compliance Employee 26");
  await expect(page.getByTestId("employee-compliance-list").getByRole("article")).toHaveCount(1);
  await expect(page.getByText("1 matching employee", { exact: true })).toBeVisible();
  await page.getByLabel("Search employee compliance").fill("");
  await selectBrandedOption(page.getByRole("combobox", { name: "Compliance status" }), "Expired");
  await expect(page.getByTestId("employee-compliance-list").getByRole("article")).toHaveCount(8);
  await expect(page.getByText("8 matching employees", { exact: true })).toBeVisible();
});

test("audited desktop fields remain readable and responsive fallbacks avoid page overflow", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);
  await page.route("**/api/v1/targets/kpi", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [], metrics: [] }) });
  });

  for (const theme of ["light", "dark"] as const) {
    await setVisualTheme(page, theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/users");
    const table = page.getByTestId("users-directory-table");
    await expect(table).toBeVisible();
    const nationality = table.getByRole("columnheader", { name: "Nationality", exact: true });
    const joining = table.getByRole("columnheader", { name: "Joining", exact: true });
    expect(await Promise.all([nationality.boundingBox(), joining.boundingBox()]).then(([left, right]) => right!.x - (left!.x + left!.width))).toBeGreaterThanOrEqual(0);
    expect(await table.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
    await expectNoPageOverflow(page);

    await page.goto("/reports/compare");
    const periodPair = page.getByRole("combobox", { name: "Period pair" });
    await expect(periodPair).toContainText("Current Month vs Previous Month");
    expect(await periodPair.locator("span.truncate").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
    await expectNoPageOverflow(page);

    await page.goto("/applications");
    await expectPlaceholderFits(page.getByLabel("Created Date"));
    await expectNoPageOverflow(page);

    await page.goto("/customers");
    await expectPlaceholderFits(page.getByLabel("Search customers", { exact: true }));
    await expectNoPageOverflow(page);

    await page.goto("/targets/kpi");
    const emptyMessage = page.getByText("No KPI scorecards are configured.", { exact: true });
    const createButton = page.getByRole("button", { name: "Create scorecard", exact: true }).last();
    await expect(emptyMessage).toBeVisible();
    const [messageBox, buttonBox] = await Promise.all([emptyMessage.boundingBox(), createButton.boundingBox()]);
    expect(buttonBox!.y - (messageBox!.y + messageBox!.height)).toBeGreaterThanOrEqual(12);
    await expectNoPageOverflow(page);
  }

  for (const theme of ["light", "dark"] as const) {
    await setVisualTheme(page, theme);
    await page.setViewportSize({ width: 1363, height: 900 });
    await page.goto("/users");
    await expect(page.getByTestId("users-directory-table")).toBeHidden();
    await expect(page.locator("article").first()).toBeVisible();
    await expectNoPageOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/users", "/reports/compare", "/applications", "/customers", "/targets/kpi"]) {
      await page.goto(path);
      await expectNoPageOverflow(page);
    }
    const mobilePeriodPair = page.getByRole("combobox", { name: "Period pair" });
    await page.goto("/reports/compare");
    await expect(mobilePeriodPair).toContainText("Current Month vs Previous Month");
    expect(await mobilePeriodPair.locator("span.truncate").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  }
});
