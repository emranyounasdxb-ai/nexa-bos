import { expect, test, type APIRequestContext } from "@playwright/test";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

type NamedRef = { id: string; code: string; name: string };

async function ensureOwner(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  const body = (await status.json()) as { available: boolean };
  if (!body.available) {
    return;
  }
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
  const body = (await login.json()) as { csrfToken: string };
  return { "X-CSRF-Token": body.csrfToken };
}

test("edit user office department team selectors do not silently clear invalid values", async ({
  page,
  request,
}) => {
  const headers = await ownerHeaders(request);
  const offices = ((await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as { items: NamedRef[] })
    .items;
  const dxb = offices.find((item) => item.code === "DXB");
  const auh = offices.find((item) => item.code === "AUH");
  expect(dxb && auh).toBeTruthy();
  const designations = (
    (await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as { items: NamedRef[] }
  ).items;
  const tag = Date.now().toString(16).slice(-8).toUpperCase();
  const dxbDept = await request.post(`${apiOrigin}/api/v1/departments`, {
    headers,
    data: { office_id: dxb!.id, name: `Edit DXB ${tag}`, code: `ED${tag.slice(0, 6)}` },
  });
  const otherDxbDept = await request.post(`${apiOrigin}/api/v1/departments`, {
    headers,
    data: { office_id: dxb!.id, name: `Other DXB ${tag}`, code: `EO${tag.slice(0, 6)}` },
  });
  const auhDept = await request.post(`${apiOrigin}/api/v1/departments`, {
    headers,
    data: { office_id: auh!.id, name: `Edit AUH ${tag}`, code: `EA${tag.slice(0, 6)}` },
  });
  expect(dxbDept.ok()).toBeTruthy();
  expect(otherDxbDept.ok()).toBeTruthy();
  expect(auhDept.ok()).toBeTruthy();
  const dxbDeptId = ((await dxbDept.json()) as NamedRef).id;
  const otherDxbDeptId = ((await otherDxbDept.json()) as NamedRef).id;
  const auhDeptId = ((await auhDept.json()) as NamedRef).id;
  const dxbTeam = await request.post(`${apiOrigin}/api/v1/teams`, {
    headers,
    data: {
      office_id: dxb!.id,
      department_id: dxbDeptId,
      name: `Edit Team ${tag}`,
      code: `ET${tag.slice(0, 6)}`,
    },
  });
  expect(dxbTeam.ok()).toBeTruthy();
  const dxbTeamId = ((await dxbTeam.json()) as NamedRef).id;
  const created = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Edit Org ${tag}`,
      employee_code: `EMP-ED-${tag}`,
      email: `edit-org-${tag.toLowerCase()}@example.com`,
      mobile: "+971500000030",
      designation_id: designations[0]?.id,
      employment_status: "Active",
      joining_date: "2026-04-01",
      office_id: dxb!.id,
      department_id: dxbDeptId,
      team_id: dxbTeamId,
    },
  });
  expect(created.ok()).toBeTruthy();
  const user = (await created.json()) as { id: string };

  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto(`/users/${user.id}/edit`);
  await expect(page.getByRole("heading", { name: "Edit user" })).toBeVisible();
  const office = page.locator("#edit-office");
  const department = page.locator("#edit-department");
  const team = page.locator("#edit-team");
  await expect(office).toHaveValue(dxb!.id);
  await expect(department).toHaveValue(dxbDeptId);
  await expect(team).toHaveValue(dxbTeamId);
  await expect(department.locator(`option[value="${auhDeptId}"]`)).toHaveCount(0);
  await expect(department.locator(`option[value="${otherDxbDeptId}"]`)).toHaveCount(1);

  await office.selectOption(auh!.id);
  await expect(office).toHaveValue(auh!.id);
  await expect(department).toHaveValue(dxbDeptId);
  await expect(team).toHaveValue(dxbTeamId);
  await expect(department.locator(`option[value="${auhDeptId}"]`)).toHaveCount(1);
  await expect(department.locator(`option[value="${dxbDeptId}"]`)).toHaveCount(1);
  await expect(department.locator(`option[value="${otherDxbDeptId}"]`)).toHaveCount(0);
  await expect(page.getByTestId("org-assignment-error")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  await department.selectOption(auhDeptId);
  await expect(team).toHaveValue(dxbTeamId);
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await team.selectOption("");
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: `Edit Org ${tag}` })).toBeVisible();
});

test("in-progress office edit is not overwritten by a late user refetch", async ({
  page,
  request,
}) => {
  const headers = await ownerHeaders(request);
  const offices = ((await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as { items: NamedRef[] })
    .items;
  const dxb = offices.find((item) => item.code === "DXB");
  const auh = offices.find((item) => item.code === "AUH");
  expect(dxb && auh).toBeTruthy();
  const designations = (
    (await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as { items: NamedRef[] }
  ).items;
  const tag = `RF${Date.now().toString(16).slice(-6).toUpperCase()}`;
  const dxbDept = await request.post(`${apiOrigin}/api/v1/departments`, {
    headers,
    data: { office_id: dxb!.id, name: `Refetch DXB ${tag}`, code: `RD${tag.slice(0, 6)}` },
  });
  const auhDept = await request.post(`${apiOrigin}/api/v1/departments`, {
    headers,
    data: { office_id: auh!.id, name: `Refetch AUH ${tag}`, code: `RA${tag.slice(0, 6)}` },
  });
  expect(dxbDept.ok()).toBeTruthy();
  expect(auhDept.ok()).toBeTruthy();
  const dxbDeptId = ((await dxbDept.json()) as NamedRef).id;
  const created = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Refetch Org ${tag}`,
      employee_code: `EMP-RF-${tag}`,
      email: `refetch-org-${tag.toLowerCase()}@example.com`,
      mobile: "+971500000031",
      designation_id: designations[0]?.id,
      employment_status: "Active",
      joining_date: "2026-04-01",
      office_id: dxb!.id,
      department_id: dxbDeptId,
    },
  });
  expect(created.ok()).toBeTruthy();
  const user = (await created.json()) as { id: string };
  let userGets = 0;
  await page.route(`**/api/v1/users/${user.id}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    userGets += 1;
    const response = await route.fetch();
    if (userGets >= 2) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    await route.fulfill({ response });
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto(`/users/${user.id}/edit`);
  await expect(page.getByRole("heading", { name: "Edit user" })).toBeVisible();
  const office = page.locator("#edit-office");
  const department = page.locator("#edit-department");
  await expect(office).toHaveValue(dxb!.id);
  await office.selectOption(auh!.id);
  await expect(office).toHaveValue(auh!.id);
  await expect(department).toHaveValue(dxbDeptId);
  await page.waitForTimeout(3000);
  await expect(office).toHaveValue(auh!.id);
  await expect(department).toHaveValue(dxbDeptId);
  await expect(page.getByTestId("org-assignment-error")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
});
