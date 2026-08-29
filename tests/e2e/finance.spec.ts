import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

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

test("Finance exposes only the approved Task 11 workflows and calculation modes", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await signIn(page, request);
  await page.getByRole("link", { name: "Finance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();
  await expect(page.getByLabel("Finance payout month")).toBeVisible();
  await expect(page.getByRole("button", { name: "Excel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "PDF" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
  await expect(page.getByText("CSV", { exact: true })).toHaveCount(0);

  const ruleCard = page.locator("div.rounded-xl").filter({
    has: page.getByRole("heading", { name: "New commission rule version" }),
  });
  await expect(ruleCard).toBeVisible();
  const sharedCalculation = ruleCard.getByLabel("Calculation").first();
  await expect(sharedCalculation.locator("option")).toHaveText([
    "Fixed",
    "Percentage",
    "Single applicable slab",
    "Flat + Percentage",
  ]);
  await sharedCalculation.selectOption("slab");
  await ruleCard.getByRole("button", { name: "Add slab" }).click();
  await expect(ruleCard.getByLabel("Minimum eligible value")).toBeVisible();
  await expect(ruleCard.getByLabel("Maximum eligible value (optional)")).toBeVisible();

  await ruleCard.getByLabel("Payout mode").selectOption("independent_role_rate");
  const roleCalculation = ruleCard.getByLabel("Calculation").first();
  await roleCalculation.selectOption("flat_percentage");
  await expect(ruleCard.getByLabel("Flat amount")).toBeVisible();
  await expect(ruleCard.getByLabel("Rate %")).toBeVisible();
  await expect(ruleCard.getByLabel("Authoritative source")).toHaveValue("case_owner");
  await expect(ruleCard.getByText("Team Leader", { exact: true })).toHaveCount(0);
  await expect(ruleCard.getByText("Designation", { exact: true })).toHaveCount(0);

  const incentiveCard = page.locator("div.rounded-xl").filter({
    has: page.getByRole("heading", { name: "New monthly incentive plan version" }),
  });
  await expect(incentiveCard).toContainText("not progressive");
  await incentiveCard.getByRole("button", { name: "Add slab" }).click();
  await expect(incentiveCard.getByLabel("Minimum production").first()).toBeVisible();
  await expect(incentiveCard.getByRole("button", { name: "Create draft plan version" })).toBeVisible();
});
