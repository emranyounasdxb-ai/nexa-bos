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
    hiddenLinks: ["Customers", "Applications", "Workflows", "Reports", "Finance"],
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
    hiddenLinks: ["Customers", "Applications", "Workflows", "Finance"],
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
    hiddenLinks: ["Customers", "Applications", "Organization", "Workflows", "Reports", "Finance"],
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
    hiddenLinks: ["Users", "Customers", "Applications", "Workflows", "Organization"],
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
    expectedLinks: ["Dashboard", "Users", "Applications", "Reports", "Finance"],
    hiddenLinks: ["Customers", "Workflows", "Organization", "Banks & products", "User types"],
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
    expectedLinks: ["Dashboard", "Applications", "Organization", "Banks & products", "Targets", "Reports"],
    hiddenLinks: ["Users", "Customers", "Workflows", "Finance"],
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
    expectedLinks: ["Dashboard", "Users", "Applications", "Organization", "Banks & products", "Reports"],
    hiddenLinks: ["Customers", "Workflows", "Finance"],
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
    expectedLinks: ["Dashboard", "Applications", "Organization", "Banks & products"],
    hiddenLinks: ["Users", "Customers", "Workflows", "Finance"],
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
    expectedLinks: ["Dashboard", "Applications", "Organization", "Banks & products"],
    hiddenLinks: ["Users", "Customers", "Workflows", "Reports", "Finance"],
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
    expectedLinks: ["Dashboard", "Applications"],
    hiddenLinks: ["Users", "Customers", "Organization", "Banks & products", "Workflows", "Reports", "Finance"],
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
    expectedLinks: ["Dashboard", "Applications", "Organization", "Banks & products", "Attendance", "Assets"],
    hiddenLinks: ["Users", "Customers", "Workflows", "Finance"],
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

