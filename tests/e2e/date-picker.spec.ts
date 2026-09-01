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

test("application date ranges use two months and preserve existing query fields", async ({
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

  const submission = page.getByLabel("Submission date", { exact: true });
  const bankStage = page.getByLabel("Bank stage date", { exact: true });
  const created = page.getByLabel("Created date", { exact: true });
  const requestedMinimum = page.getByLabel("Filter requested min", { exact: true });
  const bankSelect = page.getByLabel("Filter by bank", { exact: true });
  const apply = page.getByRole("button", { name: "Apply filters", exact: true });

  for (const control of [submission, bankStage, created, requestedMinimum, bankSelect, apply]) {
    await expect(control).toBeVisible();
    expect((await control.boundingBox())?.height).toBe(32);
  }

  await submission.click();
  const dialog = page.getByRole("dialog", { name: "Choose submission date range" });
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
  const submissionFrom = (await firstDateButton.getAttribute("aria-label"))!;
  const submissionTo = (await secondDateButton.getAttribute("aria-label"))!;
  await firstDateButton.click();
  await expect(dialog.getByText("Choose the To date")).toBeVisible();
  await secondDateButton.click();
  await expect(dialog).toHaveCount(0);
  await expect(submission).toHaveValue(`${submissionFrom} – ${submissionTo}`);

  await submission.click();
  await expect(dialog.locator('[data-range-state="start"]')).toHaveAttribute("aria-label", submissionFrom);
  await expect(dialog.locator('[data-range-state="end"]')).toHaveAttribute("aria-label", submissionTo);
  expect(await dialog.locator('[data-range-state="middle"]').count()).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await bankStage.fill("2026-01-01 – 2026-01-31");
  await created.fill("2026-02-01 – 2026-02-28");
  const filteredRequest = page.waitForRequest((candidate) => {
    const url = new URL(candidate.url());
    return (
      url.pathname === "/api/v1/applications" &&
      url.searchParams.get("submission_from") === submissionFrom &&
      url.searchParams.get("submission_to") === submissionTo
    );
  });
  await apply.click();
  const requestUrl = new URL((await filteredRequest).url());
  expect(requestUrl.searchParams.get("bank_stage_from")).toBe("2026-01-01");
  expect(requestUrl.searchParams.get("bank_stage_to")).toBe("2026-01-31");
  expect(requestUrl.searchParams.get("created_from")).toBe("2026-02-01");
  expect(requestUrl.searchParams.get("created_to")).toBe("2026-02-28");

  await submission.click();
  await dialog.getByRole("button", { name: "Clear range" }).click();
  await expect(submission).toHaveValue("");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBeTruthy();
});
