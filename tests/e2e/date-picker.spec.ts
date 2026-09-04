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
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 30_000,
  });
}

function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

test("create user form uses the NEXA BOS date picker", async ({ page, request }) => {
  await signIn(page, request);
  await page.goto("/users/new");
  await expect(page.getByRole("heading", { name: "Create user" })).toBeVisible();
  await expect(page.locator('input[type="date"]')).toHaveCount(0);

  const joining = page.getByLabel("Joining date");
  await joining.fill("2026-03-15");
  await expect(joining).toHaveValue("2026-03-15");
  expect((await joining.boundingBox())?.height).toBe(32);
  await expect(page.getByRole("button", { name: "Open calendar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Calendar", exact: true })).toHaveCount(0);

  await joining.click();
  await expect(page.getByRole("dialog", { name: "Choose date" })).toBeVisible();
  await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: "Previous month" }).click();
  await page.getByRole("button", { name: "Next year" }).click();
  await page.getByRole("button", { name: "Previous year" }).click();
  await page.getByRole("button", { name: "Today" }).click();
  await expect(joining).toHaveValue(todayIso());
  await expect(page.getByRole("dialog", { name: "Choose date" })).toHaveCount(0);

  await joining.press("ArrowDown");
  await expect(page.getByRole("dialog", { name: "Choose date" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Choose date" })).toHaveCount(0);
});

test("invalid typed dates block submit and month navigation keeps a focused day", async ({
  page,
  request,
}) => {
  await signIn(page, request);
  await page.goto("/users/new");
  await expect(page.getByRole("heading", { name: "Create user" })).toBeVisible();

  const joining = page.getByLabel("Joining date");
  await joining.fill("2026-02-31");
  await expect(joining).toHaveAttribute("aria-invalid", "true");
  await expect
    .poll(async () => joining.evaluate((el: HTMLInputElement) => el.checkValidity()))
    .toBe(false);
  await expect
    .poll(async () => joining.evaluate((el: HTMLInputElement) => el.validationMessage))
    .toBe("Enter a valid date as YYYY-MM-DD");

  await joining.fill("2026-03-31");
  await expect(joining).not.toHaveAttribute("aria-invalid", "true");
  await expect
    .poll(async () => joining.evaluate((el: HTMLInputElement) => el.checkValidity()))
    .toBe(true);
  await joining.click();
  await expect(page.getByRole("dialog", { name: "Choose date" })).toBeVisible();
  await expect(page.getByRole("button", { name: "2026-03-31" })).toHaveAttribute("tabindex", "0");
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByText("February 2026")).toBeVisible();
  await expect(page.getByRole("button", { name: "2026-02-28" })).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Choose date" })).toHaveCount(0);

  await joining.fill("2026-03-03");
  await joining.click();
  await expect(page.getByRole("dialog", { name: "Choose date" })).toBeVisible();
  await expect(page.getByRole("button", { name: "2026-03-03" })).toHaveAttribute("tabindex", "0");
  await page.getByRole("button", { name: "2026-03-03" }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByText("February 2026")).toBeVisible();
  await expect(page.getByRole("button", { name: "2026-02-24" })).toHaveAttribute("tabindex", "0");
});

