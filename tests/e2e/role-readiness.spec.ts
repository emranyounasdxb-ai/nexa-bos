import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";
const common = ["Dashboard.View", "Notifications.View"];

type Scope = "own" | "team" | "office" | "company" | null;
type RoleDefinition = {
  code: string;
  permissions: string[];
  directory: Scope;
  customer: Scope;
  application: Scope;
  reporting: Scope;
  caseOwner?: boolean;
  office?: "DXB";
  expectedLinks: string[];
  hiddenLinks: string[];
};

type PreparedRole = RoleDefinition & { email: string; password: string };

const roleDefinitions: RoleDefinition[] = [
  {
    code: "ITM",
    permissions: [
      ...common,
      "Users.View",
      "Users.Unlock",
      "Users.GenerateResetLink",
      "Assets.View",
      "Assets.ManageMaster",
      "Assets.ManageStock",
      "Assets.Allocate",
      "Assets.Transfer",
      "Assets.Return",
      "Assets.ManageStatus",
      "Assets.ViewAudit",
    ],
    directory: "company",
    customer: null,
    application: null,
    reporting: null,
    expectedLinks: ["Dashboard", "Users", "Organization", "Banks & products", "Assets"],
    hiddenLinks: ["Applications", "Workflows", "Reports", "Finance"],
  },
  {
    code: "HR",
    permissions: [
      ...common,
      "Users.View",
      "Users.Create",
      "Users.Edit",
      "Attendance.View",
      "Attendance.Manage",
      "Attendance.Correct",
      "Attendance.Reports",
      "Targets.View",
    ],
    directory: "company",
    customer: null,
    application: null,
    reporting: "company",
    expectedLinks: ["Dashboard", "Users", "Attendance", "Attendance reports", "Targets"],
    hiddenLinks: ["Applications", "Workflows", "Finance"],
  },
  {
    code: "PRO",
    permissions: [
      ...common,
      "Users.View",
      "Users.Edit",
    ],
    directory: "company",
    customer: null,
    application: null,
    reporting: null,
    expectedLinks: ["Dashboard", "Users"],
    hiddenLinks: ["Applications", "Organization", "Workflows", "Reports", "Finance"],
  },
  {
    code: "FIN",
    permissions: [
      ...common,
      "Finance.View",
      "Finance.GeneratePayout",
      "Finance.EditAdjustment",
      "Finance.Review",
      "Finance.Finalize",
      "Finance.ReopenPeriod",
      "Finance.ViewCommissionRules",
      "Finance.ManageCommissionRules",
    ],
    directory: null,
    customer: null,
    application: null,
    reporting: "company",
    expectedLinks: ["Dashboard", "Finance"],
    hiddenLinks: ["Users", "Applications", "Workflows", "Organization"],
  },
  {
    code: "AUDITOR",
    permissions: [
      ...common,
      "Users.View",
      "Users.ViewAudit",
      "Customers.View",
      "Applications.View",
      "Reports.View",
      "Attendance.View",
      "Attendance.Reports",
      "Notifications.ViewAudit",
      "Targets.View",
      "Finance.View",
      "Finance.ViewCommissionRules",
      "Assets.View",
      "Assets.ViewAudit",
    ],
    directory: "company",
    customer: "company",
    application: "company",
    reporting: "company",
    expectedLinks: ["Dashboard", "Users", "Customers", "Applications", "Reports", "Finance"],
    hiddenLinks: ["Workflows", "Organization", "Banks & products", "User types"],
  },
  {
    code: "BDM",
    permissions: [
      ...common,
      "Customers.View",
      "Customers.Create",
      "Customers.Edit",
      "Applications.View",
      "Applications.Create",
      "Applications.Edit",
      "Reports.View",
      "Targets.View",
      "Targets.Create",
      "Targets.Edit",
      "Targets.Activate",
      "Targets.Deactivate",
      "Targets.ReopenPeriod",
    ],
    directory: "office",
    customer: "office",
    application: "office",
    reporting: "office",
    caseOwner: true,
    office: "DXB",
    expectedLinks: ["Dashboard", "Customers", "Applications", "Organization", "Banks & products", "Targets", "Reports"],
    hiddenLinks: ["Users", "Workflows", "Finance"],
  },
  {
    code: "SM",
    permissions: [
      ...common,
      "Users.View",
      "Customers.View",
      "Customers.Create",
      "Customers.Edit",
      "Applications.View",
      "Applications.Create",
      "Applications.Edit",
      "Reports.View",
    ],
    directory: "office",
    customer: "own",
    application: "own",
    reporting: "office",
    caseOwner: true,
    office: "DXB",
    expectedLinks: ["Dashboard", "Users", "Customers", "Applications", "Organization", "Banks & products", "Reports"],
    hiddenLinks: ["Workflows", "Finance"],
  },
  {
    code: "COD",
    permissions: [
      ...common,
      "Customers.View",
      "Customers.Create",
      "Customers.Edit",
      "Applications.View",
      "Applications.Create",
      "Applications.Edit",
      "Applications.Submit",
      "Applications.CorrectSubmittedData",
      "Applications.UpdateStage",
      "Applications.CorrectStage",
      "Applications.ReassignCaseOwner",
      "Applications.SetOutcome",
      "Applications.MarkDelay",
      "Applications.CorrectDelay",
    ],
    directory: "office",
    customer: "office",
    application: "office",
    reporting: "office",
    caseOwner: true,
    office: "DXB",
    expectedLinks: ["Dashboard", "Customers", "Applications", "Organization", "Banks & products"],
    hiddenLinks: ["Users", "Workflows", "Finance"],
  },
  {
    code: "TL",
    permissions: [
      ...common,
      "Customers.View",
      "Customers.Create",
      "Customers.Edit",
      "Applications.View",
      "Applications.Create",
      "Applications.Edit",
    ],
    directory: "team",
    customer: "team",
    application: "team",
    reporting: "team",
    caseOwner: true,
    office: "DXB",
    expectedLinks: ["Dashboard", "Customers", "Applications", "Organization", "Banks & products"],
    hiddenLinks: ["Users", "Workflows", "Reports", "Finance"],
  },
  {
    code: "SE",
    permissions: [
      ...common,
      "Customers.View",
      "Customers.Create",
      "Customers.Edit",
      "Applications.View",
      "Applications.Create",
      "Applications.Edit",
    ],
    directory: "own",
    customer: "own",
    application: "own",
    reporting: "own",
    caseOwner: true,
    office: "DXB",
    expectedLinks: ["Dashboard", "Customers", "Applications"],
    hiddenLinks: ["Users", "Organization", "Banks & products", "Workflows", "Reports", "Finance"],
  },
  {
    code: "OM",
    permissions: [
      ...common,
      "Customers.View",
      "Customers.Create",
      "Customers.Edit",
      "Applications.View",
      "Applications.Create",
      "Applications.Edit",
      "Attendance.View",
      "Attendance.ManageOffice",
      "Attendance.Reports",
      "Assets.View",
      "Assets.ManageMaster",
      "Assets.ManageStock",
      "Assets.Allocate",
      "Assets.Transfer",
      "Assets.Return",
      "Assets.ManageStatus",
      "Assets.ViewAudit",
    ],
    directory: "office",
    customer: "own",
    application: "own",
    reporting: "office",
    caseOwner: true,
    office: "DXB",
    expectedLinks: ["Dashboard", "Customers", "Applications", "Organization", "Banks & products", "Attendance", "Assets"],
    hiddenLinks: ["Users", "Workflows", "Finance"],
  },
];

