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
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
}

test("page-purpose help and ambiguous field tooltips are accessible without changing data", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);

  const purposeByRoute = new Map([
    ["/reports", "Review application performance, pipeline movement, target progress, and items that may need attention."],
    ["/customers", "Search the customer directory and open records available within your current access scope."],
    ["/applications", "Search and filter applications in your current scope, then open permitted workflow records."],
    ["/users", "Search the user directory and open profiles or administration actions allowed by your permissions."],
    ["/assets", "Individually tracked company Assets and current Office or employee custody."],
    ["/targets", "Plan measurable employee, team, and office outcomes and review authoritative results."],
  ]);

  for (const [route, purpose] of purposeByRoute) {
    await page.goto(route);
    await expect(page.getByTestId("page-purpose")).toHaveText(purpose);
  }

  await page.goto("/finance?tab=payouts");
  const payoutHelp = page.getByRole("button", { name: "About Payout month" });
  await payoutHelp.focus();
  const payoutTooltip = page.getByRole("tooltip");
  await expect(payoutTooltip).toContainText("calendar month whose Finance period");
  await page.keyboard.press("Escape");
  await expect(payoutTooltip).toBeHidden();

  await page.getByRole("tab", { name: "Commission Rules" }).click();
  await page.getByRole("button", { name: "Create commission rule" }).click();
  const sourceHelp = page.getByRole("button", { name: "About Authoritative Source" });
  await sourceHelp.focus();
  const sourceTooltip = page.getByRole("tooltip");
  await expect(sourceTooltip).toContainText("effective-dated application owner");
  await page.keyboard.press("Escape");
  await expect(sourceTooltip).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Create commission rule" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/catalog?tab=rules");
  const requestedHelp = page.getByRole("button", { name: "About Requested amount rule" });
  await requestedHelp.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/finance?tab=payouts");
  await page.getByRole("button", { name: "About Payout month" }).click();
  const mobileTooltip = page.getByRole("tooltip");
  await expect(mobileTooltip).toBeVisible();
  const bounds = await mobileTooltip.boundingBox();
  expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
});
