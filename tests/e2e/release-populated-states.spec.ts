import { expect, test } from "@playwright/test";
import { captureViewportPair } from "./helpers/viewport-capture";

const api = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;

test("existing disposable contract states and calculated Finance statement remain readable", async ({ page }, testInfo) => {
  test.skip(!process.env.DESIGN_POPULATED_REVIEW, "Requires supported populated fixtures in an identity-verified disposable preview");
  test.setTimeout(300_000);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Open user menu", { exact: true })).toBeVisible();
  const mutations: string[] = [];
  page.on("request", request => {
    if (request.url().startsWith(api + "/api/v1/") && !request.url().includes("/auth/") && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) mutations.push(request.url());
  });

  const response = await page.request.get(`${api}/api/v1/contracts`);
  expect(response.ok()).toBe(true);
  const contracts = (await response.json()).items as { id: string; contractNumber: string; storedStatus: string; status: string }[];
  await page.goto("/contracts?tab=register");
  for (const state of ["Draft", "Pending Approval", "Active"]) {
    const contract = contracts.find(item => item.contractNumber.startsWith("DISPOSABLE-RELEASE-") && item.storedStatus === state);
    expect(contract, `Supported ${state} contract fixture required`).toBeTruthy();
    const row = page.getByRole("row").filter({ hasText: contract!.contractNumber });
    await expect(row).toBeVisible();
    await captureViewportPair(page, testInfo, `contract-${state.replaceAll(" ", "-")}-record`, row);
    const view = row.getByRole("button", { name: "View", exact: true });
    await view.click();
    const dialog = page.getByRole("dialog", { name: contract!.contractNumber, exact: true });
    await expect(dialog).toContainText(contract!.status);
    if (state === "Draft") await expect(dialog.getByRole("button", { name: "Submit for approval", exact: true })).toBeVisible();
    if (state === "Pending Approval") await expect(dialog.getByRole("button", { name: "Activate", exact: true })).toBeVisible();
    await captureViewportPair(page, testInfo, `contract-${state.replaceAll(" ", "-")}-detail`, dialog);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(view).toBeFocused();
  }
  await page.goto("/contracts?tab=reminders");
  await expect(page.getByText(/DISPOSABLE-RELEASE-ACTIVE-/).first()).toBeVisible();
  await captureViewportPair(page, testInfo, "contract-populated-expiry");

  const month = process.env.DESIGN_FINANCE_MONTH!;
  expect(month).toMatch(/^\d{4}-\d{2}-01$/);
  await page.goto("/finance");
  const periodsResponse = await page.request.get(`${api}/api/v1/finance/periods`);
  expect(periodsResponse.ok()).toBe(true);
  const period = (await periodsResponse.json()).items.find((item: { periodMonth: string }) => item.periodMonth === month);
  expect(period, "Existing generated test period required; never generates or resets data").toBeTruthy();
  const statementResponse = await page.request.get(`${api}/api/v1/finance/statements?period_month=${encodeURIComponent(month)}&page=1&page_size=50`);
  expect(statementResponse.ok()).toBe(true);
  const statement = await statementResponse.json();
  expect(statement.items.length).toBeGreaterThan(0);
  await page.getByLabel("Finance payout month").fill(month);
  await page.getByLabel("Finance payout month").press("Tab");
  const components = page.getByRole("button", { name: "Components", exact: true }).first();
  await expect(components).toBeVisible();
  await captureViewportPair(page, testInfo, "finance-calculated-payout", components);
  await components.click();
  const heading = page.getByRole("heading", { name: "Finance component drill-down", exact: true });
  await expect(heading).toBeVisible();
  await captureViewportPair(page, testInfo, "finance-calculated-components", heading);
  expect(mutations, "Populated review must remain read-only").toEqual([]);
});