async function expectOk(response: Awaited<ReturnType<APIRequestContext["get"]>>) {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response;
}

async function ensureOwner(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  const body = (await status.json()) as { available: boolean };
  if (body.available) {
    await expectOk(await request.post(`${apiOrigin}/api/v1/auth/bootstrap`, {
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
    }));
  }
  const login = await expectOk(await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: "owner@example.com", password: "OwnerPass1!" },
  }));
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function configureRoleMatrix(request: APIRequestContext): Promise<PreparedRole[]> {
  const headers = await ensureOwner(request);
  const permissions = await expectOk(await request.get(`${apiOrigin}/api/v1/permissions`, { headers }));
  const allPermissions = ((await permissions.json()) as { items: Array<{ code: string }> }).items
    .map((item) => item.code);
  const typesResponse = await expectOk(await request.get(`${apiOrigin}/api/v1/user-types`, { headers }));
  const types = (await typesResponse.json()) as { items: Array<{ code: string; id: string }> };
  let fin = types.items.find((item) => item.code === "FIN");
  if (!fin) {
    const created = await expectOk(await request.post(`${apiOrigin}/api/v1/user-types`, {
      headers,
      data: { code: "FIN", name: "Finance Manager", description: "Disposable role readiness test" },
    }));
    fin = (await created.json()) as { code: string; id: string };
    await expectOk(await request.post(`${apiOrigin}/api/v1/user-types/${fin.id}/activate`, { headers }));
    types.items.push(fin);
  }
  const gm: RoleDefinition = {
    code: "GM",
    permissions: allPermissions.filter((code) => code !== "Attendance.ManageOffice"),
    directory: "company",
    customer: "company",
    application: "company",
    reporting: "company",
    caseOwner: true,
    expectedLinks: ["Dashboard", "Users", "Customers", "Applications", "Workflows", "Reports", "Finance", "User types"],
    hiddenLinks: [],
  };
  const definitions = [gm, ...roleDefinitions];
  const officesResponse = await expectOk(await request.get(`${apiOrigin}/api/v1/offices`, { headers }));
  const offices = (await officesResponse.json()) as { items: Array<{ code: string; id: string }> };
  const designationsResponse = await expectOk(await request.get(`${apiOrigin}/api/v1/designations`, { headers }));
  const designationId = ((await designationsResponse.json()) as { items: Array<{ id: string }> }).items[0]!.id;
  const suffix = Date.now().toString().slice(-8);
  const prepared: PreparedRole[] = [];

  for (const [index, role] of definitions.entries()) {
    const type = types.items.find((item) => item.code === role.code)!;
    await expectOk(await request.put(`${apiOrigin}/api/v1/user-types/${type.id}/permissions`, {
      headers,
      data: { permissions: role.permissions },
    }));
    for (const [path, key, value] of [
      ["scope", "visibility_scope", role.directory],
      ["customer-scope", "customer_visibility_scope", role.customer],
      ["application-scope", "application_visibility_scope", role.application],
      ["reporting-scope", "reporting_visibility_scope", role.reporting],
    ] as const) {
      await expectOk(await request.put(`${apiOrigin}/api/v1/user-types/${type.id}/${path}`, {
        headers,
        data: { [key]: value },
      }));
    }
    if (role.caseOwner) {
      await expectOk(await request.put(`${apiOrigin}/api/v1/user-types/${type.id}/case-owner`, {
        headers,
        data: { can_be_case_owner: true },
      }));
    }
    const password = `Review-${role.code}-${suffix}!9a`;
    const email = `${role.code.toLowerCase()}-${suffix}@review.test`;
    const officeId = role.office
      ? offices.items.find((office) => office.code === role.office)!.id
      : null;
    const user = await expectOk(await request.post(`${apiOrigin}/api/v1/users`, {
      headers,
      data: {
        full_name: `REVIEW ONLY ${role.code}`,
        employee_code: `R${suffix}${String(index).padStart(2, "0")}`,
        email,
        mobile: `+97150${String(1000000 + index).slice(-7)}`,
        designation_id: designationId,
        employment_status: "Active",
        joining_date: "2026-09-01",
        office_id: officeId,
        user_type_id: type.id,
      },
    }));
    const userId = ((await user.json()) as { id: string }).id;
    await expectOk(await request.post(`${apiOrigin}/api/v1/users/${userId}/activate`, { headers }));
    const setup = await expectOk(await request.post(`${apiOrigin}/api/v1/auth/users/${userId}/setup-link`, { headers }));
    const token = ((await setup.json()) as { token: string }).token;
    await expectOk(await request.post(`${apiOrigin}/api/v1/auth/setup`, {
      data: { token, password },
    }));
    prepared.push({ ...role, email, password });
  }
  return prepared;
}

