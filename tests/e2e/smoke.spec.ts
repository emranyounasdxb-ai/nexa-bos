import { expect, test } from "@playwright/test";

test("web smoke page starts and reaches the API", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Engineering foundation")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Foundation smoke page" })).toBeVisible();
  await expect(page.getByTestId("api-base-url")).toContainText("http://localhost:");

  const health = page.getByTestId("api-health-status");
  await expect(health).not.toHaveText("Checking…", { timeout: 30_000 });
  await expect(health).toContainText("API health: ok");

  const ready = page.getByTestId("api-readiness-status");
  await expect(ready).not.toHaveText("Checking…", { timeout: 30_000 });
  await expect(ready).toContainText("API readiness: ready");
});