test("application Created Date range uses two months and preserves the focused query field", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);
  await page.goto("/applications");
  await expect(page.getByRole("heading", { name: "Applications" })).toBeVisible();
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open calendar" })).toHaveCount(0);

  const created = page.getByLabel("Created Date", { exact: true });
  const bankSelect = page.getByLabel("Filter by bank", { exact: true });
  const apply = page.getByRole("button", { name: "Apply filters", exact: true });

  await expect(page.getByLabel("Submission date", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Bank stage date", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Filter requested min", { exact: true })).toHaveCount(0);
  for (const control of [created, bankSelect, apply]) {
    await expect(control).toBeVisible();
    expect((await control.boundingBox())?.height).toBe(32);
  }

  await created.click();
  const dialog = page.getByRole("dialog", { name: "Choose Created Date range" });
  await expect(dialog).toBeVisible();
  const months = dialog.locator("[data-month]");
  await expect(months).toHaveCount(2);
  const monthKeys = await months.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-month")));
  const [firstYear, firstMonth] = monthKeys[0]!.split("-").map(Number);
  const expectedSecond = new Date(firstYear, firstMonth, 1);
  expect(monthKeys[1]).toBe(
    `${expectedSecond.getFullYear()}-${String(expectedSecond.getMonth() + 1).padStart(2, "0")}`,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBeTruthy();

  const firstDateButton = months.nth(0).locator('button[aria-label^="20"]').nth(4);
  const secondDateButton = months.nth(1).locator('button[aria-label^="20"]').nth(9);
  const createdFrom = (await firstDateButton.getAttribute("aria-label"))!;
  const createdTo = (await secondDateButton.getAttribute("aria-label"))!;
  await firstDateButton.click();
  await expect(dialog.getByText("Choose the To date")).toBeVisible();
  await secondDateButton.click();
  await expect(dialog).toHaveCount(0);
  await expect(created).toHaveValue(`${createdFrom} – ${createdTo}`);

  await created.click();
  await expect(dialog.locator('[data-range-state="start"]')).toHaveAttribute("aria-label", createdFrom);
  await expect(dialog.locator('[data-range-state="end"]')).toHaveAttribute("aria-label", createdTo);
  expect(await dialog.locator('[data-range-state="middle"]').count()).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  const filteredRequest = page.waitForRequest((candidate) => {
    const url = new URL(candidate.url());
    return (
      url.pathname === "/api/v1/applications" &&
      url.searchParams.get("created_from") === createdFrom &&
      url.searchParams.get("created_to") === createdTo
    );
  });
  await apply.click();
  const requestUrl = new URL((await filteredRequest).url());
  expect(requestUrl.searchParams.get("submission_from")).toBeNull();
  expect(requestUrl.searchParams.get("bank_stage_from")).toBeNull();

  await created.click();
  await dialog.getByRole("button", { name: "Clear range" }).click();
  await expect(created).toHaveValue("");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBeTruthy();
});

test("application filters use the compact responsive grid without resizing controls", async ({
  page,
  request,
}) => {
  await signIn(page, request);
  await page.goto("/applications");
  await expect(page.getByRole("heading", { name: "Applications" })).toBeVisible();

  const filters = page.getByTestId("application-filters");
  const layouts = [
    { width: 1824, height: 1000, columns: 6, maxCardHeight: 300 },
    { width: 1440, height: 900, columns: 6, maxCardHeight: 160 },
    { width: 390, height: 844, columns: 1, maxCardHeight: 520 },
  ];

  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await expect
      .poll(() =>
        filters.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
      )
      .toBe(layout.columns);

    const metrics = await filters.evaluate((element) => {
      const formRect = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll<HTMLElement>("input, select, button")];
      return {
        cardHeight: formRect.height,
        controlHeights: controls.map((control) => control.getBoundingClientRect().height),
        childrenFit: [...element.children].every((child) => {
          const rect = child.getBoundingClientRect();
          return rect.left >= formRect.left - 1 && rect.right <= formRect.right + 1;
        }),
        pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });

    expect(metrics.cardHeight).toBeLessThan(layout.maxCardHeight);
    expect(metrics.controlHeights.every((height) => height === 32)).toBeTruthy();
    expect(metrics.childrenFit).toBeTruthy();
    expect(metrics.pageOverflows).toBeFalsy();
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const created = page.getByLabel("Created Date", { exact: true });
  const apply = page.getByRole("button", { name: "Apply filters", exact: true });
  const clear = page.getByRole("button", { name: "Clear filters", exact: true });
  const [createdBox, applyBox, clearBox] = await Promise.all([
    created.boundingBox(),
    apply.boundingBox(),
    clear.boundingBox(),
  ]);
  expect(createdBox).not.toBeNull();
  expect(applyBox).not.toBeNull();
  expect(clearBox).not.toBeNull();
  expect(Math.abs(createdBox!.y + createdBox!.height - (applyBox!.y + applyBox!.height))).toBeLessThanOrEqual(1);
  expect(Math.abs(applyBox!.y - clearBox!.y)).toBeLessThanOrEqual(1);
});
