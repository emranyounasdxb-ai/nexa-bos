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

test("User Type editor groups permissions and saves existing settings without changing the assignment model", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request);

  const suffix = Date.now().toString().slice(-8);
  const typeCode = `UX${suffix}`;
  const typeName = `Permission UX ${suffix}`;
  await page.goto("/user-types");
  await page.getByPlaceholder("Name").fill(typeName);
  await page.getByPlaceholder("Unique code").fill(typeCode);
  await page.getByPlaceholder("Description").fill("Focused permission editor workflow");
  const createResponsePromise = page.waitForResponse(
    (response) => response.url() === `${apiOrigin}/api/v1/user-types` && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create custom type" }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.ok()).toBeTruthy();
  const createdType = (await createResponse.json()) as { code: string; id: string };
  expect(createdType.code).toBe(typeCode);
  await page.goto(`/user-types/${createdType.id}`);

  await expect(page.getByRole("heading", { name: `${typeName} (${typeCode})` })).toBeVisible();
  await expect(page.getByText("Focused permission editor workflow")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to User Types" })).toBeVisible();
  await expect(page.getByText(/^inactive$/i).first()).toBeVisible();
  await expect(page.getByText("This User Type currently grants no system access.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deactivate", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deactivate", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Deactivate", exact: true }).click();
  await expect(page.getByRole("dialog", { name: `Deactivate ${typeName}?` })).toBeVisible();
  await expect(page.getByText(/cannot sign in.*terminates.*active sessions/s)).toBeVisible();
  await expect(page.getByText("No assigned-user count is available from this page.")).toBeVisible();
  await page.getByRole("button", { name: "Deactivate User Type" }).click();
  await expect(page.getByRole("button", { name: "Activate", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deactivate", exact: true })).toBeVisible();

  const moduleNames = [
    "Users",
    "Customers",
    "Banks & Products",
    "Applications & Workflow",
    "Reports",
    "Attendance",
    "Notifications",
    "Targets",
    "Finance",
    "Assets",
  ];
  for (const moduleName of moduleNames) {
    await expect(page.getByRole("button", { name: `${moduleName} permissions`, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Users permissions", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("switch", { name: "Can be Reporting Manager" }).check();
  await page.getByRole("switch", { name: "Can be Case Owner" }).check();
  await page.getByLabel("User Directory scope", { exact: true }).selectOption("office");
  await page.getByLabel("Customer scope", { exact: true }).selectOption("team");
  await page.getByLabel("Application scope", { exact: true }).selectOption("own");
  await page.getByLabel("Reporting scope", { exact: true }).selectOption("company");
  await expect(page.getByText("You have unsaved changes.")).toBeVisible();

  const usersModule = page.getByTestId("permission-panel-users");
  await expect(page.getByLabel("View users within assigned visibility scope")).toBeVisible();
  await expect(usersModule.getByText("Users.View", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Select all Users permissions" }).click();
  await expect(page.getByText("This will include sensitive administrative permissions.")).toBeVisible();
  await page.getByRole("button", { name: "Include permissions" }).click();
  await expect(page.getByRole("button", { name: "Users permissions", exact: true })).toContainText("22/22");

  await page.getByLabel("Search permissions").fill("urgent");
  const urgentPanel = page.getByTestId("permission-panel-notifications");
  const urgentPermission = urgentPanel.getByLabel("Send urgent in-app notifications");
  await expect(urgentPermission).toBeVisible();
  await expect(urgentPanel.getByText("Sensitive")).toBeVisible();
  await urgentPermission.check();
  await page.getByRole("button", { name: "Selected", exact: true }).click();
  await expect(urgentPermission).toBeVisible();
  await page.getByRole("button", { name: "Unselected", exact: true }).click();
  await expect(page.getByText("No permissions match the current search and filter.").first()).toBeVisible();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByLabel("Search permissions").fill("");

  await page.getByRole("button", { name: "Clear all Users permissions" }).click();
  await page.getByLabel("View users within assigned visibility scope").check();
  await page.getByRole("button", { name: "Customers permissions", exact: true }).click();
  await page.getByRole("button", { name: "Select all Customers permissions" }).click();
  await expect(page.getByText("This will include sensitive administrative permissions.")).toBeVisible();
  await page.getByRole("button", { name: "Include permissions" }).click();

  const changeSummary = page.getByRole("list", { name: "Staged change summary" });
  await expect(changeSummary).toContainText("Reporting Manager enabled");
  await expect(changeSummary).toContainText("Case Owner enabled");
  await expect(changeSummary).toContainText("User Directory scope: No scope → Office");
  await expect(changeSummary).toContainText("permission");

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Changes saved successfully/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("All changes are saved.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();

  const typesResponse = await page.request.get(`${apiOrigin}/api/v1/user-types`);
  expect(typesResponse.ok()).toBeTruthy();
  const types = (await typesResponse.json()) as {
    items: Array<{
      code: string;
      id: string;
      canBeReportingManager: boolean;
      canBeCaseOwner: boolean;
      visibilityScope: string | null;
      customerVisibilityScope: string | null;
      applicationVisibilityScope: string | null;
      reportingVisibilityScope: string | null;
      permissions: string[];
    }>;
  };
  const saved = types.items.find((item) => item.code === typeCode);
  expect(saved).toMatchObject({
    canBeReportingManager: true,
    canBeCaseOwner: true,
    visibilityScope: "office",
    customerVisibilityScope: "team",
    applicationVisibilityScope: "own",
    reportingVisibilityScope: "company",
  });
  expect(saved?.permissions).toContain("Users.View");
  expect(saved?.permissions).toContain("Customers.View");
  expect(saved?.permissions).toContain("Notifications.SendUrgent");
  expect(saved?.permissions).not.toContain("Users.Create");

  await page.getByLabel("Reporting scope", { exact: true }).selectOption("own");
  await expect(page.getByText("You have unsaved changes.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Reporting scope", { exact: true })).toHaveValue("company");
  await expect(page.getByText("Unsaved changes discarded.")).toBeVisible();

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBeTruthy();
  await page.setViewportSize({ width: 768, height: 900 });
  const mobileUsers = page.getByRole("button", { name: "Users permissions", exact: true });
  const mobileCustomers = page.getByRole("button", { name: "Customers permissions", exact: true });
  await mobileUsers.click();
  await mobileCustomers.click();
  await expect(mobileUsers).toHaveAttribute("aria-expanded", "true");
  await expect(mobileCustomers).toHaveAttribute("aria-expanded", "true");
  const tabletOverflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    elements: Array.from(document.querySelectorAll("body *"))
      .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 5)
      .map((element) => ({
        className: element.className,
        right: element.getBoundingClientRect().right,
        tagName: element.tagName,
      })),
  }));
  expect(tabletOverflow).toEqual({ clientWidth: 768, scrollWidth: 768, elements: [] });

  const owner = types.items.find((item) => item.code === "OWNER");
  expect(owner).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/user-types/${owner!.id}`);
  await expect(page.getByRole("heading", { name: /.* \(OWNER\)/ })).toBeVisible();
  await page.getByRole("button", { name: "About System Type restrictions" }).focus();
  await expect(page.getByRole("tooltip")).toContainText("seeded identity details");
  await expect(page.getByRole("heading", { name: "Permissions", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Search permissions")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Activate", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deactivate", exact: true })).toHaveCount(0);
  await expect(page.getByText("OWNER remains protected with full permissions and a hidden permission matrix.")).toBeVisible();
});
