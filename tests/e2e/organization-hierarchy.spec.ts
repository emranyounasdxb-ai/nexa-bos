import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

type Ref = { id: string; code: string; name: string };
type User = { id: string; employeeCode: string; fullName: string; email: string };

async function ensureOwner(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  if (!((await status.json()) as { available: boolean }).available) return;
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
  const body = (await login.json()) as { csrfToken: string; user: User };
  return { headers: { "X-CSRF-Token": body.csrfToken }, owner: body.user };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  const response = page.waitForResponse(
    (candidate) => candidate.url().endsWith("/api/v1/auth/login") && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  const login = await response;
  await expect(page.getByRole("heading", { name: /Dashboard|User directory/ })).toBeVisible({
    timeout: 30_000,
  });
  return ((await login.json()) as { csrfToken: string }).csrfToken;
}

async function createUser(
  request: APIRequestContext,
  headers: Record<string, string>,
  refs: { designationId: string; userTypeId: string },
  values: {
    tag: string;
    name: string;
    officeId: string;
    departmentId?: string;
    teamId?: string;
    managerId?: string;
    password?: string;
  },
): Promise<User> {
  const created = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: values.name,
      employee_code: `EMP-H-${values.tag}`,
      email: `hierarchy-${values.tag.toLowerCase()}@example.com`,
      mobile: `+9715${values.tag.replace(/\D/g, "").padEnd(8, "7").slice(0, 8)}`,
      designation_id: refs.designationId,
      employment_status: "Active",
      joining_date: "2026-08-01",
      office_id: values.officeId,
      department_id: values.departmentId,
      team_id: values.teamId,
      reporting_manager_id: values.managerId,
    },
  });
  expect(created.ok()).toBeTruthy();
  const user = (await created.json()) as User;
  expect(
    (
      await request.post(`${apiOrigin}/api/v1/users/${user.id}/assign-type`, {
        headers,
        data: { user_type_id: refs.userTypeId },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (await request.post(`${apiOrigin}/api/v1/users/${user.id}/activate`, { headers })).ok(),
  ).toBeTruthy();
  if (values.password) {
    const setup = await request.post(`${apiOrigin}/api/v1/auth/users/${user.id}/setup-link`, {
      headers,
    });
    expect(setup.ok()).toBeTruthy();
    const token = ((await setup.json()) as { token: string }).token;
    const password = await request.post(`${apiOrigin}/api/v1/auth/setup`, {
      data: { token, password: values.password },
    });
    expect(password.ok()).toBeTruthy();
  }
  return user;
}

test("company hierarchy filters, locates, expands, inspects, and refreshes reporting updates", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { headers, owner } = await ownerHeaders(request);
  const tag = Date.now().toString(16).slice(-7).toUpperCase();
  const offices = (
    (await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as { items: Ref[] }
  ).items;
  const dxb = offices.find((row) => row.code === "DXB")!;
  const designations = (
    (await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as { items: Ref[] }
  ).items;
  const userTypes = (
    (await (await request.get(`${apiOrigin}/api/v1/user-types`)).json()) as { items: Ref[] }
  ).items;
  const departmentResponse = await request.post(`${apiOrigin}/api/v1/departments`, {
    headers,
    data: { office_id: dxb.id, name: `Hierarchy E2E Department ${tag}`, code: `HED${tag}` },
  });
  expect(departmentResponse.ok()).toBeTruthy();
  const department = (await departmentResponse.json()) as Ref;
  const teamResponse = await request.post(`${apiOrigin}/api/v1/teams`, {
    headers,
    data: {
      office_id: dxb.id,
      department_id: department.id,
      name: `Hierarchy E2E Team ${tag}`,
      code: `HET${tag}`,
    },
  });
  expect(teamResponse.ok()).toBeTruthy();
  const team = (await teamResponse.json()) as Ref;
  const gmType = userTypes.find((row) => row.code === "GM")!;
  const seType = userTypes.find((row) => row.code === "SE")!;
  const common = { designationId: designations[0]!.id, userTypeId: gmType.id };
  const firstManager = await createUser(request, headers, common, {
    tag: `M1${tag}`,
    name: `Hierarchy First Manager ${tag}`,
    officeId: dxb.id,
    departmentId: department.id,
    teamId: team.id,
    managerId: owner.id,
  });
  const secondManager = await createUser(request, headers, common, {
    tag: `M2${tag}`,
    name: `Hierarchy Second Manager ${tag}`,
    officeId: dxb.id,
    departmentId: department.id,
    teamId: team.id,
    managerId: owner.id,
  });
  const employee = await createUser(
    request,
    headers,
    { designationId: designations[0]!.id, userTypeId: seType.id },
    {
      tag: `E${tag}`,
      name: `Hierarchy Located Employee ${tag}`,
      officeId: dxb.id,
      departmentId: department.id,
      teamId: team.id,
      managerId: firstManager.id,
    },
  );

  const csrfToken = await signIn(page, "owner@example.com", "OwnerPass1!");
  await page.getByRole("button", { name: "People menu" }).click();
  await page.getByRole("link", { name: "Hierarchy", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Organization hierarchy" })).toBeVisible();
  await page.getByLabel("Office filter").selectOption(dxb.id);
  await page.getByLabel("Department filter").selectOption(department.id);
  await page.getByLabel("Team filter").selectOption(team.id);

  const reportingTree = page.getByRole("list", { name: "Reporting tree" });
  const ownerNode = page.getByTestId(`hierarchy-node-${owner.id}`);
  await expect(ownerNode).toBeVisible();
  await expect(page.getByTestId(`hierarchy-node-${firstManager.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`hierarchy-node-${employee.id}`)).toHaveCount(0);
  const collapsedTreeHeight = (await reportingTree.boundingBox())?.height ?? 0;

  const ownerExpand = page.getByRole("button", {
    name: `Expand branch for ${owner.fullName}`,
  });
  await expect(ownerExpand).toHaveAttribute("aria-expanded", "false");
  await ownerExpand.click();
  await expect(page.getByText(firstManager.fullName, { exact: true })).toBeVisible();
  await expect(page.getByTestId(`hierarchy-node-${employee.id}`)).toHaveCount(0);

  const managerExpand = page.getByRole("button", {
    name: `Expand branch for ${firstManager.fullName}`,
  });
  await managerExpand.click();
  await expect(page.getByTestId(`hierarchy-node-${employee.id}`)).toBeVisible();
  expect((await reportingTree.boundingBox())?.height ?? 0).toBeGreaterThan(collapsedTreeHeight);
  const managerNodeBox = await page.getByTestId(`hierarchy-node-${firstManager.id}`).boundingBox();
  expect(managerNodeBox?.width).toBeLessThanOrEqual(224);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: `Collapse branch for ${firstManager.fullName}` })
    .click();
  await expect(page.getByTestId(`hierarchy-node-${employee.id}`)).toHaveCount(0);

  await page.getByLabel("Employee search").fill(employee.employeeCode);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByLabel("Hierarchy search results")
    .getByRole("button", { name: `${employee.employeeCode} — ${employee.fullName}` })
    .click();
  await expect(page.getByTestId(`hierarchy-node-${employee.id}`)).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  const selectedContext = page.getByRole("heading", { name: "Selected employee" }).locator("..");
  await expect(selectedContext).toBeVisible();
  await expect(selectedContext.getByText(employee.employeeCode, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open employee profile" })).toHaveAttribute(
    "href",
    `/users/${employee.id}`,
  );
  await page.getByRole("button", { name: "Collapse all" }).click();
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(page.getByTestId(`hierarchy-node-${employee.id}`)).toBeVisible();

  const update = await page.request.patch(`${apiOrigin}/api/v1/users/${employee.id}`, {
    headers: { "X-CSRF-Token": csrfToken },
    data: { reporting_manager_id: secondManager.id },
  });
  expect(update.ok(), await update.text()).toBeTruthy();
  await page.getByRole("button", { name: "Refresh hierarchy" }).click();
  await expect(page.getByText(secondManager.fullName, { exact: true })).toBeVisible();
  await expect(page.getByText(`${employee.fullName} → ${secondManager.fullName}`)).toBeVisible();
});

test("office-scoped hierarchy does not disclose hidden offices, users, search, or profiles", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { headers } = await ownerHeaders(request);
  const tag = `R${Date.now().toString(16).slice(-7).toUpperCase()}`;
  const offices = (
    (await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as { items: Ref[] }
  ).items;
  const dxb = offices.find((row) => row.code === "DXB")!;
  const auh = offices.find((row) => row.code === "AUH")!;
  const designations = (
    (await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as { items: Ref[] }
  ).items;
  const userTypes = (
    (await (await request.get(`${apiOrigin}/api/v1/user-types`)).json()) as { items: Ref[] }
  ).items;
  const seType = userTypes.find((row) => row.code === "SE")!;
  const hidden = await createUser(
    request,
    headers,
    { designationId: designations[0]!.id, userTypeId: seType.id },
    { tag: `H${tag}`, name: `Hidden Hierarchy Employee ${tag}`, officeId: auh.id },
  );
  const visible = await createUser(
    request,
    headers,
    { designationId: designations[0]!.id, userTypeId: seType.id },
    { tag: `V${tag}`, name: `Visible Hierarchy Employee ${tag}`, officeId: dxb.id },
  );
  const typeResponse = await request.post(`${apiOrigin}/api/v1/user-types`, {
    headers,
    data: { name: `Hierarchy Office Viewer ${tag}`, code: `HOV${tag}` },
  });
  expect(typeResponse.ok()).toBeTruthy();
  const type = (await typeResponse.json()) as Ref;
  expect(
    (await request.post(`${apiOrigin}/api/v1/user-types/${type.id}/activate`, { headers })).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.put(`${apiOrigin}/api/v1/user-types/${type.id}/permissions`, {
        headers,
        data: { permissions: ["Users.View"] },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.put(`${apiOrigin}/api/v1/user-types/${type.id}/scope`, {
        headers,
        data: { visibility_scope: "office" },
      })
    ).ok(),
  ).toBeTruthy();
  const viewer = await createUser(
    request,
    headers,
    { designationId: designations[0]!.id, userTypeId: type.id },
    {
      tag: `U${tag}`,
      name: `Hierarchy Office Viewer ${tag}`,
      officeId: dxb.id,
      password: "UserPass1!",
    },
  );

  await signIn(page, viewer.email, "UserPass1!");
  await page.goto("/organization/hierarchy");
  await expect(page.getByRole("heading", { name: "Organization hierarchy" })).toBeVisible();
  await expect(page.getByText(visible.fullName, { exact: true })).toBeVisible();
  await expect(page.getByText(hidden.fullName, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Office filter").locator(`option[value="${dxb.id}"]`)).toHaveCount(1);
  await expect(page.getByLabel("Office filter").locator(`option[value="${auh.id}"]`)).toHaveCount(0);
  await page.getByLabel("Employee search").fill(hidden.employeeCode);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("No authorized employees found.")).toBeVisible();

  await page.goto(`/users/${hidden.id}`);
  await expect(page.getByRole("heading", { name: hidden.fullName })).toHaveCount(0);
  await expect(page.getByText("User is outside your visibility scope")).toBeVisible();
});
