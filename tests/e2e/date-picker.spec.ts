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
  await expect(page.getByRole("heading", { name: "User directory" })).toBeVisible({
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

  await page.getByRole("button", { name: "Open calendar" }).first().click();
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
  await page.getByRole("button", { name: "Open calendar" }).first().click();
  await expect(page.getByRole("dialog", { name: "Choose date" })).toBeVisible();
  await expect(page.getByRole("button", { name: "2026-03-31" })).toHaveAttribute("tabindex", "0");
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByText("February 2026")).toBeVisible();
  await expect(page.getByRole("button", { name: "2026-02-28" })).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Choose date" })).toHaveCount(0);

  await joining.fill("2026-03-03");
  await page.getByRole("button", { name: "Open calendar" }).first().click();
  await expect(page.getByRole("dialog", { name: "Choose date" })).toBeVisible();
  await expect(page.getByRole("button", { name: "2026-03-03" })).toHaveAttribute("tabindex", "0");
  await page.getByRole("button", { name: "2026-03-03" }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByText("February 2026")).toBeVisible();
  await expect(page.getByRole("button", { name: "2026-02-24" })).toHaveAttribute("tabindex", "0");
});

test("optional application date filters open the calendar and can be cleared", async ({
  page,
  request,
}) => {
  await signIn(page, request);
  await page.goto("/applications");
  await expect(page.getByRole("heading", { name: "Applications" })).toBeVisible();
  await expect(page.locator('input[type="date"]')).toHaveCount(0);

  const from = page.getByLabel("Filter submission from");
  await page.getByRole("button", { name: "Open calendar" }).first().click();
  await expect(page.getByRole("dialog", { name: "Choose date" })).toBeVisible();
  await page.getByRole("button", { name: "Today" }).click();
  await expect(from).toHaveValue(todayIso());
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(from).toHaveValue("");
});
