import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { selectBrandedOption } from "./helpers/select";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

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

async function ownerHeaders(request: APIRequestContext) {
  await ensureOwner(request);
  const login = await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: "owner@example.com", password: "OwnerPass1!" },
  });
  expect(login.ok()).toBeTruthy();
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function signIn(page: Page, request: APIRequestContext) {
  await ensureOwner(request);
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
}

async function seedBoundedLists(request: APIRequestContext) {
  const headers = await ownerHeaders(request);
  const suffix = Date.now().toString(36);

  for (let batch = 0; batch < 7; batch += 1) {
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, offset) => {
        const index = batch * 10 + offset;
        return request.post(`${apiOrigin}/api/v1/user-types`, {
          headers,
          data: {
            name: `Pagination type ${suffix} ${index}`,
            code: `PG_${suffix}_${index}`,
            description: "Task 16.3 bounded-list pagination coverage",
          },
        });
      }),
    );
    for (const response of responses) expect(response.ok()).toBeTruthy();
  }

  const categoryResponses = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      request.post(`${apiOrigin}/api/v1/assets/categories`, {
        headers,
        data: {
          code: `PG_${suffix}_${index}`,
          name: `Pagination category ${index}`,
          description: "Task 16.3 bounded-list pagination coverage",
          fields: [],
        },
      }),
    ),
  );
  for (const response of categoryResponses) expect(response.ok()).toBeTruthy();
}

async function seedServerUsers(request: APIRequestContext) {
  const headers = await ownerHeaders(request);
  const suffix = Date.now().toString(36);
  const designations = await request.get(`${apiOrigin}/api/v1/designations`, { headers });
  expect(designations.ok()).toBeTruthy();
  const designationId = ((await designations.json()) as { items: Array<{ id: string }> }).items[0]?.id;
  expect(designationId).toBeTruthy();
  for (let index = 0; index < 22; index += 1) {
    const response = await request.post(`${apiOrigin}/api/v1/users`, {
      headers,
      data: {
        full_name: `Server pagination ${suffix} ${index.toString().padStart(3, "0")}`,
        employee_code: `PGE2E-${suffix}-${index}`,
        email: `pagination-${suffix}-${index}@example.com`,
        mobile: "+971500000099",
        designation_id: designationId,
        employment_status: "Active",
        joining_date: "2026-02-01",
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  return suffix;
}

test("bounded master lists paginate accessibly with compact responsive rows", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await seedBoundedLists(request);
  await signIn(page, request);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/user-types");
  const pagination = page.getByRole("navigation", { name: "List pagination" });
  await expect(pagination).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await expect(pagination.getByText(/Showing 1–10 of \d+/)).toBeVisible();
  await expect(pagination.getByRole("button", { name: "Previous" })).toBeDisabled();

  await pagination.getByRole("button", { name: "Next" }).click();
  await expect(pagination.getByText(/Showing 11–20 of \d+/)).toBeVisible();
  await selectBrandedOption(pagination.getByLabel("Rows per page"), "25");
  await expect(page.locator("tbody tr")).toHaveCount(25);
  await expect(pagination.getByText(/Showing 1–25 of \d+/)).toBeVisible();
  await selectBrandedOption(pagination.getByLabel("Rows per page"), "50");
  await expect(page.locator("tbody tr")).toHaveCount(50);

  const total = Number((await pagination.textContent())?.match(/of ([\d,]+)/)?.[1]?.replaceAll(",", ""));
  expect(total).toBeGreaterThan(70);
  await selectBrandedOption(pagination.getByLabel("Rows per page"), "all");
  await expect(page.locator("tbody tr")).toHaveCount(total);
  await expect(pagination.getByText(new RegExp(`Showing 1–${total.toLocaleString()} of ${total.toLocaleString()}`))).toBeVisible();

  await selectBrandedOption(pagination.getByLabel("Rows per page"), "10");
  const finalPage = Math.ceil(total / 10);
  await pagination.getByRole("button", { name: `Page ${finalPage}` }).click();
  await expect(pagination.getByRole("button", { name: "Next" })).toBeDisabled();
  await expect(pagination.getByRole("button", { name: "Previous" })).toBeEnabled();

  await page.goto("/assets/categories");
  const categoryPagination = page.getByRole("navigation", { name: "List pagination" });
  await expect(categoryPagination).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  const renameButton = page.getByRole("button", { name: "Rename" }).first();
  await expect(renameButton).toBeVisible();
  expect((await renameButton.boundingBox())?.height ?? 100).toBeLessThanOrEqual(34);

  const firstCellDensity = await page.locator("tbody td").first().evaluate((cell) => {
    const style = window.getComputedStyle(cell);
    return {
      fontSize: style.fontSize,
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
    };
  });
  expect(firstCellDensity).toEqual({ fontSize: "13px", paddingTop: "8px", paddingBottom: "8px" });

  for (const viewport of [
    { width: 900, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBeTruthy();
    await expect(categoryPagination.getByLabel("Rows per page")).toBeVisible();
  }
});

test("large user directory requests only the selected server page", async ({ page, request }) => {
  test.setTimeout(120_000);
  const marker = await seedServerUsers(request);
  const headers = await ownerHeaders(request);
  const apiPage = await request.get(
    `${apiOrigin}/api/v1/users?q=${encodeURIComponent(marker)}&page=1&page_size=10`,
    { headers },
  );
  expect(apiPage.ok(), await apiPage.text()).toBeTruthy();
  const apiPayload = (await apiPage.json()) as {
    items: unknown[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  };
  expect(apiPayload.items).toHaveLength(10);
  expect(apiPayload.pagination).toEqual({ page: 1, pageSize: 10, total: 22, totalPages: 3 });

  await signIn(page, request);
  await page.goto("/users");
  await page.getByLabel("Search users").fill(marker);
  const pagination = page.getByRole("navigation", { name: "List pagination" });
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await expect(pagination.getByText("Showing 1–10 of 22")).toBeVisible();
  await pagination.getByLabel("Rows per page").click();
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(3);
  await expect(page.getByRole("listbox").locator('[role="option"][data-option-value="all"]')).toHaveCount(0);
  await pagination.getByLabel("Rows per page").press("Escape");

  await pagination.getByRole("button", { name: "Next" }).click();
  await expect(pagination.getByText("Showing 11–20 of 22")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(10);

  await page.getByLabel("Search users").fill(`${marker} 00`);
  await expect(pagination.getByText("Showing 1–10 of 10")).toBeVisible();
  await expect(pagination.getByRole("button", { name: "Previous" })).toBeDisabled();

  await page.getByLabel("Search users").fill(marker);
  await selectBrandedOption(pagination.getByLabel("Rows per page"), "25");
  await expect(page.locator("tbody tr")).toHaveCount(22);
  await expect(pagination.getByText("Showing 1–22 of 22")).toBeVisible();
});