async function signIn(page: Page, role: PreparedRole) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(role.email);
  await page.getByLabel("Password").fill(role.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/reports$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByLabel("Open user menu").click();
  const signOutButton = page.locator("header").getByRole("button", { name: "Sign out" });
  await signOutButton.waitFor({ state: "visible" });
  const logoutResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/auth/logout") && response.request().method() === "POST",
  );
  await signOutButton.click();
  expect((await logoutResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
  const session = await page.request.get(`${apiOrigin}/api/v1/auth/me`);
  expect(session.status()).toBe(401);
}

test("approved roles land on Dashboard with permission-aware navigation and fail-closed Workflow routes", async ({
  page,
  request,
}) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const roles = await configureRoleMatrix(request);
  const sidebar = page.getByRole("navigation", { name: "Primary" });

  for (const role of roles) {
    await signIn(page, role);
    for (const label of role.expectedLinks) {
      await expect(sidebar.locator(`a[aria-label="${label}"]`), `${role.code}: ${label}`).toHaveCount(1);
    }
    for (const label of role.hiddenLinks) {
      await expect(sidebar.locator(`a[aria-label="${label}"]`), `${role.code}: ${label}`).toHaveCount(0);
    }
    await page.goto("/workflows");
    if (role.code === "GM") {
      await expect(page.getByRole("heading", { name: "Workflow Designer" })).toBeVisible();
    } else {
      await expect(page.getByText("Workflow access is restricted to OWNER and GM.")).toBeVisible();
    }
    await signOut(page);
  }
});

test("role actions remain bounded and responsive on desktop and mobile", async ({ page, request }) => {
  test.setTimeout(420_000);
  const roles = await configureRoleMatrix(request);
  const byCode = new Map(roles.map((role) => [role.code, role]));

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, byCode.get("HR")!);
  await page.goto("/users");
  await expect(page.getByRole("link", { name: "Create user" })).toBeVisible();
  await expect(page.getByRole("link", { name: "User types" })).toHaveCount(0);
  await signOut(page);

  await signIn(page, byCode.get("BDM")!);
  await page.goto("/applications");
  await expect(page.getByRole("link", { name: "Create application" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Workflows" })).toHaveCount(0);
  await signOut(page);

  await signIn(page, byCode.get("ITM")!);
  await page.goto("/applications");
  await expect(page.getByText(/permission/i).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Create application" })).toHaveCount(0);
  await signOut(page);

  await page.setViewportSize({ width: 390, height: 844 });
  for (const code of ["OM", "AUDITOR"] as const) {
    await signIn(page, byCode.get(code)!);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByLabel("Application sidebar")).toBeVisible();
    expect(await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBeTruthy();
    await page.getByLabel("Application sidebar").getByLabel("Close navigation").click();
    await signOut(page);
  }
});
