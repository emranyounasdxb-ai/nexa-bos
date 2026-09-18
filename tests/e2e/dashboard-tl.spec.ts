import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { preserveBuiltInRoleConfiguration } from "./helpers/role-configuration";
import { selectBrandedOption } from "./helpers/select";
import { setVisualTheme } from "./helpers/viewport-capture";

preserveBuiltInRoleConfiguration();
const api = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const testPassword = "UserPass1!";
const topLabels = ["Dashboard", "Cases", "My Team", "Performance & Attendance", "Timeline"];
test.describe.configure({ timeout: 240_000 });
type RecordId = { id: string; email: string; fullName: string; applicationCode: string; code: string; name: string };
type Group = { office: RecordId; departmentId: string; team: RecordId; users: Record<string, RecordId>; targetUsers: Record<string, RecordId> };

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
  for (const [role, scope] of [["TL", "team"], ["SE", "own"], ["SM", "office"], ["COD", "office"]]) {
    const id = types.find(type => type.code === role)!.id;
    const casePermissions = role === "TL" || role === "SM" || role === "COD" ? ["CaseOperations.ViewRouting"] : [];
    await save(request, `user-types/${id}/permissions`, headers, { permissions: role === "COD" ? [...sales, ...casePermissions, "Applications.Submit", "Applications.UpdateStage"] : [...sales, ...casePermissions] }, "put");
    for (const [suffix, field] of [["scope", "visibility_scope"], ["application-scope", "application_visibility_scope"], ["customer-scope", "customer_visibility_scope"], ["reporting-scope", "reporting_visibility_scope"]]) {
      await save(request, `user-types/${id}/${suffix}`, headers, { [field]: scope }, "put");
    }
    await save(request, `user-types/${id}/case-owner`, headers, { can_be_case_owner: true }, "put");
  }
  const stamp = Date.now().toString();
  const designation = (await getItems(request, "designations"))[0].id;
  const groups: Group[] = [];
  async function createUser(role: string, tag: string, office: RecordId, departmentId: string, team: RecordId, manager?: string) {
    const user = await save(request, "users", headers, {
      full_name: `TL Test ${office.code} ${tag} ${stamp}`, employee_code: `${tag}${office.code}${stamp}`, email: `tl-${office.code}-${tag}-${stamp}@example.com`.toLowerCase(), mobile: "+971500000001", designation_id: designation, employment_status: "Active", joining_date: "2026-01-01", office_id: office.id, department_id: departmentId, team_id: team.id, reporting_manager_id: manager,
    });
    await save(request, `users/${user.id}/assign-type`, headers, { user_type_id: types.find(type => type.code === role)!.id });
    await save(request, `users/${user.id}/activate`, headers, {});
    const setup = await save(request, `auth/users/${user.id}/setup-link`, headers, {});
    await save(request, "auth/setup", {}, { token: setup.token, password: testPassword });
    return user as RecordId;
  }
  for (const code of ["DXB", "AUH"]) {
    const office = (await getItems(request, "offices")).find(item => item.code === code)!;
    const department = await save(request, "departments", headers, { code: `TD${code}${stamp}`, name: `TL review ${code}`, office_id: office.id });
    const businessUnit = await save(request, "business-units", headers, { code: `TB${code}${stamp}`, name: `TL review unit ${code}`, office_id: office.id, department_id: department.id });
    const team = await save(request, "teams", headers, { code: `TT${code}${stamp}`, name: `Team ${code} ${stamp}`, office_id: office.id, department_id: department.id, business_unit_id: businessUnit.id });
    const users: Record<string, RecordId> = {};
    users.SM = await createUser("SM", "SM", office, department.id, team);
    users.COD = await createUser("COD", "COD", office, department.id, team);
    users.TL = await createUser("TL", "TL", office, department.id, team, users.SM.id);
    users.SE = await createUser("SE", "SE", office, department.id, team, users.TL.id);
    const targetUsers: Record<string, RecordId> = {};
    if (code === "DXB") {
      for (const tag of ["OVER", "MIXED", "ZERO", "NONE"]) targetUsers[tag] = await createUser("SE", tag, office, department.id, team, users.TL.id);
      users.EMPTY = await createUser("TL", "EMPTY", office, department.id, team, users.COD.id);
    }
    groups.push({ office, departmentId: department.id, team, users, targetUsers });
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
  for (const group of groups) {
    await save(request, "case-operations/routing", headers, {
      office_id: group.office.id,
      product_id: product.id,
      sales_manager_id: group.users.SM.id,
      coordinator_id: group.users.COD.id,
    }, "put");
  }
  async function create(email: string, requestedAmount = "12500") {
    return save(request, "applications", await login(request, email), {
      customer: { customer_type: "individual", full_name: `TL disposable customer ${stamp}`, mobile: "+971500000012" }, bank_id: bank.id, product_id: product.id, product_variant_id: variant.id, requested_amount: requestedAmount,
    });
  }
  const cases = [];
  for (const group of groups) {
    cases.push({ desktop: await create(group.users.SE.email), mobile: await create(group.users.SE.email), own: await create(group.users.TL.email) });
  }
  // Real submissions produce measurable target results without mocking the dashboard contract.
  async function createSubmitted(group: Group, user: RecordId, tag: string) {
    const application = await create(user.email, "12000");
    const tlHeaders = await login(request, group.users.TL.email);
    const stateResponse = await request.get(`${api}/api/v1/applications/${application.id}/internal-review`);
    expect(stateResponse.status()).toBe(200);
    await save(request, `case-operations/applications/${application.id}/book`, tlHeaders, { expected_review_event_id: (await stateResponse.json()).eventId });
    await save(request, `case-operations/applications/${application.id}/sales-manager-decision`, await login(request, group.users.SM.email), { decision: "approve" });
    await save(request, `applications/${application.id}/case-number`, await login(request, group.users.COD.email), { bank_case_number: `TL-${group.office.code}-${tag}-${stamp}` });
  }
  for (const group of groups) await createSubmitted(group, group.users.SE, "COUNT");
  for (const tag of ["OVER", "MIXED"]) await createSubmitted(groups[0], groups[0].targetUsers[tag], tag);
  const ownHeaders = await login(request, groups[0].users.TL.email);
  const ownReview = await request.get(`${api}/api/v1/applications/${cases[0].own.id}/internal-review`);
  await save(request, `case-operations/applications/${cases[0].own.id}/book`, ownHeaders, { expected_review_event_id: (await ownReview.json()).eventId });
  await save(request, `case-operations/applications/${cases[0].own.id}/sales-manager-decision`, await login(request, groups[0].users.SM.email), { decision: "approve" });
  await save(request, `applications/${cases[0].own.id}/case-number`, await login(request, groups[0].users.COD.email), { bank_case_number: `TL-DXB-OWN-${stamp}` });
  const targetHeaders = await owner(request);
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  async function target(user: RecordId, measurement: string, value: string, milestone = "submitted") {
    await save(request, "targets", targetHeaders, { level: "employee", entity_id: user.id, period_month: month, product_id: product.id, bank_id: null, milestone, measurement, target_value: value, prorate: false });
  }
  for (const group of groups) await target(group.users.SE, "count", "5");
  await target(groups[0].targetUsers.OVER, "amount", "10000");
  await target(groups[0].targetUsers.MIXED, "amount", "10000");
  await target(groups[0].targetUsers.MIXED, "count", "5", "approved");
  await target(groups[0].targetUsers.ZERO, "count", "5");
  await target(groups[0].users.TL, "amount", "50000");
  const attendanceDate = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await save(request, "attendance/schedules", targetHeaders, { office_id: groups[0].office.id, department_id: groups[0].departmentId, kind: "normal", start_time: "09:00", end_time: "17:00", grace_minutes: 0 });
  await save(request, "attendance/records", targetHeaders, { attendance_date: attendanceDate, entries: [{ employee_id: groups[0].users.TL.id, status: "Present", time_in: "09:05", time_out: "17:00", notes: "Disposable TL dashboard preview" }] }, "put");
  return { groups, cases, attendanceDate, bank, product, variant };
}
async function signIn(page: Page, email: string, title: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(testPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: 30_000 });
}
async function signOut(page: Page) {
  await page.getByRole("button", { name: "Open user menu", exact: true }).click();
  await page.getByRole("menu", { name: "User account" }).getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}


