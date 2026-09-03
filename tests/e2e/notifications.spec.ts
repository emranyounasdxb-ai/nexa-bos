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
  expect(created.ok()).toBeTruthy();
}

async function ownerHeaders(request: APIRequestContext) {
  await ensureOwner(request);
  const login = await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: "owner@example.com", password: "OwnerPass1!" },
  });
  expect(login.ok()).toBeTruthy();
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function signIn(page: Page, request: APIRequestContext, email = "owner@example.com") {
  await ensureOwner(request);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(email === "owner@example.com" ? "OwnerPass1!" : "UserPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Administration menu" }).click();
  await expect(page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function createViewOnlyUser(request: APIRequestContext) {
  const headers = await ownerHeaders(request);
  const suffix = Date.now().toString().slice(-7);
  const createdType = await request.post(`${apiOrigin}/api/v1/user-types`, {
    headers,
    data: { name: `Notification Viewer ${suffix}`, code: `NV${suffix}` },
  });
  expect(createdType.ok()).toBeTruthy();
  const userType = (await createdType.json()) as { id: string };
  expect(
    (await request.post(`${apiOrigin}/api/v1/user-types/${userType.id}/activate`, { headers })).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.put(`${apiOrigin}/api/v1/user-types/${userType.id}/permissions`, {
        headers,
        data: { permissions: ["Notifications.View"] },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.put(`${apiOrigin}/api/v1/user-types/${userType.id}/scope`, {
        headers,
        data: { visibility_scope: "own" },
      })
    ).ok(),
  ).toBeTruthy();
  const offices = (
    (await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as {
      items: Array<{ id: string }>;
    }
  ).items;
  const designations = (
    (await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as {
      items: Array<{ id: string }>;
    }
  ).items;
  const email = `notification-view-${suffix}@example.com`;
  const createdUser = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Notification Viewer ${suffix}`,
      employee_code: `EMP-NV${suffix}`,
      email,
      mobile: `+97158${suffix.slice(-7)}`,
      designation_id: designations[0].id,
      employment_status: "Active",
      joining_date: "2026-02-01",
      office_id: offices[0].id,
    },
  });
  expect(createdUser.ok()).toBeTruthy();
  const user = (await createdUser.json()) as { id: string };
  expect(
    (
      await request.post(`${apiOrigin}/api/v1/users/${user.id}/assign-type`, {
        headers,
        data: { user_type_id: userType.id },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (await request.post(`${apiOrigin}/api/v1/users/${user.id}/activate`, { headers })).ok(),
  ).toBeTruthy();
  const setup = await request.post(`${apiOrigin}/api/v1/auth/users/${user.id}/setup-link`, {
    headers,
  });
  expect(setup.ok()).toBeTruthy();
  const token = ((await setup.json()) as { token: string }).token;
  expect(
    (
      await request.post(`${apiOrigin}/api/v1/auth/setup`, {
        data: { token, password: "UserPass1!" },
      })
    ).ok(),
  ).toBeTruthy();
  return { email, id: user.id, headers };
}

test("owner manages rules and uses the in-app notification center", async ({ page, request }) => {
  test.setTimeout(120_000);
  await signIn(page, request);
  await page.getByRole("link", { name: "Notification admin" }).click();
  await expect(page.getByRole("heading", { name: "Notification administration" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "New notification rule" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Send urgent in-app notification" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notification audit" })).toBeVisible();

  const suffix = Date.now().toString().slice(-7);
  await page.getByLabel("Rule name").fill(`Stage alert ${suffix}`);
  await selectBrandedOption(page.getByLabel("Severity"), "critical");
  await page.getByLabel("Notification title").fill(`Stage changed ${suffix}`);
  await page.getByLabel("Notification message").fill("An assigned application changed stage.");
  await selectBrandedOption(page.getByLabel("Recipient target").first(), "affected_user");
  await page.getByRole("button", { name: "Add target" }).first().click();
  await page.getByRole("button", { name: "Create draft rule" }).click();
  await expect(page.getByText("Notification rule created as draft.")).toBeVisible();
  const ruleRow = page.getByRole("row").filter({ hasText: `Stage alert ${suffix}` });
  await expect(ruleRow).toBeVisible();
  await ruleRow.getByRole("button", { name: "Activate" }).click();
  await expect(ruleRow.getByText("Active", { exact: true })).toBeVisible();

  const urgentTitle = `Urgent system notice ${suffix}`;
  await selectBrandedOption(page.getByLabel("Urgent category"), "system");
  await page.getByLabel("Urgent title").fill(urgentTitle);
  await page.getByLabel("Urgent message").fill("Please review this in-app notice.");
  await page.getByLabel("Require acknowledgement").last().check();
  await selectBrandedOption(page.getByLabel("Recipient target").last(), "company");
  await page.getByRole("button", { name: "Add target" }).last().click();
  await page.getByRole("button", { name: "Send urgent notification" }).click();
  await expect(page.getByText("Urgent in-app notification sent.")).toBeVisible();

  await page.getByRole("link", { name: "Notifications", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Notification center" })).toBeVisible();
  const notice = page.locator("div.rounded-xl").filter({ hasText: urgentTitle });
  await expect(notice).toContainText("System");
  await expect(notice).toContainText("Urgent");
  await expect(notice).toContainText("Acknowledgement required");
  await notice.getByRole("button", { name: "Acknowledge" }).click();
  await expect(notice).toContainText("Acknowledged");
  await expect(notice.getByText("Unread", { exact: true })).toBeVisible();
  await notice.getByRole("button", { name: "Mark as read" }).click();
  await expect(notice.getByText("Read", { exact: true })).toBeVisible();
});

test("view-only user has own notification UI but no administration controls", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const user = await createViewOnlyUser(request);
  const sent = await request.post(`${apiOrigin}/api/v1/notifications/urgent`, {
    headers: user.headers,
    data: {
      category: "operations",
      title: "Viewer-only delivery",
      message: "This delivery is visible only to its authorized recipient.",
      acknowledgement_required: false,
      affected_user_id: user.id,
      targets: [{ target_type: "affected_user", target_id: null }],
    },
  });
  expect(sent.ok()).toBeTruthy();

  await signIn(page, request, user.email);
  await expect(page.getByRole("link", { name: "Notification admin" })).toHaveCount(0);
  await expect(page.getByLabel(/Notifications, 1 unread/)).toBeVisible();
  await page.getByRole("link", { name: "Notifications", exact: true }).click();
  await expect(page.getByText("Viewer-only delivery")).toBeVisible();
  await page.goto("/notifications/manage");
  await expect(page.getByText("You do not have permission to administer notifications.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "New notification rule" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Send urgent in-app notification" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Notification audit" })).toHaveCount(0);
});