async function prepareApplicationStageFixture(
  request: APIRequestContext,
  roles: PreparedRole[],
) {
  const headers = await ensureOwner(request);
  const ownerLogin = await expectOk(await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: "owner@example.com", password: "OwnerPass1!" },
  }));
  headers["X-CSRF-Token"] = ((await ownerLogin.json()) as { csrfToken: string }).csrfToken;
  const suffix = Date.now().toString().slice(-8);
  const offices = ((await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as {
    items: Array<{ id: string; code: string }>;
  }).items;
  const dxb = offices.find((office) => office.code === "DXB")!;
  const department = await expectOk(await request.post(`${apiOrigin}/api/v1/departments`, {
    headers,
    data: { office_id: dxb.id, name: `Stage Readiness ${suffix}`, code: `SR-${suffix}` },
  }));
  const departmentId = ((await department.json()) as { id: string }).id;
  const team = await expectOk(await request.post(`${apiOrigin}/api/v1/teams`, {
    headers,
    data: {
      office_id: dxb.id,
      department_id: departmentId,
      name: `Stage Readiness Team ${suffix}`,
      code: `SRT-${suffix}`,
    },
  }));
  const teamId = ((await team.json()) as { id: string }).id;
  const byCode = new Map(roles.map((role) => [role.code, role]));
  const findUser = async (code: "TL" | "SE") => {
    const email = byCode.get(code)!.email;
    const response = await expectOk(
      await request.get(`${apiOrigin}/api/v1/users?q=${encodeURIComponent(email)}`),
    );
    return ((await response.json()) as { items: Array<{ id: string; email: string }> })
      .items.find((user) => user.email === email)!;
  };
  const [tl, se] = await Promise.all([findUser("TL"), findUser("SE")]);
  await expectOk(await request.patch(`${apiOrigin}/api/v1/users/${tl.id}`, {
    headers,
    data: { office_id: dxb.id, department_id: departmentId, team_id: teamId },
  }));
  await expectOk(await request.patch(`${apiOrigin}/api/v1/users/${se.id}`, {
    headers,
    data: {
      office_id: dxb.id,
      department_id: departmentId,
      team_id: teamId,
      reporting_manager_id: tl.id,
    },
  }));
  await expectOk(await request.put(`${apiOrigin}/api/v1/teams/${teamId}/leader`, {
    headers,
    data: { user_id: tl.id },
  }));

  const banks = ((await (await request.get(`${apiOrigin}/api/v1/banks`)).json()) as {
    items: Array<{ id: string; code: string }>;
  }).items;
  const products = ((await (await request.get(`${apiOrigin}/api/v1/products`)).json()) as {
    items: Array<{ id: string; code: string }>;
  }).items;
  const bank = banks.find((item) => item.code === "DIB")!;
  const product = products.find((item) => item.code === "PF")!;
  const workflows = ((await (
    await request.get(
      `${apiOrigin}/api/v1/workflows?bank_id=${bank.id}&product_id=${product.id}`,
    )
  ).json()) as {
    items: Array<{
      id: string;
      status: string;
      stages: Array<{ id: string; systemKey: string | null }>;
    }>;
  }).items;
  let workflow = workflows.find(
    (item) =>
      item.status === "active" &&
      item.stages.some((stage) => stage.systemKey === "submitted"),
  );
  if (!workflow) {
    const created = await expectOk(await request.post(`${apiOrigin}/api/v1/workflows`, {
      headers,
      data: { bank_id: bank.id, product_id: product.id },
    }));
    const createdWorkflow = (await created.json()) as {
      id: string;
      stages: Array<{ id: string; systemKey: string | null }>;
    };
    await expectOk(await request.post(
      `${apiOrigin}/api/v1/workflows/${createdWorkflow.id}/stages`,
      { headers, data: { name: "Submitted", code: "SUBMITTED", sort_order: 20 } },
    ));
    const refreshed = (await (
      await request.get(`${apiOrigin}/api/v1/workflows/${createdWorkflow.id}`)
    ).json()) as {
      id: string;
      stages: Array<{ id: string; systemKey: string | null }>;
    };
    const entry = refreshed.stages.find(
      (stage) => stage.systemKey === "application_created",
    )!;
    const submitted = refreshed.stages.find((stage) => stage.systemKey === "submitted")!;
    await expectOk(await request.put(
      `${apiOrigin}/api/v1/workflows/${createdWorkflow.id}/transitions`,
      {
        headers,
        data: { items: [{ from_stage_id: entry.id, to_stage_id: submitted.id }] },
      },
    ));
    workflow = { ...refreshed, status: "active" };
  }
  const mappings = ((await (
    await request.get(
      `${apiOrigin}/api/v1/bank-products?bankId=${bank.id}&productId=${product.id}`,
    )
  ).json()) as { items: Array<{ id: string }> }).items;
  let variants = ((await (
    await request.get(`${apiOrigin}/api/v1/product-variants?bankProductId=${mappings[0].id}`)
  ).json()) as { items: Array<{ id: string }> }).items;
  if (!variants.length) {
    const variant = await expectOk(await request.post(`${apiOrigin}/api/v1/product-variants`, {
      headers,
      data: {
        bank_product_id: mappings[0].id,
        name: `Stage Readiness Variant ${suffix}`,
        code: `SRV${suffix}`,
        description: "Disposable application-stage readiness fixture",
      },
    }));
    variants = [(await variant.json()) as { id: string }];
  }
  const seLogin = await expectOk(await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: byCode.get("SE")!.email, password: byCode.get("SE")!.password },
  }));
  const seHeaders = {
    "X-CSRF-Token": ((await seLogin.json()) as { csrfToken: string }).csrfToken,
  };
  const createdApplication = await expectOk(await request.post(
    `${apiOrigin}/api/v1/applications`,
    {
      headers: seHeaders,
      data: {
        customer: {
          customer_type: "individual",
          full_name: `Stage Readiness Customer ${suffix}`,
          mobile: `+97157${suffix}`,
        },
        bank_id: bank.id,
        product_id: product.id,
        product_variant_id: variants[0].id,
        requested_amount: "10000",
      },
    },
  ));
  const application = (await createdApplication.json()) as {
    id: string;
    applicationCode: string;
    caseOwnerId: string;
  };
  expect(application.caseOwnerId).toBe(se.id);
  return { ...application, workflowId: workflow.id };
}

async function signIn(page: Page, role: PreparedRole) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(role.email);
  await page.getByLabel("Password").fill(role.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/reports$/, { timeout: 30_000 });
  await expect(
    page.locator("header").getByRole("heading", {
      name: role.code === "SE" ? "My Dashboard" : "Dashboard",
      exact: true,
    }),
  ).toBeVisible();
}