async function settled(page: Page) {
  await expect(page.getByTestId("tl-dashboard")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
}
async function enter(page: Page, email: string) {
  await signIn(page, email, "Team Leader Dashboard");
  await settled(page);
}
async function openWorkspace(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Workspace pages" }).getByRole("link", { name, exact: true }).click();
  await settled(page);
}
async function report(page: Page, query = "view=team&queue=all") {
  const response = await page.request.get(`${api}/api/v1/reports/tl-dashboard?${query}`);
  expect(response.status()).toBe(200);
  return response.json();
}

test("TL case owner allowlist, own/team workspace and calendar remain isolated and responsive", async ({ page, request }, testInfo) => {
  const fixture = await seed(request), group = fixture.groups[0];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await enter(page, group.users.TL.email);
  // The public login page intentionally probes /auth/me before a session exists (401).
  // Collect every console error throughout the authenticated workspace instead.
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  for (const width of [1440, 1363, 1024, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const theme of ["light", "dark"] as const) {
      await setVisualTheme(page, theme);
      const nav = page.getByRole("navigation", { name: "Workspace pages" });
      if (width >= 1280) expect((await page.getByTestId("page-header").boundingBox())!.height, "Compact TL header must not reserve empty desktop chrome").toBeLessThanOrEqual(1);
      expect(await nav.getByRole("link").allTextContents()).toEqual(topLabels);
      await expect(page.getByLabel("Application sidebar", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open navigation", exact: true })).toHaveCount(0);
      for (const label of topLabels) {
        await openWorkspace(page, label);
        await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
        await expect(nav.getByRole("link", { name: label, exact: true })).toBeInViewport();
        if (label === "Cases") {
          await page.getByRole("tab", { name: "Team Cases", exact: true }).click();
          await settled(page);
          await expect(page.getByTestId("tl-review-queue")).toContainText(group.users.SE.fullName);
          await expect(page.getByTestId("tl-review-queue")).not.toContainText(fixture.groups[1].users.SE.fullName);
          await expect(page.getByRole("button", { name: "Create Case", exact: true })).toBeVisible();
          for (const name of ["Case Owner", "Product", "Stage", "Outcome", "Case date range"]) await expect(page.getByRole("combobox", { name, exact: true })).toBeVisible();
        }
        if (label === "Performance & Attendance") {
          await expect(page.getByTestId("my-performance")).toBeVisible();
          await expect(page.getByText("Appraisal module not configured", { exact: true })).toBeVisible();
          await page.getByRole("tab", { name: "Team Performance", exact: true }).click();
          await settled(page);
          await expect(page.getByTestId("tl-member-targets")).toContainText(group.users.SE.fullName);
          await expect(page.getByTestId("team-appraisal-unconfigured").first()).toHaveText("Appraisal module not configured");
          await expect(page.getByTestId("tl-member-targets")).not.toContainText(fixture.groups[1].users.SE.fullName);
        }
        if (label === "Timeline") {
          await page.getByRole("tab", { name: "Team Timeline", exact: true }).click();
          await settled(page);
          await expect(page.locator("time[datetime]").first()).toBeVisible();
          await expect(page.getByRole("combobox", { name: "Event type", exact: true })).toBeVisible();
        }
        await expectNoOverflow(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        // A route's effect can begin after the previous render reported idle.
        // Capture only after real requests and the current workspace both settle.
        await page.waitForLoadState("networkidle");
        await settled(page);
        await page.screenshot({ path: testInfo.outputPath(`tl-${label.toLowerCase().replaceAll(" ", "-")}-${width}-${theme}.png`), fullPage: true });
        await settled(page);
        await page.screenshot({ path: testInfo.outputPath(`tl-${label.toLowerCase().replaceAll(" ", "-")}-${width}-${theme}-viewport.png`) });
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        expect(await page.locator("header").evaluate(element => element.getBoundingClientRect().top)).toBe(0);
        for (const tab of await nav.getByRole("link").all()) await expect(tab).toBeInViewport();
        await page.evaluate(() => window.scrollTo(0, 0));
      }
    }
  }
  await openWorkspace(page, "Cases");
  await page.getByRole("combobox", { name: "Case date range", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Choose case date range range", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Create Case", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create application", exact: true });
  await dialog.getByLabel("Case Owner", { exact: true }).click();
  await expect(page.getByRole("option", { name: group.users.TL.fullName, exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: group.users.SE.fullName, exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: fixture.groups[1].users.SE.fullName, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(errors).toEqual([]);
});

test("DXB and AUH TL review: scope, tabs, charts, breadcrumbs and responsive queues", async ({ page, request }) => {
  const fixture = await seed(request);
  for (const index of [0, 1]) {
    const group = fixture.groups[index], other = fixture.cases[1 - index].desktop;
    await enter(page, group.users.TL.email);
    await openWorkspace(page, "Cases");
    await page.getByRole("tab", { name: "Team Cases", exact: true }).click();
    await settled(page);
    await expect(page.getByTestId("tl-review-queue")).toContainText(fixture.cases[index].desktop.applicationCode);
    await expect(page.getByTestId("tl-review-queue")).not.toContainText(other.applicationCode);
    for (const suffix of ["", "/progress", "/timeline", "/internal-review"]) expect((await page.request.get(`${api}/api/v1/applications/${other.id}${suffix}`)).status()).toBe(404);
    for (const path of ["/organization", "/organization/hierarchy", "/catalog", "/workflows", "/case-operations", "/contracts", "/transfers", "/exits", "/approvals", "/hr", "/pro", "/user-types", "/reports/compare"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/reports\?workspace=dashboard$/);
      await settled(page);
    }
    for (const path of ["case-operations/routing", "case-operations/reports/cases", "workflows", "reports/dashboard", "reports/rankings", "contracts", "transfers", "exits", "approvals"]) expect((await page.request.get(`${api}/api/v1/${path}`)).status()).toBe(403);
    await page.goto(`/applications/${fixture.cases[index].desktop.id}`);
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByRole("link", { name: "Cases", exact: true })).toHaveAttribute("href", "/reports?workspace=cases&queue=all");
    const tracker = page.getByTestId("internal-review");
    const returnButton = tracker.getByRole("button", { name: "Return to SE", exact: true });
    await returnButton.click();
    await page.keyboard.press("Escape");
    await expect(returnButton).toBeFocused();
    await returnButton.click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await page.getByLabel("Return reason").evaluate((input: HTMLTextAreaElement) => input.validity.valueMissing)).toBe(true);
    await page.getByLabel("Return reason").fill("Correct the requested amount");
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(tracker).toContainText("Returned to SE");
    await signOut(page);
    await signIn(page, group.users.SE.email, "My Dashboard");
    await page.goto(`/applications/${fixture.cases[index].desktop.id}`);
    await page.getByRole("button", { name: "Correct requested amount", exact: true }).click();
    await page.getByLabel("Requested amount", { exact: true }).fill("15000");
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByRole("button", { name: "Resubmit to TL", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByTestId("internal-review")).toContainText("Resubmitted to TL");
    await signOut(page);
    await enter(page, group.users.TL.email);
    await page.goto(`/applications/${fixture.cases[index].desktop.id}`);
    await page.getByTestId("internal-review").getByRole("button", { name: "Book & Send to SM", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByTestId("internal-review")).toContainText("Booked by TL");
    const stored = await (await page.request.get(`${api}/api/v1/applications/${fixture.cases[index].desktop.id}`)).json();
    expect(stored.caseOwnerId).toBe(group.users.SE.id);
    expect(stored.requestedAmount).toBe("15000.00");
    expect(stored.submitted).toBe(false);
    await signOut(page);
    await signIn(page, group.users.SM.email, "Dashboard");
    await expect(page.getByLabel("Application sidebar", { exact: true })).toHaveCount(1);
    await page.goto(`/applications/${fixture.cases[index].desktop.id}?tab=actions`);
    await page.getByRole("tab", { name: "Corrections & Actions", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sales Manager Review", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Case approved for processing.", { exact: true })).toBeVisible();
    await signOut(page);
    await signIn(page, group.users.COD.email, "Operations Dashboard");
    await expect(page.getByLabel("Application sidebar", { exact: true })).toHaveCount(1);
    await page.goto(`/applications/${fixture.cases[index].desktop.id}?tab=actions`);
    await page.getByRole("tab", { name: "Corrections & Actions", exact: true }).click();
    await page.getByLabel("Bank File Number", { exact: true }).fill(`E2E-${fixture.cases[index].desktop.id}`);
    await page.getByRole("button", { name: "Submit to Bank", exact: true }).click();
    await expect(page.getByText("Bank submission recorded.", { exact: true })).toBeVisible();
    const submitted = await (await page.request.get(`${api}/api/v1/applications/${fixture.cases[index].desktop.id}`)).json();
    expect(submitted.submitted).toBe(true);
    expect(submitted.caseOwnerId).toBe(group.users.SE.id);
    // PF stays open after bank submission; CC closure is covered by the case-operations test.
    expect(submitted.terminalOutcome).toBeNull();
    await signOut(page);
  }
});

test("TL approved review cards preserve real metrics, selection, focus and motion preferences", async ({ page, request }) => {
  const fixture = await seed(request), group = fixture.groups[0];
  await enter(page, group.users.TL.email);
  for (const motion of ["reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion: motion });
    for (const theme of ["light", "dark"] as const) {
      await setVisualTheme(page, theme);
      await openWorkspace(page, "Dashboard");
      const payload = await report(page);
      for (const [id, counts] of [["tl-own-status", payload.ownStatus], ["tl-team-status", payload.teamStatus]] as const) {
        const panel = page.getByTestId(id);
        await expect(panel.getByRole("term")).toHaveCount(4);
        await expect(panel).toContainText("Cumulative milestones · Selected period");
        for (const label of ["Created", "TL Booked", "Bank Submitted", "Completed/Closed"]) await expect(panel.getByText(label, { exact: true }).locator("..").getByRole("definition")).toHaveText(String(counts[label]));
      }
      expect(payload.ownTotal).toBe(1);
      expect(payload.teamTotal).toBeGreaterThan(payload.ownTotal);
      await expect(page.getByTestId("tl-team-status")).toContainText("Your direct SE members");
      for (const cohort of ["own", "team"] as const) {
        const pipeline = page.getByRole("navigation", { name: `${cohort === "own" ? "My" : "Team"} current workflow`, exact: true });
        await expect(pipeline.getByRole("link")).toHaveCount(6);
        for (const key of ["created", "tl_booking", "sm", "coordinator", "bank", "completed"]) await expect(pipeline.locator(`a[href*="queue=stage_${key}"] strong`)).toHaveText(String(payload.currentWork[cohort].stages[key]));
      }
      const nav = page.getByRole("navigation", { name: "Workspace pages" });
      const casesLink = nav.getByRole("link", { name: "Cases", exact: true });
      await casesLink.focus();
      await page.keyboard.press("Enter");
      await settled(page);
      await expect(casesLink).toHaveAttribute("aria-current", "page");
      await page.getByRole("tab", { name: "Team Cases", exact: true }).click();
      await settled(page);
      await page.getByRole("textbox", { name: "Search cases", exact: true }).fill(fixture.cases[0].desktop.applicationCode);
      await settled(page);
      await expect(page.getByTestId("tl-review-queue")).toContainText(fixture.cases[0].desktop.applicationCode);
      await expect(page.getByTestId("tl-review-queue")).not.toContainText(fixture.cases[0].mobile.applicationCode);
      await page.reload();
      await settled(page);
      await expect(page.getByRole("textbox", { name: "Search cases", exact: true })).toHaveValue(fixture.cases[0].desktop.applicationCode);
      await expect(page.getByRole("tab", { name: "Team Cases", exact: true })).toHaveAttribute("aria-selected", "true");
      await page.getByRole("textbox", { name: "Search cases", exact: true }).fill("");
      await settled(page);
    }
  }
});

test("TL actionable booking summary matches own/team queues and current-state drilldowns", async ({ page, request }) => {
  const fixture = await seed(request), group = fixture.groups[0];
  await enter(page, group.users.TL.email);
  const payload = await report(page, "view=combined&queue=booking");
  const pending = page.getByTestId("tl-pending-booking");
  await expect(pending).toContainText(fixture.cases[0].desktop.applicationCode);
  expect(payload.currentWork.team.booking).toBeGreaterThan(0);
  expect(payload.currentWork.own.booking + payload.currentWork.team.booking).toBe(payload.total);
  const summary = page.getByRole("navigation", { name: "Actionable case summary" });
  await expect(summary.getByRole("link", { name: /Needs TL Action/ }).locator("strong")).toHaveText(String(payload.total));
  // Each current-stage link opens precisely the backend snapshot cohort, not cumulative milestones.
  for (const key of ["created", "tl_booking", "sm", "coordinator", "bank", "completed"]) {
    await openWorkspace(page, "Dashboard");
    await page.getByRole("navigation", { name: "Team current workflow", exact: true }).locator(`a[href*="queue=stage_${key}"]`).click();
    await settled(page);
    const queue = await report(page, `view=team&queue=stage_${key}`);
    expect(queue.total).toBe(payload.currentWork.team.stages[key]);
    await expect(page.getByRole("tab", { name: "Team Cases", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("tl-review-queue")).toContainText(`${queue.total} cases`);
    for (const item of queue.items) expect(item.currentBucket).toBe(key);
  }
  await openWorkspace(page, "Cases");
  await page.getByRole("tab", { name: "Team Cases", exact: true }).click();
  await settled(page);
  await page.getByRole("combobox", { name: "Case date range", exact: true }).click();
  const today = payload.updatedAt.slice(0, 10);
  await page.getByRole("button", { name: today, exact: true }).click();
  await page.getByRole("button", { name: today, exact: true }).click();
  expect(new URL(page.url()).searchParams.has("date_from")).toBe(false);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await settled(page);
  expect(new URL(page.url()).searchParams.get("date_from")).toBe(today);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await settled(page);
  expect(new URL(page.url()).searchParams.has("date_from")).toBe(false);
  await expect(page.getByTestId("tl-review-queue")).toContainText(fixture.cases[0].desktop.applicationCode);
});

test("TL compact header and real database refresh preserve selections and last successful time", async ({ page, request }) => {
  const fixture = await seed(request), group = fixture.groups[0];
  await enter(page, group.users.TL.email);
  await openWorkspace(page, "Cases");
  const before = await report(page, "view=own&queue=all");
  const meResponse = await page.request.get(`${api}/api/v1/auth/me`);
  const me = await meResponse.json();
  const created = await page.request.post(`${api}/api/v1/applications`, { headers: { "X-CSRF-Token": me.csrfToken }, data: { customer: { customer_type: "individual", full_name: "TL own refresh regression", mobile: "+971500000016" }, bank_id: fixture.bank.id, product_id: fixture.product.id, product_variant_id: fixture.variant.id, requested_amount: "1000" } });
  expect(created.status()).toBe(200);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await settled(page);
  await expect(page.getByTestId("tl-review-queue")).toContainText((await created.json()).applicationCode);
  const after = await report(page, "view=own&queue=all");
  expect(after.ownTotal).toBe(before.ownTotal + 1);
  expect(after.teamTotal).toBe(before.teamTotal);
  expect(after.currentWork.own.booking).toBe(before.currentWork.own.booking + 1);
  expect(after.currentWork.team.booking).toBe(before.currentWork.team.booking);
  await openWorkspace(page, "Dashboard");
  await expect(page.getByRole("navigation", { name: "Actionable case summary" }).getByRole("link", { name: /Needs TL Action/ }).locator("strong")).toHaveText(String(after.currentWork.own.booking + after.currentWork.team.booking));
  await expect(page.getByTestId("tl-pending-booking")).toContainText((await created.json()).applicationCode);
  await openWorkspace(page, "Cases");
  const successTime = await page.getByTestId("tl-last-update").innerText();
  expect(successTime).not.toBe("Last update: —");
  await page.route("**/api/v1/reports/tl-dashboard?**", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Isolated dashboard unavailable" } }) }));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Isolated dashboard unavailable", { exact: true })).toBeVisible();
  await expect(page.getByTestId("tl-last-update")).toHaveText(successTime);
  await page.unroute("**/api/v1/reports/tl-dashboard?**");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await settled(page);
  await expect(page.getByTestId("tl-review-queue")).toContainText((await created.json()).applicationCode);
});

test("TL portal surfaces share approved spacing, compact tabs, flat cards and responsive access", async ({ page, request }, testInfo) => {
  const fixture = await seed(request), group = fixture.groups[0];
  await enter(page, group.users.TL.email);
  await openWorkspace(page, "My Team");
  const payload = await report(page);
  await expect(page.getByText(group.users.SM.fullName, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `${group.users.SE.fullName} · SE`, exact: true }).click();
  await settled(page);
  await page.getByRole("tablist", { name: "Selected member details" }).getByRole("tab", { name: "Performance", exact: true }).click();
  await expect(page.getByTestId("tl-member-targets")).toContainText(group.users.SE.fullName);
  await expect(page.getByTestId("tl-member-targets")).not.toContainText(group.targetUsers.OVER.fullName);
  await expect(page.getByTestId("tl-member-targets").getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
  expect(payload.staff.find((person: { id: string }) => person.id === group.users.SE.id).target).toMatchObject({ assigned: "5.00", achieved: "1.00", remaining: "4.00", achievementPct: 20, measurement: "count" });
  await openWorkspace(page, "Performance & Attendance");
  await page.getByRole("tab", { name: "Team Performance", exact: true }).click();
  await settled(page);
  const over = page.getByTestId(`tl-staff-row-${group.targetUsers.OVER.id}`);
  await expect(over.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await expect(over).toContainText("120%");
  await expect(over).toContainText("20% above target");
  await expect(over).toContainText("Exceeded by");
  const mixed = page.getByTestId(`tl-staff-row-${group.targetUsers.MIXED.id}`);
  await expect(mixed).toContainText("Mixed target units");
  await expect(mixed).not.toContainText(/10,?005/);
  await expect(page.getByTestId(`tl-staff-row-${group.targetUsers.ZERO.id}`).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByTestId(`tl-staff-row-${group.targetUsers.NONE.id}`)).toContainText("Target results unavailable");
  await expect(page.getByTestId(`tl-staff-row-${group.targetUsers.NONE.id}`).getByRole("progressbar")).toHaveCount(0);
  await openWorkspace(page, "Timeline");
  await page.getByRole("tab", { name: "Team Timeline", exact: true }).click();
  await settled(page);
  await selectBrandedOption(page.getByRole("combobox", { name: "Timeline case", exact: true }), fixture.cases[0].desktop.id);
  const times = await page.getByTestId("tl-dashboard").locator("li time[datetime]").evaluateAll(elements => elements.map(element => element.getAttribute("datetime")));
  expect(times.length).toBeGreaterThan(0);
  expect(times.every(time => Number.isFinite(Date.parse(time!)))).toBe(true);
  expect(times).toEqual([...times].sort());
  await page.screenshot({ path: testInfo.outputPath("tl-filtered-timeline.png"), fullPage: true });
  await signOut(page);
  await enter(page, group.users.EMPTY.email);
  await openWorkspace(page, "Cases");
  await expect(page.getByTestId("tl-review-queue")).toContainText("No records match the selected filters");
  expect((await page.getByTestId("tl-review-queue").boundingBox())!.height).toBeLessThan(240);
  await openWorkspace(page, "My Team");
  await expect(page.getByText("No direct SE members assigned.", { exact: true })).toBeVisible();
  await openWorkspace(page, "Performance & Attendance");
  await expect(page.getByTestId("my-performance")).toContainText("No performance data for this period");
  await expect(page.getByText("Appraisal module not configured", { exact: true })).toBeVisible();
});
