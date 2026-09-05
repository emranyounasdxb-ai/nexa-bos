import { expect, test, type APIRequestContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { selectBrandedOption } from "./helpers/select";

const api = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const testPassword = "UserPass1!";
type RecordId = { id: string; email: string; fullName: string; applicationCode: string; code: string; name: string };
type Group = { office: RecordId; departmentId: string; team: RecordId; users: Record<string, RecordId>; targetUsers: Record<string, RecordId> };
type MetricHistory = { unit: "cases"; basis: string; points: Array<{ date: string; value: number | null }> };
type MetricReport = { cards: Array<{ key: string }>; metricHistory: Record<string, MetricHistory | null> };

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
    const team = await save(request, "teams", headers, { code: `TT${code}${stamp}`, name: `Team ${code} ${stamp}`, office_id: office.id, department_id: department.id });
    const users: Record<string, RecordId> = {};
    let manager: string | undefined;
    for (const role of ["COD", "TL", "SE"]) {
      const user = await createUser(role, role, office, department.id, team, manager);
      users[role] = user;
      manager = user.id;
    }
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
    await save(request, `applications/${application.id}/internal-review`, tlHeaders, { action: "forward", expected_event_id: (await stateResponse.json()).eventId });
    await save(request, `applications/${application.id}/case-number`, await login(request, group.users.COD.email), { bank_case_number: `TL-${group.office.code}-${tag}-${stamp}` });
  }
  for (const group of groups) await createSubmitted(group, group.users.SE, "COUNT");
  for (const tag of ["OVER", "MIXED"]) await createSubmitted(groups[0], groups[0].targetUsers[tag], tag);
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
  const sidebar = page.getByLabel("Application sidebar", { exact: true });
  const trigger = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await trigger.isVisible() && await sidebar.evaluate(element => element.inert)) await trigger.click();
  await sidebar.getByRole("button", { name: "Open user menu", exact: true }).click();
  await sidebar.getByRole("menu", { name: "User account" }).getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function capturePreview(page: Page, testInfo: TestInfo, name: string) {
  await expect(page.getByTestId("tl-dashboard")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, animations: "disabled" });
}

