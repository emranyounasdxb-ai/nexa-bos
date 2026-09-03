import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { brandedOptionValues, selectBrandedOption } from "./helpers/select";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

type Ref = { id: string; code: string; name: string; status?: string; officeId?: string };
type SeededMasters = {
  officeA: Ref;
  officeB: Ref;
  inactiveOffice: Ref;
  departmentA: Ref;
  departmentB: Ref;
  teamA: Ref;
};

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
  expect(created.ok(), await created.text()).toBeTruthy();
}

async function ownerHeaders(request: APIRequestContext) {
  await ensureOwner(request);
  const login = await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: "owner@example.com", password: "OwnerPass1!" },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  return {
    "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken,
  };
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Dashboard|User directory/ })).toBeVisible({
    timeout: 30_000,
  });
}

async function createRef(
  request: APIRequestContext,
  headers: Record<string, string>,
  path: string,
  data: Record<string, string>,
) {
  const response = await request.post(`${apiOrigin}${path}`, { headers, data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as Ref;
}

async function seedMasters(request: APIRequestContext): Promise<SeededMasters> {
  const headers = await ownerHeaders(request);
  const tag = Date.now().toString(16).slice(-7).toUpperCase();
  const officeA = await createRef(request, headers, "/api/v1/offices", {
    name: `Organization North ${tag}`,
    code: `ON${tag}`,
  });
  const officeB = await createRef(request, headers, "/api/v1/offices", {
    name: `Organization South ${tag}`,
    code: `OS${tag}`,
  });
  const inactiveOffice = await createRef(request, headers, "/api/v1/offices", {
    name: `Organization Archived ${tag}`,
    code: `OI${tag}`,
  });
  const deactivate = await request.post(
    `${apiOrigin}/api/v1/offices/${inactiveOffice.id}/deactivate`,
    { headers },
  );
  expect(deactivate.ok(), await deactivate.text()).toBeTruthy();
  const departmentA = await createRef(request, headers, "/api/v1/departments", {
    office_id: officeA.id,
    name: `North Operations ${tag}`,
    code: `DNA${tag}`,
  });
  const departmentB = await createRef(request, headers, "/api/v1/departments", {
    office_id: officeB.id,
    name: `South Operations ${tag}`,
    code: `DSB${tag}`,
  });
  const teamA = await createRef(request, headers, "/api/v1/teams", {
    office_id: officeA.id,
    department_id: departmentA.id,
    name: `North Team ${tag}`,
    code: `TNA${tag}`,
  });
  return { officeA, officeB, inactiveOffice, departmentA, departmentB, teamA };
}

async function expectNoPageOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBeTruthy();
}

test("Organization masters use URL tabs, filters, dependent drawers, and accessible dismissal", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const seeded = await seedMasters(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/organization");

  await expect(page).toHaveURL(/\/organization\?tab=offices$/);
  await expect(page.getByRole("heading", { name: "Organization masters", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View hierarchy" })).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "Organization masters" });
  await expect(tabs.getByRole("tab", { name: "Offices" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Offices", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Departments", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Organization master summary")).toContainText("Offices");
  await expect(page.getByLabel("Offices status filter")).toHaveAttribute("value", "all");
  await expect(page.getByRole("navigation", { name: "List pagination" })).toBeVisible();
  expect((await page.getByLabel("Search offices").boundingBox())?.height).toBe(32);
  expect((await page.getByLabel("Offices status filter").boundingBox())?.height).toBe(32);

  await page.getByLabel("Search offices").fill(seeded.inactiveOffice.code);
  await selectBrandedOption(page.getByLabel("Offices status filter"), "inactive");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText(seeded.inactiveOffice.name);
  await expect(page.getByText("1 row", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByLabel("Search offices")).toHaveValue("");
  await expect(page.getByLabel("Offices status filter")).toHaveAttribute("value", "all");

  await tabs.getByRole("tab", { name: "Departments" }).click();
  await expect(page).toHaveURL(/tab=departments/);
  await page.reload();
  await expect(tabs.getByRole("tab", { name: "Departments" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Departments", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Offices", exact: true })).toHaveCount(0);
  await tabs.getByRole("tab", { name: "Teams" }).click();
  await expect(page).toHaveURL(/tab=teams/);
  await page.goBack();
  await expect(page).toHaveURL(/tab=departments/);
  await expect(tabs.getByRole("tab", { name: "Departments" })).toHaveAttribute("aria-selected", "true");

  const addDepartment = page.getByRole("button", { name: "Add department" });
  await addDepartment.click();
  let drawer = page.getByRole("dialog", { name: "Add department" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("combobox", { name: "Office", exact: true })).toHaveAttribute("value", "");
  await expect(drawer.getByRole("combobox", { name: "Office", exact: true })).toContainText("Select office");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(addDepartment).toBeFocused();

  await addDepartment.click();
  drawer = page.getByRole("dialog", { name: "Add department" });
  await drawer.getByRole("textbox", { name: /Department name/ }).fill("Unsaved department");
  await page.keyboard.press("Escape");
  const discard = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Keep editing" }).click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(addDepartment).toBeFocused();

  await tabs.getByRole("tab", { name: "Teams" }).click();
  const addTeam = page.getByRole("button", { name: "Add team" });
  await addTeam.click();
  drawer = page.getByRole("dialog", { name: "Add team" });
  const officeSelect = drawer.getByRole("combobox", { name: "Office", exact: true });
  const departmentSelect = drawer.getByRole("combobox", { name: "Department", exact: true });
  await expect(officeSelect).toHaveAttribute("value", "");
  await expect(departmentSelect).toHaveAttribute("value", "");
  await expect(departmentSelect).toBeDisabled();
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(drawer.getByText("Select an office.")).toBeVisible();
  await expect(drawer.getByText("Select a department.")).toBeVisible();
  await selectBrandedOption(officeSelect, seeded.officeA.id);
  await expect(departmentSelect).toBeEnabled();
  const departmentValues = await brandedOptionValues(departmentSelect);
  expect(departmentValues).toContain(seeded.departmentA.id);
  expect(departmentValues).not.toContain(seeded.departmentB.id);
  await selectBrandedOption(departmentSelect, seeded.departmentA.id);
  await selectBrandedOption(officeSelect, seeded.officeB.id);
  await expect(departmentSelect).toHaveAttribute("value", "");
  await expect(departmentSelect).toContainText("Select department");
  await drawer.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("alertdialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();

  await tabs.getByRole("tab", { name: "Offices" }).click();
  const addOffice = page.getByRole("button", { name: "Add office" });
  await addOffice.click();
  drawer = page.getByRole("dialog", { name: "Add office" });
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(drawer.getByText("Enter an office name.")).toBeVisible();
  await expect(drawer.getByText("Enter an immutable code.")).toBeVisible();
  await drawer.getByRole("textbox", { name: /Office name/ }).fill("Duplicate office code");
  await drawer.getByRole("textbox", { name: /Immutable code/ }).fill(seeded.officeA.code.toLowerCase());
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(drawer.getByText(/office code must be unique and is immutable/i)).toBeVisible();
  await drawer.getByRole("button", { name: "Close organization drawer" }).click();
  await page.getByRole("alertdialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
  await expect(addOffice).toBeFocused();
  await expectNoPageOverflow(page);
});

test("Organization masters use readable mobile cards and a full-screen drawer without overflow", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await ownerHeaders(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/organization?tab=teams");
  await expect(page.getByRole("tab", { name: "Teams" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("organization-mobile-list")).toBeVisible();
  await expect(page.locator("table")).toBeHidden();
  await expectNoPageOverflow(page);

  const addTeam = page.getByRole("button", { name: "Add team" });
  await addTeam.click();
  const drawer = page.getByRole("dialog", { name: "Add team" });
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox?.x).toBe(0);
  expect(drawerBox?.width).toBe(390);
  await expect(drawer.getByRole("combobox", { name: "Office", exact: true })).toBeFocused();
  await expect(drawer.getByRole("combobox", { name: "Office", exact: true })).toHaveAttribute("value", "");
  await expect(drawer.getByRole("combobox", { name: "Department", exact: true })).toBeDisabled();
  await expectNoPageOverflow(page);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(addTeam).toBeFocused();
  await expectNoPageOverflow(page);
});