async function signOut(page: Page) {
  const navigationBackdrop = page.locator('button.fixed[aria-label="Close navigation"]');
  if (await navigationBackdrop.isVisible()) {
    await navigationBackdrop.click();
    await expect(navigationBackdrop).toBeHidden();
  }
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
  await expect(page.getByRole("button", { name: "Create application" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Workflows" })).toHaveCount(0);
  await signOut(page);

  await signIn(page, byCode.get("ITM")!);
  await page.goto("/applications");
  await expect(page.getByText(/permission/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Create application" })).toHaveCount(0);
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

test("COD, TL, and SE use application-bound stage metadata without Workflow access", async ({
  page,
  request,
}) => {
  test.setTimeout(420_000);
  const roles = await configureRoleMatrix(request);
  const fixture = await prepareApplicationStageFixture(request, roles);
  const byCode = new Map(roles.map((role) => [role.code, role]));

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const code of ["COD", "TL", "SE"] as const) {
      await signIn(page, byCode.get(code)!);
      const deniedResponses: Array<{ path: string; status: number }> = [];
      const captureDenied = (response: { url(): string; status(): number }) => {
        if (response.status() < 400 || !response.url().includes("/api/v1/")) return;
        deniedResponses.push({
          path: new URL(response.url()).pathname,
          status: response.status(),
        });
      };
      page.on("response", captureDenied);
      await page.goto(`/applications/${fixture.id}?tab=actions`);
      await expect(page.getByText(fixture.applicationCode, { exact: true })).toBeVisible();
      await expect(page.getByText("You do not have permission to perform this action")).toHaveCount(0);
      if (code === "COD") {
        await expect(page.getByRole("button", { name: "Save and submit" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Update stage" })).toBeVisible();
      } else {
        await expect(page.getByRole("button", { name: "Save and submit" })).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "Update stage" })).toHaveCount(0);
      }
      expect(await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      )).toBeTruthy();
      expect(deniedResponses).toEqual([]);
      page.off("response", captureDenied);

      await page.goto("/workflows");
      await expect(page.getByText("Workflow access is restricted to OWNER and GM.")).toBeVisible();
      await signOut(page);
    }
  }
});

test.describe("shared sidebar role regression matrix", () => {
  let roles: PreparedRole[] = [];

  // Complete the existing matrix's representative expectations, without changing
  // any fixture permissions or deriving expected access from application code.
  const additionalLinks: Record<string, string[]> = {
    GM: ["Organization", "Hierarchy", "Attendance", "Attendance reports", "Targets",
      "KPI scorecards", "Assets", "Asset categories", "Asset reports", "Banks & products", "Security"],
    ITM: ["Hierarchy", "Asset categories", "Asset reports"],
    HR: ["Hierarchy", "KPI scorecards"],
    PRO: ["Hierarchy"],
    FIN: [],
    AUDITOR: ["Hierarchy", "Attendance", "Attendance reports", "Targets", "KPI scorecards",
      "Assets", "Asset reports"],
    BDM: ["KPI scorecards"],
    SM: ["Hierarchy"],
    COD: [],
    TL: [],
    SE: [],
    OM: ["Attendance reports", "Asset categories", "Asset reports"],
  };

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(120_000);
    const request = await playwright.request.newContext();
    try {
      roles = await configureRoleMatrix(request);
      const gm = roles.find((role) => role.code === "GM")!;
      roles.unshift({
        ...gm,
        code: "OWNER",
        // The existing disposable bootstrap account; never a canonical login.
        email: "owner@example.com",
        password: "OwnerPass1!",
      });
    } finally {
      await request.dispose();
    }
  });

  test.afterAll(() => { roles = []; });

  for (const code of ["OWNER", "GM", ...roleDefinitions.map((role) => role.code)]) {
    test(`${code}: authorized mobile menus, dismissal, keyboard exclusion and desktop navigation`, async ({ page }) => {
      test.setTimeout(90_000);
      const role = roles.find((item) => item.code === code)!;
      const expectedLinks = [...role.expectedLinks, ...additionalLinks[code === "OWNER" ? "GM" : code]].sort();
      const longMenu = code === "OWNER" || code === "GM";
      await page.setViewportSize({ width: 390, height: 844 });
      await signIn(page, role);

      const sidebar = page.locator('aside[aria-label="Application sidebar"]');
      const navigation = sidebar.getByRole("navigation", { name: "Primary" });
      const trigger = page.getByRole("button", { name: "Open navigation" });
      const close = sidebar.getByRole("button", { name: "Close navigation" });
      const dashboard = navigation.locator('a[aria-label="Dashboard"]');
      const notifications = page.getByRole("link", { name: /Notifications, \d+ unread/ });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));

      const expectNoOverflow = async () => {
        expect(await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )).toBe(0);
      };
      const expectAuthorizedLinks = async () => {
        expect(await navigation.locator("a").evaluateAll(
          (links) => links.map((link) => link.getAttribute("aria-label")).sort(),
        )).toEqual(expectedLinks);
        for (const label of role.hiddenLinks) {
          await expect(navigation.locator(`a[aria-label="${label}"]`)).toHaveCount(0);
        }
        await expect(navigation.getByRole("link", { name: "Notifications", exact: true })).toHaveCount(0);
      };
      const expectClosed = async () => {
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
        await expect(trigger).toBeFocused();
        await expect(sidebar).toHaveJSProperty("inert", true);
        // Inert descendants remain in the DOM and can match role locators;
        // verify actual focus exclusion rather than asserting their removal.
        expect(await sidebar.evaluate((element) => {
          for (const control of element.querySelectorAll<HTMLElement>("a, button")) {
            control.focus();
            if (element.contains(document.activeElement)) return false;
          }
          return true;
        })).toBe(true);
        await page.keyboard.press("Tab");
        await expect(notifications).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(trigger).toBeFocused();
        await expectNoOverflow();
      };

      await expectAuthorizedLinks();
      await trigger.focus();
      await expectClosed();
      for (let cycle = 0; cycle < 3; cycle += 1) {
        await page.keyboard.press("Enter");
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        await expect(sidebar).toHaveJSProperty("inert", false);
        await expect(close).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(dashboard).toBeFocused();
        await page.keyboard.press("Escape");
        await expectClosed();

        await page.keyboard.press("Enter");
        await expect(close).toBeFocused();
        await close.click();
        await expectClosed();
      }

      await page.keyboard.press("Enter");
      for (const group of await navigation.getByRole("button").all()) {
        if (await group.getAttribute("aria-expanded") !== "true") await group.click();
        await expect(group).toHaveAttribute("aria-expanded", "true");
      }
      await expect(navigation.getByRole("link")).toHaveCount(expectedLinks.length);
      await expectAuthorizedLinks();
      const controls = navigation.locator("a:visible, button:visible");
      const lastLink = navigation.getByRole("link").last();
      await dashboard.focus();
      await expect.poll(() => navigation.evaluate((element) => element.scrollTop)).toBe(0);
      if (longMenu) {
        expect(await navigation.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
        await expect(lastLink).toHaveAccessibleName("Security");
        await expect(lastLink).not.toBeInViewport();
      }
      await close.focus();
      for (const control of await controls.all()) {
        // Tab, not locator.focus/click, must bring every authorized item into view.
        await page.keyboard.press("Tab");
        await expect(control).toBeFocused();
        await expect(control).toBeInViewport({ ratio: 1 });
      }
      await expect(lastLink).toBeFocused();
      if (longMenu) {
        expect(await navigation.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        await expect(close).toBeInViewport({ ratio: 1 });
      }
      await expectNoOverflow();
      await page.keyboard.press("Escape");
      await expectClosed();

      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(sidebar).toHaveJSProperty("inert", false);
      await expect(trigger).toBeHidden();
      await expect(close).toBeHidden();
      await dashboard.focus();
      await expect(sidebar).toHaveCSS("width", "224px");
      await expectAuthorizedLinks();
      await page.keyboard.press("Escape");
      await expect(dashboard).toBeFocused();
      await expect(sidebar).toHaveJSProperty("inert", false);
      for (const control of (await controls.all()).slice(1)) {
        await page.keyboard.press("Tab");
        await expect(control).toBeFocused();
        await expect(control).toBeInViewport({ ratio: 1 });
      }
      await expect(lastLink).toBeFocused();
      await dashboard.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/reports$/);
      await expectNoOverflow();
      expect(errors).toEqual([]);
      await signOut(page);
    });
  }
});