async function expectTabFrame(page: Page, tabKey: "review" | "team" | "analytics" | "personal", viewportWidth: number) {
  await expect(page.getByTestId("tl-dashboard")).toHaveAttribute("aria-busy", "false");
  const workspace = page.getByRole("tabpanel");
  const tabs = page.getByRole("tablist", { name: "Team Leader dashboard workspaces" });
  const selected = tabs.locator(`[role="tab"][id="tl-tab-${tabKey}"]`);
  const inactive = tabs.getByRole("tab", { selected: false }).first();
  await expect(tabs.getByRole("tab")).toHaveCount(4);
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await expect(selected).toHaveAttribute("aria-controls", `tl-panel-${tabKey}`);
  await expect(workspace).toHaveAttribute("id", `tl-panel-${tabKey}`);
  await expect(workspace).toHaveAttribute("aria-labelledby", `tl-tab-${tabKey}`);
  await expect(page.getByRole("heading", { name: /^Welcome back, /, level: 1 })).toHaveCount(1);
  for (const tab of await tabs.getByRole("tab").all()) {
    expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await expect(tab.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  }
  const tabStyle = await selected.evaluate(element => {
    const style = getComputedStyle(element);
    return { radius: Number.parseFloat(style.borderTopLeftRadius), rightRadius: Number.parseFloat(style.borderTopRightRadius), color: style.color, background: style.backgroundColor };
  });
  const inactiveStyle = await inactive.evaluate(element => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
  expect(tabStyle.radius).toBeGreaterThanOrEqual(8);
  expect(tabStyle.rightRadius).toBeGreaterThanOrEqual(8);
  expect(tabStyle.color !== inactiveStyle.color || tabStyle.background !== inactiveStyle.background).toBe(true);
  const activeTabBox = (await selected.boundingBox())!;
  const workspaceBox = (await workspace.boundingBox())!;
  expect(Math.abs(activeTabBox.y + activeTabBox.height - workspaceBox.y)).toBeLessThanOrEqual(3);
  if (viewportWidth === 390) {
    const tabStripBox = (await tabs.boundingBox())!;
    expect(activeTabBox.x).toBeGreaterThanOrEqual(tabStripBox.x - 1);
    expect(activeTabBox.x + activeTabBox.width).toBeLessThanOrEqual(tabStripBox.x + tabStripBox.width + 1);
    await expect(page.getByRole("button", { name: "Previous dashboard tab", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next dashboard tab", exact: true })).toBeVisible();
    if (tabKey === "review") await expect(page.getByRole("button", { name: "Previous dashboard tab", exact: true })).toBeDisabled();
    if (tabKey === "personal") await expect(page.getByRole("button", { name: "Next dashboard tab", exact: true })).toBeDisabled();
  }

  const controls = [page.getByLabel("Period", { exact: true }), page.getByLabel("Scope", { exact: true }), page.getByRole("button", { name: "Refresh", exact: true }), page.getByRole("link", { name: "Create Application", exact: true })];
  const controlBoxes = await Promise.all(controls.map(control => control.boundingBox()));
  for (const box of controlBoxes) {
    expect(box).not.toBeNull();
    expect(Math.abs(box!.height - 32)).toBeLessThanOrEqual(1);
  }
  for (const control of controls.slice(0, 2)) {
    // The selected value must remain readable, not just accessible by its label.
    expect(await control.locator(":scope > span").evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
  }
  await expect(page.getByTestId("tl-dashboard").getByText("Period", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("tl-dashboard").getByText("Scope", { exact: true })).toHaveCount(0);
  if (viewportWidth === 1440) {
    expect(Math.max(...controlBoxes.map(box => box!.y)) - Math.min(...controlBoxes.map(box => box!.y))).toBeLessThanOrEqual(1);
    const tabBox = (await tabs.boundingBox())!;
    expect(Math.abs(controlBoxes[0]!.y + 16 - (tabBox.y + tabBox.height / 2))).toBeLessThanOrEqual(1);
    const lastTabBox = (await tabs.getByRole("tab").last().boundingBox())!;
    expect(lastTabBox.x + lastTabBox.width).toBeLessThanOrEqual(controlBoxes[0]!.x);
  }
  else {
    expect(Math.abs(controlBoxes[0]!.y - controlBoxes[1]!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(controlBoxes[2]!.y - controlBoxes[3]!.y)).toBeLessThanOrEqual(1);
  }
  await expectNoOverflow(page);
}

async function expectAlignedPanels(page: Page, titles: string[], viewportWidth: number) {
  // Attendance includes its current status badge in the heading's accessible name.
  const panels = titles.map(title => page.getByRole("heading").filter({ has: page.getByText(title, { exact: true }) }).locator(".."));
  for (const panel of panels) await expect(panel).toHaveCount(1);
  const boxes = await Promise.all(panels.map(panel => panel.boundingBox()));
  if (viewportWidth === 1440) {
    expect(Math.max(...boxes.map(box => box!.y)) - Math.min(...boxes.map(box => box!.y))).toBeLessThanOrEqual(1);
    expect(Math.max(...boxes.map(box => box!.height)) - Math.min(...boxes.map(box => box!.height))).toBeLessThanOrEqual(1);
  } else {
    for (let index = 1; index < boxes.length; index++) expect(boxes[index]!.y).toBeGreaterThanOrEqual(boxes[index - 1]!.y + boxes[index - 1]!.height);
  }
  for (const panel of panels) {
    expect(await panel.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  }
}

async function expectReviewLayout(page: Page, viewportWidth: number) {
  await expectTabFrame(page, "review", viewportWidth);
  const cards = page.getByTestId("tl-cards").getByRole("button");
  await expect(cards).toHaveCount(4);
  const cardBoxes = await Promise.all((await cards.all()).map(card => card.locator("..").boundingBox()));
  expect(Math.max(...cardBoxes.map(box => box!.width)) - Math.min(...cardBoxes.map(box => box!.width))).toBeLessThanOrEqual(1);
  for (let index = 0; index < cardBoxes.length; index += viewportWidth === 1440 ? 4 : 2) {
    const row = cardBoxes.slice(index, index + (viewportWidth === 1440 ? 4 : 2));
    expect(Math.max(...row.map(box => box!.height)) - Math.min(...row.map(box => box!.height))).toBeLessThanOrEqual(1);
  }
  for (const card of await cards.all()) await expect(card.locator("strong")).toHaveCSS("font-size", viewportWidth === 1440 ? "40px" : "36px");
  if (viewportWidth === 1440) expect(Math.max(...cardBoxes.map(box => box!.y)) - Math.min(...cardBoxes.map(box => box!.y))).toBeLessThanOrEqual(1);
  else {
    expect(Math.abs(cardBoxes[0]!.y - cardBoxes[1]!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(cardBoxes[2]!.y - cardBoxes[3]!.y)).toBeLessThanOrEqual(1);
    expect(cardBoxes[2]!.y).toBeGreaterThanOrEqual(cardBoxes[0]!.y + cardBoxes[0]!.height);
  }
  const queue = page.getByTestId("tl-review-queue");
  const activity = page.getByTestId("tl-review-activity");
  await expect(activity.getByRole("button", { name: "Recent team activity", exact: true })).toBeVisible();
  const queueBox = (await queue.boundingBox())!;
  const activityBox = (await activity.boundingBox())!;
  if (viewportWidth === 1440) {
    expect(Math.abs(queueBox.y - activityBox.y)).toBeLessThanOrEqual(1);
    expect(queueBox.width / activityBox.width).toBeGreaterThanOrEqual(1.5);
    expect(queueBox.width / activityBox.width).toBeLessThanOrEqual(3);
    expect(activityBox.x).toBeGreaterThan(queueBox.x + queueBox.width);
  } else {
    const queueColumnBottom = await queue.evaluate(element => element.parentElement!.getBoundingClientRect().bottom);
    expect(activityBox.y).toBeGreaterThanOrEqual(queueColumnBottom - 1);
    expect(Math.abs(activityBox.x - queueBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(activityBox.width - queueBox.width)).toBeLessThanOrEqual(1);
  }
  await expectNoOverflow(page);
}

async function expectMetricSparklines(page: Page, report: MetricReport, interactive = false) {
  for (const { key } of report.cards) {
    const spark = page.getByTestId(`tl-sparkline-${key}`);
    const history = report.metricHistory[key];
    if (!history || history.points.every(point => point.value === null)) {
      await expect(spark).toHaveAttribute("data-state", "unavailable");
      await expect(spark).toContainText("Trend unavailable");
      await expect(spark.locator("svg")).toHaveCount(0);
      continue;
    }
    expect(history.unit).toBe("cases");
    expect(history.basis.trim().length).toBeGreaterThan(0);
    await expect(spark).toHaveAttribute("data-state", "available");
    const points = spark.locator("g[data-date][data-value]");
    await expect(points).toHaveCount(history.points.length);
    await expect.poll(() => points.evaluateAll(nodes => nodes.map(node => ({ date: node.getAttribute("data-date"), value: node.getAttribute("data-value") === "null" ? null : Number(node.getAttribute("data-value")) })))).toEqual(history.points);
    if (!interactive || !["pending_review", "approved"].includes(key)) continue;
    const expectTooltip = async (point: { date: string; value: number | null }) => {
      const tooltip = spark.getByRole("tooltip");
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText(point.date);
      await expect(tooltip).toContainText(point.value === null ? "Unavailable" : `${point.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} cases`);
      await expect(tooltip).toContainText(history.basis);
    };
    await spark.focus();
    await spark.press("End");
    await expectTooltip(history.points.at(-1)!);
    await spark.press("Home");
    await expectTooltip(history.points[0]);
    if (history.points.length > 1) {
      await spark.press("ArrowRight");
      await expectTooltip(history.points[1]);
      await spark.press("ArrowLeft");
      await expectTooltip(history.points[0]);
    }
    await spark.press("Escape");
    await expect(spark.getByRole("tooltip")).toHaveCount(0);
    await points.last().locator("rect").hover();
    await expectTooltip(history.points.at(-1)!);
    await spark.press("Escape");
    await expect(spark).toBeFocused();
    await expect(spark.getByRole("tooltip")).toHaveCount(0);
  }
}

async function expectCompleteActivity(page: Page, eventCount: number) {
  const activity = page.getByTestId("tl-review-activity");
  const list = activity.getByTestId("tl-activity-list");
  await expect(list.getByRole("listitem")).toHaveCount(Math.min(3, eventCount));
  if (eventCount <= 3) return;
  const expand = activity.getByRole("button", { name: `Show all ${eventCount} updates`, exact: true });
  await expand.click();
  await expect(list.getByRole("listitem")).toHaveCount(eventCount);
  expect(await list.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  const links = list.getByRole("link");
  await links.first().focus();
  for (let index = 1; index < eventCount; index += 1) await page.keyboard.press("Tab");
  await expect(links.last()).toBeFocused();
  await expect(links.last()).toBeInViewport({ ratio: 1 });
  await activity.getByRole("button", { name: "Show fewer updates", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(expand).toBeFocused();
}

async function expectProgress(row: Locator, name: string, percentage: number) {
  const progress = row.getByRole("progressbar", { name: `${name} target achievement`, exact: true });
  const bounded = Math.min(percentage, 100);
  await expect(progress).toHaveAttribute("aria-valuemin", "0");
  await expect(progress).toHaveAttribute("aria-valuemax", "100");
  await expect(progress).toHaveAttribute("aria-valuenow", String(bounded));
  await expect(progress).toHaveAttribute("aria-valuetext", new RegExp(`^${percentage}% achieved`));
  // The drawn fill must occupy its honest fraction of a fixed 0–100% track.
  const track = await progress.boundingBox();
  const fill = await progress.getByTestId("target-progress-fill").boundingBox();
  expect(track).not.toBeNull(); expect(fill).not.toBeNull();
  expect(track!.width).toBeGreaterThan(40);
  expect(Math.abs(fill!.width / track!.width * 100 - bounded)).toBeLessThanOrEqual(0.6);
}

test("DXB and AUH TL review: scope, tabs, charts, breadcrumbs and responsive queues", async ({ page, request }, testInfo) => {
  test.setTimeout(300_000);
  const fixture = await seed(request);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const index of [0, 1]) {
    const group = fixture.groups[index];
    const other = fixture.cases[1 - index].desktop;
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const app = viewport.width === 1440 ? fixture.cases[index].desktop : fixture.cases[index].mobile;
      await page.setViewportSize(viewport);
      await signIn(page, group.users.TL.email, `Welcome back, ${group.users.TL.fullName}`);
      await expect(page.getByTestId("tl-team-context")).toHaveText(group.team.name);
      await expect(page.getByRole("heading", { name: `Welcome back, ${group.users.TL.fullName}`, exact: true })).toHaveCount(1);
      await expect(page.getByRole("tab", { name: "Review", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("tl-dashboard")).not.toContainText(fixture.groups[1-index].users.SE.fullName);
      await expect(page.getByTestId("tl-dashboard")).not.toContainText(other.applicationCode);
      await expect(page.getByText("Top employees", { exact: true })).toHaveCount(0);
      const priorityCards = page.getByTestId("tl-cards").getByRole("button");
      await expect(priorityCards).toHaveCount(4);
      expect(await priorityCards.evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")))).toEqual(["Pending Review queue", "Resubmitted queue", "Returned queue", "Forwarded to COD queue"]);
      await expect(page.getByTestId("tl-bank-status").getByRole("button", { name: "Bank Approved queue", exact: true })).toBeVisible();
      await expect(page.getByTestId("tl-review-queue")).toContainText(app.applicationCode);
      await expect(page.getByTestId("tl-review-queue")).toContainText(group.users.SE.fullName);
      const initialReportResponse = await page.request.get(`${api}/api/v1/reports/tl-dashboard?period=mtd&view=combined&queue=pending_review&page=1`);
      expect(initialReportResponse.status()).toBe(200);
      const report = await initialReportResponse.json();
      expect(report.metricHistory.approved.points.every((point: { value: number | null }) => point.value === 0)).toBe(true);
      for (const card of report.cards as Array<{ key: string; count: number }>) expect(report.metricHistory[card.key].points.at(-1).value).toBe(card.count);
      await expectReviewLayout(page, viewport.width);
      await expectMetricSparklines(page, report, true);
      await expectCompleteActivity(page, report.activity.length);
      if (index === 0 && viewport.width === 1440) {
        await selectBrandedOption(page.getByLabel("Period"), "today");
        const todayResponse = await page.request.get(`${api}/api/v1/reports/tl-dashboard?period=today&view=combined&queue=pending_review&page=1`);
        expect(todayResponse.status()).toBe(200);
        const todayReport = await todayResponse.json();
        expect(todayReport.metricHistory.pending_review.points).toHaveLength(1);
        await expectMetricSparklines(page, todayReport, true);
        await selectBrandedOption(page.getByLabel("Period"), "mtd");
        await expectMetricSparklines(page, report);
      }
      await capturePreview(page, testInfo, `tl-${group.office.code}-${viewport.width}-review`);
      const reviewQueue = page.getByTestId("tl-review-queue");
      const reviewToggle = reviewQueue.getByRole("button", { name: /· Review queue/ });
      const pendingCard = page.getByRole("button", { name: "Pending Review queue", exact: true });
      await expect(pendingCard).toHaveAttribute("aria-pressed", "true");
      await reviewToggle.click();
      await expect(reviewToggle).toHaveAttribute("aria-expanded", "false");
      await expect(reviewQueue.getByRole("heading", { name: "Pending Review review queue", exact: true })).toHaveCount(0);
      await pendingCard.focus(); await page.keyboard.press("Enter");
      await expect(reviewToggle).toHaveAttribute("aria-expanded", "true");
      await expect(reviewQueue.getByRole("heading", { name: "Pending Review review queue", exact: true })).toBeFocused();
      await expect(page.getByTestId("tl-dashboard")).toHaveAttribute("aria-busy", "false");
      await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
      if (viewport.width === 390) {
        const trigger = page.getByRole("button", { name: "Open navigation", exact: true });
        const sidebar = page.getByLabel("Application sidebar", { exact: true });
        await trigger.focus();
        await page.keyboard.press("Enter");
        await expect(sidebar.getByRole("button", { name: "Close navigation", exact: true })).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        await expect(sidebar).toHaveJSProperty("inert", true);
        await page.keyboard.press("Tab");
        expect(await sidebar.evaluate(element => element.contains(document.activeElement))).toBe(false);
        const previousTab = page.getByRole("button", { name: "Previous dashboard tab", exact: true });
        const nextTab = page.getByRole("button", { name: "Next dashboard tab", exact: true });
        await expect(previousTab).toBeDisabled();
        for (const label of ["Team Performance", "Analytics", "My Performance & Attendance"]) {
          await nextTab.click();
          await expect(page.getByRole("tab", { name: label, exact: true })).toHaveAttribute("aria-selected", "true");
          await expect(page.getByRole("tab", { name: label, exact: true })).toBeInViewport({ ratio: 1 });
        }
        await expect(nextTab).toBeDisabled();
        await page.getByRole("tab", { name: "My Performance & Attendance", exact: true }).focus();
        await page.keyboard.press("Home");
        await expect(page.getByRole("tab", { name: "Review", exact: true })).toBeFocused();
        await expect(page.getByRole("tab", { name: "Review", exact: true })).toBeInViewport({ ratio: 1 });
        await expect(previousTab).toBeDisabled();
      }
      await page.getByRole("tab", { name: "Team Performance", exact: true }).click();
      await expect(page).toHaveURL(/tab=team/);
      await expect(page.getByTestId("tl-dashboard")).toHaveAttribute("aria-busy", "false");
      await expectTabFrame(page, "team", viewport.width);
      await expect(page.getByTestId("tl-team-performance")).toContainText(group.users.SE.fullName);
      const member = page.getByTestId(`tl-staff-row-${group.users.SE.id}`);
      await expect(member.getByText("Historical trends for these team metrics are not provided by the current dashboard.", { exact: true })).toHaveCount(1);
      await expect(member.getByText("Trend unavailable", { exact: true })).toHaveCount(0);
      for (const metric of await member.locator('[data-history="unavailable"]').all()) {
        await expect(metric).toHaveAttribute("aria-describedby", `tl-team-history-${group.users.SE.id}`);
        await expect(metric.locator("svg")).toHaveCount(0);
      }
      await expect(page.getByTestId("tl-team-performance").getByText(`${report.staff.length} ${report.staff.length === 1 ? "member" : "members"}`, { exact: true })).toBeVisible();
      await expectProgress(member, group.users.SE.fullName, 20);
      await expect(member).toContainText(/Application count|Applications|Count/);
      await expect(member.getByRole("definition").filter({ hasText: /^5$/ })).toHaveCount(1);
      expect(report.staff.find((person: { id: string }) => person.id === group.users.SE.id).target).toMatchObject({ assigned: "5.00", achieved: "1.00", remaining: "4.00", achievementPct: 20, measurement: "count" });
      if (index === 0) {
        const over = page.getByTestId(`tl-staff-row-${group.targetUsers.OVER.id}`);
        await expectProgress(over, group.targetUsers.OVER.fullName, 120);
        await expect(over).toContainText("120%");
        await expect(over).toContainText("20% above target");
        await expect(over).toContainText("AED");
        await expect(over.getByText("Exceeded by", { exact: true })).toBeVisible();
        await expect(over.getByRole("definition").filter({ hasText: /^AED 2,?000(?:\.00)?$/ })).toHaveCount(1);
        await expect(over).not.toContainText(/AED -2,?000/);
        const mixed = page.getByTestId(`tl-staff-row-${group.targetUsers.MIXED.id}`);
        expect(report.staff.find((person: { id: string }) => person.id === group.targetUsers.MIXED.id).target).toMatchObject({ assigned: null, achieved: null, remaining: null, measurement: null });
        await expect(mixed).toContainText("Mixed target units");
        await expect(mixed).toContainText("Average achievement");
        await expect(mixed).not.toContainText(/10,?005/);
        const zero = page.getByTestId(`tl-staff-row-${group.targetUsers.ZERO.id}`);
        await expectProgress(zero, group.targetUsers.ZERO.fullName, 0);
        await expect(zero).not.toContainText("Target results unavailable");
        const missing = page.getByTestId(`tl-staff-row-${group.targetUsers.NONE.id}`);
        await expect(missing).toContainText("Target results unavailable");
        await expect(missing.getByRole("progressbar")).toHaveCount(0);
      }
      await expect(page.getByTestId("tl-target-progress-chart")).toHaveCount(0);
      await capturePreview(page, testInfo, `tl-${group.office.code}-${viewport.width}-team`);
      await page.reload();
      await expect(page.getByRole("tab", { name: "Team Performance", exact: true })).toHaveAttribute("aria-selected", "true");
      await page.getByRole("tab", { name: "Team Performance", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("tab", { name: "Analytics", exact: true })).toHaveAttribute("aria-selected", "true");
      await expectTabFrame(page, "analytics", viewport.width);
      await expectAlignedPanels(page, ["Applications trend", "Bank Stage tracker"], viewport.width);
      await expectAlignedPanels(page, ["Product mix", "Bank outcomes", "Waiting time & delays"], viewport.width);
      const trendToggle = page.getByRole("button", { name: "Applications trend", exact: true });
      await trendToggle.focus(); await trendToggle.press("Enter");
      await expect(trendToggle).toHaveAttribute("aria-expanded", "false");
      await expectAlignedPanels(page, ["Applications trend", "Bank Stage tracker"], viewport.width);
      await trendToggle.press("Enter");
      await expect(trendToggle).toHaveAttribute("aria-expanded", "true");
      for (const title of ["Applications trend", "Internal Review tracker", "Bank Stage tracker", "Product mix", "Bank outcomes", "Waiting time & delays"]) await expect(page.getByRole("heading", { name: title, exact: true }).getByRole("button", { name: title, exact: true })).toBeVisible();
      await expect(page.getByTestId("tl-trend-chart").getByRole("img").first()).toHaveAttribute("aria-label", /Applications trend/);
      const chartText = await page.getByTestId("tl-trend-chart").locator("svg text").evaluateAll(nodes => nodes.filter(node => ["Created", "Submitted", "Cases"].includes(node.textContent ?? "")).map(node => { const box = node.getBoundingClientRect(); return { label: node.textContent, top: box.top, bottom: box.bottom }; }));
      const createdLegend = chartText.find(item => item.label === "Created")!;
      const submittedLegend = chartText.find(item => item.label === "Submitted")!;
      const casesAxis = chartText.find(item => item.label === "Cases")!;
      expect(createdLegend).toBeDefined(); expect(submittedLegend).toBeDefined(); expect(casesAxis).toBeDefined();
      expect(Math.abs(createdLegend.top - submittedLegend.top)).toBeLessThanOrEqual(1);
      expect(casesAxis.top).toBeGreaterThan(createdLegend.bottom + 8);
      await expect(page.getByTestId("tl-stage-chart").getByRole("img").first()).toHaveAttribute("aria-label", /workflow context/);
      const firstStage = report.charts.stages[0] as { label: string; workflowContext: string };
      const stageHelp = page.getByTestId("tl-stage-chart").getByRole("button", { name: `About ${firstStage.label}`, exact: true });
      await stageHelp.focus();
      await expect(stageHelp).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("tooltip")).toBeVisible();
      await expect(page.getByRole("tooltip")).toContainText(firstStage.workflowContext);
      await page.keyboard.press("Escape");
      await expect(stageHelp).toHaveAttribute("aria-expanded", "false");
      await expect(stageHelp).toBeFocused();
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      for (const month of report.charts.trend as Array<{ name: string; created: number; submitted: number }>) await expect(page.getByTestId("tl-trend-chart").getByRole("img").first()).toHaveAttribute("aria-label", new RegExp(`${month.name}: ${month.created} created and ${month.submitted} submitted`));
      await expect(page.getByTestId("tl-product-chart")).toContainText("Personal Finance");
      await expect(page.getByTestId("tl-product-chart").locator("canvas")).toHaveCount(0);
      await expect(page.getByTestId("tl-outcome-chart").locator("canvas")).toHaveCount(0);
      const analyticsLinks = page.getByRole("tabpanel").getByRole("link");
      await expect(analyticsLinks).toHaveCount(4);
      for (const link of await analyticsLinks.all()) {
        const target = new URL((await link.getAttribute("href"))!, page.url());
        expect(target.pathname).toBe("/reports");
        expect(target.searchParams.get("tab")).toBe("review");
        expect(target.searchParams.get("period")).toBe("mtd");
        expect(target.searchParams.get("view")).toBe("combined");
        expect(target.searchParams.get("page")).toBe("1");
        const linkText = await link.textContent();
        expect(target.searchParams.get("queue")).toBe(linkText === "Review bank-approved cases" ? "approved" : linkText === "Review cases in selected period" ? "all" : "active");
      }
      await capturePreview(page, testInfo, `tl-${group.office.code}-${viewport.width}-analytics`);
      await page.getByRole("link", { name: "Review bank-approved cases", exact: true }).click();
      await expect(page.getByRole("tab", { name: "Review", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("button", { name: "Bank Approved queue", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("tl-review-queue")).toContainText("Approved · Review queue");
      await expect(page).toHaveURL(/queue=approved/);
      await page.goBack();
      await expect(page.getByRole("tab", { name: "Analytics", exact: true })).toHaveAttribute("aria-selected", "true");
      await page.getByRole("tab", { name: "My Performance & Attendance", exact: true }).click();
      await expect(page.getByTestId("my-performance")).toBeVisible();
      await expect(page.getByTestId("my-attendance")).toBeVisible();
      await expectTabFrame(page, "personal", viewport.width);
      await expectAlignedPanels(page, ["My Performance", "My Attendance"], viewport.width);
      const attendance = page.getByTestId("my-attendance");
      expect(report.personalAttendance.month).toMatch(/^\d{4}-\d{2}-01$/);
      const attendanceMonth = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${report.personalAttendance.month}T00:00:00Z`));
      await expect(attendance.getByRole("heading", { name: attendanceMonth, exact: true })).toBeVisible();
      for (const label of ["Duty", "Check-in", "Check-out", "Worked"]) await expect(attendance.getByRole("term").filter({ hasText: new RegExp(`^${label}$`) })).toBeVisible();
      await expect(attendance.getByRole("button", { name: /save|edit|check in|check out/i })).toHaveCount(0);
      const personal = page.getByTestId("my-performance");
      const unavailablePersonalHistory = personal.getByTestId("tl-metric-personal-applications");
      await expect(unavailablePersonalHistory).toHaveAttribute("data-history", "unavailable");
      await expect(unavailablePersonalHistory).toHaveAccessibleDescription("Historical trends for personal targets, KPI scores and application totals are not provided by the current dashboard.");
      await expect(unavailablePersonalHistory.locator("svg")).toHaveCount(0);
      await expect(personal.getByText("Trend unavailable", { exact: true })).toHaveCount(0);
      await expect(attendance.getByText("Trend unavailable", { exact: true })).toHaveCount(0);
      await expect(attendance.getByTestId("tl-metric-attendance-duty")).toHaveAttribute("data-history", "unavailable");
      if (index === 0) {
        expect(report.personalPerformance.target).toMatchObject({ assigned: "50000.00", achieved: "12500.00", remaining: "37500.00", achievementPct: 25, measurement: "amount" });
        await expectProgress(personal, "Personal Finance submitted", 25);
        for (const amount of ["50,000.00", "12,500.00", "37,500.00"]) await expect(personal.getByRole("definition").filter({ hasText: new RegExp(`^AED ${amount.replace(".", "\\.")}$`) })).toHaveCount(1);
        expect(report.personalAttendance.today).toMatchObject({ date: fixture.attendanceDate, status: "Present", scheduledStart: "09:00", scheduledEnd: "17:00", actualCheckIn: "09:05", actualCheckOut: "17:00", workedMinutes: 475 });
        for (const value of ["09:00–17:00", "09:05", "17:00", "7h 55m"]) await expect(attendance.getByRole("definition").filter({ hasText: new RegExp(`^${value}$`) })).toHaveCount(1);
        const workedHistory = attendance.getByTestId("tl-sparkline-attendance-worked");
        await expect(workedHistory).toHaveAttribute("data-state", "available");
        await expect(attendance.getByTestId("tl-metric-attendance-worked")).toHaveAttribute("data-history", "available");
        await expect(attendance).toContainText("Worked, late and early-departure trends use recorded days; gaps are not zero.");
        const expectedDays: Array<{ date: string; value: number | null }> = [];
        for (let date = new Date(`${report.personalAttendance.month}T00:00:00Z`); date.toISOString().slice(0, 10) <= fixture.attendanceDate; date = new Date(date.getTime() + 86400000)) {
          const day = date.toISOString().slice(0, 10);
          expectedDays.push({ date: day, value: day === fixture.attendanceDate ? 475 : null });
        }
        expect(await workedHistory.locator("g[data-date][data-value]").evaluateAll(nodes => nodes.map(node => ({ date: node.getAttribute("data-date"), value: node.getAttribute("data-value") === "null" ? null : Number(node.getAttribute("data-value")) })))).toEqual(expectedDays);
        const knownPoint = workedHistory.locator(`g[data-date="${fixture.attendanceDate}"]`);
        const nullPoints = workedHistory.locator('g[data-value="null"]');
        await expect(nullPoints).toHaveCount(expectedDays.length - 1);
        await expect(nullPoints.locator("circle")).toHaveCount(0);
        const otherMetric = attendance.getByRole("term").filter({ hasText: /^Check-in$/ });
        await otherMetric.hover();
        await page.getByRole("tab", { name: "My Performance & Attendance", exact: true }).focus();
        await expect(workedHistory.getByRole("tooltip")).toHaveCount(0);
        await expect(knownPoint.locator("circle")).toHaveAttribute("r", "1.5");
        expect(Number(await knownPoint.locator("circle").getAttribute("cy"))).toBeLessThan(29);
        // One isolated recorded day must remain visible; missing days cannot become a zero line.
        await expect(workedHistory.locator("path").nth(1)).toHaveAttribute("d", /^\s*M[^ML]*$/);
        await workedHistory.focus();
        await workedHistory.press("Home");
        await expect(workedHistory.getByRole("tooltip")).toContainText(expectedDays[0].date);
        await expect(workedHistory.getByRole("tooltip")).toContainText(expectedDays[0].value === null ? "Unavailable" : "475 minutes");
        await workedHistory.press("End");
        await expect(workedHistory.getByRole("tooltip")).toContainText(`${fixture.attendanceDate}`);
        await expect(workedHistory.getByRole("tooltip")).toContainText("475 minutes");
        await knownPoint.locator("rect").hover();
        await otherMetric.hover();
        await expect(workedHistory).toBeFocused();
        await expect(workedHistory.getByRole("tooltip")).toBeVisible();
        await knownPoint.locator("rect").hover();
        await workedHistory.press("Escape");
        await otherMetric.hover();
        await expect(workedHistory).toBeFocused();
        await expect(workedHistory.getByRole("tooltip")).toHaveCount(0);
      } else {
        await expect(personal).toContainText("No target or KPI scorecard is assigned for this period.");
        await expect(personal.getByRole("progressbar")).toHaveCount(0);
        await expect(attendance).toContainText("Not recorded");
        await expect(attendance).toContainText("No recorded daily values for Worked, Late arrival, Early departure in this period.");
        for (const key of ["duty", "check-in", "check-out", "worked"]) {
          const metric = attendance.getByTestId(`tl-metric-attendance-${key}`);
          await expect(metric).toHaveAttribute("data-history", "unavailable");
          await expect(metric.locator("dd").first()).toHaveCSS("font-size", "16px");
        }
      }
      const monthly = attendance.locator("summary").filter({ hasText: /Monthly/ });
      await monthly.focus(); await page.keyboard.press("Enter");
      await expect(attendance.locator("details")).toHaveAttribute("open", "");
      if (index === 0) {
        const entry = attendance.locator("details li");
        await expect(entry).toHaveCount(1);
        await expect(entry).toContainText(fixture.attendanceDate);
        await expect(entry).toContainText("Present");
        await expect(entry).toContainText("09:05 / 17:00");
        await expect(entry).toContainText("7h 55m");
        await capturePreview(page, testInfo, `tl-${group.office.code}-${viewport.width}-personal-monthly`);
        await monthly.focus();
      } else await expect(attendance.getByText("No attendance records are available this month.")).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(attendance.locator("details")).not.toHaveAttribute("open", "");
      await capturePreview(page, testInfo, `tl-${group.office.code}-${viewport.width}-personal`);
      await page.getByRole("tab", { name: "Review", exact: true }).click();
      const attention = page.getByRole("button", { name: /^Attention Required/ });
      await expect(attention).toHaveAttribute("aria-expanded", "false");
      const attentionContent = page.locator(`[id="${await attention.getAttribute("aria-controls")}"]`);
      await expect(attentionContent).toHaveCount(0);
      await attention.press("Enter");
      await expect(attention).toHaveAttribute("aria-expanded", "true");
      await expect(attentionContent).toBeVisible();
      await attention.press("Space");
      await expect(attention).toHaveAttribute("aria-expanded", "false");
      await expect(attentionContent).toHaveCount(0);
      await expectNoOverflow(page);
      await reviewToggle.click();
      await expect(reviewToggle).toHaveAttribute("aria-expanded", "false");
      const card = page.getByRole("button", { name: "Returned queue", exact: true });
      await card.focus(); await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/queue=returned/);
      await expect(page.getByRole("heading", { name: "Returned review queue", exact: true })).toBeFocused();
      await expect(reviewToggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByTestId("tl-dashboard")).toHaveAttribute("aria-busy", "false");
      await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
      const emptyQueue = page.getByTestId("tl-review-queue");
      await expect(emptyQueue).toContainText("No Applications in this queue.");
      expect((await emptyQueue.boundingBox())!.height).toBeLessThan(200);
      await expect(emptyQueue.getByRole("button", { name: /^(Previous|Next)$/ })).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("button", { name: "Returned queue", exact: true })).toHaveAttribute("aria-pressed", "true");
      await selectBrandedOption(page.getByLabel("Scope"), "own");
      await page.getByRole("button", { name: "Active Team Cases queue" }).click();
      await expect(page.getByText(fixture.cases[index].own.applicationCode).first()).toBeVisible();
      await selectBrandedOption(page.getByLabel("Scope"), "team");
      await expect(page.getByTestId("tl-dashboard")).not.toContainText(fixture.cases[index].own.applicationCode);
      await selectBrandedOption(page.getByLabel("Period"), "ytd");
      await page.getByRole("tab", { name: "Analytics", exact: true }).click();
      await page.reload();
      await expect(page).toHaveURL(/period=ytd/);
      await expect(page).toHaveURL(/view=team/);
      await expect(page.getByRole("tab", { name: "Analytics", exact: true })).toHaveAttribute("aria-selected", "true");
      const scopedApproved = new URL((await page.getByRole("link", { name: "Review bank-approved cases", exact: true }).getAttribute("href"))!, page.url());
      expect(scopedApproved.searchParams.get("period")).toBe("ytd");
      expect(scopedApproved.searchParams.get("view")).toBe("team");
      expect(scopedApproved.searchParams.get("queue")).toBe("approved");
      await page.getByRole("tab", { name: "Analytics", exact: true }).focus();
      await page.keyboard.press("Home");
      await expect(page.getByRole("tab", { name: "Review", exact: true })).toBeFocused();
      const ytdResponse = await page.request.get(`${api}/api/v1/reports/tl-dashboard?period=ytd&view=team&queue=active&page=1`);
      expect(ytdResponse.status()).toBe(200);
      const ytdReport = await ytdResponse.json();
      expect(ytdReport.view).toBe("team");
      expect(ytdReport.metricHistory.pending_review.points.length).toBe(new Date().getUTCMonth() + 1);
      await expectMetricSparklines(page, ytdReport);
      await page.keyboard.press("End");
      await expect(page.getByRole("tab", { name: "My Performance & Attendance", exact: true })).toBeFocused();
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
      const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
      await expect(breadcrumb.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute("href", "/reports");
      await expect(breadcrumb.getByRole("link", { name: "Applications", exact: true })).toHaveAttribute("href", "/applications");
      await expect(breadcrumb.getByRole("heading", { name: "Application details", exact: true })).toHaveAttribute("aria-current", "page");
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
      await signIn(page, group.users.TL.email, `Welcome back, ${group.users.TL.fullName}`);
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
        await expect(page.getByTestId("tl-last-update")).toHaveText("Last update: —");
        await expect(page.getByTestId("tl-cards")).toHaveCount(0);
        await page.unroute("**/api/v1/reports/tl-dashboard?**");
        await page.getByRole("button", { name: "Refresh", exact: true }).click();
        await expect(page.getByTestId("tl-cards")).toBeVisible();
      }
      await signOut(page);
    }
  }
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await signIn(page, fixture.groups[0].users.EMPTY.email, `Welcome back, ${fixture.groups[0].users.EMPTY.fullName}`);
    const queue = page.getByTestId("tl-review-queue");
    await expect(queue).toContainText("No Applications in this queue.");
    expect((await queue.boundingBox())!.height).toBeLessThan(200);
    await expect(queue.getByRole("button", { name: /^(Previous|Next)$/ })).toHaveCount(0);
    await expectReviewLayout(page, viewport.width);
    const emptyReportResponse = await page.request.get(`${api}/api/v1/reports/tl-dashboard?period=mtd&view=combined&queue=pending_review&page=1`);
    expect(emptyReportResponse.status()).toBe(200);
    const emptyReport = await emptyReportResponse.json();
    for (const history of Object.values(emptyReport.metricHistory) as MetricHistory[]) expect(history.points.every(point => point.value === 0)).toBe(true);
    await expectMetricSparklines(page, emptyReport, true);
    await capturePreview(page, testInfo, `tl-empty-${viewport.width}-review`);
    await page.getByRole("tab", { name: "Team Performance", exact: true }).click();
    await expectTabFrame(page, "team", viewport.width);
    await expect(page.getByTestId("tl-team-performance")).toContainText("No SEs are currently assigned to this team.");
    await expect(page.getByTestId("tl-team-performance").getByRole("progressbar")).toHaveCount(0);
    await capturePreview(page, testInfo, `tl-empty-${viewport.width}-team`);
    await page.getByRole("tab", { name: "Analytics", exact: true }).click();
    await expectTabFrame(page, "analytics", viewport.width);
    await expectAlignedPanels(page, ["Applications trend", "Bank Stage tracker"], viewport.width);
    await expectAlignedPanels(page, ["Product mix", "Bank outcomes", "Waiting time & delays"], viewport.width);
    for (const chart of ["tl-trend-chart", "tl-stage-chart", "tl-product-chart", "tl-outcome-chart"]) {
      await expect(page.getByTestId(chart)).toBeVisible();
      await expect(page.getByTestId(chart).locator("canvas")).toHaveCount(0);
      expect((await page.getByTestId(chart).boundingBox())!.height).toBeLessThan(200);
    }
    await capturePreview(page, testInfo, `tl-empty-${viewport.width}-analytics`);
    await page.getByRole("tab", { name: "My Performance & Attendance", exact: true }).click();
    await expectTabFrame(page, "personal", viewport.width);
    await expectAlignedPanels(page, ["My Performance", "My Attendance"], viewport.width);
    await expect(page.getByTestId("my-performance")).toContainText("No target or KPI scorecard is assigned for this period.");
    await expect(page.getByTestId("my-performance").getByRole("progressbar")).toHaveCount(0);
    await capturePreview(page, testInfo, `tl-empty-${viewport.width}-personal`);
    await signOut(page);
  }
  expect(errors).toEqual([]);
});

test("TL welcome header and real database refresh preserve selections and last successful time", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const fixture = await seed(request);
  const group = fixture.groups[0];
  await signIn(page, group.users.TL.email, `Welcome back, ${group.users.TL.fullName}`);
  const endpoint = "**/api/v1/reports/tl-dashboard?**";
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/reports?tab=analytics&period=ytd&view=team&queue=pending_review&page=1");
    await expect(page.getByTestId("tl-dashboard")).toHaveAttribute("aria-busy", "false");
    const heading = page.getByRole("heading", { level: 1, name: `Welcome back, ${group.users.TL.fullName}`, exact: true });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveCSS("font-weight", "700");
    await expect(page.getByTestId("tl-team-context")).toHaveText(group.team.name);
    await expect(page.getByTestId("tl-team-context")).toHaveCSS("font-weight", "400");
    expect(await page.getByTestId("tl-team-context").evaluate(e => getComputedStyle(e).color)).not.toBe(await heading.evaluate(e => getComputedStyle(e).color));
    await expect(page.getByText("Team Leader Dashboard", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("tl-last-update")).not.toContainText("My Team");
    const url = page.url();
    const lastUpdate = page.getByTestId("tl-last-update").locator("time");
    const previousTime = await lastUpdate.getAttribute("datetime");
    const baselineResponse = await page.request.get(`${api}/api/v1/reports/tl-dashboard?period=ytd&view=team&queue=pending_review&page=1`);
    expect(baselineResponse.status()).toBe(200);
    const baseline = await baselineResponse.json();

    // Supported SE creation changes only this disposable database; never canonical data.
    const seHeaders = await login(request, group.users.SE.email);
    const created = await save(request, "applications", seHeaders, {
      customer: { customer_type: "individual", full_name: `Disposable refresh ${viewport.width} ${Date.now()}`, mobile: "+971500000012" },
      bank_id: fixture.bank.id, product_id: fixture.product.id, product_variant_id: fixture.variant.id, requested_amount: "13000",
    });
    expect(created.caseOwnerId).toBe(group.users.SE.id);
    let release!: () => void;
    let fetched!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const fetchedResponse = new Promise<void>(resolve => { fetched = resolve; });
    let fresh = baseline;
    let requests = 0;
    await page.route(endpoint, async route => {
      requests++;
      expect(route.request().method()).toBe("GET");
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      fresh = await response.json();
      fetched();
      await held;
      await route.fulfill({ response }); // Unchanged, authenticated response from the real test database.
    });
    try {
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await fetchedResponse;
      await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
      await expect(lastUpdate).toHaveAttribute("datetime", previousTime!);
      await expect(page).toHaveURL(url);
    } finally { release(); }
    await expect(page.getByTestId("tl-dashboard")).toHaveAttribute("aria-busy", "false");
    await expect(lastUpdate).toHaveAttribute("datetime", fresh.updatedAt);
    expect(Date.parse(fresh.updatedAt)).toBeGreaterThan(Date.parse(previousTime!));
    expect(requests).toBe(1);
    expect(fresh.charts.trend.at(-1).created).toBe(baseline.charts.trend.at(-1).created + 1);
    const pending = (report: { cards: Array<{ key: string; count: number }> }) => report.cards.find(card => card.key === "pending_review")!.count;
    expect(pending(fresh)).toBe(pending(baseline) + 1);
    const trendSummary = page.getByTestId("tl-trend-chart").getByRole("img", { name: /^Applications trend\./ });
    await expect(trendSummary).toHaveCount(1);
    await expect(trendSummary).toHaveAttribute("aria-label", new RegExp(`${fresh.charts.trend.at(-1).created} created`));
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("tab", { name: "Analytics", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Period", { exact: true })).toContainText("YTD");
    await expect(page.getByLabel("Scope", { exact: true })).toContainText("Team Cases");
    await page.unroute(endpoint);

    const successfulTime = fresh.updatedAt;
    await page.route(endpoint, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Disposable refresh unavailable" } }) }));
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("Disposable refresh unavailable", { exact: true })).toBeVisible();
    await expect(lastUpdate).toHaveAttribute("datetime", successfulTime);
    await expect(page.getByRole("tabpanel")).toHaveCount(0);
    await expect(page).toHaveURL(url);
    await page.unroute(endpoint);
    const recovery = page.waitForResponse(response => response.url().includes("/api/v1/reports/tl-dashboard?") && response.request().method() === "GET");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    const recovered = await recovery;
    expect(recovered.status()).toBe(200);
    const recoveredData = await recovered.json();
    await expect(lastUpdate).toHaveAttribute("datetime", recoveredData.updatedAt);
    await expect(page.getByText("Disposable refresh unavailable", { exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(url);
    await capturePreview(page, testInfo, `tl-welcome-${viewport.width}-analytics`);
    await page.getByRole("tab", { name: "Review", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pending Review queue", exact: true }).locator("strong")).toHaveText(String(pending(recoveredData)));
    await expect(page.getByTestId("tl-review-queue")).toContainText(created.applicationCode);
    await capturePreview(page, testInfo, `tl-welcome-${viewport.width}-review`);
    await page.reload();
    await expect(page.getByRole("tab", { name: "Review", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Period", { exact: true })).toContainText("YTD");
    await expect(page.getByLabel("Scope", { exact: true })).toContainText("Team Cases");
  }
  await signOut(page);
});
