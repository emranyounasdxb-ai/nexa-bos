import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { selectBrandedOption } from "./helpers/select";

const api = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const testPassword = "UserPass1!";
type RecordId = { id: string; email: string; fullName: string; applicationCode: string; code: string; name: string };

async function login(request: APIRequestContext, email: string, password = testPassword) {
  const response = await request.post(`${api}/api/v1/auth/login`, { data: { email, password } });
  expect(response.status()).toBe(200);
  return { "X-CSRF-Token": (await response.json()).csrfToken as string };
}
async function owner(request: APIRequestContext) {
  const status = await request.get(`${api}/api/v1/auth/bootstrap-status`);
  if ((await status.json()).available) {
    const response = await request.post(`${api}/api/v1/auth/bootstrap`, { data: {
      secret: process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret", full_name: "Platform Owner", employee_code: "EMP-OWNER", email: "owner@example.com", mobile: "+971500000000", joining_date: "2026-01-01", employment_status: "Active", password: "OwnerPass1!", designation_name: "Owner", designation_code: "OWN",
    } });
    expect(response.status()).toBe(200);
  }
  return login(request, "owner@example.com", "OwnerPass1!");
}
async function getItems(request: APIRequestContext, path: string) {
  const response = await request.get(`${api}/api/v1/${path}`);
  expect(response.status()).toBe(200);
  return (await response.json()).items as RecordId[];
}
async function save(request: APIRequestContext, path: string, headers: Record<string, string>, data: object, method = "post") {
  const response = await request.fetch(`${api}/api/v1/${path}`, { method, headers, data });
  expect(response.status(), `Supported ${method} ${path}`).toBe(200);
  return response.json();
}
async function seed(request: APIRequestContext) {
  const headers = await owner(request);
  const types = await getItems(request, "user-types");
  const sales = ["Dashboard.View", "Applications.View", "Applications.Create", "Applications.Edit", "Customers.Create", "Customers.Edit", "Customers.View", "Notifications.View"];
  for (const [role, scope] of [["TL", "team"], ["SE", "own"], ["COD", "office"]]) {
    const id = types.find(type => type.code === role)!.id;
    await save(request, `user-types/${id}/permissions`, headers, { permissions: role === "COD" ? [...sales, "Applications.Submit", "Applications.UpdateStage"] : sales }, "put");
    for (const [suffix, field] of [["scope", "visibility_scope"], ["application-scope", "application_visibility_scope"], ["customer-scope", "customer_visibility_scope"], ["reporting-scope", "reporting_visibility_scope"]]) {
      await save(request, `user-types/${id}/${suffix}`, headers, { [field]: scope }, "put");
    }
    await save(request, `user-types/${id}/case-owner`, headers, { can_be_case_owner: true }, "put");
  }
  const stamp = Date.now().toString();
  const designation = (await getItems(request, "designations"))[0].id;
  const groups = [];
  for (const code of ["DXB", "AUH"]) {
    const office = (await getItems(request, "offices")).find(item => item.code === code)!;
    const department = await save(request, "departments", headers, { code: `TD${code}${stamp}`, name: `TL review ${code}`, office_id: office.id });
    const team = await save(request, "teams", headers, { code: `TT${code}${stamp}`, name: `Team ${code} ${stamp}`, office_id: office.id, department_id: department.id });
    const users: Record<string, RecordId> = {};
    let manager: string | undefined;
    for (const role of ["COD", "TL", "SE"]) {
      const user = await save(request, "users", headers, {
        full_name: `TL Test ${code} ${role} ${stamp}`, employee_code: `${role}${code}${stamp}`, email: `tl-${code}-${role}-${stamp}@example.com`.toLowerCase(), mobile: "+971500000001", designation_id: designation, employment_status: "Active", joining_date: "2026-01-01", office_id: office.id, department_id: department.id, team_id: team.id, reporting_manager_id: manager,
      });
      await save(request, `users/${user.id}/assign-type`, headers, { user_type_id: types.find(type => type.code === role)!.id });
      await save(request, `users/${user.id}/activate`, headers, {});
      const setup = await save(request, `auth/users/${user.id}/setup-link`, headers, {});
      await save(request, "auth/setup", {}, { token: setup.token, password: testPassword });
      users[role] = user;
      manager = user.id;
    }
    groups.push({ office, team, users });
  }
  const bank = (await getItems(request, "banks")).find(item => item.code === "DIB")!;
  const product = (await getItems(request, "products")).find(item => item.code === "PF")!;
  const workflows = await getItems(request, `workflows?bank_id=${bank.id}&product_id=${product.id}`);
  if (!workflows.length) {
    const workflow = await save(request, "workflows", headers, { bank_id: bank.id, product_id: product.id });
    const entry = workflow.stages.find((stage: { systemKey: string }) => stage.systemKey === "application_created");
    const submitted = await save(request, `workflows/${workflow.id}/stages`, headers, { code: "SUBMITTED", name: "Submitted", sort_order: 20 });
    await save(request, `workflows/${workflow.id}/transitions`, headers, { items: [{ from_stage_id: entry.id, to_stage_id: submitted.id }] }, "put");
  }
  const mapping = (await getItems(request, `bank-products?bankId=${bank.id}&productId=${product.id}`))[0];
  const variant = await save(request, "product-variants", headers, { bank_product_id: mapping.id, code: `TL-${stamp}`, name: `TL disposable variant ${stamp}` });
  async function create(email: string) {
    return save(request, "applications", await login(request, email), {
      customer: { customer_type: "individual", full_name: `TL disposable customer ${stamp}`, mobile: "+971500000012" }, bank_id: bank.id, product_id: product.id, product_variant_id: variant.id, requested_amount: "12500",
    });
  }
  const cases = [];
  for (const group of groups) {
    cases.push({ desktop: await create(group.users.SE.email), mobile: await create(group.users.SE.email), own: await create(group.users.TL.email) });
  }
  return { groups, cases };
}
async function signIn(page: Page, email: string, title: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(testPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: 30_000 });
}
async function signOut(page: Page) {
  await page.getByLabel("Open user menu").click();
  await page.locator("header").getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test("DXB and AUH TL review: scope, return/correct/resubmit/forward, keyboard and responsive queues", async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  const fixture = await seed(request);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const index of [0, 1]) {
    const group = fixture.groups[index];
    const other = fixture.cases[1 - index].desktop;
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const app = viewport.width === 1440 ? fixture.cases[index].desktop : fixture.cases[index].mobile;
      await page.setViewportSize(viewport);
      await signIn(page, group.users.TL.email, "Team Leader Dashboard");
      await expect(page.getByText(`${group.office.name} · ${group.team.name} · My Team`)).toBeVisible();
      await expect(page.getByTestId("tl-team-performance")).toContainText(group.users.SE.fullName);
      await expect(page.getByTestId("tl-dashboard")).not.toContainText(fixture.groups[1-index].users.SE.fullName);
      await expect(page.getByTestId("tl-dashboard")).not.toContainText(other.applicationCode);
      await expect(page.getByTestId("my-performance")).toBeVisible();
      await expect(page.getByTestId("my-attendance")).toBeVisible();
      await expect(page.getByText("Top employees", { exact: true })).toHaveCount(0);
      for (const title of ["Applications trend", "My vs Team", "Internal Review tracker", "Bank Stage tracker", "Product mix", "Outcomes", "TAT and delays"]) await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`tl-${group.office.code}-${viewport.width}.png`) });
      const card = page.getByRole("button", { name: "Returned queue", exact: true });
      await card.focus(); await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/queue=returned/);
      await expect(page.getByRole("heading", { name: "Returned · Review queue" })).toBeFocused();
      await page.reload();
      await expect(page.getByRole("button", { name: "Returned queue", exact: true })).toHaveAttribute("aria-pressed", "true");
      await selectBrandedOption(page.getByLabel("Case scope"), "own");
      await page.getByRole("button", { name: "All period cases" }).click();
      await expect(page.getByText(fixture.cases[index].own.applicationCode).first()).toBeVisible();
      await selectBrandedOption(page.getByLabel("Case scope"), "team");
      await expect(page.getByTestId("tl-dashboard")).not.toContainText(fixture.cases[index].own.applicationCode);
      for (const suffix of ["", "/progress", "/timeline", "/internal-review"]) expect((await page.request.get(`${api}/api/v1/applications/${other.id}${suffix}`)).status()).toBe(404);
      expect((await page.request.get(`${api}/api/v1/customers`)).status()).toBe(403);
      expect((await page.request.get(`${api}/api/v1/workflows`)).status()).toBe(403);
      await page.goto("/customers");
      await expect(page.getByText("You do not have permission to view Customers.")).toBeVisible();
      await page.goto("/workflows");
      await expect(page.getByText("Workflow access is restricted to OWNER and GM.")).toBeVisible();
      await page.goto(`/applications/${other.id}`);
      await expect(page.getByText("Application not found", { exact: true })).toBeVisible();
      await page.goto(`/applications/${app.id}`);
      const review = page.getByTestId("internal-review");
      await expect(review).toContainText("Pending TL Review");
      await expect(page.getByRole("button", { name: "Save Product Variant" })).toHaveCount(0);
      const returnButton = review.getByRole("button", { name: "Return to SE", exact: true });
      await returnButton.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(returnButton).toBeFocused();
      await returnButton.click();
      await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByLabel("Return reason").fill("Correct the requested amount");
      await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
      await expect(review).toContainText("Returned to SE");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await signOut(page);
      await signIn(page, group.users.SE.email, "My Dashboard");
      await page.goto(`/applications/${app.id}`);
      await page.getByRole("button", { name: "Correct requested amount" }).click();
      await page.getByLabel("Requested amount", { exact: true }).fill("15000");
      await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
      await expect(page.getByTestId("internal-review")).toBeVisible();
      await page.getByRole("button", { name: "Resubmit to TL", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
      await expect(page.getByTestId("internal-review")).toContainText("Resubmitted to TL");
      await signOut(page);
      await signIn(page, group.users.TL.email, "Team Leader Dashboard");
      await page.getByRole("button", { name: "Resubmitted queue", exact: true }).click();
      await expect(page.getByText(app.applicationCode).first()).toBeVisible();
      await page.goto(`/applications/${app.id}`);
      await page.getByRole("button", { name: "Forward to COD", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
      await expect(page.getByTestId("internal-review")).toContainText("Forwarded to COD");
      const stored = await (await page.request.get(`${api}/api/v1/applications/${app.id}`)).json();
      expect(stored.caseOwnerId).toBe(group.users.SE.id);
      expect(stored.requestedAmount).toBe("15000.00");
      expect(stored.submitted).toBe(false);
      await page.getByRole("tab", { name: "Corrections & Actions" }).click();
      for (const action of ["Update MIS stage", "Save Bank Case Number", "Set outcome"]) await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
      if (index === 0 && viewport.width === 1440) {
        await page.route("**/api/v1/reports/tl-dashboard?**", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Isolated dashboard unavailable" } }) }));
        await page.goto("/reports");
        await expect(page.getByText("Isolated dashboard unavailable", { exact: true })).toBeVisible();
        await expect(page.getByTestId("tl-cards")).toHaveCount(0);
        await page.unroute("**/api/v1/reports/tl-dashboard?**");
        await page.getByRole("button", { name: "Refresh", exact: true }).click();
        await expect(page.getByTestId("tl-cards")).toBeVisible();
      }
      await signOut(page);
    }
  }
  expect(errors).toEqual([]);
});
